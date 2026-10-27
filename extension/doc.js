/* 页面预览器：从 storage 取出 HTML，交给沙箱页真实渲染（脚本可执行） */
const $ = id => document.getElementById(id);
const qid = new URLSearchParams(location.search).get('id');
let html = '', title = '页面';

(async function () {
  let rec = null;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    const { resultDocs = {} } = await chrome.storage.local.get(['resultDocs']);
    rec = resultDocs[qid];
    if (!rec) {
      // 「我的页面」库里保存的网页
      const { pages = [] } = await chrome.storage.local.get(['pages']);
      const entry = pages.find(p => p.type === 'static' && (!qid || p.id === qid));
      if (entry) rec = { html: entry.html, title: entry.name, date: entry.date };
    }
  }
  if (!rec) {
    try { rec = JSON.parse(localStorage.getItem('result_doc_' + qid) || 'null'); } catch (e) {}
  }
  if (!rec) {
    document.body.innerHTML = '<div class="empty">没有找到页面内容。<br>请回到 Skill 工坊重新执行，再点「单独打开为 HTML 页面」。</div>';
    if (window.I18N) I18N.apply(document.body);
    return;
  }
  html = rec.html || '';
  title = rec.title || '页面';
  document.title = title;
  $('t').textContent = title;
  $('m').textContent = new Date(rec.date || Date.now()).toLocaleString('zh-CN') + ' · ' + html.length + ' 字符';

  $('dl').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    a.download = title + '.html'; a.click();
  };
  $('raw').onclick = () => {
    const w = window.open('', '_blank');
    if (!w) return;
    const pre = w.document.createElement('pre');
    pre.style.cssText = 'white-space:pre-wrap;padding:20px;font:12.5px ui-monospace,monospace;line-height:1.5';
    pre.textContent = html;
    w.document.title = title + ' · 源码';
    w.document.body.appendChild(pre);
  };

  if (window.I18N) I18N.apply(document.body);
  $('frame').src = 'sandbox.html';
  window.addEventListener('message', e => {
    if (e.data && e.data.type === 'skill-sandbox-ready' && html) {
      $('frame').contentWindow.postMessage({ type: 'skill-html', html: html }, '*');
    }
  });
})();
