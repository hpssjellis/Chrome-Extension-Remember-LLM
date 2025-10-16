// mySidePanel.js

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
// These are now hidden, but references are kept if automation is disabled later
const mySrsAgainBtn = document.getElementById('mySrsAgainBtn');
const mySrsHardBtn = document.getElementById('mySrsHardBtn');
const mySrsGoodBtn = document.getElementById('mySrsGoodBtn');
const myMinOneDayCheckbox = document.getElementById('myMinOneDayCheckbox');
const myDeleteBtn = document.getElementById('myDeleteBtn');
const myExportBtn = document.getElementById('myExportBtn');
const myImportInput = document.getElementById('myImportInput');
const myImportReplaceLabel = document.getElementById('myImportReplaceLabel'); 
const myImportAppendLabel = document.getElementById('myImportAppendLabel'); 
const myMaxIdInput = document.getElementById('myMaxIdInput'); 
// New Input for Concept Count
const myConceptCountInput = document.getElementById('myConceptCountInput'); 

// New Edit Panel Elements
const myEditPanel = document.getElementById('myEditPanel'); 
const myEditContent = document.getElementById('myEditContent'); 
const myEditDescription = document.getElementById('myEditDescription'); 
const myEditDate = document.getElementById('myEditDate'); 
const mySaveEditBtn = document.getElementById('mySaveEditBtn'); 
const myCancelEditBtn = document.getElementById('myCancelEditBtn'); 


// --- LLM & SRS State ---
let myLanguageModelSession = null;
let myItemsDataSet; // Vis.js DataSet
let myTimeline; // Vis.js Timeline instance
let myTimerInterval;
let mySeconds = 0;
let myEditingItemId = null; // ID of the item currently loaded in the edit panel
let myLastSimilarityScore = 0.0; // Stores the last calculated similarity score

// SRS constants
const mySRSFactors = {
    myEaseFactor: 2.50, // Initial Ease Factor (EF)
    myFactorMax: 3.0,
    myFactorMin: 1.1,
    myCurrentIntervalDays: 0
};
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
// Two days in milliseconds for initial zoom
const TWO_DAYS_MS = 2 * ONE_DAY_MS; 

// Default Data Set structure
const myDefaultData = [
    { id: 1, content: 'Welcome!', start: new Date().toISOString(), longDescription: 'Use the buttons to extract text, summarize it with AI, and add to the timeline.', myOriginalStart: new Date().toISOString(), myCorrectCount: 0, language: 'en' },
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
 * Updates the global max ID variable and the corresponding HTML input to the next available ID.
 */
function myUpdateMaxId() {
    const maxIdResult = myItemsDataSet.max('id');
    const maxExistingId = (maxIdResult && maxIdResult.max !== null) ? maxIdResult.max : 0;
    
    // Set the input field to the next available ID. Ensure it is at least 2.
    const myNextAvailableId = Math.max(2, maxExistingId + 1);

    if (myMaxIdInput) {
        myMaxIdInput.value = myNextAvailableId;
    }
    return myNextAvailableId;
}

/**
 * Retrieves and increments the maximum ID for a new item.
 * NOTE: This relies on myMaxIdInput holding the *next available* ID.
 */
function myGetNextItemId() {
    let myCurrentNextId = parseInt(myMaxIdInput.value) || 2;
    myMaxIdInput.value = myCurrentNextId + 1; // Pre-increment for next call
    return myCurrentNextId;
}

/**
 * Converts ISO date string to datetime-local format for input fields.
 * @param {string} isoString - The ISO 8601 date string.
 * @returns {string} Date string in "YYYY-MM-DDThh:mm" format.
 */
function myIsoToLocalDatetime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const year = String(date.getFullYear()).padStart(4, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Ensures a generated hint is unique within the current myItemsDataSet.
 * @param {string} originalHint The hint generated by the AI.
 * @returns {string} A unique hint string.
 */
function myEnsureUniqueHint(originalHint) {
    let uniqueHint = originalHint;
    let counter = 1;
    let isUnique = false;

    while (!isUnique) {
        let foundDuplicate = false;
        myItemsDataSet.forEach((item) => {
            // Check against existing content, but ignore the item currently being edited
            if (item.id !== myEditingItemId && item.content && item.content.trim().toLowerCase() === uniqueHint.trim().toLowerCase()) {
                foundDuplicate = true;
            }
        });

        if (foundDuplicate) {
            counter++;
            uniqueHint = `${originalHint.trim()} (${counter})`;
        } else {
            isUnique = true;
        }
    }
    return uniqueHint;
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
 * @param {Event} event - The file change event.
 * @param {boolean} myReplaceExisting - True to replace all existing data, False to append.
 */
function myImportData(event, myReplaceExisting) {
    const file = event.target.files[0];
    if (!file) {
        event.target.value = ''; 
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importedData = JSON.parse(e.target.result);
            if (!Array.isArray(importedData)) {
                myStatusMessage.textContent = "Import failed: File content is not a valid JSON array.";
                return;
            }

            if (myReplaceExisting) {
                // Clear and replace mode
                myItemsDataSet.clear();
                myItemsDataSet.add(importedData);
                myStatusMessage.textContent = `Successfully imported ${importedData.length} timeline items (REPLACING existing data).`;
            } else {
                // Append mode: Re-index imported data and check for hint uniqueness
                let myCurrentId = myGetNextItemId() - 1; 
                let myAppendCount = 0;
                
                const myReIndexedData = importedData.map(item => {
                    myCurrentId++;
                    myAppendCount++;
                    // Apply uniqueness check to the imported hint/content
                    // We check against item.content first, then fall back to item.hint, then a generic string
                    const myUniqueContentHint = myEnsureUniqueHint(item.content || item.hint || `Item ${myCurrentId}`);

                    return { 
                        ...item, 
                        id: myCurrentId, 
                        content: myUniqueContentHint // Use the unique hint
                    }; 
                });
                
                // Update the max ID input to reflect the next available ID
                myMaxIdInput.value = myCurrentId + 1; 

                myItemsDataSet.add(myReIndexedData);
                myStatusMessage.textContent = `Successfully appended ${myAppendCount} new timeline items to the existing data (IDs re-indexed).`;
            }

            mySaveToLocalStorage(); 
            myUpdateMaxId(); 
            myTimeline.fit(); 
        } catch (error) {
            console.error("Import error:", error);
            myStatusMessage.textContent = "Import failed: Invalid JSON file or data structure.";
        }
        event.target.value = ''; 
    };
    reader.onerror = function(e) {
        console.error("File reading error:", e);
        myStatusMessage.textContent = "Error reading file.";
        event.target.value = ''; 
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
    const myOptions = {
        language: 'en'
    };

    myStatusMessage.textContent = "Initializing built-in AI...";
    try {
        if (typeof LanguageModel !== 'undefined') {
            myLanguageModelSession = await LanguageModel.create(myOptions);
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
 * Checks similarity and, upon success, triggers the automated review.
 */
async function myCheckSimilarity() {
    const mySelectedItems = myTimeline.getSelection();
    if (mySelectedItems.length === 0) {
        myLLMFeedback.textContent = "Please select an item on the timeline to load its hint.";
        return;
    }
    
    if (!myLanguageModelSession) {
        myLLMFeedback.textContent = "Error: AI not ready.";
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
    myLastSimilarityScore = 0.0; // Reset score

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

        myLastSimilarityScore = mySimilarityScore;
        myLLMFeedback.style.backgroundColor = `rgba(0, 255, 0, ${mySimilarityScore * 0.7})`;
        myLLMFeedback.textContent = `LLM Similarity Score: ${mySimilarityScore.toFixed(2)} — Automating Review...`;
        
        // --- AUTOMATION STEP 1: Determine Quality and Update SRS ---
        myAutomateReview(myItem, mySimilarityScore);

    } catch (myError) {
        console.error("LLM Prompt Error:", myError);
        myStopTimer("AI Check Failed. See console for error.", myLLMFeedback);
        myLLMFeedback.style.backgroundColor = '#ffcccc';
    } finally {
        myLLMCheckBtn.disabled = false;
    }
}

async function myGenerateTimelineItemJson(myText) {
    if (!myLanguageModelSession) {
        throw new Error("AI not ready for summarization.");
    }
    
    // Retrieve user-defined concept count range
    const myConceptCount = myConceptCountInput ? myConceptCountInput.value.trim() : "3 and 5";

    try {
        const myCardSchema = {
            "type": "object",
            "properties": {
                "hint": { "type": "string", "description": "A concise, 1-3 word title or question based on the concept. E.g., 'What is a closure?'" },
                "description": { "type": "string", "description": "A single, short, concise sentence factual summary of the concept." },
                "language": { "type": "string", "enum": ["en"], "description": "The language of the flashcard content, currently fixed to English." }
            },
            "required": ["hint", "description", "language"],
            "additionalProperties": false
        };

        const myResultSchema = {
            "type": "array",
            "items": myCardSchema
        };

        const myOptions = {
            type: 'key-points',
            length: 'medium',
            language: 'en',
        };

        const myPrompt = `
            Analyze the following text. Extract between **${myConceptCount} distinct, separate concepts** and generate a summary for each, suitable for a Spaced Repetition System (SRS) flashcard.

            When summarizing, focus on providing **${myOptions.type.toUpperCase()}** that are **${myOptions.length.toUpperCase()}** in length.
            All generated content (hint and description) MUST be in **${myOptions.language.toUpperCase()}**.

            For each concept:
            1. Create a very short, punchy **Hint** (title or question, max 10 words).
            2. Create a **Description** which MUST be a single, short, concise sentence factual summary of the concept.
            3. Set the 'language' property to '${myOptions.language}'.

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
 * Determines the SRS quality (1, 2, or 3) based on LLM similarity and review interval.
 * @param {object} myItem The timeline item being reviewed.
 * @param {number} mySimilarityScore The LLM's conceptual match score (0.0 to 1.0).
 */
function myAutomateReview(myItem, mySimilarityScore) {
    let myQuality = 1; // Default to Again (1)

    // Calculate time over/underdue in days (1.0 = exactly due)
    const myReviewDate = new Date(myItem.start).getTime();
    const myOriginalStart = new Date(myItem.myOriginalStart).getTime();
    const myIntervalDuration = myReviewDate - myOriginalStart;
    const myTimeElapsed = Date.now() - myReviewDate; // Time since the scheduled review
    
    // For the very first review (myCorrectCount === 0), myTimeElapsed might be negative, so we use 0.
    const myIntervalRatio = myIntervalDuration > 0 ? (myTimeElapsed + myIntervalDuration) / myIntervalDuration : 1.0; 
    
    // --- Automated Quality Assignment Algorithm ---
    
    if (mySimilarityScore >= 0.85) {
        // High confidence match (0.85+)
        if (myIntervalRatio >= 0.8 && myIntervalRatio <= 1.5) { 
            // Correct and done near the scheduled time (80% to 150% of interval)
            myQuality = 3; // Good
        } else if (myIntervalRatio > 1.5) {
             // Correct but late (>150% of interval) - Good but indicates too easy/long interval
             myQuality = 3; // Good
        } else {
             // Correct but early (<=80% of interval) - Hard, as it was recalled faster than expected
             myQuality = 2; // Hard
        }
    } else if (mySimilarityScore >= 0.5) {
        // Medium confidence match (0.5 to 0.85)
        myQuality = 2; // Hard
    } else {
        // Low confidence match (< 0.5)
        myQuality = 1; // Again
    }
    
    // The actual update
    myUpdateSRS(myQuality, myItem.id);

    // Provide detailed feedback
    let myQualityMessage;
    if (myQuality === 1) myQualityMessage = "AGAIN (1)";
    else if (myQuality === 2) myQualityMessage = "HARD (2)";
    else myQualityMessage = "GOOD (3)";
    
    myLLMFeedback.textContent = `LLM Score: ${mySimilarityScore.toFixed(2)}. Automated Review: ${myQualityMessage}.`;
}

function myCalculateNextReview(myItem, myQuality) {
    let myEF = mySRSFactors.myEaseFactor;
    let myN = myItem.myCorrectCount;
    let myIntervalDays;

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

    if (myN === 1) {
        myIntervalDays = 1;
    } else if (myN === 2) {
        myIntervalDays = 3;
    } else {
        // For the first review (N=0, but only for quality=1), myCurrentIntervalDays will be based on time since original start.
        myIntervalDays = Math.round(mySRSFactors.myCurrentIntervalDays * myEF);
    }

    if (myMinOneDayCheckbox.checked && myIntervalDays < 1) {
        myIntervalDays = 1;
    }

    const myNextReviewMillis = Date.now() + (myIntervalDays * ONE_DAY_MS);
    const myNextReviewDate = myMillisToIso(myNextReviewMillis);

    mySRSFactors.myEaseFactor = myEF;
    mySRSFactors.myCurrentIntervalDays = myIntervalDays;

    return { myNextReviewDate, myNewCorrectCount: myN };
}

/**
 * Updates the SRS status of the selected item and then selects the next due item.
 * @param {number} myQuality The quality of the review (1=Again, 2=Hard, 3=Good).
 * @param {number} myItemId The ID of the item to update (passed from automation).
 */
function myUpdateSRS(myQuality, myItemId) {
    
    const myItem = myItemsDataSet.get(myItemId);

    if (!myItem) return;
    
    // Calculate current interval
    const myLastReviewMillis = new Date(myItem.start).getTime();
    const myIntervalMillis = Date.now() - new Date(myItem.myOriginalStart).getTime(); // Time since item creation for first review
    
    if (myItem.myCorrectCount > 0) {
        // For subsequent reviews, use time since last review (which is stored in myItem.start)
        mySRSFactors.myCurrentIntervalDays = Math.round((Date.now() - myLastReviewMillis) / ONE_DAY_MS) || 1;
    } else {
        // For first review (if it's the first time being marked good/hard), use interval since creation
        mySRSFactors.myCurrentIntervalDays = Math.round(myIntervalMillis / ONE_DAY_MS) || 1;
    }


    const { myNextReviewDate, myNewCorrectCount } = myCalculateNextReview(myItem, myQuality);

    const myUpdate = {
        id: myItemId,
        start: myNextReviewDate,
        myCorrectCount: myNewCorrectCount,
    };

    myItemsDataSet.update(myUpdate);
    mySaveToLocalStorage();
    myStatusMessage.textContent = `Review recorded! Next review in ${mySRSFactors.myCurrentIntervalDays} days. New EF: ${mySRSFactors.myEaseFactor.toFixed(2)}`;

    myResponseArea.value = '';
    myContentArea.value = '';
    myTimeline.setSelection([]);
    
    // --- AUTOMATION STEP 2: Load the next item ---
    myAutoSelectNextItem();
}

/**
 * Finds the next item that is currently due (start date <= now) and loads it for review.
 */
function myAutoSelectNextItem() {
    const myNowMillis = Date.now();
    let myNextItem = null;
    let myEarliestDueTime = Infinity;

    myItemsDataSet.forEach((item) => {
        const itemStartTime = new Date(item.start).getTime();
        
        // Find the earliest item whose review date is NOW or in the PAST
        if (itemStartTime <= myNowMillis && itemStartTime < myEarliestDueTime) {
            myEarliestDueTime = itemStartTime;
            myNextItem = item;
        }
    });

    if (myNextItem) {
        myTimeline.setSelection([myNextItem.id]);
        myLoadItemForReview(myNextItem.id);
        myTimeline.focus(myNextItem.id, { animation: true, zoom: true });
    } else {
        myStatusMessage.textContent = `No items currently due for review. Current EF: ${mySRSFactors.myEaseFactor.toFixed(2)}`;
        myLLMFeedback.textContent = "LLM Similarity: N/A";
        myLLMFeedback.style.backgroundColor = 'transparent';
    }
}

function myDeleteSelectedItem() {
    const mySelectedItems = myTimeline.getSelection();
    if (mySelectedItems.length === 0) {
        myStatusMessage.textContent = "Please select an item on the timeline to delete.";
        return;
    }

    const myItemId = mySelectedItems[0];

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
        myUpdateMaxId(); // Recalculate and update max ID
    } catch (error) {
        console.error("Error deleting item:", error);
        myStatusMessage.textContent = "Error deleting item. See console.";
    }
}


// =========================================================================
// --- CONTENT EXTRACTION & AI PROCESSING HANDLERS (Multi-Item) ---
// =========================================================================

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
            // Pass the function reference directly
            func: myExtractionFunc
        });

        const myExtractedText = myResults?.[0]?.result || '';
        myStopTimer();

        if (myExtractedText && myExtractedText.trim().length > 200) {
            myContentArea.value = myExtractedText.trim();
            myStatusMessage.textContent = 'Step 1: Content extracted. Click "Summarize & Add to Timeline" to summarize and save multiple concepts.';
            myGenerateTimelineBtn.disabled = false;
            myGenerateTimelineBtn.click()    // activate the timeline data extraction
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
    
    let myCurrentId = myGetNextItemId() - 1; 

    try {
        const mySummaryArray = await myGenerateTimelineItemJson(myExtractedText);
        myStopTimer();

        let myNewIds = [];
        const myCurrentIsoDate = myMillisToIso(Date.now());

        // --- Step 3: Add all items to Timeline ---
        mySummaryArray.forEach(mySummaryObject => {
            myCurrentId++; 
            const uniqueContentHint = myEnsureUniqueHint(mySummaryObject.hint);

            const myNewItem = {
                id: myCurrentId,
                content: uniqueContentHint, 
                start: myCurrentIsoDate,
                longDescription: mySummaryObject.description, 
                myOriginalStart: myCurrentIsoDate,
                myCorrectCount: 0,
                language: mySummaryObject.language || 'en'
            };

            myItemsDataSet.add(myNewItem);
            myNewIds.push(myCurrentId);
        });
        
        // Update the max ID input to reflect the last assigned ID + 1
        myMaxIdInput.value = myCurrentId + 1; 

        mySaveToLocalStorage();

        myContentArea.value = `Successfully generated and added ${mySummaryArray.length} new flashcard items.`;
        myResponseArea.value = '';

        if (myNewIds.length > 0) {
            myTimeline.setSelection([myNewIds[myNewIds.length - 1]]);
            // We removed myTimeline.focus() to prevent unwanted deep zoom.
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
    // Hide edit panel when a new item is clicked for review
    myEditPanel.style.display = 'none';
    myEditingItemId = null;

    const myItem = myItemsDataSet.get(myItemId);
    if (myItem) {
        const myReviewDate = new Date(myItem.start);
        const myNow = new Date();
        
        if (myReviewDate.getTime() > myNow.getTime()) {
            const myDiffMs = myReviewDate.getTime() - myNow.getTime();
            const myDiffHours = Math.floor(myDiffMs / (1000 * 60 * 60));
            const myDiffMinutes = Math.round((myDiffMs % (1000 * 60 * 60)) / (1000 * 60));
            
            let myWaitMessage = "";
            if (myDiffHours > 0) {
                myWaitMessage += `${myDiffHours} hour${myDiffHours !== 1 ? 's' : ''}`;
            }
            if (myDiffMinutes > 0 || myDiffHours === 0) {
                if (myDiffHours > 0) myWaitMessage += " and ";
                myWaitMessage += `${myDiffMinutes} minute${myDiffMinutes !== 1 ? 's' : ''}`;
            }

            myContentArea.value = `This item is not due yet. Please wait ${myWaitMessage} (until ${myReviewDate.toLocaleTimeString()}) to review.`;
            myResponseArea.value = '';
            myLLMFeedback.textContent = "LLM Similarity: N/A";
            myLLMFeedback.style.backgroundColor = 'transparent';
            myStatusMessage.textContent = `Item due in the future: ${myItem.content}`;
            myTimeline.setSelection([]); // Deselect the item as it can't be reviewed
            return;
        }

        // Item is due: Load for review
        myContentArea.value = myItem.content || '';
        myResponseArea.value = '';
        myLLMFeedback.textContent = "LLM Similarity: Ready to check";
        myLLMFeedback.style.backgroundColor = 'transparent';
        myStatusMessage.textContent = `Reviewing item: ${myItem.content}`;
    }
}

/**
 * Handles double click on a timeline item to load it into the edit panel.
 */
function myTimelineDoubleClick(myProps) {
    const myItemId = myProps.item;
    if (!myItemId) return;

    const myItem = myItemsDataSet.get(myItemId);
    if (myItem) {
        myEditingItemId = myItemId;
        
        // Load data into edit fields
        myEditContent.value = myItem.content || '';
        myEditDescription.value = myItem.longDescription || '';

        // Calculate new date: Current Date + 10 minutes
        const myNewDate = new Date(Date.now() + 10 * 60 * 1000);
        myEditDate.value = myIsoToLocalDatetime(myNewDate.toISOString());

        // Show the edit panel
        myEditPanel.style.display = 'block';
        myTimeline.focus(myItemId);
        myStatusMessage.textContent = `Editing Item ID ${myItemId}. Next review date pre-set to 10 minutes from now.`;
    }
}

/**
 * Saves the changes from the edit panel back to the timeline item.
 */
function mySaveEdit() {
    if (!myEditingItemId) return;

    const myNewContent = myEditContent.value.trim();
    const myNewDescription = myEditDescription.value.trim();
    const myNewDateString = myEditDate.value;

    if (!myNewContent || !myNewDescription || !myNewDateString) {
        myStatusMessage.textContent = "Error: All editing fields must be filled.";
        return;
    }

    const myUniqueContentHint = myEnsureUniqueHint(myNewContent);
    const myNewDateIso = new Date(myNewDateString).toISOString();
    
    // Ensure that if the user double-clicked to edit, the next review count is reset to 0/1 to restart SRS
    const myCurrentItem = myItemsDataSet.get(myEditingItemId);
    const myNewCorrectCount = myCurrentItem.myCorrectCount > 0 ? 1 : 0; // Reset to 1 (first good review) or 0

    const myUpdate = {
        id: myEditingItemId,
        content: myUniqueContentHint,
        longDescription: myNewDescription,
        start: myNewDateIso,
        myCorrectCount: myNewCorrectCount, // Resetting the review count
    };

    myItemsDataSet.update(myUpdate);
    mySaveToLocalStorage();
    myStatusMessage.textContent = `Item ID ${myEditingItemId} updated and scheduled for review at ${new Date(myNewDateIso).toLocaleString()}.`;

    myCancelEdit(); // Close and reset
}

/**
 * Cancels the editing and hides the panel.
 */
function myCancelEdit() {
    myEditPanel.style.display = 'none';
    myEditingItemId = null;
    myEditContent.value = '';
    myEditDescription.value = '';
    myEditDate.value = '';
    myTimeline.setSelection([]); // Deselect the item
    myStatusMessage.textContent = "Edit cancelled. Ready.";
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

        let loadedData = myDefaultData;
        if (myStoredData) {
            loadedData = JSON.parse(myStoredData);
        }

        return loadedData;
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

    const myInitialData = myLoadFromLocalStorage();

    myItemsDataSet = new vis.DataSet(myInitialData);

    const myNow = Date.now();
    const myInitialStart = myNow - TWO_DAYS_MS; // Start 2 days ago
    const myInitialEnd = myNow + TWO_DAYS_MS;  // End 2 days from now
    
    myTimeline = new vis.Timeline(myVisTimelineContainer, myItemsDataSet, {
        type: 'box',
        tooltip: { followMouse: false },
        autoResize: true,
        zoomable: true,
        zoomKey: undefined,
        moveable: true,
        selectable: true,
        showCurrentTime: true,
        // Crucial options for solving the stacking/date visibility issue:
        verticalScroll: true, 
        stack: true, 
        template: function (item) {
            const isOverdue = new Date(item.start).getTime() < Date.now();
            return `<div style="${isOverdue ? 'color: red; font-weight: bold;' : ''}">${item.content}</div>`;
        },
        // Set initial zoom to span 4 days
        start: myInitialStart, 
        end: myInitialEnd,
        // Removed: zoomMin and zoomMax constraints
    });

    myTimeline.on('doubleClick', myTimelineDoubleClick);
    myTimeline.on('click', (properties) => {
        if (properties.item) {
            myLoadItemForReview(properties.item);
        } else {
            // Clicked on background, deselect, hide edit panel
            myCancelEdit();
        }
    });
    
    // Crucial step: Initialize the Max ID after loading data
    myUpdateMaxId(); 
}

function myUpdateFactorDisplay() {
    const currentMessage = myStatusMessage.textContent.split(' | ')[0];
    myStatusMessage.textContent = `${currentMessage} | Current EF: ${mySRSFactors.myEaseFactor.toFixed(2)}`;
}


// =========================================================================
// --- APP INITIALIZATION ---
// =========================================================================

async function myInitializeApp() {
    myInitializeVisTimeline();
    await myInitializeLanguageModel();

    // The preferred direct assignment of onclick handlers:
    if (myShowAllButton) { myShowAllButton.onclick = () => myExtractContent(myGetPageText); }
    if (myShowSelectedButton) { myShowSelectedButton.onclick = () => myExtractContent(myGetSelectedText); }
    if (myGenerateTimelineBtn) {
        myGenerateTimelineBtn.onclick = myGenerateTimelineItem;
        myGenerateTimelineBtn.disabled = true;
    }
    if (myLLMCheckBtn) { 
        myLLMCheckBtn.onclick = myCheckSimilarity; 
    }
    
    // SRS Buttons (Again, Hard, Good) are disabled/hidden and the handlers removed as automation is now active.
    // The previous manual handlers are commented out:
    // if (mySrsAgainBtn) { mySrsAgainBtn.onclick = () => myUpdateSRS(1); }
    // if (mySrsHardBtn) { mySrsHardBtn.onclick = () => myUpdateSRS(2); }
    // if (mySrsGoodBtn) { mySrsGoodBtn.onclick = () => myUpdateSRS(3); }

    if (myDeleteBtn) { myDeleteBtn.onclick = myDeleteSelectedItem; }
    if (myExportBtn) { myExportBtn.onclick = myExportData; }
    
    // Prevent default label action and manually trigger the hidden input click
    const myImportInputHandler = (myMode) => (event) => {
        event.preventDefault(); 
        myImportInput.dataset.mode = myMode; 
        myImportInput.click(); 
    };

    if (myImportReplaceLabel) { 
           myImportReplaceLabel.onclick = myImportInputHandler('replace'); 
    }
    if (myImportAppendLabel) { 
        myImportAppendLabel.onclick = myImportInputHandler('append'); 
    }
    
    // The onchange event fires after the user selects a file:
    if (myImportInput) {
        myImportInput.onchange = (event) => {
            const myMode = event.target.dataset.mode === 'replace';
            myImportData(event, myMode);
        };
    }
    
    if (mySaveEditBtn) { mySaveEditBtn.onclick = mySaveEdit; }
    if (myCancelEditBtn) { myCancelEditBtn.onclick = myCancelEdit; }

    if (myMinOneDayCheckbox) {
        myMinOneDayCheckbox.onclick = mySaveToLocalStorage;
    }

    myUpdateFactorDisplay();
    myStatusMessage.textContent = "App initialized. All features ready.";
    
    // Hide edit panel initially
    myEditPanel.style.display = 'none';
    
    // Initial call to load the first due item, if any
    myAutoSelectNextItem();
}

document.addEventListener('DOMContentLoaded', myInitializeApp);