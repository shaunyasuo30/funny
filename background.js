chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "close-current-tab") {
    return;
  }

  const senderTabId = sender && sender.tab && typeof sender.tab.id === "number"
    ? sender.tab.id
    : null;

  if (senderTabId !== null) {
    chrome.tabs.remove(senderTabId);
    sendResponse({ ok: true, method: "sender-tab" });
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: chrome.runtime.lastError.message || "tabs.query failed" });
      return;
    }

    const activeTab = tabs && tabs[0];
    if (activeTab && typeof activeTab.id === "number") {
      chrome.tabs.remove(activeTab.id);
      sendResponse({ ok: true, method: "active-tab" });
      return;
    }

    sendResponse({ ok: false, error: "no active tab found" });
  });

  return true;
});
