// PageFlow AI - Service Worker (Manifest V3)
// Provides the "Send selected text to PageFlow AI" context-menu item.
// The selected text is saved to storage and automatically loaded into
// the SmartFormMapper text field the next time the popup is opened.

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'pfa-send-selection',
    title: 'Send selected text to PageFlow AI',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'pfa-send-selection' && info.selectionText) {
    chrome.storage.local.set({ pfaPendingText: info.selectionText });
    chrome.action.setBadgeText({ text: '1' });
    chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
  }
});

// Clear the badge once the popup has picked up the pending text
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'PFA_CLEAR_BADGE') {
    chrome.action.setBadgeText({ text: '' });
  }
});
