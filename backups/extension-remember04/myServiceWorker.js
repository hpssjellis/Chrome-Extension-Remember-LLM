// Set the side panel to be available on all tabs by default
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((myError) => console.error('Error setting side panel behavior:', myError));

// Keeping the runtime message listener for future flexibility,
// but the current implementation moves extraction/summarization to the sidepanel.js
// so this file is minimal.