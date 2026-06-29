// PageFlow AI - Service Worker (Manifest V3)
// 右クリックメニュー「選択テキストを PageFlow AI に送る」を提供する。
// 選択テキストは storage に保存され、次回ポップアップを開いたときに
// SmartFormMapper のテキスト欄へ自動でセットされる。

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'pfa-send-selection',
    title: '選択テキストを PageFlow AI に送る',
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

// ポップアップ側がテキストを取り込んだらバッジを消す
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'PFA_CLEAR_BADGE') {
    chrome.action.setBadgeText({ text: '' });
  }
});
