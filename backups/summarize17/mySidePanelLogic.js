// --- Global Variables (myCamelCase) ---
// References to UI elements
const myContentArea = document.getElementById('contentArea');
const myStatusMessage = document.getElementById('statusMessage');
const myShowAllButton = document.getElementById('showAllBtn');
const myShowSelectedButton = document.getElementById('showSelectedBtn');
const myVisTimelineContainer = document.getElementById('myVisTimeline'); // Timeline container

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
    myStatusMessage.textContent = 'Thinking (0s)...';

    if (myTimerInterval) clearInterval(myTimerInterval);

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
// --- CONTENT RETRIEVAL FUNCTIONS ---
// -------------------------------------------------------------------------

function myGetPageText() {
    return document.body.innerText;
}

function myGetSelectedText() {
    return window.getSelection().toString();
}

// -------------------------------------------------------------------------
// --- AI SUMMARIZATION CORE FUNCTION ---
// -------------------------------------------------------------------------

async function mySummarizeWithPrompt(myText) {
    if (!('LanguageModel' in window)) {
        return 'Error: The Chrome LanguageModel API is not supported or enabled.';
    }

    try {
        const mySummarySchema = {
            "type": "object",
            "properties": {
                "heading": { "type": "string" },
                "sections": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "subheading": { "type": "string" },
                            "content": { "type": "string" }
                        },
                        "required": ["subheading", "content"]
                    }
                }
            },
            "required": ["heading", "sections"],
            "additionalProperties": false
        };

        const myModel = await LanguageModel.create({
            expectedOutputs: [{ type: "text", languages: ["en"] }]
        });

        const myPrompt = `Provide a main title (heading) and a detailed summary of the following text, broken down into 2-4 key sections with descriptive subheadings. The output must be valid JSON matching this schema. Text:\n\n${myText}`;

        const mySummaryJsonString = await myModel.prompt(myPrompt, {
            responseConstraint: mySummarySchema
        });

        return mySummaryJsonString;
    } catch (myError) {
        console.error('LanguageModel API Error:', myError);
        return `Error: ${myError.message}. Could not generate summary.`;
    }
}

// -------------------------------------------------------------------------
// --- ACTION HANDLERS ---
// -------------------------------------------------------------------------

async function mySummarizePage(myExtractionFunc) {
    myContentArea.value = '';
    myStatusMessage.textContent = '';
    myStartTimer();

    try {
        const [myTab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!myTab || myTab.url.startsWith('chrome://') || myTab.url.startsWith('chrome-extension://') || myTab.url.startsWith('file://')) {
            myStopTimer();
            myStatusMessage.textContent = 'Cannot access content on this type of page.';
            return;
        }

        const myResults = await chrome.scripting.executeScript({
            target: { tabId: myTab.id },
            func: myExtractionFunc
        });

        const myExtractedText = myResults[0].result;

        if (myExtractedText && myExtractedText.trim().length > 0) {
            myStatusMessage.textContent = 'Text extracted. Generating summary...';
            const mySummaryJsonString = await mySummarizeWithPrompt(myExtractedText);
            myStopTimer();

            try {
                const mySummaryObject = JSON.parse(mySummaryJsonString);
                let myFormattedOutput = (mySummaryObject.heading || 'Summary Title').toUpperCase() + '\n' + '='.repeat(40) + '\n\n';

                if (mySummaryObject.sections && Array.isArray(mySummaryObject.sections)) {
                    mySummaryObject.sections.forEach(mySection => {
                        myFormattedOutput += `--- ${mySection.subheading.toUpperCase()} ---\n`;
                        myFormattedOutput += `${mySection.content}\n\n`;
                    });
                }

                myContentArea.value = myFormattedOutput.trim();
                myStatusMessage.textContent = 'Summary complete.';
            } catch (myParseError) {
                myContentArea.value = `ERROR: Failed to parse output:\n\n${mySummaryJsonString}`;
                myStatusMessage.textContent = 'Summary complete but parsing failed.';
                console.error('Parsing error:', myParseError);
            }
        } else {
            myStopTimer();
            myContentArea.value = '';
            myStatusMessage.textContent = myExtractionFunc === myGetPageText ?
                'No text found on page.' : 'No text selected.';
        }
    } catch (myError) {
        myStopTimer();
        console.error('Scripting error:', myError);
        myStatusMessage.textContent = 'Could not execute script on page.';
    }
}

// -------------------------------------------------------------------------
// --- VIS.JS TIMELINE INITIALIZATION ---
// -------------------------------------------------------------------------

function myInitializeVisTimeline() {
    if (!myVisTimelineContainer) {
        myStatusMessage.textContent = "Timeline container not found.";
        return;
    }
    if (typeof vis === 'undefined') {
        myStatusMessage.textContent = "Vis.js not loaded.";
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
// --- APP INITIALIZATION ---
// -------------------------------------------------------------------------

function myInitializeApp() {
    myInitializeVisTimeline();

    if (myShowAllButton) {
        myShowAllButton.addEventListener('click', () => mySummarizePage(myGetPageText));
    }

    if (myShowSelectedButton) {
        myShowSelectedButton.addEventListener('click', () => mySummarizePage(myGetSelectedText));
    }

    myStatusMessage.textContent = myVisTimeline ?
        "App initialized. Timeline and summarization ready." :
        "App initialized. Summarization ready (Timeline failed).";
}

document.addEventListener('DOMContentLoaded', myInitializeApp);
