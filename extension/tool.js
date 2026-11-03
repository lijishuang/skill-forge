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

/* ===== folder 字段：本地待检目录（选择目录、打开/勾选本地文件，随执行提交） ===== */
const FOLDER_TEXT_EXT = ('md,txt,json,csv,tsv,log,js,ts,jsx,tsx,py,java,c,h,cpp,hpp,cs,go,rs,rb,php,sh,bat,ps1,html,htm,css,scss,less,xml,yml,yaml,ini,cfg,conf,toml,sql,swift,kt,scala,r,m,mm,vue,svelte,proto,graphql,gql,properties,env,plist').split(',');
function folderIsText(name) {
  const base = String(name).split('/').pop();
  if (/^(dockerfile|makefile|gitignore|license|readme|gemfile|procfile)$/i.test(base)) return true;
  const parts = base.split('.');
  if (parts.length < 2) return false;
  return FOLDER_TEXT_EXT.includes(parts.pop().toLowerCase());
}
function folderFmtSize(n) {
  return n < 1024 ? n + 'B' : n < 1048576 ? (n / 1024).toFixed(1) + 'K' : (n / 1048576).toFixed(1) + 'M';
}
async function folderWalk(dir, out, depth, prefix) {
  if (depth > 3 || out.length >= 200) return;
  for await (const [name, h] of dir.entries()) {
    if (out.length >= 200) break;
    if (name.startsWith('.')) continue;
    const p = (prefix ? prefix + '/' : '') + name;
    if (h.kind === 'file') {
      try { const file = await h.getFile(); out.push({ file, path: p, name, size: file.size }); } catch (e) {}
    } else if (h.kind === 'directory') await folderWalk(h, out, depth + 1, p);
  }
}
function folderPickFallback(onLoaded) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.webkitdirectory = true; inp.multiple = true;
  inp.onchange = () => {
    const files = [...inp.files].map(f => ({ file: f, path: f.webkitRelativePath || f.name, name: f.name, size: f.size }));
    const root = (files[0] && files[0].path.includes('/')) ? files[0].path.split('/')[0] : '';
    onLoaded(files, root);
  };
  inp.click();
}
function folderPick(onLoaded) {
  if (window.showDirectoryPicker) {
    window.showDirectoryPicker({ mode: 'read' }).then(async dir => {
      const files = [];
      await folderWalk(dir, files, 0, '');
      onLoaded(files, dir.name);
    }).catch(e => { if (e && e.name !== 'AbortError') folderPickFallback(onLoaded); });
  } else folderPickFallback(onLoaded);
}
function folderOpenFile(it, ctx) {
  const show = text => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--panel,#fff);border-radius:12px;max-width:760px;width:100%;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.25)';
    const head = document.createElement('div');
    head.style.cssText = 'padding:10px 16px;border-bottom:1px solid var(--border,#e5e7eb);display:flex;align-items:center;gap:10px;flex-shrink:0';
    const tt = document.createElement('b'); tt.style.cssText = 'font-size:13px;flex:1;word-break:break-all'; tt.textContent = it.path;
    const x = document.createElement('button'); x.type = 'button'; x.textContent = '✕';
    x.style.cssText = 'border:none;background:none;font-size:15px;cursor:pointer;color:inherit';
    x.onclick = () => ov.remove();
    head.appendChild(tt); head.appendChild(x);
    const pre = document.createElement('pre');
    pre.style.cssText = 'margin:0;padding:14px 16px;overflow:auto;font:12px/1.6 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word;flex:1';
    pre.textContent = text == null ? ctx.tr('（二进制文件或读取失败，无法预览）') : text;
    box.appendChild(head); box.appendChild(pre); ov.appendChild(box);
    ov.onclick = e => { if (e.target === ov) ov.remove(); };
    document.body.appendChild(ov);
  };
  if (!folderIsText(it.name)) { show(null); return; }
  it.file.text().then(s => {
    show(s.includes('\u0000') ? null : (s.length > 20000 ? s.slice(0, 20000) + '\n…' : s));
  }).catch(() => show(null));
}
function buildFolderUI(f, d, ctx) {
  const st = { files: [], included: new Set(), dirName: '' };
  d._folderState = st;
  const pickRow = document.createElement('div');
  pickRow.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px';
  const btn = document.createElement('button');
  btn.type = 'button'; btn.textContent = '📁 ' + ctx.tr('选择本地目录'); btn.style.fontWeight = '600';
  const dirName = document.createElement('span');
  dirName.style.cssText = 'font-size:12px;color:var(--text-3)';
  dirName.textContent = ctx.tr('未选择');
  pickRow.appendChild(btn); pickRow.appendChild(dirName);
  const listWrap = document.createElement('div');
  listWrap.classList.add(ctx.hideCls);
  listWrap.innerHTML = '<div class="fbar"><label class="fall"><input type="checkbox" class="fall-ck"> <span>' + ctx.tr('全选') + '</span></label><span class="fcnt"></span></div><div class="fitems"></div>';
  d.appendChild(pickRow); d.appendChild(listWrap);
  const itemsEl = listWrap.querySelector('.fitems');
  const fall = listWrap.querySelector('.fall-ck');
  const updCnt = () => {
    listWrap.querySelector('.fcnt').textContent = ctx.tr(st.included.size + ' / ' + st.files.length + ' 已选');
    fall.checked = st.files.length > 0 && st.included.size === st.files.length;
  };
  const renderItems = () => {
    itemsEl.innerHTML = '';
    st.files.forEach(it => {
      const row = document.createElement('div'); row.className = 'fitem';
      const ck = document.createElement('input'); ck.type = 'checkbox';
      ck.checked = st.included.has(it.path);
      ck.onchange = () => { if (ck.checked) st.included.add(it.path); else st.included.delete(it.path); updCnt(); };
      const nm = document.createElement('span'); nm.className = 'fname'; nm.textContent = it.path;
      nm.title = ctx.tr('点击打开文件');
      nm.onclick = () => folderOpenFile(it, ctx);
      const sz = document.createElement('span'); sz.className = 'fsize'; sz.textContent = folderFmtSize(it.size);
      if (!folderIsText(it.name)) { sz.textContent += ' ⛔'; sz.title = ctx.tr('二进制文件，不参与执行'); }
      row.appendChild(ck); row.appendChild(nm); row.appendChild(sz);
      itemsEl.appendChild(row);
    });
    updCnt();
  };
  st.rerender = renderItems;   // 供测试/外部刷新
  fall.onchange = () => {
    st.included = new Set(fall.checked ? st.files.map(x => x.path) : []);
    renderItems();
  };
  btn.onclick = () => folderPick((files, dirN) => {
    st.files = files; st.dirName = dirN || '';
    st.included = new Set(files.filter(x => folderIsText(x.name)).slice(0, 30).map(x => x.path));
    dirName.textContent = (st.dirName || ctx.tr('已选目录')) + ' · ' + ctx.tr(files.length + ' 个文件');
    listWrap.classList.remove(ctx.hideCls);
    renderItems();
    ctx.toast(ctx.tr('已加载待检目录（' + files.length + ' 个文件），勾选后随执行一并提交'));
  });
}
async function folderCollectText(fields, getBox) {
  let text = '', used = 0;
  for (const f of fields) {
    if (f.type !== 'folder' || f._hidden) continue;
    const box = getBox(f);
    const st = box && box._folderState;
    if (!st) continue;
    for (const it of st.files) {
      if (used >= 60000) break;
      if (!st.included.has(it.path) || !folderIsText(it.name)) continue;
      try {
        const s = await it.file.text();
        if (s.includes('\u0000')) continue;
        const body = s.slice(0, 12000);
        text += '\n\n### 本地文件：' + it.path + '\n' + body;
        used += body.length;
      } catch (e) {}
    }
  }
  return text;
}
window.__folderTest = { folderIsText, folderFmtSize, buildFolderUI, folderPick, folderOpenFile, folderCollectText };

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
    d.dataset.fkey = f.key;
    const lkTag = f.showIf ? '<span class="lktag" title="' + I18N.tr('此字段按参数联动显示') + '">🔗</span>' : '';
    d.innerHTML = '<div class="fl">' + escapeHtml(f.label) + lkTag + '<span class="fk">' + escapeHtml(f.key) + '</span></div>' +
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
      lab.appendChild(ctrl); lab.appendChild(document.createTextNode(I18N.tr('启用')));
      ctrl.dataset.key = f.key; d.appendChild(lab); $('form').appendChild(d); return;
    } else if (f.type === 'folder') {
      buildFolderUI(f, d, { tr: s => I18N.tr(s), toast, hideCls: 'hide' });
      $('form').appendChild(d); return;
    } else {
      ctrl = document.createElement('input');
      ctrl.type = { number: 'number', date: 'date', email: 'email', url: 'url' }[f.type] || 'text';
    }
    ctrl.dataset.key = f.key;
    d.appendChild(ctrl);
    $('form').appendChild(d);
  });

  /* 参数联动：根据父字段取值显示/隐藏字段，隐藏字段不参与校验与执行 */
  function fieldValue(f) {
    const el = document.querySelector('#form [data-key="' + f.key + '"]');
    if (!el) return '';
    if (f.type === 'checkbox') return el.checked ? '是' : '否';
    return (el.value || '').trim();
  }
  function applyLinkage() {
    D.fields.forEach(f => {
      f._hidden = false;
      if (f.showIf && f.showIf.key) {
        const p = D.fields.find(x => x.key === f.showIf.key);
        if (p) {
          const v = fieldValue(p);
          const vals = (f.showIf.values || []).map(s => String(s).trim());
          f._hidden = !vals.includes(v);
        }
      }
      const d = document.querySelector('#form .field[data-fkey="' + f.key + '"]');
      if (d) d.classList.toggle('hide', !!f._hidden);
    });
  }
  $('form').addEventListener('change', applyLinkage);
  applyLinkage();

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
    applyLinkage();
  };

  function setBrowser(hasHtml) {
    $('pv').classList.toggle('hide', !hasHtml);
    $('bEmpty').classList.toggle('hide', !!hasHtml);
    $('bBtns').classList.toggle('hide', !hasHtml);
    $('bTag').textContent = I18N.tr(hasHtml ? '已渲染 HTML' : '不涉及');
  }
  setBrowser(false);

  function download(content, type, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: type }));
    a.download = name; a.click();
  }

  async function run() {
    if (running) return;
    const base = $('cBase').value.trim(), key = $('cKey').value.trim(), model = $('cModel').value.trim();
    if (!base || !key || !model) { toast('请先填写模型配置（地址 / Key / 模型）'); return; }
    applyLinkage();
    const values = {};
    let visibleCount = 0;
    for (const f of D.fields) {
      if (f._hidden) continue;   // 联动隐藏的字段不参与执行
      if (f.type === 'folder') {
        const box = document.querySelector('#form .field[data-fkey="' + f.key + '"]');
        const st = box && box._folderState;
        const picks = st ? st.files.filter(x => st.included.has(x.path)) : [];
        if (picks.length) {
          values[f.key] = I18N.tr('本地目录「' + (st.dirName || '') + '」，已选 ' + picks.length + ' 个文件：\n' + picks.map(x => '- ' + x.path).join('\n'));
          visibleCount++;
        }
        continue;   // 目录允许为空，不强制
      }
      const el = document.querySelector('#form [data-key="' + f.key + '"]');
      if (f.type === 'checkbox') { values[f.key] = el && el.checked ? '是' : '否'; visibleCount++; continue; }
      const v = el ? el.value.trim() : '';
      if (!v) { toast('请填写「' + f.label + '」'); if (el) el.focus(); return; }
      values[f.key] = v; visibleCount++;
    }
    if (!visibleCount) { toast('没有可见的输入字段，请检查参数联动设置'); return; }
    let refText = '';
    (D.refs || []).forEach(r => { refText += '\n\n### 参考文件：' + r.name + '\n' + String(r.content).slice(0, 8000); });
    const folderText = await folderCollectText(D.fields, f => document.querySelector('#form .field[data-fkey="' + f.key + '"]'));
    const sys = '你是一个执行「Skill」的助手。\n# Skill 名称\n' + D.name +
      (D.description ? '\n# 描述\n' + D.description + '\n' : '') + '# 完整指令\n' + D.body + refText + folderText;
    const user = '请根据上述 Skill 指令处理以下输入：\n' +
      Object.keys(values).map(k => '【' + k + '】\n' + values[k]).join('\n\n') +
      '\n\n直接输出 Skill 要求的最终结果，不要解释执行过程。';

    running = true; $('btnRun').disabled = true;
    $('out').setAttribute('data-noi18n', '1');
    $('stat').textContent = I18N.tr('正在调用模型…');
    $('out').classList.remove('md'); $('out').classList.add('term'); $('out').textContent = '';
    $('out').classList.remove('hide');
    $('btnRender').classList.add('hide');
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

  /* 结果视图：默认终端原样输出，可切换 Markdown 渲染 */
  function setView(md) {
    if (md) {
      $('out').classList.add('md'); $('out').classList.remove('term');
      $('out').innerHTML = renderMarkdown(lastResult);
      $('btnRender').classList.add('on');
    } else {
      $('out').classList.remove('md'); $('out').classList.add('term');
      $('out').textContent = lastResult;
      $('btnRender').classList.remove('on');
    }
  }
  $('btnRender').onclick = () => setView(!$('out').classList.contains('md'));

  function finish() {
    resultHtml = extractHtml(lastResult);
    if (resultHtml) {
      $('pv').srcdoc = resultHtml;          // 右栏内嵌浏览器默认渲染 HTML 结果
      setBrowser(true);
      $('btnRender').classList.add('hide');
    } else {
      setBrowser(false);
      $('btnRender').classList.remove('hide');
    }
    $('out').classList.remove('hide');
    setView(false);   // 中栏始终为终端原样输出，与终端结果完全一致
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
