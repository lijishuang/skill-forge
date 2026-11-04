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
/* 直接选择文件（可多选），不经过目录 */
function folderPickFilesFallback(onLoaded) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.multiple = true;
  inp.onchange = () => {
    const files = [...inp.files].map(f => ({ file: f, path: f.name, name: f.name, size: f.size }));
    onLoaded(files);
  };
  inp.click();
}
function folderPickFiles(onLoaded) {
  if (window.showOpenFilePicker) {
    window.showOpenFilePicker({ multiple: true }).then(async hs => {
      const files = [];
      for (const h of hs) {
        try { const file = await h.getFile(); files.push({ file, path: file.name, name: file.name, size: file.size }); } catch (e) {}
      }
      onLoaded(files);
    }).catch(e => { if (e && e.name !== 'AbortError') folderPickFilesFallback(onLoaded); });
  } else folderPickFilesFallback(onLoaded);
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
  const btnF = document.createElement('button');
  btnF.type = 'button'; btnF.textContent = '📄 ' + ctx.tr('选择文件'); btnF.style.fontWeight = '600';
  const dirName = document.createElement('span');
  dirName.style.cssText = 'font-size:12px;color:var(--text-3)';
  dirName.textContent = ctx.tr('未选择');
  pickRow.appendChild(btn); pickRow.appendChild(btnF); pickRow.appendChild(dirName);
  const listWrap = document.createElement('div');
  listWrap.classList.add(ctx.hideCls);
  listWrap.innerHTML = '<div class="fbar"><label class="fall"><input type="checkbox" class="fall-ck"> <span>' + ctx.tr('全选') + '</span></label><span class="fcnt"></span></div><div class="fitems"></div>';
  /* 绝对路径输入：连接本地执行器（底层真执行）时，可直接使用本机真实路径 */
  const pathRow = document.createElement('div');
  pathRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px';
  const pathIn = document.createElement('input');
  pathIn.className = 'fpath'; pathIn.type = 'text';
  pathIn.placeholder = ctx.tr('或粘贴本地绝对路径（连接本地执行器后可直接执行，如 /Users/you/Downloads/待检目录）');
  pathIn.style.cssText = 'flex:1;font-size:12px;padding:6px 8px';
  pathRow.appendChild(pathIn);
  d.appendChild(pickRow); d.appendChild(pathRow); d.appendChild(listWrap);
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
  const applyFiles = (files, label) => {
    // 合并去重（按 path），保留已有勾选状态
    const seen = new Set(st.files.map(x => x.path));
    const fresh = files.filter(x => !seen.has(x.path));
    st.files = st.files.concat(fresh);
    fresh.forEach(x => { if (folderIsText(x.name)) st.included.add(x.path); });
    dirName.textContent = label + ' · ' + ctx.tr(st.files.length + ' 个文件');
    listWrap.classList.remove(ctx.hideCls);
    renderItems();
    ctx.toast(ctx.tr('已加载 ' + fresh.length + ' 个文件，勾选后随执行一并提交'));
  };
  btn.onclick = () => folderPick((files, dirN) => {
    if (!files.length) { ctx.toast(ctx.tr('目录为空')); return; }
    st.dirName = dirN || '';
    applyFiles(files, st.dirName || ctx.tr('已选目录'));
  });
  btnF.onclick = () => folderPickFiles(files => {
    if (!files.length) return;
    st.dirName = st.dirName || ctx.tr('手动选择');
    applyFiles(files, ctx.tr('手动选择'));
  });
  st.apply = applyFiles;       // 供测试：直接注入文件列表
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
/* 把文件读成 base64（分块避免栈溢出） */
async function b64OfFile(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk)
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}
/* 收集勾选文件为 {path: 'input/<原相对路径>', b64} 列表（真执行模式随技能包上传，含二进制） */
async function folderCollectFiles(fields, getBox) {
  const out = [];
  for (const f of fields) {
    if (f.type !== 'folder' || f._hidden) continue;
    const box = getBox(f);
    const st = box && box._folderState;
    if (!st) continue;
    for (const it of st.files) {
      if (!st.included.has(it.path)) continue;
      try { out.push({ path: 'input/' + it.path, b64: await b64OfFile(it.file) }); } catch (e) {}
    }
  }
  return out;
}
window.__folderTest = { folderIsText, folderFmtSize, buildFolderUI, folderPick, folderPickFiles, folderOpenFile, folderCollectText, folderCollectFiles, b64OfFile };

/* ===== host 本地执行器 START ===== */
/* 让上传的 Skill 包被「真正执行」（scripts/ 里的 python/shell 真跑），
   而非只把 SKILL.md 塞给模型口头模拟。
   前置条件：本机运行 python3 skill-forge-host.py（默认 http://127.0.0.1:39217）。
   本块为共享代码，app.js 与 tool.js 通过 START/END 标记保持同步。 */
const HOST_DEFAULT_BASE = 'http://127.0.0.1:39217';
const __host = { ok: false, checkedAt: 0, base: '' };
try { __host.base = localStorage.getItem('sf_host_base') || HOST_DEFAULT_BASE; } catch (e) { __host.base = HOST_DEFAULT_BASE; }
const hostBase = () => (__host.base || HOST_DEFAULT_BASE).replace(/\/+$/, '');
async function hostPing(force) {
  if (!force && __host.ok && Date.now() - __host.checkedAt < 30000) return true;
  const was = __host.ok;
  try {
    const r = await fetch(hostBase() + '/ping', { signal: AbortSignal.timeout(2500) });
    __host.info = await r.json();
    __host.ok = !!(__host.info && __host.info.ok);
  } catch (e) { __host.ok = false; __host.info = null; }
  __host.checkedAt = Date.now();
  if (!was && __host.ok) { try { toast(I18N.tr('本地执行器已自动连接')); } catch (e) {} }
  if (typeof window !== 'undefined' && typeof window.__hostUIRefresh === 'function') window.__hostUIRefresh();
  return __host.ok;
}
const hostHasScripts = refs => (refs || []).some(r =>
  /(^|\/)(scripts?|bin)\//i.test(r.name) || /\.(py|sh)$/i.test(r.name));
async function hostUploadSkill(name, files) {
  /* files 项：{path, content(文本)} 或 {path, b64(已编码，二进制文件用)} */
  const body = { name, files: files.map(f => ({ path: f.path, b64: f.b64 != null ? f.b64 : btoa(unescape(encodeURIComponent(f.content))) })) };
  const r = await fetch(hostBase() + '/upload', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!j.ok) throw new Error('技能包安装失败：' + (j.error || ('HTTP ' + r.status)));
  return j;
}
async function hostExec(cwd, command) {
  const r = await fetch(hostBase() + '/exec', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd, command, timeout: 900 }) });
  const j = await r.json();
  if (!j.ok) throw new Error('执行器错误：' + (j.error || ('HTTP ' + r.status)));
  return j;
}
/* 从模型回复中解析 {"action":"exec"|"final",...}（容忍代码围栏与多余文字） */
function hostParseAction(text) {
  const tryParse = s => { try { const j = JSON.parse(s); return (j && j.action) ? j : null; } catch (e) { return null; } };
  const fences = [...String(text || '').matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(m => m[1]);
  for (let k = fences.length - 1; k >= 0; k--) { const j = tryParse(fences[k].trim()); if (j) return j; }
  const t = String(text || '');
  let end = t.length;
  while (end > 0) {
    const i = t.lastIndexOf('{', end - 1);
    if (i < 0) return null;
    let depth = 0;
    for (let p = i; p < t.length; p++) {
      if (t[p] === '{') depth++;
      else if (t[p] === '}') {
        depth--;
        if (!depth) { const j = tryParse(t.slice(i, p + 1)); if (j) return j; break; }
      }
    }
    end = i;
  }
  return null;
}
/* 底层执行主循环：模型每轮返回 exec（执行一条命令）或 final（给出最终结果） */
async function hostAgentRun(o) {
  const msgs = [{ role: 'system', content: o.sys }, { role: 'user', content: o.user }];
  for (let round = 1; round <= 15; round++) {
    o.status('模型思考中…（第 ' + round + ' 轮）');
    const text = await o.chat(msgs);
    const act = hostParseAction(text);
    if (!act) throw new Error('模型未返回有效的 JSON 指令（需要 {"action":"exec"} 或 {"action":"final"}）');
    if (act.action === 'final') return String(act.answer == null ? '' : act.answer);
    if (act.action === 'exec') {
      const cmd = String(act.command || '').trim();
      if (!cmd) { msgs.push({ role: 'assistant', content: text }, { role: 'user', content: 'command 为空，请重新给出。' }); continue; }
      o.print('$ ' + cmd);
      let out, code;
      try { const r = await hostExec(o.dir, cmd); out = r.output; code = r.code; }
      catch (e) { out = '[执行器错误] ' + e.message; code = -1; }
      o.print(out || '(无输出)');
      const feed = out.length > 16000 ? out.slice(-16000) : out;
      msgs.push({ role: 'assistant', content: text },
        { role: 'user', content: '命令退出码 ' + code + '，输出：\n```\n' + feed + '\n```\n继续：还需执行命令就返回 {"action":"exec","command":"…"}；任务已完成就返回 {"action":"final","answer":"最终结果"}。' });
      continue;
    }
    msgs.push({ role: 'assistant', content: text }, { role: 'user', content: '无法识别的 action，请返回 exec 或 final。' });
  }
  throw new Error('执行轮次超限（15 轮），Skill 可能陷入循环，请检查指令');
}
/* 读取执行器上的文件（返回 UTF-8 文本；≤20MB） */
async function hostReadFile(path) {
  const r = await fetch(hostBase() + '/read', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(j.error || ('HTTP ' + r.status));
  const bytes = Uint8Array.from(atob(j.b64), ch => ch.charCodeAt(0));
  return { text: new TextDecoder().decode(bytes), size: j.size, path: j.path };
}
/* 递归查找执行生成的 HTML 报告（跳过 input/ 与隐藏目录，按修改时间倒序） */
async function hostFindHtml(root, sinceTs) {
  const r = await fetch(hostBase() + '/find', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root, ext: '.html', since: sinceTs || 0 })
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}
/* ===== host 本地执行器 END ===== */

/* ===== 主流程 ===== */
(async function main() {
  const D = await loadPayload();
  if (!D) {
    document.body.innerHTML = '<div class="empty" style="margin:80px auto;max-width:520px">' +
      '没有找到要展示的界面数据。<br>请回到 Skill 工坊，重新点「🌐 新标签页打开此界面」。</div>';
    return;
  }

  let running = false, lastResult = '', resultHtml = null, browserHtml = null, hostTranscript = '';

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
  const DC = D.cfg || {};
  $('cBase').value = saved.base || DC.base || '';
  $('cKey').value = saved.key || DC.key || '';
  $('cModel').value = saved.model || DC.model || '';
  const persist = () => {
    try { localStorage.setItem(CK, JSON.stringify(saved)); } catch (e) {}
    if (isExt) chrome.storage.local.set({ toolCfg: saved });
  };
  [['cBase', 'base'], ['cKey', 'key'], ['cModel', 'model']].forEach(p => {
    $(p[0]).addEventListener('change', () => { saved[p[1]] = $(p[0]).value.trim(); persist(); });
  });

  /* 本地执行器状态 UI */
  function hostUIRefresh() {
    const d = $('hostDot'), l = $('hostLabel');
    if (!d || !l) return;
  d.className = 'host-dot' + (__host.ok ? ' on' : '');
      l.textContent = __host.ok
        ? I18N.tr('本地执行器：已连接 v') + ((__host.info && __host.info.version) || '')
        : I18N.tr('本地执行器：未连接（运行「安装执行器自启.command」可开机自动启动，正在自动重连…）');
  }
  window.__hostUIRefresh = hostUIRefresh;
  $('hostCheck').onclick = () => {
    const l = $('hostLabel');
    if (l) l.textContent = I18N.tr('本地执行器：检测中…');
    hostPing(true);
  };
  setTimeout(() => hostPing(), 0);
  /* 执行器未上线时每 10 秒自动重连，上线即自动变绿，无需手动点「检测」
     （测试页可用 window.__HOST_RETRY_MS 覆盖间隔；设为 0 关闭） */
  setInterval(() => { if (!__host.ok) hostPing(); },
    (typeof window !== 'undefined' && window.__HOST_RETRY_MS) || 10000);

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

  /* ===== 内嵌浏览器：加载执行器上真实生成的 HTML 报告文件 ===== */
  async function browserLoadLocal(path, syncOut) {
    try {
      const r = await hostReadFile(path);
      browserHtml = r.text;
      $('pv').srcdoc = r.text;
      setBrowser(true);
      $('bTag').textContent = '📄 ' + path.split('/').pop();
      $('bSrc').value = path;
      if (syncOut) showSrcFileView(r.path || path, r.text, r.size);   // 中栏联动展示该文件源码
    } catch (e) { toast('读取执行器上的 HTML 失败：' + e.message); }
  }
  async function loadGeneratedHtml(dir, sinceTs) {
    try {
      const r = await hostFindHtml(dir, sinceTs);
      const files = r.files || [];
      if (!files.length) return;
      const sel = $('bSrc');
      sel.innerHTML = '';
      if (resultHtml) {
        const o = document.createElement('option');
        o.value = '__inline__'; o.textContent = I18N.tr('最终结果中的页面');
        sel.appendChild(o);
      }
      files.forEach(f => {
        const o = document.createElement('option');
        o.value = f.path; o.textContent = '📄 ' + (f.rel || f.path);
        sel.appendChild(o);
      });
      sel.classList.toggle('hide', sel.options.length < 2);
      if (!resultHtml) await browserLoadLocal(files[0].path);
    } catch (e) { /* 执行器离线等场景静默跳过 */ }
  }
  $('bSrc').onchange = () => {
    const v = $('bSrc').value;
    if (v === '__inline__') {
      browserHtml = resultHtml;
      if (resultHtml) {
        $('pv').srcdoc = resultHtml;
        setBrowser(true);
        $('bTag').textContent = I18N.tr('已渲染 HTML');
      }
      setView(viewMd);   // 中栏恢复执行结果展示
    } else if (v) browserLoadLocal(v, true);
  };

  /* ===== 来源文件视图：右栏下拉框选中磁盘文件时，中栏联动展示该文件源码 ===== */
  function showSrcFileView(path, text, size) {
    const kb = size > 1048576 ? (size / 1048576).toFixed(1) + ' MB'
      : size ? Math.max(1, Math.round(size / 1024)) + ' KB' : '';
    $('out').classList.add('md'); $('out').classList.remove('term');
    $('out').setAttribute('data-noi18n', '1');
    $('out').innerHTML =
      '<div class="src-head">📄 <b>' + escapeHtml(path.split('/').pop()) + '</b>' +
      '<span class="src-meta">' + escapeHtml(path) + (kb ? ' · ' + kb : '') + '</span></div>' +
      '<div class="src-tip">' + I18N.tr('该文件已在右栏「内嵌浏览器」渲染预览，下方为其源码；切回「最终结果中的页面」可查看执行结果') + '</div>' +
      '<pre><code>' + escapeHtml(text) + '</code></pre>';
    $('out').scrollTop = 0;
  }
  /* 点「渲染/终端」切回执行结果时，右栏同步恢复为最终结果页面 */
  function browserBackToInline() {
    const sel = $('bSrc');
    if (!sel.classList.contains('hide') && sel.value !== '__inline__' &&
        sel.querySelector('option[value="__inline__"]')) {
      sel.value = '__inline__';
      browserHtml = resultHtml;
      if (resultHtml) {
        $('pv').srcdoc = resultHtml;
        setBrowser(true);
        $('bTag').textContent = I18N.tr('已渲染 HTML');
      }
    }
  }

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
    /* 底层真执行判定：Skill 带脚本 且 本地执行器在线 */
    const skillHasScripts = hostHasScripts(D.refs);
    const hostOK = await hostPing();
    if (skillHasScripts && !hostOK)
      toast(I18N.tr('检测到 Skill 含脚本，但本地执行器未连接，本次将以纯模型模式执行（双击「安装执行器自启.command」后自动连接即可真执行）'));
    const hostMode = hostOK && skillHasScripts;
    const values = {};
    let visibleCount = 0;
    for (const f of D.fields) {
      if (f._hidden) continue;   // 联动隐藏的字段不参与执行
      if (f.type === 'folder') {
        const box = document.querySelector('#form .field[data-fkey="' + f.key + '"]');
        /* 真执行模式优先使用用户粘贴的本地绝对路径（模型可在命令中直接访问） */
        const pathEl = box && box.querySelector('.fpath');
        const localPath = pathEl ? pathEl.value.trim() : '';
        if (hostMode && localPath) {
          values[f.key] = I18N.tr('本地待检目录（本机绝对路径，可在命令中直接使用）：') + localPath;
          visibleCount++;
          continue;
        }
        const st = box && box._folderState;
        const picks = st ? st.files.filter(x => st.included.has(x.path)) : [];
        if (picks.length) {
          values[f.key] = hostMode
            ? I18N.tr('已选文件将随技能包上传到执行器 input/ 目录（共 ' + picks.length + ' 个），执行时请用其 input/ 相对路径：\n' + picks.map(x => '- input/' + x.path).join('\n'))
            : I18N.tr('本地待检文件清单（内容已附在系统提示「### 本地文件」小节，可直接引用）：\n' + picks.map(x => '- ' + x.path).join('\n'));
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

    /* ===== 底层真执行：安装技能包 → 模型驱动命令循环 ===== */
    if (hostMode) {
      running = true; $('btnRun').disabled = true;
      $('out').setAttribute('data-noi18n', '1');
      $('out').classList.remove('md'); $('out').classList.add('term');
      $('out').textContent = ''; $('out').classList.remove('hide');
      $('btnRender').classList.add('hide');
      hostTranscript = '';
      $('bSrc').innerHTML = ''; $('bSrc').classList.add('hide');   // 清掉上次执行残留的来源选项
      const print = line => {
        hostTranscript += (hostTranscript ? '\n' : '') + line;
        $('out').textContent += ($('out').textContent ? '\n' : '') + line;
        $('out').scrollTop = $('out').scrollHeight;
      };
      try {
        const runStartTs = Math.floor(Date.now() / 1000) - 2;   // 用于识别执行期间新生成的文件
        $('stat').textContent = I18N.tr('正在把技能包安装到本地执行器…');
        /* 收集勾选的本地文件（含二进制），随技能包一并上传到 input/ 目录 */
        const inputFiles = await folderCollectFiles(D.fields, f => document.querySelector('#form .field[data-fkey="' + f.key + '"]'));
        const files = [{ path: 'SKILL.md', content: D.raw || ('---\nname: ' + D.name + '\ndescription: ' + (D.description || '') + '\n---\n\n' + D.body) }]
          .concat((D.refs || []).filter(r => r.content).map(r => ({ path: r.name, content: r.content })))
          .concat(inputFiles);
        const up = await hostUploadSkill(D.name, files);
        print('[host] 技能包已安装：' + up.dir + '（' + up.files + ' 个文件' + (inputFiles.length ? '，含 ' + inputFiles.length + ' 个待检文件已放入 input/' : '') + '）');
        const scriptList = (D.refs || []).filter(r => r.content && /\.(py|sh)$/i.test(r.name))
          .map(r => '- ' + r.name).join('\n');
        const inputNote = inputFiles.length
          ? '用户选择的待检文件已上传到技能目录的 input/ 子目录（相对路径保持原样，如 input/xxx.py）。处理目标就是这些文件，请直接对 input/ 下的文件执行。\n'
          : '';
        const sys = '你是一个执行「Skill」的助手，运行在用户本机的命令执行环境中。\n'
          + '# Skill 名称\n' + D.name + '\n'
          + (D.description ? '# 描述\n' + D.description + '\n' : '')
          + '# 完整指令\n' + D.body + refText
          + '\n\n# 本地执行环境\n技能包已安装到目录：' + up.dir + '（命令默认在此目录执行，SKILL.md 在该目录下，脚本如 scripts/xxx.py 位于其子目录）\n'
          + (scriptList ? '可用脚本：\n' + scriptList + '\n' : '')
          + inputNote
          + '命令最长可运行 900 秒，输出会回传给你。用户提供的本地目录/文件是本机真实路径，可直接在命令中使用；python3 可用，脚本缺依赖时先 pip3 install。\n'
          + '# 执行要求（必须遵守）\n'
          + '1. 必须通过执行命令来完成任务：优先按 Skill 指令运行其自带的脚本（如 python3 scripts/xxx.py …）处理目标文件/目录，让脚本真实运行并基于其真实输出给出结论。\n'
          + '2. 禁止不运行脚本、仅凭阅读文件内容就直接给出分析报告——口头分析不是有效执行。\n'
          + '3. 若脚本报错，读取输出、修复调用方式（缺依赖先 pip3 install）后重试。\n'
          + '# 输出协议（严格遵守）\n每次回复只输出一个 JSON 对象，二选一：\n'
          + '{"action":"exec","command":"要执行的一条 shell 命令"}\n'
          + '{"action":"final","answer":"给用户的最终结果（完整保留 Skill 要求的格式，如报告/JSON/HTML）"}\n'
          + '不要输出任何多余文字。需要多条命令就分多轮逐条执行；全部完成后再给 final。\n'
          + '若 Skill 要产出 HTML 报告/页面，请把文件保存到技能目录下（如 report.html），并在 final 的 answer 里列出该文件的相对路径——用户浏览器会自动加载预览；不要把大段 HTML 直接贴进 answer。';
        const user = '请执行此 Skill。输入参数：\n'
          + Object.keys(values).map(k => '【' + k + '】\n' + values[k]).join('\n\n');
        const chatOnce = async msgs => {
          const res = await fetch(base.replace(/\/+$/, '') + '/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
            body: JSON.stringify({ model: model, messages: msgs, stream: false, temperature: 0.3 })
          });
          if (!res.ok) { let d = ''; try { d = (await res.json()).error.message || ''; } catch (e) {} throw new Error('HTTP ' + res.status + ' ' + d); }
          return (await res.json()).choices[0].message.content.trim();
        };
        const answer = await hostAgentRun({
          sys, user, dir: up.dir,
          status: s => { $('stat').textContent = I18N.tr(s); },
          print,
          chat: chatOnce
        });
        lastResult = answer;
        finish();
        /* 默认修饰显示最终结果；切「终端」可看完整执行过程 */
        $('btnRender').classList.remove('hide');
        setView(true);
        $('stat').textContent = I18N.tr('完成（底层真执行 · 结果 ') + answer.length + I18N.tr(' 字符）');
        await loadGeneratedHtml(up.dir, runStartTs);   // 加载执行期间磁盘上生成的 HTML 报告
      } catch (e) {
        $('stat').textContent = I18N.tr('执行失败');
        $('out').textContent += '\n❌ ' + e.message + I18N.tr('\n\n常见原因：接口地址需以 /v1 结尾；Key 无效或额度不足；浏览器跨域限制。');
      }
      running = false; $('btnRun').disabled = false;
      return;
    }

    const folderText = await folderCollectText(D.fields, f => document.querySelector('#form .field[data-fkey="' + f.key + '"]'));
    // 告知模型：文件内容已附上，禁止以「缺少路径/无法访问」为由拒绝
    const folderNote = folderText ? '\n\n# 本地文件说明\n用户已在浏览器端选择了本地待检文件，内容已全文附在上方「### 本地文件：<路径>」小节中（路径为文件名/相对路径形式，浏览器安全机制不提供绝对路径）。你没有访问用户文件系统的能力，请直接基于已附上的文件内容执行 Skill；不要以「缺少文件路径」「无法访问文件」「无法执行本地自查」为由拒绝或要求补充信息。' : '';
    const hasFolderPick = D.fields.some(f => f.type === 'folder' && !f._hidden && values[f.key]);
    if (hasFolderPick && !folderText) toast(I18N.tr('注意：所选文件均无法读取为文本（可能全是二进制），未附加任何文件内容'));
    const sys = '你是一个执行「Skill」的助手。\n# Skill 名称\n' + D.name +
      (D.description ? '\n# 描述\n' + D.description + '\n' : '') + '# 完整指令\n' + D.body + refText + folderText + folderNote;
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

  /* 结果视图：默认修饰渲染（Markdown），可切回终端原样输出 */
  let viewMd = true;   // 记录当前视图，便于从「来源文件视图」恢复
  function setView(md) {
    viewMd = md;
    $('out').setAttribute('data-noi18n', '1');
    if (md) {
      $('out').classList.add('md'); $('out').classList.remove('term');
      $('out').innerHTML = renderMarkdown(lastResult);
      $('btnRender').classList.add('on');
    } else {
      $('out').classList.remove('md'); $('out').classList.add('term');
      $('out').textContent = hostTranscript
        ? hostTranscript + '\n────────── 最终结果 ──────────\n' + lastResult
        : lastResult;
      $('btnRender').classList.remove('on');
    }
  }
  $('btnRender').onclick = () => { browserBackToInline(); setView(!$('out').classList.contains('md')); };

  function finish() {
    resultHtml = extractHtml(lastResult);
    if (resultHtml) {
      browserHtml = resultHtml;
      $('pv').srcdoc = resultHtml;          // 右栏内嵌浏览器默认渲染 HTML 结果
      setBrowser(true);
      $('btnRender').classList.add('hide');
    } else {
      browserHtml = null;
      setBrowser(false);
      $('bSrc').classList.add('hide');
      $('btnRender').classList.remove('hide');
    }
    $('out').classList.remove('hide');
    setView(true);   // 默认修饰显示；切「终端」看原样输出
    retr();
  }

  $('btnRun').onclick = run;
  $('btnCopy').onclick = () => { navigator.clipboard.writeText(lastResult); toast('已复制'); };
  $('btnDl').onclick = () => download(lastResult, 'text/markdown', D.name + '-结果.md');
  $('btnOpenHtml').onclick = async () => {
    if (!browserHtml) return;
    if (isExt) {
      // 扩展内：交给 doc.html + 沙箱页渲染，保证页面里的脚本能执行
      const { resultDocs = {} } = await chrome.storage.local.get(['resultDocs']);
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      resultDocs[id] = { html: browserHtml, title: D.name + '-页面', date: Date.now() };
      const keys = Object.keys(resultDocs);
      if (keys.length > 30) keys.slice(0, keys.length - 30).forEach(k => delete resultDocs[k]);
      await chrome.storage.local.set({ resultDocs });
      chrome.tabs.create({ url: chrome.runtime.getURL('doc.html?id=' + id) });
      return;
    }
    window.open(URL.createObjectURL(new Blob([browserHtml], { type: 'text/html' })), '_blank');
  };
  $('btnDlHtml').onclick = () => {
    if (!browserHtml) return;
    download(browserHtml, 'text/html', D.name + '-页面.html');
  };
})();
