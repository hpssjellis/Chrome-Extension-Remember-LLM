// This file implements the Spaced Repetition System (SRS) and AI-powered
// content summarization for the Chrome Extension side panel.

// --- Global Variables & UI References ---
const myVisTimelineContainer = document.getElementById('myVisTimeline');
const myStatusMessage = document.getElementById('myStatusMessage');
const myContentArea = document.getElementById('myContentArea'); 
const myResponseArea = document.getElementById('myResponseArea'); 
const myShowAllButton = document.getElementById('myShowAllBtn'); 
const myShowSelectedButton = document.getElementById('myShowSelectedBtn'); 
const myGenerateTimelineBtn = document.getElementById('myGenerateTimelineBtn'); 
const myLLMCheckBtn = document.getElementById('myLLMCheckBtn');
const myLLMFeedback = document.getElementById('myLLMFeedback');
const mySrsAgainBtn = document.getElementById('mySrsAgainBtn');
const mySrsHardBtn = document.getElementById('mySrsHardBtn');
const mySrsGoodBtn = document.getElementById('mySrsGoodBtn');
const myMinOneDayCheckbox = document.getElementById('myMinOneDayCheckbox');
const myDeleteBtn = document.getElementById('myDeleteBtn'); 
const myExportBtn = document.getElementById('myExportBtn'); 
const myImportInput = document.getElementById('myImportInput'); 

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
    myCurrentIntervalDays: 0 
};
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Default Data Set structure
const myDefaultData = [
    { id: 1, content: 'Welcome!', start: new Date().toISOString(), longDescription: 'Use the buttons to extract text, summarize it with AI, and add to the timeline.', myOriginalStart: new Date().toISOString(), myCorrectCount: 0 },
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

/**
 * Calculates the next unique integer ID for a new timeline item.
 * Ensures the ID is greater than the current maximum ID.
 */
function myGetNextItemId() {
    const maxIdResult = myItemsDataSet.max('id');
    
    let maxExistingId = 0;

    if (maxIdResult && maxIdResult.max !== null) {
        maxExistingId = maxIdResult.max;
    } 
    
    if (maxExistingId < 1) {
        maxExistingId = 1;
    }

    return maxExistingId + 1;
}

/**
 * Exports the current timeline data (myItemsDataSet) as a JSON file.
 */
function myExportData() {
    const dataToExport = myItemsDataSet.get();
    const jsonString = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `srs_timeline_export_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    URL.revokeObjectURL(url);
    myStatusMessage.textContent = "Timeline data exported successfully.";
}

/**
 * Handles the file input change event to load and import data.
 */
function myImportData(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importedData = JSON.parse(e.target.result);
            if (!Array.isArray(importedData)) {
                myStatusMessage.textContent = "Import failed: File content is not a valid JSON array.";
                return;
            }
            
            // Clear current data and replace with imported data
            myItemsDataSet.clear();
            myItemsDataSet.add(importedData);
            mySaveToLocalStorage();
            myTimeline.fit(); // Zoom to fit all items
            myStatusMessage.textContent = `Successfully imported ${importedData.length} timeline items.`;
        } catch (error) {
            console.error("Import error:", error);
            myStatusMessage.textContent = "Import failed: Invalid JSON file or data structure.";
        }
        // Clear the file input value so the same file can be imported again
        event.target.value = ''; 
    };
    reader.onerror = function(e) {
        console.error("File reading error:", e);
        myStatusMessage.textContent = "Error reading file.";
    };
    reader.readAsText(file);
}

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
// --- LLM INITIALIZATION & AI FUNCTIONS ---
// =========================================================================

async function myInitializeLanguageModel() {
    myStatusMessage.textContent = "Initializing built-in AI...";
    try {
        if (typeof LanguageModel !== 'undefined') {
            myLanguageModelSession = await LanguageModel.create(); 
            myStopTimer("AI Ready. Click 'Extract' to begin.", myStatusMessage);
            return true;
        } else {
            myStopTimer("Error: Built-in AI not available.", myStatusMessage);
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
        myLLMFeedback.textContent = "Error: AI not ready.";
        return;
    }

    const mySelectedItems = myTimeline.getSelection();
    if (mySelectedItems.length === 0) {
        myLLMFeedback.textContent = "Please select an item on the timeline to load its hint.";
        return;
    }
    const myItem = myItemsDataSet.get(mySelectedItems[0]);
    if (!myItem || !myItem.longDescription) {
        myLLMFeedback.textContent = "Selected item has no answer to check against.";
        return;
    }

    const myOriginalContent = myItem.longDescription;
    const myUserResponse = myResponseArea.value; 

    if (!myOriginalContent || !myUserResponse) {
        myLLMFeedback.textContent = "Please type your response above in the 'Your Recall' box.";
        return;
    }

    myStartTimer(myLLMFeedback);
    myLLMCheckBtn.disabled = true;

    try {
        const myPrompt = `
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
        
        myLLMFeedback.style.backgroundColor = `rgba(0, 255, 0, ${mySimilarityScore * 0.7})`; 
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
 * Uses the built-in AI to generate multiple timeline items (Hint + Description) in JSON array format.
 * @returns {Promise<Array<{hint: string, description: string}>>} An array of summary objects.
 */
async function myGenerateTimelineItemJson(myText) {
    if (!myLanguageModelSession) {
        throw new Error("AI not ready for summarization.");
    }

    try {
        // Define the schema for a single flashcard object
        const myCardSchema = {
            "type": "object",
            "properties": {
                "hint": { "type": "string", "description": "A concise, 1-3 word title or question based on the concept. E.g., 'What is a closure?'" },
                "description": { "type": "string", "description": "A single, short, concise sentence factual summary of the concept." }
            },
            "required": ["hint", "description"],
            "additionalProperties": false
        };

        // Define the schema for the resulting array (multiple flashcards)
        const myResultSchema = {
            "type": "array",
            "items": myCardSchema
        };

        const myPrompt = `
            Analyze the following text. Extract between **3 and 5 distinct, separate concepts** and generate a summary for each, suitable for a Spaced Repetition System (SRS) flashcard.
            
            For each concept:
            1. Create a very short, punchy **Hint** (title or question, max 10 words).
            2. Create a **Description** which MUST be a single, short, concise sentence (the detailed answer/summary).
            
            The output MUST be a valid JSON ARRAY matching this schema.
            
            TEXT TO SUMMARIZE:\n\n${myText}
        `;

        const myResultString = await myLanguageModelSession.prompt(myPrompt, {
            responseConstraint: myResultSchema
        });

        const mySummaries = JSON.parse(myResultString.trim());
        
        if (!Array.isArray(mySummaries) || mySummaries.length === 0) {
             throw new Error("AI returned an empty or invalid array.");
        }
        return mySummaries;

    } catch (myError) {
        console.error('LLM JSON Generation Error:', myError);
        throw new Error('AI Summarization Failed: Check console for schema or parsing error.');
    }
}

// =========================================================================
// --- SRS LOGIC ---
// =========================================================================

/**
 * Calculates the next review date based on the user's recall quality (1=Again, 2=Hard, 3=Good).
 */
function myCalculateNextReview(myItem, myQuality) {
    let myEF = mySRSFactors.myEaseFactor;
    let myN = myItem.myCorrectCount;
    let myIntervalDays;
    
    // 1. Update Ease Factor (EF) - SuperMemo 2 algorithm approximation
    if (myQuality === 1) { // Again (Mistake)
        myN = 0; 
        myEF = myEF - 0.20; 
    } else if (myQuality === 2) { // Hard (Slightly wrong)
        myEF = myEF - 0.15;
        myN++;
    } else if (myQuality === 3) { // Good (Correct)
        myEF = myEF + 0.10;
        myN++;
    }

    myEF = Math.min(mySRSFactors.myFactorMax, Math.max(mySRSFactors.myFactorMin, myEF));
    
    // 2. Calculate New Interval (I)
    if (myN === 1) {
        myIntervalDays = 1; 
    } else if (myN === 2) {
        myIntervalDays = 3; 
    } else {
        // Use the actual elapsed days as the *last* interval for the calculation
        myIntervalDays = Math.round(mySRSFactors.myCurrentIntervalDays * myEF);
    }
    
    if (myMinOneDayCheckbox.checked && myIntervalDays < 1) {
        myIntervalDays = 1;
    }
    
    // 3. Determine Next Review Date
    const myNextReviewMillis = Date.now() + (myIntervalDays * ONE_DAY_MS);
    const myNextReviewDate = myMillisToIso(myNextReviewMillis);

    mySRSFactors.myEaseFactor = myEF;
    mySRSFactors.myCurrentIntervalDays = myIntervalDays; // Store the newly calculated interval

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

    // Calculate time elapsed since last review (for SuperMemo 2 logic)
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
    
    // Clear review areas after update
    myResponseArea.value = '';
    myContentArea.value = '';
    myTimeline.setSelection([]); 
    myLLMFeedback.textContent = "LLM Similarity: N/A";
    myLLMFeedback.style.backgroundColor = 'transparent';
}

/**
 * Deletes the currently selected item from the timeline.
 */
function myDeleteSelectedItem() {
    const mySelectedItems = myTimeline.getSelection();
    if (mySelectedItems.length === 0) {
        myStatusMessage.textContent = "Please select an item on the timeline to delete.";
        return;
    }

    const myItemId = mySelectedItems[0];
    
    // Avoid deleting the default welcome card (id: 1) for a better UX, unless it's the only item.
    if (myItemId === 1 && myItemsDataSet.length > 1) {
        myStatusMessage.textContent = "Cannot delete the default 'Welcome!' card if other items exist.";
        return;
    }
    
    try {
        myItemsDataSet.remove(myItemId);
        mySaveToLocalStorage();
        myStatusMessage.textContent = `Item with ID ${myItemId} deleted successfully.`;
        myContentArea.value = '';
        myResponseArea.value = '';
        myTimeline.setSelection([]);
        myLLMFeedback.textContent = "LLM Similarity: N/A";
        myLLMFeedback.style.backgroundColor = 'transparent';
    } catch (error) {
        console.error("Error deleting item:", error);
        myStatusMessage.textContent = "Error deleting item. See console.";
    }
}


// =========================================================================
// --- CONTENT EXTRACTION & AI PROCESSING HANDLERS (Multi-Item) ---
// =========================================================================

/**
 * Step 1: Extracts content from the active tab and displays it in the content area.
 */
async function myExtractContent(myExtractionFunc) {
    myContentArea.value = 'Extracting content...';
    myStatusMessage.textContent = '';
    myStartTimer();
    myGenerateTimelineBtn.disabled = true; 

    try {
        const [myTab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!myTab || !myTab.id || myTab.url.startsWith('chrome://') || myTab.url.startsWith('chrome-extension://') || myTab.url.startsWith('file://')) {
            myStopTimer('Cannot access content on this type of page.');
            myContentArea.value = '';
            return;
        }

        const myResults = await chrome.scripting.executeScript({
            target: { tabId: myTab.id },
            func: myExtractionFunc
        });

        const myExtractedText = myResults?.[0]?.result || '';
        myStopTimer();

        // Require at least 200 characters for multi-item extraction to be meaningful
        if (myExtractedText && myExtractedText.trim().length > 200) {
            myContentArea.value = myExtractedText.trim();
            myStatusMessage.textContent = 'Step 1: Content extracted. Click "Summarize & Add to Timeline" to summarize and save multiple concepts.';
            myGenerateTimelineBtn.disabled = false; 
        } else {
            myContentArea.value = '';
            myStatusMessage.textContent = myExtractionFunc === myGetPageText ?
                'Not enough text found on page (min 200 chars recommended).' : 'No selection or selection too short (min 200 chars recommended).';
            myGenerateTimelineBtn.disabled = true;
        }
    } catch (myError) {
        myStopTimer('Could not execute script on page. Check permissions.');
        console.error('Scripting error:', myError);
        myGenerateTimelineBtn.disabled = true;
    }
}

/**
 * Combined Step (2 & 3): Reads extracted content, uses LLM to summarize multiple items, and adds them to the timeline.
 */
async function myGenerateTimelineItem() {
    const myExtractedText = myContentArea.value;

    if (!myExtractedText || myExtractedText.trim().length < 200) {
        myStatusMessage.textContent = "Please extract content first (must be > 200 characters).";
        return;
    }
    
    if (!myLanguageModelSession) {
        myStatusMessage.textContent = "AI not ready. Please wait for initialization to finish.";
        return;
    }

    myStatusMessage.textContent = 'Step 2: Summarizing multiple concepts using AI...';
    myStartTimer();
    myGenerateTimelineBtn.disabled = true;

    try {
        // This function now returns an array of { hint, description } objects
        const mySummaryArray = await myGenerateTimelineItemJson(myExtractedText);
        myStopTimer(); 

        let myNewIds = [];
        const myCurrentIsoDate = myMillisToIso(Date.now());
        
        // --- Step 3: Add all items to Timeline ---
        mySummaryArray.forEach(mySummaryObject => {
            const myNewId = myGetNextItemId(); 

            const myNewItem = {
                id: myNewId,
                content: mySummaryObject.hint,
                start: myCurrentIsoDate, 
                longDescription: mySummaryObject.description,
                myOriginalStart: myCurrentIsoDate,
                myCorrectCount: 0 
            };

            myItemsDataSet.add(myNewItem);
            myNewIds.push(myNewId);
        });

        mySaveToLocalStorage();

        // Update UI
        myContentArea.value = `Successfully generated and added ${mySummaryArray.length} new flashcard items.`;
        myResponseArea.value = '';
        
        // Select and focus on the latest item added
        if (myNewIds.length > 0) {
            myTimeline.setSelection([myNewIds[myNewIds.length - 1]]); 
            myTimeline.focus(myNewIds); 
        }
        
        myStatusMessage.textContent = `SUCCESS. ${mySummaryArray.length} cards generated and added to timeline.`;
    
    } catch (myError) {
        myStopTimer(myError.message, myStatusMessage);
        myGenerateTimelineBtn.disabled = false;
        myContentArea.value = myExtractedText; 
    }
}

/**
 * Loads the selected item's data (longDescription) into the content area for review.
 */
function myLoadItemForReview(myItemId) {
    const myItem = myItemsDataSet.get(myItemId);
    if (myItem) {
        // Display the hint (question/topic) in the content area
        myContentArea.value = myItem.content || ''; 
        myResponseArea.value = ''; 
        myLLMFeedback.textContent = "LLM Similarity: Ready to check";
        myLLMFeedback.style.backgroundColor = 'transparent';
        myStatusMessage.textContent = `Reviewing item: ${myItem.content}`;
    }
}

function myTimelineDoubleClick(myProps) {
    // Allows user to peek at the answer (longDescription) by double-clicking
    const myItem = myItemsDataSet.get(myProps.item);
    if (myItem && myItem.longDescription) {
        myStatusMessage.textContent = `**HINT (Cheat):** ${myItem.longDescription}`;
        setTimeout(() => { myStatusMessage.textContent = "Hint cleared. Focus on recall!"; myUpdateFactorDisplay(); }, 5000);
    }
}


// =========================================================================
// --- APP INITIALIZATION AND STATE MANAGEMENT ---
// =========================================================================

function myLoadFromLocalStorage() {
    try {
        const myStoredData = localStorage.getItem('myTimelineData');
        const myStoredFactors = localStorage.getItem('mySRSFactors');
        const myStoredSettings = localStorage.getItem('mySRSSettings');

        if (myStoredFactors) {
            const factors = JSON.parse(myStoredFactors);
            mySRSFactors.myEaseFactor = factors.easeFactor || 2.50; 
        }
        
        if (myMinOneDayCheckbox && myStoredSettings) {
            const settings = JSON.parse(myStoredSettings);
            myMinOneDayCheckbox.checked = settings.minimumOneDay === true;
        }
        
        if (myStoredData) {
            return JSON.parse(myStoredData);
        }
        return myDefaultData;
    } catch (myError) {
        console.error("Error loading data from local storage:", myError);
        return myDefaultData;
    }
}

function mySaveToLocalStorage() {
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
    }
}

function myInitializeVisTimeline() {
    if (typeof vis === 'undefined' || !vis.DataSet || !vis.Timeline) {
        myStatusMessage.textContent = "Error: Vis.js library not loaded/accessible.";
        return;
    }
    
    // Load existing settings and data
    const myInitialData = myLoadFromLocalStorage(); 

    myItemsDataSet = new vis.DataSet(myInitialData);
    
    myTimeline = new vis.Timeline(myVisTimelineContainer, myItemsDataSet, {
        type: 'box',
        tooltip: { followMouse: false },
        autoResize: true,
        zoomable: true,
        zoomKey: undefined,
        moveable: true,
        selectable: true,
        showCurrentTime: true,
        // Template to visually highlight overdue items in red
        template: function (item) {
            const isOverdue = new Date(item.start).getTime() < Date.now();
            return `<div style="${isOverdue ? 'color: red; font-weight: bold;' : ''}">${item.content}</div>`;
        }
    });

    myTimeline.on('doubleClick', myTimelineDoubleClick);
    myTimeline.on('click', (properties) => {
        if (properties.item) {
            myLoadItemForReview(properties.item);
        }
    });
}

function myUpdateFactorDisplay() {
    // Only update the EF part, keep the rest of the status message if present
    const currentMessage = myStatusMessage.textContent.split(' | ')[0];
    myStatusMessage.textContent = `${currentMessage} | Current EF: ${mySRSFactors.myEaseFactor.toFixed(2)}`;
}


// =========================================================================
// --- APP INITIALIZATION ---
// =========================================================================

async function myInitializeApp() {
    // 1. Initialize Vis.js Timeline and load data
    myInitializeVisTimeline();
    
    // 2. Initialize the built-in AI
    await myInitializeLanguageModel();

    // 3. Attach Event Listeners for Step 1: Extraction
    if (myShowAllButton) {
        myShowAllButton.addEventListener('click', () => myExtractContent(myGetPageText));
    }
    if (myShowSelectedButton) {
        myShowSelectedButton.addEventListener('click', () => myExtractContent(myGetSelectedText));
    }
    
    // 4. Attach Listener for Combined Step 2 & 3: Generate Timeline Card
    if (myGenerateTimelineBtn) {
        myGenerateTimelineBtn.addEventListener('click', myGenerateTimelineItem);
        myGenerateTimelineBtn.disabled = true; // Starts disabled until content is extracted
    }

    // 5. Attach Listeners for SRS, LLM Check, and Utility buttons
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
    if (myDeleteBtn) {
        myDeleteBtn.onclick = myDeleteSelectedItem; 
    }
    if (myExportBtn) {
        myExportBtn.onclick = myExportData; 
    }
    if (myImportInput) {
        myImportInput.addEventListener('change', myImportData); 
    }
    
    // 6. Attach listener for the checkbox to save setting immediately
    if (myMinOneDayCheckbox) {
        myMinOneDayCheckbox.addEventListener('change', mySaveToLocalStorage);
    }

    myUpdateFactorDisplay();
    myStatusMessage.textContent = "App initialized. All features ready.";
}

document.addEventListener('DOMContentLoaded', myInitializeApp);
