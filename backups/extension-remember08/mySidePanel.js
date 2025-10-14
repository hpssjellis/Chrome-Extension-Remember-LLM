// This file combines Web Page Content Extraction, AI Summarization to JSON,
// and Spaced Repetition System (SRS) features using Vis.js.

// --- Global Variables & UI References ---
const myVisTimelineContainer = document.getElementById('myVisTimeline');
const myStatusMessage = document.getElementById('myStatusMessage');
const myContentArea = document.getElementById('myContentArea'); // Output for Extracted Content / Review Hint
const myResponseArea = document.getElementById('myResponseArea'); // User input for SRS
const myShowAllButton = document.getElementById('myShowAllBtn'); 
const myShowSelectedButton = document.getElementById('myShowSelectedBtn'); 
const myGenerateTimelineBtn = document.getElementById('myGenerateTimelineBtn'); // NEW BUTTON ID
const myLLMCheckBtn = document.getElementById('myLLMCheckBtn');
const myLLMFeedback = document.getElementById('myLLMFeedback');
const mySrsAgainBtn = document.getElementById('mySrsAgainBtn');
const mySrsHardBtn = document.getElementById('mySrsHardBtn');
const mySrsGoodBtn = document.getElementById('mySrsGoodBtn');
const myMinOneDayCheckbox = document.getElementById('myMinOneDayCheckbox');

// --- LLM & SRS State ---
let myLanguageModelSession = null;
let myItemsDataSet; // Vis.js DataSet
let myTimeline; // Vis.js Timeline instance
let myTimerInterval;
let mySeconds = 0;

// SRS constants
const mySRSFactors = {
    myEaseFactor: 2.50, // Initial Ease Factor (EF)
    myFactorMax: 3.0,
    myFactorMin: 1.1,
    myCurrentIntervalDays: 0 // Used to track the last calculated interval
};
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Default Data Set
const myDefaultData = [
    { id: 1, content: 'Gemini', start: '2025-09-29T00:00:00.000Z', longDescription: 'AI model by Google', myOriginalStart: '2025-09-29T00:00:00.000Z', myCorrectCount: 0 },
    { id: 2, content: 'Spaced Repetition', start: '2025-10-16T14:00:00.000Z', longDescription: 'Memory technique based on increasing time intervals between reviews.', myOriginalStart: '2025-10-16T14:00:00.000Z', myCorrectCount: 0 }
];

// =========================================================================
// --- GENERAL UTILITY FUNCTIONS ---
// =========================================================================

function myStartTimer(myTargetStatusElement = myStatusMessage) {
    mySeconds = 0;
    myTargetStatusElement.textContent = "Working... 0s";

    if (myTimerInterval) {
        clearInterval(myTimerInterval);
    }

    myTimerInterval = setInterval(() => {
        mySeconds++;
        myTargetStatusElement.textContent = `Working... ${mySeconds}s`;
    }, 1000);
}

function myStopTimer(myMessage, myTargetStatusElement = myStatusMessage) {
    if (myTimerInterval) {
        clearInterval(myTimerInterval);
        myTimerInterval = null;
    }
    if (myMessage) {
        myTargetStatusElement.textContent = myMessage;
    }
}

function myMillisToIso(myMillis) { return new Date(myMillis).toISOString(); }

// =========================================================================
// --- CONTENT RETRIEVAL FUNCTIONS (Injected into Content Script) ---
// =========================================================================

function myGetPageText() {
    return document.body.innerText;
}

function myGetSelectedText() {
    return window.getSelection().toString();
}

// =========================================================================
// --- LLM INITIALIZATION & SIMILARITY CHECK (For SRS) ---
// =========================================================================

async function myInitializeLanguageModel() {
    myStatusMessage.textContent = "Initializing built-in AI...";
    try {
        if (typeof LanguageModel !== 'undefined') {
            // We use a general session for both similarity and structured generation
            myLanguageModelSession = await LanguageModel.create(); 
            myStopTimer("AI Ready.", myStatusMessage);
            return true;
        } else {
            myStopTimer("Error: Built-in AI not available (LanguageModel missing).", myStatusMessage);
            return false;
        }
    } catch (myError) {
        console.error("Error initializing LanguageModel:", myError);
        myStopTimer("AI Initialization Failed. Check Chrome Flags.", myStatusMessage);
        return false;
    }
}

/**
 * Uses the built-in AI to check the similarity (0.0 to 1.0) for SRS review.
 */
async function myCheckSimilarity() {
    if (!myLanguageModelSession) {
        myLLMFeedback.textContent = "Error: AI not ready. Please wait or check initialization.";
        return;
    }
    // ... (Similarity check logic remains the same) ...
    const myOriginalContent = myContentArea.value; 
    const myUserResponse = myResponseArea.value; 

    if (!myOriginalContent || !myUserResponse) {
        myLLMFeedback.textContent = "Please ensure both Original Content and Your Response areas are filled.";
        return;
    }

    myStartTimer(myLLMFeedback);
    myLLMCheckBtn.disabled = true;

    try {
        const myPrompt = `
            You are an AI similarity checker. 
            Evaluate how conceptually similar the USER RESPONSE is to the ORIGINAL CONTENT.
            Your output MUST be a single decimal number between 0.0 (totally different) and 1.0 (perfect match).
            DO NOT output any text, explanation, or extra characters, only the number.

            ORIGINAL CONTENT: "${myOriginalContent}"
            USER RESPONSE: "${myUserResponse}"
        `;

        const myResult = await myLanguageModelSession.prompt(myPrompt);
        
        let mySimilarityScore = parseFloat(myResult.trim());

        if (isNaN(mySimilarityScore) || mySimilarityScore < 0 || mySimilarityScore > 1) {
            mySimilarityScore = 0.5;
            myStopTimer(`AI returned non-numeric data. Assuming 0.5.`, myLLMFeedback);
        } else {
            myStopTimer(`Similarity Check Complete. Score: ${mySimilarityScore.toFixed(2)}`, myLLMFeedback);
        }
        
        myLLMFeedback.style.backgroundColor = `rgba(0, 255, 0, ${mySimilarityScore / 2})`;
        myLLMFeedback.textContent = `LLM Similarity Score: ${mySimilarityScore.toFixed(2)}`;

    } catch (myError) {
        console.error("LLM Prompt Error:", myError);
        myStopTimer("AI Check Failed. See console for error.", myLLMFeedback);
        myLLMFeedback.style.backgroundColor = '#ffcccc';
    } finally {
        myLLMCheckBtn.disabled = false;
    }
}

/**
 * Uses the built-in AI to generate a timeline item (Hint + Description) in JSON format.
 * @param {string} myText The content to summarize.
 * @returns {Promise<object>} A parsed JSON object or null on error.
 */
async function myGenerateTimelineItemJson(myText) {
    if (!myLanguageModelSession) {
        myStatusMessage.textContent = "Error: AI not ready for summarization.";
        return null;
    }

    try {
        const myItemSchema = {
            "type": "object",
            "properties": {
                "hint": { "type": "string", "description": "A concise, 1-3 word title or question based on the content. E.g., 'What is a closure?'" },
                "description": { "type": "string", "description": "A detailed, multi-sentence summary of the content for spaced repetition review." }
            },
            "required": ["hint", "description"],
            "additionalProperties": false
        };

        const myPrompt = `
            Analyze the following text from a webpage. Your task is to extract the main concept and generate a summary suitable for a Spaced Repetition System (SRS) flashcard.
            
            1. Create a very short, punchy **Hint** (title or question).
            2. Create a **Description** (the detailed answer/summary).
            
            The output MUST be valid JSON matching this schema.
            
            TEXT TO SUMMARIZE:\n\n${myText}
        `;

        const myResultString = await myLanguageModelSession.prompt(myPrompt, {
            responseConstraint: myItemSchema
        });

        // Parse and return the structured result
        return JSON.parse(myResultString.trim());
    } catch (myError) {
        console.error('LLM JSON Generation Error:', myError);
        myStopTimer(`AI Summarization Failed: ${myError.message}`, myStatusMessage);
        return null;
    }
}

// =========================================================================
// --- SRS LOGIC ---
// =========================================================================

/**
 * Calculates the next review date based on the user's recall quality (1, 2, or 3).
 */
function myCalculateNextReview(myItem, myQuality) {
    let myEF = mySRSFactors.myEaseFactor;
    let myN = myItem.myCorrectCount;
    let myIntervalDays;
    
    // 1. Update Ease Factor (EF)
    if (myQuality === 1) { // Again (Mistake)
        myN = 0; 
        myEF = myEF + (0.10 - (3 - 1) * 0.08 - (3 - 1) * 0.02);
    } else if (myQuality === 2) { // Hard (Slightly wrong)
        myEF = myEF + (0.10 - (3 - 2) * 0.08 - (3 - 2) * 0.02);
        myN++;
    } else if (myQuality === 3) { // Good (Correct)
        myEF = myEF + (0.10 - (3 - 3) * 0.08 - (3 - 3) * 0.02);
        myN++;
    }

    myEF = Math.min(mySRSFactors.myFactorMax, Math.max(mySRSFactors.myFactorMin, myEF));
    
    // 2. Calculate New Interval (I)
    if (myN === 1) {
        myIntervalDays = 1;
    } else if (myN === 2) {
        myIntervalDays = 3;
    } else {
        myIntervalDays = Math.round(mySRSFactors.myCurrentIntervalDays * myEF);
    }
    
    if (myMinOneDayCheckbox.checked && myIntervalDays < 1) {
        myIntervalDays = 1;
    }
    
    // 3. Determine Next Review Date
    const myNextReviewMillis = Date.now() + (myIntervalDays * ONE_DAY_MS);
    const myNextReviewDate = myMillisToIso(myNextReviewMillis);

    mySRSFactors.myEaseFactor = myEF;
    mySRSFactors.myCurrentIntervalDays = myIntervalDays;

    return { myNextReviewDate, myNewCorrectCount: myN };
}

/**
 * Handles the click of an SRS feedback button, updating the item and timeline.
 */
function myUpdateSRS(myQuality) {
    const mySelectedItems = myTimeline.getSelection();
    if (mySelectedItems.length === 0) {
        myStatusMessage.textContent = "Please click an item on the timeline to select it for review.";
        return;
    }

    const myItemId = mySelectedItems[0];
    const myItem = myItemsDataSet.get(myItemId);

    if (!myItem) return;

    const myLastReviewMillis = new Date(myItem.start).getTime();
    const myIntervalMillis = Date.now() - myLastReviewMillis;
    mySRSFactors.myCurrentIntervalDays = Math.round(myIntervalMillis / ONE_DAY_MS) || 1; 

    const { myNextReviewDate, myNewCorrectCount } = myCalculateNextReview(myItem, myQuality);
    
    const myUpdate = {
        id: myItemId,
        start: myNextReviewDate, 
        myCorrectCount: myNewCorrectCount,
    };

    myItemsDataSet.update(myUpdate);
    mySaveToLocalStorage();
    myStatusMessage.textContent = `Review recorded! Next review in ${mySRSFactors.myCurrentIntervalDays} days. New EF: ${mySRSFactors.myEaseFactor.toFixed(2)}`;
}

// =========================================================================
// --- CONTENT EXTRACTION & LLM PROCESSING HANDLERS (Split Flow) ---
// =========================================================================

/**
 * Phase 1: Extracts content from the active tab and displays it in the content area.
 * @param {function} myExtractionFunc The function (myGetPageText or myGetSelectedText) to execute in the tab.
 */
async function myExtractContent(myExtractionFunc) {
    myContentArea.value = 'Extracting content...';
    myStatusMessage.textContent = '';
    myStartTimer();
    myGenerateTimelineBtn.disabled = true;

    try {
        const [myTab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!myTab || myTab.url.startsWith('chrome://') || myTab.url.startsWith('chrome-extension://') || myTab.url.startsWith('file://')) {
            myStopTimer('Cannot access content on this type of page.');
            myContentArea.value = '';
            return;
        }

        const myResults = await chrome.scripting.executeScript({
            target: { tabId: myTab.id },
            func: myExtractionFunc
        });

        const myExtractedText = myResults[0].result;
        myStopTimer();

        if (myExtractedText && myExtractedText.trim().length > 50) {
            myContentArea.value = myExtractedText.trim();
            myStatusMessage.textContent = 'Content extracted successfully. Click "Summarize & Add to Timeline" to process.';
            myGenerateTimelineBtn.disabled = false;
        } else {
            myContentArea.value = '';
            myStatusMessage.textContent = myExtractionFunc === myGetPageText ?
                'No meaningful text found on page.' : 'No text selected.';
            myGenerateTimelineBtn.disabled = true;
        }
    } catch (myError) {
        myStopTimer('Could not execute script on page.');
        console.error('Scripting error:', myError);
        myGenerateTimelineBtn.disabled = true;
    }
}

/**
 * Phase 2: Reads content from myContentArea, uses LLM to summarize, and adds to timeline.
 */
async function myProcessContentToTimeline() {
    const myExtractedText = myContentArea.value;

    if (!myExtractedText || myExtractedText.trim().length < 50) {
        myStatusMessage.textContent = "Please extract content first (must be > 50 characters).";
        return;
    }

    myStatusMessage.textContent = 'Sending to AI for summarization...';
    myStartTimer();
    myGenerateTimelineBtn.disabled = true;

    // Call the new LLM function to get structured data
    const mySummaryObject = await myGenerateTimelineItemJson(myExtractedText);
    myStopTimer();

    if (mySummaryObject && mySummaryObject.hint && mySummaryObject.description) {
        // 1. Generate a new unique ID
        const myNewId = myItemsDataSet.max('id') + 1 || 1;
        const myCurrentIsoDate = myMillisToIso(Date.now());

        // 2. Construct the new timeline item object
        const myNewItem = {
            id: myNewId,
            content: mySummaryObject.hint,
            start: myCurrentIsoDate, // Set for immediate review
            longDescription: mySummaryObject.description,
            myOriginalStart: myCurrentIsoDate,
            myCorrectCount: 0 
        };

        // 3. Add the item to the DataSet and save
        myItemsDataSet.add(myNewItem);
        mySaveToLocalStorage();

        // 4. Update UI
        myContentArea.value = `New Item Created: ${mySummaryObject.hint}\n\n--- Description ---\n${mySummaryObject.description}`;
        myResponseArea.value = '';
        myTimeline.setSelection([myNewId]); 
        myTimeline.focus(myNewId); 
        myStatusMessage.textContent = `SUCCESS: New item "${mySummaryObject.hint}" added to timeline!`;
    } else {
        myStatusMessage.textContent = 'ERROR: AI failed to return a valid structured summary. Check console.';
        myContentArea.value = mySummaryObject ? JSON.stringify(mySummaryObject, null, 2) : 'AI returned null.';
    }
    myGenerateTimelineBtn.disabled = false;
}


// =========================================================================
// --- APP INITIALIZATION AND STATE MANAGEMENT ---
// =========================================================================

function myLoadFromLocalStorage() {
    // ... (Loading logic remains the same) ...
    try {
        const myStoredData = localStorage.getItem('myTimelineData');
        const myStoredFactors = localStorage.getItem('mySRSFactors');

        if (myStoredFactors) {
            const factors = JSON.parse(myStoredFactors);
            mySRSFactors.myEaseFactor = factors.easeFactor || 2.50; 
        }
        
        if (myStoredData) {
            myStatusMessage.textContent = "Data loaded from Local Storage.";
            return JSON.parse(myStoredData);
        }
        myStatusMessage.textContent = "No stored data found. Using default data.";
        return myDefaultData;
    } catch (myError) {
        console.error("Error loading data from local storage:", myError);
        myStatusMessage.textContent = "Error loading data. Using default data.";
        return myDefaultData;
    }
}

function mySaveToLocalStorage() {
    // ... (Saving logic remains the same) ...
    try {
        const myDataToSave = myItemsDataSet.get();
        localStorage.setItem('myTimelineData', JSON.stringify(myDataToSave));
        
        localStorage.setItem('mySRSFactors', JSON.stringify({ easeFactor: mySRSFactors.myEaseFactor }));
        
        if (myMinOneDayCheckbox) {
             const mySettings = { minimumOneDay: myMinOneDayCheckbox.checked };
             localStorage.setItem('mySRSSettings', JSON.stringify(mySettings));
        }

        myUpdateFactorDisplay();
    } catch (myError) {
        console.error("Error saving data to local storage:", myError);
        myStatusMessage.textContent = "Error saving data. Check console.";
    }
}

function myInitializeVisTimeline() {
    if (typeof vis === 'undefined' || !vis.DataSet || !vis.Timeline) {
        myStatusMessage.textContent = "Error: Vis.js library not loaded. Timeline functionality disabled.";
        return;
    }

    const myInitialData = myLoadFromLocalStorage();
    myItemsDataSet = new vis.DataSet(myInitialData);
    
    myTimeline = new vis.Timeline(myVisTimelineContainer, myItemsDataSet, {
        type: 'box',
        tooltip: { followMouse: false },
        autoResize: true,
        zoomKey: 'ctrlKey',
        moveable: true,
        selectable: true,
        showCurrentTime: true
    });

    myTimeline.on('doubleClick', myTimelineDoubleClick);
    myTimeline.on('click', (properties) => {
        if (properties.item) {
            myLoadItemForReview(properties.item);
        }
    });
}

function myUpdateFactorDisplay() {
    myStatusMessage.textContent += ` | Current Ease Factor (EF): ${mySRSFactors.myEaseFactor.toFixed(2)}`;
}

/**
 * Loads the selected item's data (longDescription) into the content area for review.
 */
function myLoadItemForReview(myItemId) {
    const myItem = myItemsDataSet.get(myItemId);
    if (myItem) {
        myContentArea.value = myItem.longDescription || ''; // Original content (the answer/prompt)
        myResponseArea.value = ''; // Clear the user response area
        myLLMFeedback.textContent = "LLM Similarity: N/A";
        myLLMFeedback.style.backgroundColor = 'transparent';
        myStatusMessage.textContent = `Ready to review item: ${myItem.content}`;
    }
}

function myTimelineDoubleClick(myProps) {
    const myItem = myItemsDataSet.get(myProps.item);
    if (myItem && myItem.content) {
        myStatusMessage.textContent = `**HINT (Cheat):** ${myItem.content}`;
        setTimeout(() => { myStatusMessage.textContent = "Hint cleared. Get back to work!"; }, 3000);
    }
}


// =========================================================================
// --- APP INITIALIZATION ---
// =========================================================================

async function myInitializeApp() {
    // 1. Initialize Vis.js Timeline and load data
    myInitializeVisTimeline();
    
    // 2. Initialize the built-in AI for the Similarity Check and Summarization
    await myInitializeLanguageModel();

    // 3. Attach Event Listeners for Content Extraction (Phase 1)
    if (myShowAllButton) {
        myShowAllButton.addEventListener('click', () => myExtractContent(myGetPageText));
    }
    if (myShowSelectedButton) {
        myShowSelectedButton.addEventListener('click', () => myExtractContent(myGetSelectedText));
    }

    // 4. Attach Listener for Summarization and Timeline Add (Phase 2)
    if (myGenerateTimelineBtn) {
        myGenerateTimelineBtn.addEventListener('click', myProcessContentToTimeline);
        myGenerateTimelineBtn.disabled = true; // Disabled initially until content is extracted
    }

    // 5. Attach Listeners for SRS and LLM Check buttons
    if (myLLMCheckBtn) {
        myLLMCheckBtn.onclick = myCheckSimilarity;
    }
    if (mySrsAgainBtn) {
        mySrsAgainBtn.onclick = () => myUpdateSRS(1); 
    }
    if (mySrsHardBtn) {
        mySrsHardBtn.onclick = () => myUpdateSRS(2); 
    }
    if (mySrsGoodBtn) {
        mySrsGoodBtn.onclick = () => myUpdateSRS(3); 
    }

    myUpdateFactorDisplay();
    myStatusMessage.textContent = "App initialized. All features ready.";
}

document.addEventListener('DOMContentLoaded', myInitializeApp);
