// Renamed from mySidePanelLogic.js to mySidePanel.js
// Script type="module" requires use of 'export' if functions were called from HTML,
// but since the extension uses a different setup (popups/sidepanels), we stick to
// direct ID binding and an initialization function.

// --- Global Variables & UI References (myCamelCase) ---
// Note: We are using the IDs from the updated mySidePanel.html
const myVisTimelineContainer = document.getElementById('myVisTimeline'); // Renamed for clarity
const myStatus = document.getElementById('myStatusMessage'); // Updated ID
const myContentArea = document.getElementById('myContentArea'); // New
const myResponseArea = document.getElementById('myResponseArea'); // New
const myShowAllBtn = document.getElementById('myShowAllBtn'); // Updated ID
const myShowSelectedBtn = document.getElementById('myShowSelectedBtn'); // Updated ID
const myLLMCheckBtn = document.getElementById('myLLMCheckBtn'); // New
const myLLMFeedback = document.getElementById('myLLMFeedback'); // New
const mySrsAgainBtn = document.getElementById('mySrsAgainBtn'); // New
const mySrsHardBtn = document.getElementById('mySrsHardBtn'); // New
const mySrsGoodBtn = document.getElementById('mySrsGoodBtn'); // New
const myMinOneDayCheckbox = document.getElementById('myMinOneDayCheckbox'); // Updated ID

// Note: Removed unused or un-provided element IDs (myProcessImportButton, myQuestionSelectBox, etc.)
// from the global declarations for simplicity based on the current HTML.

// --- LLM & SRS State ---
let myLanguageModelSession = null;
let myItemsDataSet;
let myTimeline;
let myTimerInterval;

// SRS constants (used with localStorage)
const mySRSFactors = {
    myEaseFactor: 2.50, // Initial Ease Factor (EF)
    myFactorMax: 3.0,
    myFactorMin: 1.1,
    myCurrentIntervalDays: 0 // Used to track the last calculated interval
};
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MIN_TEST_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes minimum delay

// Default Data Set (Simplified for this example)
const myDefaultData = [
    { id: 1, content: 'Gemini', start: '2025-09-29T00:00:00.000Z', longDescription: 'AI model by Google', myOriginalStart: '2025-09-29T00:00:00.000Z', myCorrectCount: 0 },
    { id: 2, content: 'Spaced Repetition', start: '2025-09-30T14:00:00.000Z', longDescription: 'Memory technique based on increasing time intervals between reviews.', myOriginalStart: '2025-09-30T14:00:00.000Z', myCorrectCount: 0 }
];

// =========================================================================
// --- GENERAL UTILITY FUNCTIONS (Kept or adapted) ---
// =========================================================================

function myStartTimer(myTargetStatusElement = myStatus) {
    let mySeconds = 0;
    myTargetStatusElement.textContent = "Working... 0s";

    if (myTimerInterval) {
        clearInterval(myTimerInterval);
    }

    myTimerInterval = setInterval(() => {
        mySeconds++;
        myTargetStatusElement.textContent = `Working... ${mySeconds}s`;
    }, 1000);
}

function myStopTimer(myMessage, myTargetStatusElement = myStatus) {
    if (myTimerInterval) {
        clearInterval(myTimerInterval);
        myTimerInterval = null;
    }
    myTargetStatusElement.textContent = myMessage;
}

function myMillisToIso(myMillis) { return new Date(myMillis).toISOString(); }

// =========================================================================
// --- LLM (Built-in AI) FUNCTIONS ---
// =========================================================================

/**
 * Initializes the Chrome built-in Language Model session.
 * This function should run on app startup.
 */
async function myInitializeLanguageModel() {
    myStatus.textContent = "Initializing built-in AI...";
    try {
        // Assume 'LanguageModel' is the global object for Chrome's built-in AI
        if (typeof LanguageModel !== 'undefined') {
            myLanguageModelSession = await LanguageModel.create();
            myStopTimer("AI Ready.", myStatus);
            return true;
        } else {
            myStopTimer("Error: Built-in AI not available (LanguageModel missing).", myStatus);
            return false;
        }
    } catch (myError) {
        console.error("Error initializing LanguageModel:", myError);
        myStopTimer("AI Initialization Failed. Check Chrome Flags.", myStatus);
        return false;
    }
}

/**
 * Uses the built-in AI to check the similarity between the original content and the user's response.
 */
async function myCheckSimilarity() {
    if (!myLanguageModelSession) {
        myLLMFeedback.textContent = "Error: AI not ready. Please wait or check initialization.";
        return;
    }

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
        
        // Attempt to parse the result as a number
        let mySimilarityScore = parseFloat(myResult.trim());

        if (isNaN(mySimilarityScore) || mySimilarityScore < 0 || mySimilarityScore > 1) {
            // Fallback for an AI that returns text or an unexpected format
            mySimilarityScore = 0.5; // Default to a neutral score if parsing fails
            myStopTimer(`AI returned non-numeric data. Assuming 0.5. Raw: ${myResult.substring(0, 30)}...`, myLLMFeedback);
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


// =========================================================================
// --- SPACED REPETITION SYSTEM (SRS) LOGIC ---
// =========================================================================

/**
 * Calculates the next review date based on the user's recall quality (1, 2, or 3).
 * @param {object} myItem The current item data.
 * @param {number} myQuality The recall quality (1=Again, 2=Hard, 3=Good).
 */
function myCalculateNextReview(myItem, myQuality) {
    let myEF = mySRSFactors.myEaseFactor;
    let myN = myItem.myCorrectCount;
    let myIntervalDays;
    
    // 1. Update Ease Factor (EF) based on quality
    if (myQuality === 1) { // Again (Mistake)
        myN = 0; // Reset correct count
        myEF = myEF + (0.10 - (3 - 1) * 0.08 - (3 - 1) * 0.02);
    } else if (myQuality === 2) { // Hard (Slightly wrong)
        myEF = myEF + (0.10 - (3 - 2) * 0.08 - (3 - 2) * 0.02);
        myN++;
    } else if (myQuality === 3) { // Good (Correct)
        myEF = myEF + (0.10 - (3 - 3) * 0.08 - (3 - 3) * 0.02);
        myN++;
    }

    // Clamp EF between min and max
    myEF = Math.min(mySRSFactors.myFactorMax, Math.max(mySRSFactors.myFactorMin, myEF));
    
    // 2. Calculate New Interval (I)
    if (myN === 1) {
        myIntervalDays = 1;
    } else if (myN === 2) {
        myIntervalDays = 3;
    } else {
        // I(n) = I(n-1) * EF
        // We need the *previous* interval (not stored here), so we'll use a simplified model
        // that's common in basic SRS implementations:
        // I(n) = I(n-1) * EF, and since n>2, we use I(2)=3
        // For simplicity, let's use:
        myIntervalDays = Math.round(myCurrentIntervalDays * myEF);
    }
    
    // Check 'Min 1 Day' setting
    if (myMinOneDayCheckbox.checked && myIntervalDays < 1) {
        myIntervalDays = 1;
    }
    
    // 3. Determine Next Review Date
    const myNextReviewMillis = Date.now() + (myIntervalDays * ONE_DAY_MS);
    const myNextReviewDate = myMillisToIso(myNextReviewMillis);

    // Update global factor and interval for next calculation
    mySRSFactors.myEaseFactor = myEF;
    mySRSFactors.myCurrentIntervalDays = myIntervalDays;

    return { myNextReviewDate, myNewCorrectCount: myN };
}

/**
 * Handles the click of an SRS feedback button, updating the item and timeline.
 * @param {number} myQuality The recall quality (1=Again, 2=Hard, 3=Good).
 */
function myUpdateSRS(myQuality) {
    // 1. Get the current active item (This assumes the timeline always has one selected item, or we need a way to track the current item being reviewed)
    const mySelectedItems = myTimeline.getSelection();
    if (mySelectedItems.length === 0) {
        myStatus.textContent = "Please click an item on the timeline to select it for review.";
        return;
    }

    const myItemId = mySelectedItems[0];
    const myItem = myItemsDataSet.get(myItemId);

    if (!myItem) return;

    // We need the current interval to calculate the next one, but the existing data structure doesn't store it.
    // Let's calculate the current interval from the last review date:
    const myLastReviewMillis = new Date(myItem.start).getTime();
    const myIntervalMillis = Date.now() - myLastReviewMillis;
    mySRSFactors.myCurrentIntervalDays = Math.round(myIntervalMillis / ONE_DAY_MS) || 1; // Default to 1 day if it's the first review or interval is too small

    // 2. Calculate the next review
    const { myNextReviewDate, myNewCorrectCount } = myCalculateNextReview(myItem, myQuality);
    
    // 3. Update the item in the DataSet
    const myUpdate = {
        id: myItemId,
        start: myNextReviewDate, // The new review date
        myCorrectCount: myNewCorrectCount,
        // Optional: Can add a property to track the last quality score/response for debugging
    };

    myItemsDataSet.update(myUpdate);
    mySaveToLocalStorage();
    myStatus.textContent = `Review recorded! Next review in ${mySRSFactors.myCurrentIntervalDays} days. New EF: ${mySRSFactors.myEaseFactor.toFixed(2)}`;
}


// =========================================================================
// --- APP INITIALIZATION AND STATE MANAGEMENT (Adapted) ---
// =========================================================================

function myLoadFromLocalStorage() {
    try {
        const myStoredData = localStorage.getItem('myTimelineData');
        const myStoredFactors = localStorage.getItem('mySRSFactors');

        if (myStoredFactors) {
            const factors = JSON.parse(myStoredFactors);
            mySRSFactors.myEaseFactor = factors.easeFactor || 2.50; // Update global factor
        }
        
        // Note: mySRSSettings handling is removed for simplicity as the HTML doesn't show
        // myGenerationPromptInput. If it exists in the extension, the logic should be reinstated.
        
        if (myStoredData) {
            myStatus.textContent = "Data loaded from Local Storage.";
            return JSON.parse(myStoredData);
        }
        myStatus.textContent = "No stored data found. Using default data.";
        return myDefaultData;
    } catch (myError) {
        console.error("Error loading data from local storage:", myError);
        myStatus.textContent = "Error loading data. Using default data.";
        return myDefaultData;
    }
}

function mySaveToLocalStorage() {
    try {
        const myDataToSave = myItemsDataSet.get();
        localStorage.setItem('myTimelineData', JSON.stringify(myDataToSave));
        // Save the updated Ease Factor
        localStorage.setItem('mySRSFactors', JSON.stringify({ easeFactor: mySRSFactors.myEaseFactor }));
        
        // Save the 'Min 1 Day' setting
        const mySettings = { minimumOneDay: myMinOneDayCheckbox.checked };
        localStorage.setItem('mySRSSettings', JSON.stringify(mySettings));
        
        myUpdateFactorDisplay();
    } catch (myError) {
        console.error("Error saving data to local storage:", myError);
        myStatus.textContent = "Error saving data. Check console.";
    }
}

async function myInitializeApp() {
    const myInitialData = myLoadFromLocalStorage();

    if (typeof vis === 'undefined' || !vis.DataSet || !vis.Timeline) {
        myStatus.textContent = "Error: Vis.js library not loaded. Timeline functionality disabled.";
        console.error("Vis.js is required for timeline display.");
        return;
    }

    myItemsDataSet = new vis.DataSet(myInitialData);
    myTimeline = new vis.Timeline(myVisTimelineContainer, myItemsDataSet, { // Updated container ID
        type: 'box',
        tooltip: { followMouse: false },
        autoResize: true,
    });

    // NOTE: Removed myTimelineItemOver and myTimelineItemOut as no myTooltip element was provided in the HTML.
    // If you add a myCustomTooltip element, the original functions can be restored.

    myTimeline.on('doubleClick', myTimelineDoubleClick);
    myTimeline.on('click', (properties) => {
        if (properties.item) {
            myLoadItemForReview(properties.item); // New function to load item content
        }
    });
    
    // Call the AI initializer
    await myInitializeLanguageModel();

    myUpdateFactorDisplay();
    // Removed unused functions: myAutofillNextEntry, myPopulateSelectBox, mySwitchTab.
}

function myUpdateFactorDisplay() {
    // Corrected to use the mySRSFactors object
    // Also, we don't have myFactorDisplay in the current HTML/JS context, so we'll log it to status
    myStatus.textContent += ` | Current Ease Factor (EF): ${mySRSFactors.myEaseFactor.toFixed(2)}`;
}

/**
 * Loads the selected item's data into the content area for review.
 * @param {string|number} myItemId The ID of the item to load.
 */
function myLoadItemForReview(myItemId) {
    const myItem = myItemsDataSet.get(myItemId);
    if (myItem) {
        myContentArea.value = myItem.longDescription || ''; // Original content (the answer)
        myResponseArea.value = ''; // Clear the user response area
        myLLMFeedback.textContent = "LLM Similarity: N/A";
        myLLMFeedback.style.backgroundColor = 'transparent';
        myStatus.textContent = `Ready to review item: ${myItem.content}`;
    }
}

// =========================================================================
// --- TIMELINE INTERACTION (Vis.js Handlers) (Adapted) ---
// =========================================================================

function myTimelineDoubleClick(myProps) {
    // Only display the HINT (the item content) on double-click now, as a reveal/cheat.
    const myItem = myItemsDataSet.get(myProps.item);
    if (myItem && myItem.content) {
        myStatus.textContent = `**HINT (Cheat):** ${myItem.content}`;
        setTimeout(() => { myStatus.textContent = "Hint cleared. Get back to work!"; }, 3000);
    }
}

// =========================================================================
// --- Attach Event Listeners ---
// =========================================================================

// Attach listeners for the new SRS and LLM Check buttons
if (myLLMCheckBtn) {
    myLLMCheckBtn.onclick = myCheckSimilarity;
}
if (mySrsAgainBtn) {
    // Use an anonymous function to pass the quality score (1 = Again/Bad)
    mySrsAgainBtn.onclick = () => myUpdateSRS(1);
}
if (mySrsHardBtn) {
    // Use an anonymous function to pass the quality score (2 = Hard/OK)
    mySrsHardBtn.onclick = () => myUpdateSRS(2);
}
if (mySrsGoodBtn) {
    // Use an anonymous function to pass the quality score (3 = Good/Perfect)
    mySrsGoodBtn.onclick = () => myUpdateSRS(3);
}
// Attach listeners for content buttons (if they communicate with Service Worker/Content Script)
// For now, we assume their functions (myProcessImportData, myGenerateLongDescription) 
// are defined elsewhere and are called from the Service Worker via messages.
// If the functions are purely local, we need the logic. Since they weren't provided,
// we only hook up the provided functions.

// Since myInitializeApp is the core function, we call it on load.
myInitializeApp();