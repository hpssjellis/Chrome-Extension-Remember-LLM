// --- Global Variables & UI References (myCamelCase) ---
const myContainer = document.getElementById('myTimeline');
const myTooltip = document.getElementById('myCustomTooltip');
const myStatus = document.getElementById('myStatus');
const myOutput = document.getElementById('myOutput');
const myProcessImportButton = document.getElementById('myProcessImportButton');
const myQuestionSelectBox = document.getElementById('myQuestionSelectBox');
const myMinimumOneDayCheckbox = document.getElementById('myMinimumOneDayCheckbox');
const myFactorDisplay = document.getElementById('myFactorDisplay');
const myCheckButton = document.getElementById('myCheckButton');
const mySummarizedContentArea = document.getElementById('mySummarizedContentArea');
const mySummarizeStatusMessage = document.getElementById('mySummarizeStatusMessage');
const myEntryIdInput = document.getElementById('myEntryIdInput');
const myEntryDateInput = document.getElementById('myEntryDateInput');
const myEntryContentInput = document.getElementById('myEntryContentInput');
const myEntryLongDescriptionInput = document.getElementById('myEntryLongDescriptionInput');
const myGenerationStatus = document.getElementById('myGenerationStatus');
const myGenerationPromptInput = document.getElementById('myGenerationPromptInput');

// --- LLM & SRS State ---
let myLanguageModelSession = null;
let myItemsDataSet;
let myTimeline;
let myTimerInterval;
const myEaseFactor = { value: 2.50 }; // Initial Ease Factor (EF)
const myFactorMax = 3.0;
const myFactorMin = 1.1;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MIN_TEST_INTERVAL_MS = 5 * 60 * 1000;

// Default Data Set
const myDefaultData = [
  { id: 1, content: 'Gemini', start: '2025-09-29T00:00:00.000Z', longDescription: 'AI model by Google', myOriginalStart: '2025-07-26T10:00:00.000Z', myCorrectCount: 0 },
  { id: 2, content: 'Spaced Repetition', start: '2025-09-30T14:00:00.000Z', longDescription: 'Memory technique based on increasing time intervals between reviews.', myOriginalStart: '2025-05-27T14:00:00.000Z', myCorrectCount: 0 }
];


// =========================================================================
// --- GENERAL UTILITY FUNCTIONS ---
// =========================================================================

/** Starts a simple timer in the status bar */
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

/** Stops the timer and updates the status message */
function myStopTimer(myMessage, myTargetStatusElement = myStatus) {
  if (myTimerInterval) {
    clearInterval(myTimerInterval);
    myTimerInterval = null;
  }
  myTargetStatusElement.textContent = myMessage;
}

/** Converts ISO string to local date/time string for input type="datetime-local" */
function myIsoToLocalDateTime(myIsoString) {
  const myDate = new Date(myIsoString);
  const myOffset = myDate.getTimezoneOffset() * 60000;
  const myLocalTime = new Date(myDate.getTime() - myOffset);
  return myLocalTime.toISOString().slice(0, 16);
}

function myIsoToMillis(myIsoString) { return new Date(myIsoString).getTime(); }
function myMillisToIso(myMillis) { return new Date(myMillis).toISOString(); }


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
      myEaseFactor.value = factors.easeFactor || 2.50;
    }
    
    if (myStoredSettings) {
      const settings = JSON.parse(myStoredSettings);
      myMinimumOneDayCheckbox.checked = settings.minimumOneDay !== false;
      myGenerationPromptInput.value = settings.generationPrompt || myGenerationPromptInput.value;
    }

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
    localStorage.setItem('mySRSFactors', JSON.stringify({ easeFactor: myEaseFactor.value }));
    // Save settings including the new prompt
    const mySettings = { 
        minimumOneDay: myMinimumOneDayCheckbox.checked,
        generationPrompt: myGenerationPromptInput.value
    };
    localStorage.setItem('mySRSSettings', JSON.stringify(mySettings));
    myUpdateFactorDisplay();
  } catch (myError) {
    console.error("Error saving data to local storage:", myError);
    myStatus.textContent = "Error saving data. Check console.";
  }
}

async function myInitializeApp() {
  // 1. Load Data
  const myInitialData = myLoadFromLocalStorage();

  // 2. Initialize Vis.js Timeline
  myItemsDataSet = new vis.DataSet(myInitialData);
  myTimeline = new vis.Timeline(myContainer, myItemsDataSet, {
    type: 'box',
    tooltip: { followMouse: false },
    autoResize: true,
  });

  // 3. Attach Timeline Event Handlers
  myTimeline.on('itemover', myTimelineItemOver);
  myTimeline.on('itemout', myTimelineItemOut);
  myTimeline.on('doubleClick', myTimelineDoubleClick);
  myTimeline.on('click', myLoadItemForEdit);
  
  // 4. Final Setup
  myUpdateFactorDisplay();
  myAutofillNextEntry();
  myPopulateSelectBox();
  mySwitchTab('summarize');
}

/** Updates the display of the Ease Factor */
function myUpdateFactorDisplay() {
  myFactorDisplay.innerHTML = `
    <strong>Ease Factor (EF):</strong> 
    <span style="color: purple; font-weight: bold;">${myEaseFactor.value.toFixed(2)}</span> 
    (Interval Multiplier)
  `;
}

/** Clears all data from the tool and local storage */
function myClearAllLocalData() {
    if (confirm("Are you sure you want to clear ALL data (including Local Storage)? This cannot be undone.")) {
        myItemsDataSet.clear();
        localStorage.removeItem('myTimelineData');
        localStorage.removeItem('mySRSFactors');
        localStorage.removeItem('mySRSSettings');
        myEaseFactor.value = 2.50;
        myUpdateFactorDisplay();
        myPopulateSelectBox();
        myAutofillNextEntry();
        myStatus.textContent = "All data cleared from tool and Local Storage. Defaults restored.";
    }
}

/** Switches the visible content panel */
function mySwitchTab(myTabName) {
    document.querySelectorAll('.myTabContent').forEach(el => el.classList.remove('myVisible'));
    document.querySelectorAll('[id^="myTabButton"]').forEach(el => el.classList.remove('myActiveTabButton'));

    if (myTabName === 'summarize') {
        document.getElementById('myTabContentSummarize').classList.add('myVisible');
        document.getElementById('myTabButtonSummarize').classList.add('myActiveTabButton');
    } else if (myTabName === 'remember') {
        document.getElementById('myTabContentRemember').classList.add('myVisible');
        document.getElementById('myTabButtonRemember').classList.add('myActiveTabButton');
    }
}


// =========================================================================
// --- TIMELINE INTERACTION (Vis.js Handlers) ---
// =========================================================================

function myTimelineItemOver(myProps) {
  const myItem = myItemsDataSet.get(myProps.item);
  if (myItem) {
    const myOriginalTime = new Date(myItem.myOriginalStart).toLocaleDateString();
    myTooltip.innerHTML = 
      `**Hint:** ${myItem.content}<br>` + 
      `**Original Date:** ${myOriginalTime}<br>` +
      `**Correct Count:** ${myItem.myCorrectCount}`;
    myTooltip.style.display = 'block';
    myTooltip.style.left = myProps.pageX + 10 + 'px';
    myTooltip.style.top = myProps.pageY + 10 + 'px';
  }
}

function myTimelineItemOut() {
  myTooltip.style.display = 'none';
}

function myTimelineDoubleClick(myProps) {
  const myItem = myItemsDataSet.get(myProps.item);
  if (myItem && myItem.longDescription) {
    myTooltip.innerHTML = `**ANSWER:**<br>${myItem.longDescription.replace(/\n/g, '<br>')}`;
    myTooltip.style.display = 'block';
    setTimeout(() => { myTooltip.style.display = 'none'; }, 3000);
  }
}


// =========================================================================
// --- SRS DATA MANAGEMENT (CRUD) ---
// =========================================================================

function myLoadItemForEdit(myId) {
    if (!myId || typeof myId !== 'number') return;
    
    const myItem = myItemsDataSet.get(myId);
    if (myItem) {
        myEntryIdInput.value = myItem.id;
        myEntryDateInput.value = myIsoToLocalDateTime(myItem.start);
        myEntryContentInput.value = myItem.content;
        myEntryLongDescriptionInput.value = myItem.longDescription;
        mySwitchTab('remember'); // Switch to the remember tab if an item is clicked
    }
}

function myGetNextId() {
  const myAllIds = myItemsDataSet.getIds();
  return myAllIds.length ? Math.max(...myAllIds) + 1 : 1;
}

function myAutofillNextEntry() {
  const now = new Date();
  now.setSeconds(0, 0);
  const myOffset = now.getTimezoneOffset();
  const myLocalDate = new Date(now.getTime() - myOffset * 60000);
  const myCurrentDateTimeLocal = myLocalDate.toISOString().slice(0, 16);

  myEntryIdInput.value = myGetNextId();
  myEntryDateInput.value = myCurrentDateTimeLocal;
  myEntryContentInput.value = '';
  myEntryLongDescriptionInput.value = '';
}

function myAddEntry() {
  const myId = Number(myEntryIdInput.value);
  const myContent = myEntryContentInput.value.trim();
  const myLongDescription = myEntryLongDescriptionInput.value.trim();
  const myDateTimeLocal = myEntryDateInput.value;

  if (!myContent || !myLongDescription || !myDateTimeLocal) {
    myStatus.textContent = 'Error: Please fill all fields (Hint, Answer, Date).';
    return;
  }

  const myExistingItem = myItemsDataSet.get(myId);
  const myIsoString = new Date(myDateTimeLocal).toISOString();

  if (myExistingItem) {
    myExistingItem.content = myContent;
    myExistingItem.longDescription = myLongDescription;
    myExistingItem.start = myIsoString;
    myItemsDataSet.update(myExistingItem);
    myStatus.textContent = `Item ${myId} updated!`;
  } else {
    myItemsDataSet.add({
      id: myId,
      content: myContent,
      start: myIsoString,
      longDescription: myLongDescription,
      myOriginalStart: myIsoString,
      myCorrectCount: 0,
    });
    myStatus.textContent = `New Item ${myId} added!`;
  }
  myAutofillNextEntry();
}

function myDeleteEntry() {
  const myId = Number(myEntryIdInput.value);
  const myItem = myItemsDataSet.get(myId);

  if (!myId || !myItem) {
    myStatus.textContent = 'Error: No item selected or ID is invalid for deletion.';
    return;
  }

  if (confirm(`Are you sure you want to delete item #${myId}: "${myItem.content}"?`)) {
    try {
      myItemsDataSet.remove(myId);
      mySaveToLocalStorage();
      myPopulateSelectBox();
      myAutofillNextEntry();
      myStatus.textContent = `Item #${myId} deleted successfully.`;
    } catch (myError) {
      console.error("Error deleting item:", myError);
      myStatus.textContent = "Error during deletion. Check console.";
    }
  }
}

// --- Import/Export Functions ---

function myDownloadFile(myContent, myFileName, myMimeType) {
  const myBlob = new Blob([myContent], { type: myMimeType });
  const myUrl = URL.createObjectURL(myBlob);
  const myA = document.createElement('a');
  myA.href = myUrl;
  myA.download = myFileName;
  document.body.appendChild(myA);
  myA.click();
  document.body.removeChild(myA);
  URL.revokeObjectURL(myUrl);
  myStatus.textContent = `Successfully exported data to ${myFileName}.`;
}

function myExportJsonAll() {
  const myAllItems = myItemsDataSet.get();
  const myJsonString = JSON.stringify(myAllItems, null, 2);
  myDownloadFile(myJsonString, 'srs_all_data.json', 'application/json');
}

function myExportCsv() {
  const myAllItems = myItemsDataSet.get();
  if (myAllItems.length === 0) {
    myStatus.textContent = "No data to export to CSV.";
    return;
  }
  const myHeaders = ["id", "content", "longDescription", "start", "myOriginalStart", "myCorrectCount"];
  let myCsv = myHeaders.join(',') + '\n';
  // ... (CSV logic is complex, simplified for merge plan) ...
  myDownloadFile(myCsv, 'srs_data_export.csv', 'text/csv');
}

function myPrepareImport() {
  myOutput.readOnly = false;
  myOutput.style.backgroundColor = '#fff';
  myOutput.value = "Paste JSON or CSV data here and click 'Process Imported Data'. JSON is preferred for full data import.";
  myProcessImportButton.style.display = 'block';
  myStatus.textContent = "Ready to import data. Please paste content below.";
}

function myProcessImportData() {
    const myDataString = myOutput.value.trim();
    if (!myDataString) {
        myStatus.textContent = "Error: Paste data into the box before processing.";
        return;
    }
    let myParsedData;
    try {
        myParsedData = JSON.parse(myDataString);
    } catch (jsonError) {
        myStatus.textContent = "Error: Data could not be parsed as valid JSON. Try CSV format.";
        return;
    }

    if (myParsedData && Array.isArray(myParsedData) && myParsedData.length > 0) {
        myItemsDataSet.clear();
        myItemsDataSet.add(myParsedData);
        mySaveToLocalStorage();
        myPopulateSelectBox();
        myAutofillNextEntry();
        myStatus.textContent = `Successfully imported and saved ${myParsedData.length} items!`;
    } else {
        myStatus.textContent = "Error: Imported data array is empty or invalid.";
    }

    myOutput.readOnly = true;
    myOutput.style.backgroundColor = '#eee';
    myProcessImportButton.style.display = 'none';
}


// =========================================================================
// --- SUMMARIZATION LOGIC ---
// =========================================================================

/** Function injected into the active tab to get all page text. */
function myGetPageText() {
  return document.body.innerText;
}

/** Function injected into the active tab to get selected text. */
function myGetSelectedText() {
  return window.getSelection().toString();
}

/** Core AI summarization function (uses a static JSON schema) */
async function mySummarizeWithPrompt(myText) {
  if (!('LanguageModel' in window)) {
    return 'Error: The Chrome LanguageModel API is not supported in this browser or is not enabled.';
  }

  const mySummarySchema = {
    // ... (Schema definition remains the same) ...
    "type": "object",
    "properties": {
        "heading": { "type": "string", "description": "A brief, descriptive title for the summary." },
        "sections": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "subheading": { "type": "string", "description": "A concise subheading for this section." },
                    "content": { "type": "string", "description": "The detailed, neutral summary content for this section." }
                },
                "required": ["subheading", "content"]
            }
        }
    },
    "required": ["heading", "sections"],
    "additionalProperties": false
  };

  try {
    const myModel = await LanguageModel.create({
      expectedOutputs: [{ type: "text", languages: ["en"] }]
    });

    const myPrompt = `Provide a main title (heading) and a detailed summary of the following text, broken down into 2-4 key sections with descriptive subheadings. The entire output must be a valid JSON object matching the requested schema. The text to summarize is:\n\n${myText}`;

    const mySummaryJsonString = await myModel.prompt(myPrompt, {
      responseConstraint: mySummarySchema
    });
    return mySummaryJsonString;
  } catch (myError) {
    console.error('Error using LanguageModel API for summary:', myError);
    return `Error: ${myError.message}. Failed to generate summary.`;
  }
}

/** Main function to orchestrate content extraction and summarization. */
async function mySummarizePage(myExtractionFunc) {
  mySummarizedContentArea.value = '';
  mySummarizeStatusMessage.textContent = '';
  myStartTimer(mySummarizeStatusMessage);

  const [myTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!myTab || myTab.url.startsWith('chrome://')) {
    myStopTimer('Error: Cannot access content on this type of page.', mySummarizeStatusMessage);
    return;
  }

  try {
    const myResults = await chrome.scripting.executeScript({
      target: { tabId: myTab.id },
      func: myExtractionFunc
    });

    const myExtractedText = myResults[0].result;

    if (myExtractedText && myExtractedText.trim().length > 0) {
      myStopTimer('Text extracted successfully. Generating summary...', mySummarizeStatusMessage);

      const mySummaryJsonString = await mySummarizeWithPrompt(myExtractedText);
      myStopTimer('Summary complete.', mySummarizeStatusMessage);

      try {
        const mySummaryObject = JSON.parse(mySummaryJsonString);
        let myFormattedOutput = (mySummaryObject.heading || 'Summary Title').toUpperCase() + '\n' + '='.repeat(40) + '\n\n';
        
        if (mySummaryObject.sections && Array.isArray(mySummaryObject.sections)) {
          mySummaryObject.sections.forEach(mySection => {
            myFormattedOutput += `--- ${mySection.subheading.toUpperCase()} ---\n`;
            myFormattedOutput += `${mySection.content}\n\n`;
          });
        }
        mySummarizedContentArea.value = myFormattedOutput.trim();

      } catch (myParseError) {
        mySummarizedContentArea.value = `ERROR: Failed to parse structured output. Raw model output:\n\n${mySummaryJsonString}`;
        myStopTimer(`Summary complete, but parsing failed.`, mySummarizeStatusMessage);
      }

    } else {
      myStopTimer(myExtractionFunc === myGetPageText ? 'Could not retrieve any text.' : 'No text was selected.', mySummarizeStatusMessage);
    }
  } catch (myError) {
    myStopTimer(`Scripting Error: Could not execute script.`, mySummarizeStatusMessage);
    console.error('Scripting Error:', myError);
  }
}


// =========================================================================
// --- SRS TESTING & SCHEDULING LOGIC ---
// =========================================================================

/** Populates the dropdown menu with due items */
function myPopulateSelectBox() {
  const myAllItems = myItemsDataSet.get();
  myQuestionSelectBox.innerHTML = '';
  const myNow = new Date();

  const myDueItems = myAllItems.filter(myItem => new Date(myItem.start) <= myNow);

  const myDefaultOption = document.createElement('option');
  myDefaultOption.textContent = myDueItems.length > 0 ? 'Select a DUE Question to Test' : 'No items due yet!';
  myDefaultOption.value = '';
  myQuestionSelectBox.appendChild(myDefaultOption);

  myDueItems.forEach(myItem => {
    const myOption = document.createElement('option');
    myOption.value = myItem.id;
    myOption.textContent = `#${myItem.id} - ${myItem.content}`;
    myQuestionSelectBox.appendChild(myOption);
  });

  // Load the first due question automatically
  if (myDueItems.length > 0) {
    myQuestionSelectBox.value = myDueItems[0].id;
    myLoadQuestion(myDueItems[0].id);
  } else {
    myLoadQuestion(null);
  }
}

/** Loads the hint and hidden answer into the test area */
function myLoadQuestion(myId) {
  const myHintInput = document.getElementById('myHintInput');
  const myStoredStatement = document.getElementById('myStoredStatement');
  const myUserTestInput = document.getElementById('myUserTestInput');
  const myPresentNumber = document.getElementById('myPresentNumber');

  if (!myId) {
    myHintInput.value = '';
    myStoredStatement.value = '';
    myUserTestInput.value = '';
    myPresentNumber.value = '';
    return;
  }

  const myItem = myItemsDataSet.get(parseInt(myId));

  if (myItem) {
    myStoredStatement.value = myItem.longDescription || '';
    myHintInput.value = myItem.content || '';
    myUserTestInput.value = '';
    myPresentNumber.value = myId;
  }
}

/** Adapts the memory item's next review date and the global ease factor. */
function myUpdateMemory(myQuestionId, myLastScheduledReviewTimeIso, myIsCorrect) {
  const myItemToUpdate = myItemsDataSet.get(parseInt(myQuestionId));
  if (!myItemToUpdate) return;

  const myNow = Date.now();
  const myLastScheduledReviewTime = myIsoToMillis(myLastScheduledReviewTimeIso);
  const myActualDuration = myNow - myLastScheduledReviewTime;
  const isMinimumOneDayChecked = myMinimumOneDayCheckbox.checked;

  let myDuration;
  let myAdjustmentMessage = '';
  const myFactorAdjustment = 0.1;

  if (myIsCorrect) {
    myItemToUpdate.myCorrectCount++;
    
    // Determine base duration for next interval calculation
    if (isMinimumOneDayChecked) {
      myDuration = Math.max(myActualDuration, ONE_DAY_MS);
    } else {
      myDuration = Math.max(myActualDuration, MIN_TEST_INTERVAL_MS);
    }
    
    // Calculate new interval
    const myNewInterval = myDuration * myEaseFactor.value;
    const myNextDateTime = myNow + myNewInterval;

    // Adjust Ease Factor (EF)
    const myEFDelta = (myActualDuration > ONE_DAY_MS * 2) ? myFactorAdjustment : (myFactorAdjustment / 2);
    myEaseFactor.value = Math.min(myEaseFactor.value + myEFDelta, myFactorMax);
    myAdjustmentMessage = `EF $\uparrow$ by ${myEFDelta.toFixed(2)}.`;

    myItemToUpdate.start = myMillisToIso(myNextDateTime);
    myStatus.textContent = `Item #${myQuestionId} Correctly recalled! ${myAdjustmentMessage} Next: ${new Date(myNextDateTime).toLocaleString()}.`;
  } else {
    // Failure Logic
    const myNewInterval = 60000; // Reset interval to 1 minute
    const myNextDateTime = myNow + myNewInterval;
    myItemToUpdate.myCorrectCount = 0;

    // Adjust Ease Factor (EF)
    const myEFDelta = (myActualDuration < ONE_DAY_MS * 3) ? (myFactorAdjustment * 2) : myFactorAdjustment;
    myEaseFactor.value = Math.max(myEaseFactor.value - myEFDelta, myFactorMin);
    myAdjustmentMessage = `EF $\downarrow$ by ${myEFDelta.toFixed(2)}.`;

    myItemToUpdate.start = myMillisToIso(myNextDateTime);
    myStatus.textContent = `Item #${myQuestionId} Failed. Schedule reset. ${myAdjustmentMessage} Next: ${new Date(myNextDateTime).toLocaleString()}.`;
  }

  myItemsDataSet.update(myItemToUpdate);
  mySaveToLocalStorage();
}

/** Uses the AI to compare the user's answer to the stored answer. */
async function myCheckSimilarity() {
  const myStoredStatement = document.getElementById('myStoredStatement');
  const myUserTestInput = document.getElementById('myUserTestInput');
  const myPresentNumberInput = document.getElementById('myPresentNumber');

  const myQuestionId = myPresentNumberInput.value;
  if (!myQuestionId) {
    myStopTimer('Please select an item to test first.');
    return;
  }

  const myStoredValue = myStoredStatement.value.trim();
  const myUserValue = myUserTestInput.value.trim();

  if (!myStoredValue || !myUserValue || !('LanguageModel' in window)) {
    myStopTimer(myStoredValue && myUserValue ? "Error: LanguageModel API not available." : 'Please fill in Your Recall/Answer.');
    return;
  }
  
  myCheckButton.disabled = true;
  myCheckButton.style.backgroundColor = '#ccc';
  myOutput.value = "";

  try {
    myStartTimer(myStatus);

    if (!myLanguageModelSession) {
      const mySessionOptions = {
        systemInstruction: 'You are an AI assistant designed to act as a similarity judge for spaced repetition memory tests. Your sole function is to compare two statements and determine if they express the same general idea. You must only reply with the word "same" or "different".',
        outputLanguage: 'en'
      };
      myLanguageModelSession = await LanguageModel.create(mySessionOptions);
    }

    const myPrompt = `Compare the meaning of the following two statements and determine if they express the same general idea. Ignore differences in letter casing. Only respond with one word: "same" or "different".\nStatement 1: ${myStoredValue}\nStatement 2: ${myUserValue}`;
    const myResponse = await myLanguageModelSession.prompt(myPrompt);
    
    const myResult = myResponse.trim().toLowerCase();
    const myIsSame = myResult === 'same';
    
    myOutput.value = myIsSame ? '✅ Same (Correct)' : '❌ Different (Incorrect)';
    myStopTimer(`Comparison complete! Result: ${myIsSame ? 'Correct' : 'Incorrect'}`);
    
    myUpdateMemory(myQuestionId, myItemsDataSet.get(parseInt(myQuestionId)).start, myIsSame);

  } catch (myError) {
    myStopTimer("An error occurred. Check the console for details.");
    console.error("Similarity Check Error:", myError);
  } finally {
    myCheckButton.disabled = false;
    myCheckButton.style.backgroundColor = '#4CAF50';
    myPopulateSelectBox();
  }
}

/** Uses the AI to generate a concise description for the current hint. */
async function myGenerateLongDescription() {
  const myContent = myEntryContentInput.value.trim();
  const myGenerateButton = document.querySelector('button[onclick="myGenerateLongDescription()"]');

  if (!myContent) {
    myStopTimer('Please enter a concept or term in the "Hint" field first.', myGenerationStatus);
    return;
  }
  if (!('LanguageModel' in window)) {
    myStopTimer("Error: LanguageModel API not available.", myGenerationStatus);
    return;
  }

  myGenerateButton.disabled = true;
  myGenerateButton.textContent = 'Generating...';
  myGenerateButton.style.backgroundColor = '#ccc';
  myEntryLongDescriptionInput.value = 'Generating...';

  try {
    myStartTimer(myGenerationStatus);
    
    // Create session using the user-defined prompt
    const mySessionOptions = {
        systemInstruction: myGenerationPromptInput.value,
        outputLanguage: 'en'
    };
    const myLanguageModelSessionForGeneration = await LanguageModel.create(mySessionOptions);

    const myPrompt = `HINT: ${myContent}`;
    const myResponse = await myLanguageModelSessionForGeneration.prompt(myPrompt);
    
    const myGeneratedDescription = myResponse.trim();
    
    myEntryLongDescriptionInput.value = myGeneratedDescription;
    myOutput.value = `Generated Answer for "${myContent}":\n\n---\n${myGeneratedDescription}\n---`;

    myStopTimer(`Content generated for "${myContent}". Review and click 'Add / Update' to save.`, myGenerationStatus);

  } catch (myError) {
    myStopTimer("Content generation failed.", myGenerationStatus);
    console.error("Content Generation Error:", myError);
    myEntryLongDescriptionInput.value = "Failed to generate content.";
  } finally {
    myGenerateButton.disabled = false;
    myGenerateButton.textContent = 'Generate Answer (LLM)';
    myGenerateButton.style.backgroundColor = '#007bff';
  }
}

// Ensure initialization happens when the window loads
// window.onload = myInitializeApp; // Inline call in <body> tag is cleaner: onload="myInitializeApp()"