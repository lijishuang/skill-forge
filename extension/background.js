// Skill 工坊 - 后台：右键菜单 + 打开工作台
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'sf-save',
    title: '📥 存入 Skill 工坊（保存选中内容为 Skill）',
    contexts: ['selection']
  });
  chrome.contextMenus.create({
    id: 'sf-exec',
    title: '▶ 用 Skill 工坊执行选中内容',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const text = (info.selectionText || '').slice(0, 120000);
  if (!text) return;
  if (info.menuItemId === 'sf-save') {
    await chrome.storage.local.set({
      pendingSave: { text, url: info.pageUrl || '', date: Date.now() }
    });
    openApp('?pending=save');
  } else if (info.menuItemId === 'sf-exec') {
    await chrome.storage.local.set({
      pendingExec: { text, url: info.pageUrl || '', date: Date.now() }
    });
    openApp('?pending=exec');
  }
});

function openApp(query) {
  chrome.tabs.create({ url: chrome.runtime.getURL('app.html' + (query || '')) });
}
