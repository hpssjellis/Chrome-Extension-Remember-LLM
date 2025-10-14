// mySidePanelLogic.js

// --- Global Variables (myCamelCase) ---
// References to UI elements
const myContentArea = document.getElementById('contentArea');
const myStatusMessage = document.getElementById('statusMessage');
const myShowAllButton = document.getElementById('showAllBtn');
const myShowSelectedButton = document.getElementById('showSelectedBtn');
const myVisTimelineContainer = document.getElementById('myVisTimeline'); // New timeline container

// Timer state
let myTimerInterval;
let mySeconds = 0;

// Vis.js state
let myVisTimeline;
const myItemsData = new vis.DataSet([
    { id: 1, content: 'First Review', start: '2025-10-10' },
    { id: 2, content: 'Due Tomorrow', start: '2025-10-14' },
    { id: 3, content: 'Project Start', start: '2025-10-01', type: 'point' }
]);

// -------------------------------------------------------------------------
// --- TIMER MANAGEMENT ---
// -------------------------------------------------------------------------

function myStartTimer() {
    mySeconds = 0;
    // Use the statusMessage area for the timer display
    myStatusMessage.textContent = 'Thinking (0s)...';

    if (myTimerInterval) {
        clearInterval(myTimerInterval);
    }

    myTimerInterval = setInterval(() => {
        mySeconds++;
        myStatusMessage.textContent = `Thinking (${mySeconds}s)...`;
    }, 1000);
}

function myStopTimer() {
    if (myTimerInterval) {
        clearInterval(myTimerInterval);
        myTimerInterval = null;
    }
}

// -------------------------------------------------------------------------
// --- CONTENT RETRIEVAL FUNCTIONS (Injected into the Active Tab) ---
// -------------------------------------------------------------------------

// This function is injected to get all text from the page body.
function myGetPageText() {
    return document.body.innerText;
}

// This function is injected to get only the selected text.
function myGetSelectedText() {
    return window.getSelection().toString();
}

// -------------------------------------------------------------------------
// --- AI SUMMARIZATION CORE FUNCTION ---
// -------------------------------------------------------------------------

// This is the function that uses the LanguageModel API with a prompt.
async function mySummarizeWithPrompt(myText) {
    if (!('LanguageModel' in window)) {
        return 'Error: The Chrome LanguageModel API is not supported in this browser or is not enabled.';
    }

    try {
        // Define the JSON schema for the required output format
        const mySummarySchema = {
            "type": "object",
            "properties": {
                "heading": { "type": "string", "description": "A brief, descriptive title for the summary." },
                "sections": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "subheading": { "type": "string", "description": "A concise subheading for this specific section of the summary." },
                            "content": { "type": "string", "description": "The detailed, neutral summary content for this section." }
                        },
                        "required": ["subheading", "content"]
                    }
                }
            },
            "required": ["heading", "sections"],
            "additionalProperties": false
        };

        const myModel = await LanguageModel.create({
            expectedOutputs: [
                { type: "text", languages: ["en"] }
            ]
        });
        
        // Use the new, explicit prompt for structured JSON output
        const myPrompt = `Provide a main title (heading) and a detailed summary of the following text, broken down into 2-4 key sections with descriptive subheadings. **The entire output must be a valid JSON object matching the requested schema. DO NOT include any explanatory text or formatting outside of the JSON object.** The text to summarize is:\n\n${myText}`;
        
        const mySummaryJsonString = await myModel.prompt(myPrompt, {
            responseConstraint: mySummarySchema
        });
        
        return mySummaryJsonString;
    } catch (myError) {
        console.error('Error using LanguageModel API:', myError);
        return `Error: ${myError.message}. Failed to generate summary. (Is the model downloaded? Check chrome://components)`;
    }
}

// -------------------------------------------------------------------------
// --- ACTION HANDLERS ---
// -------------------------------------------------------------------------

// Grabs and summarizes the text from the entire webpage.
async function mySummarizePage(myExtractionFunc) {
    // Clear previous output and start loading state
    myContentArea.value = '';
    myStatusMessage.textContent = '';
    myStartTimer();

    const [myTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Check for a valid URL
    if (!myTab || myTab.url.startsWith('chrome://') || myTab.url.startsWith('chrome-extension://') || myTab.url.startsWith('file://')) {
        myStopTimer();
        myStatusMessage.textContent = 'Error: Cannot access content on this type of page (e.g., settings, extension page).';
        return;
    }

    try {
        // Execute the appropriate content retrieval function
        const myResults = await chrome.scripting.executeScript({
            target: { tabId: myTab.id },
            func: myExtractionFunc
        });

        const myExtractedText = myResults[0].result;

        if (myExtractedText && myExtractedText.trim().length > 0) {
            myStatusMessage.textContent = 'Text extracted successfully. Generating summary...';
            
            const mySummaryJsonString = await mySummarizeWithPrompt(myExtractedText);
            myStopTimer();

            try {
                const mySummaryObject = JSON.parse(mySummaryJsonString);
                
                // Start with the main heading
                let myFormattedOutput = (mySummaryObject.heading || 'Summary Title').toUpperCase() + '\n' + '='.repeat(40) + '\n\n';
                
                // Iterate through the sections and format them
                if (mySummaryObject.sections && Array.isArray(mySummaryObject.sections)) {
                    mySummaryObject.sections.forEach(mySection => {
                        // Use a simple text divider for subheadings
                        myFormattedOutput += `--- ${mySection.subheading.toUpperCase()} ---\n`;
                        myFormattedOutput += `${mySection.content}\n\n`;
                    });
                }
                
                myContentArea.value = myFormattedOutput.trim();
                myStatusMessage.textContent = 'Summary complete.';
                
            } catch (myParseError) {
                // Fallback: If parsing fails, display the raw text and an error
                myContentArea.value = `ERROR: Failed to parse structured output. Displaying raw model output:\n\n${mySummaryJsonString}`;
                myStatusMessage.textContent = `Summary complete, but structured output parsing failed.`;
                console.error('Failed to parse summary JSON:', myParseError, mySummaryJsonString);
            }

        } else {
            myStopTimer();
            myContentArea.value = '';
            myStatusMessage.textContent = myExtractionFunc === myGetPageText ? 
                'Could not retrieve any text from the page.' : 
                'No text was selected on the page.';
        }
    } catch (myError) {
        myStopTimer();
        console.error('Scripting Error:', myError);
        myStatusMessage.textContent = `Scripting Error: Could not execute script on the page.`;
    }
}


// -------------------------------------------------------------------------
// --- VIS.JS TIMELINE INITIALIZATION ---
// -------------------------------------------------------------------------

function myInitializeVisTimeline() {
    if (!myVisTimelineContainer) {
        myStatusMessage.textContent = "Error: Timeline container (myVisTimeline) not found in HTML.";
        return;
    }
    if (typeof vis === 'undefined') {
        myStatusMessage.textContent = "Error: Vis.js library not loaded. Timeline functionality disabled.";
        return;
    }

    const myOptions = {
        zoomKey: 'ctrlKey', 
        moveable: true,
        selectable: true,
        showCurrentTime: true
    };

    myVisTimeline = new vis.Timeline(myVisTimelineContainer, myItemsData, myOptions);
    console.log("Vis.js Timeline initialized.");
}


// -------------------------------------------------------------------------
// --- APP INITIALIZATION (Entry Point) ---
// -------------------------------------------------------------------------

function myInitializeApp() {
    // 1. Initialize the Vis.js Timeline for testing
    myInitializeVisTimeline();
    
    // 2. Attach CSP-Compliant Event Listeners for the buttons
    
    // Button to summarize the entire page content
    if (myShowAllButton) {
        // Use an anonymous function to pass the function reference
        myShowAllButton.addEventListener('click', () => mySummarizePage(myGetPageText));
    } else {
        console.warn("Element 'showAllBtn' not found.");
    }

    // Button to summarize the selected text content
    if (myShowSelectedButton) {
        myShowSelectedButton.addEventListener('click', () => mySummarizePage(myGetSelectedText));
    } else {
        console.warn("Element 'showSelectedBtn' not found.");
    }

    // Update status to confirm successful initialization
    myStatusMessage.textContent = myVisTimeline ? 
        "App initialized. Timeline and Summarization ready." : 
        "App initialized. Summarization ready (Timeline failed to load).";
}


// -------------------------------------------------------------------------
// 🟢 SECURE INITIALIZATION CALL (Replaces HTML 'onload') 🟢
// -------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', myInitializeApp);