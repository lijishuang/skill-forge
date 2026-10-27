/* Skill 工坊 · 独立工具页运行时
   同一份代码用于：扩展内的 tool.html（payload 从 chrome.storage 读）、
   以及导出的单文件 HTML（payload 由 window.SKILL_PAYLOAD 内联注入）。 */

const isExt = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

const $ = id => document.getElementById(id);
const I18N = window.I18N || { tr: s => s, apply: () => {}, getLang: () => 'zh' };
const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toast = msg => {
  const t = $('toast'); t.textContent = I18N.tr(msg); t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2400);
};
const retr = () => { try { I18N.apply(document.body); } catch (e) {} };

/* ===== 结果渲染工具（与工坊同款） ===== */
function wrapHtmlFragment(frag) {
  return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">\n</head>\n<body>\n' +
    frag + '\n</body>\n</html>';
}

function extractHtml(text) {
  if (!text || typeof text !== 'string') return null;
  const fences = [...text.matchAll(/```(?:html|htm)?\s*\n([\s\S]*?)```/gi)].map(m => m[1]);
  let cand = fences.find(f => /<html[\s>]|<!DOCTYPE\s+html|<body[\s>]|<div[\s>]|<section[\s>]|<svg[\s>]/i.test(f)) || null;
  if (!cand) {
    const i = text.search(/<!DOCTYPE\s+html|<html[\s>]/i);
    if (i >= 0) cand = text.slice(i).replace(/```[\s\S]*$/, '');
    else {
      const hits = text.match(/<(div|section|main|header|footer|style|table|svg|h1|h2|button|canvas|body)\b/gi) || [];
      const strong = /<style[\s>]|<svg[\s>]|<canvas[\s>]|<script[\s>]|<table[\s>]/i.test(text);
      if (hits.length >= 3 && (text.length > 120 || strong)) cand = text;
    }
  }
  if (!cand) return null;
  cand = cand.trim().replace(/^```[a-z]*\s*/i, '').replace(/```$/, '').trim();
  if (!/<html[\s>]|<!DOCTYPE\s+html/i.test(cand)) cand = wrapHtmlFragment(cand);
  return cand;
}

function renderMarkdown(src) {
  const lines = escapeHtml(src).split('\n');
  let html = '', inUl = false, inOl = false, inCode = false, codeBuf = [], tableBuf = [];
  const inline = t => t
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*\n]+)\*/g, '<i>$1</i>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const flushList = () => { if (inUl) { html += '</ul>'; inUl = false; } if (inOl) { html += '</ol>'; inOl = false; } };
  const flushTable = () => {
    if (!tableBuf.length) return;
    const rows = tableBuf.map(r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
    const body = rows.slice(rows[1] && /^:?-+:?$/.test(rows[1][0] || '') ? 2 : 1);
    html += '<table><thead><tr>' + rows[0].map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' +
      body.map(r => '<tr>' + r.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
    tableBuf = [];
  };
  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      if (inCode) { html += '<pre><code>' + codeBuf.join('\n') + '</code></pre>'; codeBuf = []; inCode = false; }
      else { flushList(); flushTable(); inCode = true; }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }
    if (/^\s*\|/.test(line)) { flushList(); tableBuf.push(line.trim()); continue; }
    flushTable();
    if (/^#{1,6}\s/.test(line)) {
      flushList();
      const l = Math.min(line.match(/^#+/)[0].length + 2, 6);
      html += '<h' + l + '>' + inline(line.replace(/^#+\s*/, '')) + '</h' + l + '>';
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      if (inOl) { html += '</ol>'; inOl = false; }
      if (!inUl) { html += '<ul>'; inUl = true; }
      html += '<li>' + inline(line.replace(/^\s*[-*]\s+/, '')) + '</li>'; continue;
    }
    if (/^\s*\d+[.、)]\s+/.test(line)) {
      if (inUl) { html += '</ul>'; inUl = false; }
      if (!inOl) { html += '<ol>'; inOl = true; }
      html += '<li>' + inline(line.replace(/^\s*\d+[.、)]\s+/, '')) + '</li>'; continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushList(); html += '<hr>'; continue; }
    if (!line.trim()) { flushList(); continue; }
    flushList(); html += '<p>' + inline(line) + '</p>';
  }
  flushList(); flushTable();
  if (inCode) html += '<pre><code>' + codeBuf.join('\n') + '</code></pre>';
  return html;
}

/* ===== 读取 payload ===== */
async function loadPayload() {
  if (window.SKILL_PAYLOAD) return window.SKILL_PAYLOAD;
  const id = new URLSearchParams(location.search).get('id');
  if (isExt) {
    const { toolPages = {} } = await chrome.storage.local.get(['toolPages']);
    const p = id ? toolPages[id] : Object.values(toolPages).pop();
    if (p) return p;
    // 「我的页面」库里保存的工具页（payload 不含 Key，配置走 toolCfg / 手填）
    const got = await chrome.storage.local.get(['pages']);
    const entry = (got.pages || []).find(x => x.type === 'tool' && (!id || x.id === id));
    if (entry && entry.payload) return entry.payload;
  }
  try {
    const raw = localStorage.getItem('skill_tool_payload');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}

/* ===== 主流程 ===== */
(async function main() {
  const D = await loadPayload();
  if (!D) {
    document.body.innerHTML = '<div class="empty" style="margin:80px auto;max-width:520px">' +
      '没有找到要展示的界面数据。<br>请回到 Skill 工坊，重新点「🌐 新标签页打开此界面」。</div>';
    return;
  }

  let running = false, lastResult = '', resultHtml = null;

  document.title = D.name + ' · Skill 工具';
  $('hdTitle').textContent = D.name;
  $('hdDesc').textContent = D.description || I18N.tr('由 Skill 工坊生成的独立工具页面');
  $('fldTag').textContent = I18N.tr(D.fields.length + ' 个字段');
  if (isExt && history.length > 1) $('btnBack').classList.remove('hide');
  $('btnBack').onclick = () => { if (history.length > 1) history.back(); };

  /* 表单 */
  D.fields.forEach(f => {
    const d = document.createElement('div'); d.className = 'field';
    d.innerHTML = '<div class="fl">' + escapeHtml(f.label) + '<span class="fk">' + escapeHtml(f.key) + '</span></div>' +
      (f.hint ? '<div class="hint">' + escapeHtml(f.hint) + '</div>' : '');
    let ctrl;
    if (f.type === 'select') {
      ctrl = document.createElement('select');
      (f.options && f.options.length ? f.options : ['默认']).forEach(o => {
        const op = document.createElement('option'); op.value = op.textContent = o; ctrl.appendChild(op);
      });
    } else if (f.type === 'textarea') {
      ctrl = document.createElement('textarea');
    } else if (f.type === 'checkbox') {
      ctrl = document.createElement('input'); ctrl.type = 'checkbox'; ctrl.style.width = 'auto';
      const lab = document.createElement('label'); lab.className = 'ck';
      lab.appendChild(ctrl); lab.appendChild(document.createTextNode('启用'));
      ctrl.dataset.key = f.key; d.appendChild(lab); $('form').appendChild(d); return;
    } else {
      ctrl = document.createElement('input');
      ctrl.type = { number: 'number', date: 'date', email: 'email', url: 'url' }[f.type] || 'text';
    }
    ctrl.dataset.key = f.key;
    d.appendChild(ctrl);
    $('form').appendChild(d);
  });

  retr();

  /* 配置：优先读插件存储，其次 localStorage */
  const CK = 'skill_tool_cfg';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(CK) || '{}') || {}; } catch (e) {}
  if (isExt) {
    const { toolCfg = {} } = await chrome.storage.local.get(['toolCfg']);
    saved = Object.assign({}, saved, toolCfg);
  }
  $('cBase').value = saved.base || D.cfg.base || '';
  $('cKey').value = saved.key || D.cfg.key || '';
  $('cModel').value = saved.model || D.cfg.model || '';
  const persist = () => {
    try { localStorage.setItem(CK, JSON.stringify(saved)); } catch (e) {}
    if (isExt) chrome.storage.local.set({ toolCfg: saved });
  };
  [['cBase', 'base'], ['cKey', 'key'], ['cModel', 'model']].forEach(p => {
    $(p[0]).addEventListener('change', () => { saved[p[1]] = $(p[0]).value.trim(); persist(); });
  });

  $('btnClear').onclick = () => {
    document.querySelectorAll('#form [data-key]').forEach(el => {
      if (el.type === 'checkbox') el.checked = false; else el.value = '';
    });
  };

  function setSeg(pv) {
    $('segPv').classList.toggle('on', pv); $('segCd').classList.toggle('on', !pv);
    $('pvWrap').classList.toggle('hide', !pv); $('out').classList.toggle('hide', pv);
  }
  $('segPv').onclick = () => setSeg(true);
  $('segCd').onclick = () => setSeg(false);

  function download(content, type, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: type }));
    a.download = name; a.click();
  }

  async function run() {
    if (running) return;
    const base = $('cBase').value.trim(), key = $('cKey').value.trim(), model = $('cModel').value.trim();
    if (!base || !key || !model) { toast('请先填写模型配置（地址 / Key / 模型）'); return; }
    const values = {};
    for (const f of D.fields) {
      const el = document.querySelector('#form [data-key="' + f.key + '"]');
      if (f.type === 'checkbox') { values[f.key] = el && el.checked ? '是' : '否'; continue; }
      const v = el ? el.value.trim() : '';
      if (!v) { toast('请填写「' + f.label + '」'); if (el) el.focus(); return; }
      values[f.key] = v;
    }
    let refText = '';
    (D.refs || []).forEach(r => { refText += '\n\n### 参考文件：' + r.name + '\n' + String(r.content).slice(0, 8000); });
    const sys = '你是一个执行「Skill」的助手。\n# Skill 名称\n' + D.name +
      (D.description ? '\n# 描述\n' + D.description + '\n' : '') + '# 完整指令\n' + D.body + refText;
    const user = '请根据上述 Skill 指令处理以下输入：\n' +
      Object.keys(values).map(k => '【' + k + '】\n' + values[k]).join('\n\n') +
      '\n\n直接输出 Skill 要求的最终结果，不要解释执行过程。';

    running = true; $('btnRun').disabled = true;
    $('out').setAttribute('data-noi18n', '1');
    $('stat').textContent = I18N.tr('正在调用模型…');
    $('out').classList.remove('md'); $('out').textContent = '';
    $('seg').classList.add('hide'); $('pvWrap').classList.add('hide'); $('out').classList.remove('hide');
    try {
      const res = await fetch(base.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
          stream: true, temperature: 0.7
        })
      });
      if (!res.ok) {
        let d = ''; try { d = (await res.json()).error.message || ''; } catch (e) {}
        throw new Error('HTTP ' + res.status + ' ' + d);
      }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '', out = '';
      while (true) {
        const r = await reader.read(); if (r.done) break;
        buf += dec.decode(r.value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) {
          const s = line.trim(); if (s.indexOf('data:') !== 0) continue;
          const pl = s.slice(5).trim(); if (pl === '[DONE]') continue;
          try {
            const o = JSON.parse(pl);
            const dl = o.choices && o.choices[0] && o.choices[0].delta && o.choices[0].delta.content;
            if (dl) { out += dl; $('out').textContent = out; $('stat').textContent = I18N.tr('正在输出… ' + out.length + ' 字符'); }
          } catch (e) {}
        }
      }
      lastResult = out;
      $('stat').textContent = I18N.tr('完成（' + out.length + ' 字符）');
      finish();
    } catch (e) {
      $('stat').textContent = I18N.tr('执行失败');
      $('out').textContent = '❌ ' + e.message + I18N.tr('\n\n常见原因：接口地址需以 /v1 结尾；Key 无效或额度不足；浏览器跨域限制。');
    }
    running = false; $('btnRun').disabled = false;
  }

  function finish() {
    resultHtml = extractHtml(lastResult);
    if (resultHtml) {
      $('pv').srcdoc = resultHtml;
      $('seg').classList.remove('hide');
      $('out').classList.add('hide'); $('pvWrap').classList.remove('hide'); setSeg(true);
      $('btnOpenHtml').classList.remove('hide'); $('btnDlHtml').classList.remove('hide');
    } else {
      $('seg').classList.add('hide'); $('pvWrap').classList.add('hide');
      $('out').classList.remove('hide'); $('out').classList.add('md');
      $('out').innerHTML = renderMarkdown(lastResult);
      $('btnOpenHtml').classList.add('hide'); $('btnDlHtml').classList.add('hide');
    }
    retr();
  }

  $('btnRun').onclick = run;
  $('btnCopy').onclick = () => { navigator.clipboard.writeText(lastResult); toast('已复制'); };
  $('btnDl').onclick = () => download(lastResult, 'text/markdown', D.name + '-结果.md');
  $('btnOpenHtml').onclick = async () => {
    if (!resultHtml) return;
    if (isExt) {
      // 扩展内：交给 doc.html + 沙箱页渲染，保证页面里的脚本能执行
      const { resultDocs = {} } = await chrome.storage.local.get(['resultDocs']);
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      resultDocs[id] = { html: resultHtml, title: D.name + '-页面', date: Date.now() };
      const keys = Object.keys(resultDocs);
      if (keys.length > 30) keys.slice(0, keys.length - 30).forEach(k => delete resultDocs[k]);
      await chrome.storage.local.set({ resultDocs });
      chrome.tabs.create({ url: chrome.runtime.getURL('doc.html?id=' + id) });
      return;
    }
    window.open(URL.createObjectURL(new Blob([resultHtml], { type: 'text/html' })), '_blank');
  };
  $('btnDlHtml').onclick = () => {
    if (!resultHtml) return;
    download(resultHtml, 'text/html', D.name + '-页面.html');
  };
})();
