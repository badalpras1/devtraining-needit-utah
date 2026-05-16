chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ leads: [] });
});

// Merge new leads into storage, deduplicating by profileUrl
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'saveLeads') {
    chrome.storage.local.get({ leads: [] }, (data) => {
      const existing = data.leads;
      const existingUrls = new Set(existing.map((l) => l.profileUrl));
      const fresh = (msg.leads || []).filter((l) => !existingUrls.has(l.profileUrl));
      const merged = [...existing, ...fresh];
      chrome.storage.local.set({ leads: merged }, () => {
        sendResponse({ saved: fresh.length, total: merged.length });
      });
    });
    return true;
  }

  if (msg.action === 'clearLeads') {
    chrome.storage.local.set({ leads: [] }, () => sendResponse({ ok: true }));
    return true;
  }

  if (msg.action === 'getLeads') {
    chrome.storage.local.get({ leads: [] }, (data) => sendResponse(data));
    return true;
  }
});
