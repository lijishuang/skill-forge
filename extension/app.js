/* Skill 工坊 · 工作台逻辑（Chrome 扩展版，存储用 chrome.storage.local） */
let SKILL = null;
let FIELDS = [];
let mode = null;
let running = false;
let currentSkillId = null;

const $ = id => document.getElementById(id);
const I18N = window.I18N || { tr: s => s, apply: () => {}, getLang: () => 'zh', setLang: () => {} };
const toast = msg => { const t = $('toast'); t.textContent = I18N.tr(msg); t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2400); };
const retr = () => { try { I18N.apply(document.body); } catch (e) {} };
const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function step(n) { ['st1','st2','st3'].forEach((id, i) => $(id).classList.toggle('on', i < n)); }

/* 动态内容（列表/表单/按钮）生成后自动重译；执行流式输出期间跳过，避免卡顿 */
let _retrTimer = null;
new MutationObserver(() => {
  if (running) return;
  clearTimeout(_retrTimer);
  _retrTimer = setTimeout(retr, 40);
}).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
document.addEventListener('i18n:change', () => { clearTimeout(_retrTimer); _retrTimer = setTimeout(retr, 0); });

/* ===== 存储适配（插件环境用 chrome.storage，普通浏览器预览时降级到 localStorage） ===== */
const HAS_CHROME = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
const LS_KEY = 'skill_forge_store';
/* 探测 localStorage 是否可用（部分预览面板的沙箱 iframe 会拦截，导致静默丢数据） */
const LS_OK = (() => { try { localStorage.setItem('__sf_probe', '1'); localStorage.removeItem('__sf_probe'); return true; } catch (e) { return false; } })();
/* localStorage 不可用时降级为内存存储（本次会话有效，不持久） */
const memStore = {};
function lsRead() {
  if (!LS_OK) { try { return JSON.parse(memStore[LS_KEY] || '{}'); } catch (e) { return {}; } }
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; }
}
function lsWrite(obj) {
  const s = { ...lsRead(), ...obj };
  const raw = JSON.stringify(s);
  if (!LS_OK) { memStore[LS_KEY] = raw; return; }
  localStorage.setItem(LS_KEY, raw);
}
const store = HAS_CHROME ? {
  get: keys => chrome.storage.local.get(keys),
  set: obj => chrome.storage.local.set(obj)
} : {
  get: async keys => { const s = lsRead(); const out = {};
    (Array.isArray(keys) ? keys : [keys]).forEach(k => { if (k in s) out[k] = s[k]; }); return out; },
  set: async obj => lsWrite(obj)
};
if (!HAS_CHROME) console.info('[Skill 工坊] 未检测到插件环境，已降级使用 localStorage（右键菜单等插件能力不可用）');
async function getCfg() {
  const { cfg = {} } = await store.get(['cfg']);
  return cfg;
}
async function saveCfg() {
  await store.set({ cfg: { base: $('cfgBase').value.trim(), key: $('cfgKey').value.trim(), model: $('cfgModel').value.trim() } });
}

/* ===== 初始化 ===== */
(async function init() {
  const { cfg = {} } = await store.get(['cfg']);
  if (cfg.base) $('cfgBase').value = cfg.base;
  if (cfg.key) $('cfgKey').value = cfg.key;
  if (cfg.model) $('cfgModel').value = cfg.model;
  if (!HAS_CHROME && !LS_OK) $('storeWarn').classList.remove('hidden');
  $('histRefresh').onclick = async () => { await renderHistory(); toast('历史已刷新'); };
  $('histClear').onclick = async () => {
    if (!confirm('确定清空全部生成历史？此操作不可恢复。')) return;
    await store.set({ history: [] }); renderHistory(); toast('已清空全部历史');
  };
  await renderLibrary();
  await renderHistory();
  await renderPages();
  await handlePending();
  const q = new URLSearchParams(location.search);
  if (q.get('load')) await loadFromLibrary(q.get('load'));
})();

/* ===== 本地执行器状态 UI ===== */
function hostUIRefresh() {
  const d = $('hostDot'), l = $('hostLabel');
  if (!d || !l) return;
  d.className = 'host-dot' + (__host.ok ? ' on' : '');
  l.textContent = __host.ok
    ? I18N.tr('本地执行器：已连接 v') + ((__host.info && __host.info.version) || '')
    : I18N.tr('本地执行器：未连接（本机运行 python3 skill-forge-host.py 后点「检测」）');
}
window.__hostUIRefresh = hostUIRefresh;
$('hostCheck').onclick = () => {
  const l = $('hostLabel');
  if (l) l.textContent = I18N.tr('本地执行器：检测中…');
  hostPing(true);
};
setTimeout(() => hostPing(), 0);   // 延迟到脚本求值完成后（__host 为 const，避免 TDZ）

/* ===== 技能库 ===== */
async function renderLibrary() {
  const { skills = [] } = await store.get(['skills']);
  $('libCount').textContent = skills.length ? `${skills.length} 个` : '';
  const list = $('libList');
  if (!skills.length) {
    list.innerHTML = '<p style="font-size:12px;color:var(--text-3)">还没有保存的 Skill。上传后点「存入技能库」，或在网页中选中 SKILL.md 内容右键保存。</p>';
    return;
  }
  list.innerHTML = '';
  skills.forEach(s => {
    const d = document.createElement('div');
    d.className = 'skill-item' + (s.id === currentSkillId ? ' active' : '');
    d.innerHTML = `<span>📄</span><span class="n">${escapeHtml(s.name)}</span>
      <span class="d">${new Date(s.date).toLocaleDateString()}</span><span class="del" title="删除">✕</span>`;
    d.addEventListener('click', e => { if (!e.target.classList.contains('del')) loadFromLibrary(s.id); });
    d.querySelector('.del').addEventListener('click', async () => {
      await store.set({ skills: skills.filter(x => x.id !== s.id) });
      if (currentSkillId === s.id) { currentSkillId = null; SKILL = null; $('skillCard').classList.add('hidden'); }
      renderLibrary(); toast('已删除：' + s.name);
    });
    list.appendChild(d);
  });
}

async function saveToLibrary() {
  if (!SKILL) return;
  const { skills = [] } = await store.get(['skills']);
  const id = currentSkillId || uid();
  const entry = { id, name: SKILL.name, description: SKILL.description, raw: SKILL.raw, refs: SKILL.refs, date: Date.now() };
  const idx = skills.findIndex(s => s.id === id);
  if (idx >= 0) skills[idx] = entry; else skills.unshift(entry);
  await store.set({ skills });
  currentSkillId = id;
  renderLibrary();
  toast('已存入技能库：' + SKILL.name);
}

async function loadFromLibrary(id) {
  const { skills = [] } = await store.get(['skills']);
  const s = skills.find(x => x.id === id);
  if (!s) { toast('技能不存在或已删除'); return; }
  currentSkillId = s.id;
  loadSkill(s.raw, s.refs || [], s.name);
  $('btnSaveLib').textContent = '🔄 更新技能库';
}

$('btnSaveLib').onclick = saveToLibrary;

/* ===== 右键导入的待处理内容 ===== */
async function handlePending() {
  const { pendingSave, pendingExec } = await store.get(['pendingSave', 'pendingExec']);
  if (pendingSave) {
    $('bannerSave').classList.add('show');
    $('saveSrc').textContent = pendingSave.url ? '来源：' + pendingSave.url.slice(0, 60) : '';
    $('btnSavePending').onclick = async () => {
      loadSkill(pendingSave.text, [], '网页导入');
      await saveToLibrary();
      if (HAS_CHROME) await chrome.storage.local.remove('pendingSave');
      $('bannerSave').classList.remove('show');
      toast('已解析并存入技能库，可继续生成界面');
    };
  }
  if (pendingExec) {
    $('bannerExec').classList.add('show');
    window._pendingExec = pendingExec.text;
    setTimeout(() => $('bannerExec').classList.remove('show'), 8000);
  }
}

/* ===== 上传与解析 ===== */
$('drop').onclick = () => $('fileInput').click();
$('btnFiles').onclick = () => $('fileInput').click();
$('btnDir').onclick = () => $('dirInput').click();
$('fileInput').onchange = e => handleFiles(e.target.files);
$('dirInput').onchange = e => handleFiles(e.target.files);
['dragover', 'dragleave', 'drop'].forEach(ev => $('drop').addEventListener(ev, e => {
  e.preventDefault(); $('drop').classList.toggle('over', ev === 'dragover');
  if (ev === 'drop') handleFiles(e.dataTransfer.files);
}));

async function handleFiles(list) {
  const files = [...list]; if (!files.length) return;
  let skillFile = files.find(f => /(^|\/)SKILL\.md$/i.test(f.name)) || files.find(f => /\.(md|markdown|txt)$/i.test(f.name));
  if (!skillFile) skillFile = files.find(f => /\.zip$/i.test(f.name));
  if (!skillFile) { toast('未找到 SKILL.md、Markdown 或 .zip 文件'); return; }
  if (/\.zip$/i.test(skillFile.name)) { await handleZip(skillFile); return; }
  const raw = await skillFile.text();
  const refs = [];
  for (const f of files) {
    if (f === skillFile || !/\.(md|markdown|txt|py|js|ts|json|csv|sh)$/i.test(f.name)) continue;
    if (f.size > 200 * 1024) { refs.push({ name: f.name.replace(/^.*\//, ''), content: '', skipped: true }); continue; }
    refs.push({ name: f.name.replace(/^.*\//, ''), content: await f.text() });
  }
  currentSkillId = null;
  loadSkill(raw, refs, skillFile.name.replace(/^.*\//, ''));
}

/* ===== 技能压缩包（.zip）支持 ===== */
const ZIP_TEXT_EXT = /\.(md|markdown|txt|py|js|ts|jsx|tsx|json|csv|sh|yaml|yml|html|css)$/i;
const MAX_ENTRY = 512 * 1024; // 单文件解压上限 512KB

async function handleZip(file) {
  setRun(true, '正在解压 ' + file.name + ' …');
  try {
    const entries = await readZip(file);
    const names = Object.keys(entries).filter(n => !n.startsWith('__MACOSX'));
    const skillPaths = names.filter(n => n.split('/').pop().toLowerCase() === 'skill.md');
    if (!skillPaths.length) { toast('压缩包里没有找到 SKILL.md'); return; }
    const dec = u8 => new TextDecoder().decode(u8);
    const roots = [...new Set(skillPaths.map(p => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''))];

    const skills = skillPaths.map(sp => {
      const root = sp.includes('/') ? sp.slice(0, sp.lastIndexOf('/')) : '';
      const otherRoots = roots.filter(r => r !== root);
      const refs = [];
      for (const n of names) {
        if (n === sp) continue;
        if (skillPaths.includes(n)) continue;
        if (root ? !n.startsWith(root + '/') : otherRoots.some(r => n.startsWith(r + '/'))) continue;
        const base = n.slice(root ? root.length + 1 : 0);
        const u8 = entries[n];
        if (u8.length > MAX_ENTRY || !ZIP_TEXT_EXT.test(n)) {
          refs.push({ name: base, content: '', skipped: true }); continue;
        }
        refs.push({ name: base, content: dec(u8) });
      }
      return { raw: dec(entries[sp]), refs, fallback: root || file.name.replace(/\.zip$/i, '') };
    });

    if (skills.length === 1) {
      const s = skills[0];
      currentSkillId = null;
      loadSkill(s.raw, s.refs, s.fallback);
      toast('压缩包解析完成：' + (s.refs.length ? `含 ${s.refs.length} 个附带文件` : '单文件技能'));
    } else {
      // 多技能包：批量入库
      const { existing = [] } = await store.get(['skills']);
      const now = Date.now();
      skills.forEach((s, i) => {
        const { meta, body } = parseFrontmatter(s.raw);
        existing.unshift({
          id: uid(), name: meta.name || s.fallback || ('技能 ' + (i + 1)),
          description: meta.description || '', raw: s.raw, refs: s.refs, date: now + i
        });
      });
      await store.set({ skills: existing });
      currentSkillId = null;
      loadSkill(skills[0].raw, skills[0].refs, skills[0].fallback);
      toast(`多技能包：已批量导入 ${skills.length} 个 Skill 到技能库，当前加载第 1 个`);
    }
  } catch (e) { toast('压缩包解析失败：' + e.message); }
  setRun(false);
}

/* 轻量 ZIP 读取：解析中央目录，store(0) 直取，deflate(8) 用浏览器原生 DecompressionStream */
async function readZip(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65536); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const entries = {};
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const compSize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const cmtLen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = new TextDecoder().decode(buf.slice(off + 46, off + 46 + nameLen));
    off += 46 + nameLen + extraLen + cmtLen;
    if (name.endsWith('/') || lho + 30 > buf.length) continue; // 目录项跳过
    const lnameLen = dv.getUint16(lho + 26, true);
    const lextraLen = dv.getUint16(lho + 28, true);
    const dataStart = lho + 30 + lnameLen + lextraLen;
    const data = buf.slice(dataStart, dataStart + compSize);
    if (method === 0) entries[name] = data;
    else if (method === 8) entries[name] = await inflateRaw(data);
    else console.warn('[Skill 工坊] 跳过不支持的压缩项：' + name);
  }
  return entries;
}

async function inflateRaw(u8) {
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

$('btnParsePaste').onclick = () => {
  const t = $('pasteArea').value.trim();
  if (t.length < 20) { toast('内容太短，请粘贴完整 SKILL.md'); return; }
  currentSkillId = null;
  loadSkill(t, [], '粘贴内容');
};

$('btnDemo').onclick = () => { currentSkillId = null; loadSkill(DEMO_SKILL, [], '示例：周报生成器'); };

/* ===== 解析器 ===== */
function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  m[1].split(/\r?\n/).forEach(line => {
    const kv = line.match(/^([A-Za-z_-]+)\s*:\s*(.*)$/);
    if (kv) meta[kv[1].trim()] = kv[2].trim().replace(/^["']|["']$/g, '');
  });
  return { meta, body: m[2] };
}
function extractPlaceholders(body) {
  const found = new Map();
  const re1 = /\{\{\s*([A-Za-z0-9_\u4e00-\u9fa5:-]+)\s*(?::\s*([^}]+))?\}\}/g; let m;
  while ((m = re1.exec(body))) found.set(m[1], (m[2] || '').trim());
  const sec = body.match(/#{2,3}\s*(输入参数|参数|必填|Required Inputs?|Inputs?|Variables?)[^\n]*\n([\s\S]*?)(?=\n#{2,3}\s|\n---|$)/i);
  if (sec) {
    sec[2].split('\n').forEach(l => {
      const li = l.match(/^\s*[-*]\s*`?([A-Za-z0-9_\u4e00-\u9fa5]+)`?\s*[:：(]([^)：\n]*)/);
      if (li && !found.has(li[1])) found.set(li[1], li[2].trim());
    });
  }
  return [...found.entries()].map(([key, hint]) => ({ key, hint }));
}
function inferType(key, hint) {
  const t = key + (hint || '');
  if (/风格|类型|语言|模式|tone|style|format|level|语气/i.test(t)) return 'select';
  if (/是否|开关|启用|布尔|enable/i.test(t)) return 'checkbox';
  if (/日期|时间|date\b|time\b/i.test(t)) return 'date';
  if (/正文|内容|文本|描述|要求|背景|prompt|content|text|desc|需求|说明|记录|素材|大纲|work|issue|plan|notes|列表/i.test(t)) return 'textarea';
  if (/数量|次数|个数|count|number|num/i.test(t)) return 'number';
  return 'text';
}
const guessLabel = key => key.replace(/[_:-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim() || key;

function loadSkill(raw, refs, srcName) {
  const { meta, body } = parseFrontmatter(raw);
  const placeholders = extractPlaceholders(body);
  SKILL = { name: meta.name || srcName.replace(/\.(md|txt)$/i, '') || '未命名 Skill',
    description: meta.description || '', body, raw, refs: refs || [], placeholders };
  $('skillCard').classList.remove('hidden');
  $('skName').textContent = SKILL.name;
  $('skDesc').textContent = SKILL.description || '(无 description，将使用正文作为指令)';
  $('skMeta').innerHTML = '';
  [I18N.tr(`正文 ${body.length} 字符`), I18N.tr(`占位符 ${placeholders.length} 个`)].forEach(c => {
    const s = document.createElement('span'); s.className = 'chip'; s.textContent = c; $('skMeta').appendChild(s); });
  $('skMode').textContent = I18N.tr('已解析'); $('skMode').className = 'mode-badge mode-heuristic';
  $('btnSaveLib').textContent = currentSkillId ? '🔄 更新技能库' : '💾 存入技能库';
  step(2); toast('Skill 解析完成：' + SKILL.name);
}

$('btnViewRaw').onclick = () => {
  const w = window.open('', '_blank');
  w.document.write('<pre style="white-space:pre-wrap;padding:24px;font-size:13px">' + escapeHtml(SKILL.raw) + '</pre>');
  w.document.title = SKILL.name;
};

/* ===== 参数联动 =====
   字段可声明 showIf = { key: 父字段key, values: ['值1','值2'] }，
   仅当父字段当前取值落在 values 内时该字段才显示；隐藏字段不参与必填校验，也不会进入执行参数。 */
function fieldValue(f) {
  const el = document.querySelector(`[data-key="${f.key}"]`);
  if (!el) return '';
  if (f.type === 'checkbox') return el.checked ? '是' : '否';
  return (el.value || '').trim();
}

function applyLinkage() {
  FIELDS.forEach(f => {
    f._hidden = false;
    if (f.showIf && f.showIf.key) {
      const p = FIELDS.find(x => x.key === f.showIf.key);
      if (p) {
        const v = fieldValue(p);
        const vals = (f.showIf.values || []).map(s => String(s).trim());
        f._hidden = !vals.includes(v);
      }
    }
    const d = document.querySelector(`.field[data-fkey="${f.key}"]`);
    if (d) d.classList.toggle('hidden', !!f._hidden);
  });
}
/* 表单控件变化时自动重算联动（事件委托，无需每次 render 重新绑定） */
document.addEventListener('change', e => {
  if (e.target && e.target.closest && e.target.closest('#formArea')) applyLinkage();
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t && t.tagName === 'TEXTAREA' && t.closest && t.closest('#formArea')) applyLinkage();
});

/* 单个字段的联动编辑器（内嵌在字段下方） */
function buildLinkEditor(f) {
  const ed = document.createElement('div');
  ed.className = 'link-editor';
  const others = FIELDS.filter(x => x.key !== f.key &&
    (x.type === 'select' || x.type === 'checkbox' || (x.options && x.options.length)));
  if (!others.length) {
    ed.innerHTML = `<span class="note">${escapeHtml(I18N.tr('暂无可作为联动条件的字段：需要至少一个 select / checkbox 类型字段'))}</span>`;
    return ed;
  }
  const cur = f.showIf || { key: others[0].key, values: [] };
  const row1 = document.createElement('div'); row1.className = 'row';
  row1.appendChild(document.createTextNode(I18N.tr('当字段')));
  const sel = document.createElement('select');
  others.forEach(o => {
    const op = document.createElement('option');
    op.value = o.key; op.textContent = (o.label || o.key) + ' (' + o.key + ')';
    if (o.key === cur.key) op.selected = true;
    sel.appendChild(op);
  });
  row1.appendChild(sel);
  row1.appendChild(document.createTextNode(I18N.tr('取以下值时，才显示本字段：')));
  ed.appendChild(row1);

  const row2 = document.createElement('div'); row2.className = 'row';
  const parent = () => FIELDS.find(x => x.key === sel.value);
  const renderChecks = () => {
    row2.innerHTML = '';
    const p = parent();
    const opts = !p ? [] :
      p.type === 'checkbox' ? ['是', '否'] :
      (p.options && p.options.length ? p.options : ['默认']);
    opts.forEach(o => {
      const lab = document.createElement('label'); lab.className = 'chk';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = o;
      cb.checked = (cur.values || []).includes(o);
      lab.appendChild(cb); lab.appendChild(document.createTextNode(o));
      row2.appendChild(lab);
    });
    if (!opts.length) row2.innerHTML = `<span class="note">${escapeHtml(I18N.tr('该字段暂无选项'))}</span>`;
  };
  sel.addEventListener('change', renderChecks);
  renderChecks();
  ed.appendChild(row2);

  const row3 = document.createElement('div'); row3.className = 'btnrow';
  const ok = document.createElement('button'); ok.className = 'primary'; ok.textContent = I18N.tr('保存联动');
  ok.onclick = () => {
    const vals = [...row2.querySelectorAll('input:checked')].map(c => c.value);
    if (vals.length) f.showIf = { key: sel.value, values: vals };
    else f.showIf = null;
    applyLinkage(); renderForm(); toast(f.showIf ? '联动规则已保存' : '已清除联动');
  };
  const clr = document.createElement('button'); clr.textContent = I18N.tr('清除联动');
  clr.onclick = () => { f.showIf = null; applyLinkage(); renderForm(); toast('已清除联动'); };
  row3.appendChild(ok); row3.appendChild(clr);
  ed.appendChild(row3);
  return ed;
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
  try {
    const r = await fetch(hostBase() + '/ping', { signal: AbortSignal.timeout(2500) });
    __host.info = await r.json();
    __host.ok = !!(__host.info && __host.info.ok);
  } catch (e) { __host.ok = false; __host.info = null; }
  __host.checkedAt = Date.now();
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

/* ===== 界面生成 ===== */
function fieldHeader(f, withReq) {
  return `<div class="fl">${escapeHtml(f.label || f.key)}${withReq ? ' <span class="req">' + I18N.tr('必填') + '</span>' : ''}
    <span class="fk">${escapeHtml(f.key)}</span>
    <button type="button" class="mini-ico lkbtn" title="${escapeHtml(I18N.tr('设置参数联动（根据其他字段的值决定是否显示本字段）'))}">🔗 ${escapeHtml(I18N.tr('联动'))}</button></div>` +
    (f.hint ? `<div class="hint">${escapeHtml(f.hint)}</div>` : '');
}

function bindLinkBtn(d, f) {
  const btn = d.querySelector('.lkbtn');
  if (!btn) return;
  btn.classList.toggle('on', !!f.showIf);
  btn.onclick = e => {
    e.preventDefault();
    const old = d.querySelector('.link-editor');
    if (old) { old.remove(); return; }
    document.querySelectorAll('#formArea .link-editor').forEach(x => x.remove());
    d.appendChild(buildLinkEditor(f));
  };
}

function renderForm() {
  const area = $('formArea'); area.className = ''; area.style.cssText = ''; area.innerHTML = '';
  if (!FIELDS.length) { area.innerHTML = '<p style="color:var(--text-3)">暂无字段。</p>'; return; }
  FIELDS.forEach(f => {
    const d = document.createElement('div'); d.className = 'field';
    d.dataset.fkey = f.key;
    let ctrl;
    if (f.type === 'select') {
      ctrl = document.createElement('select');
      (f.options && f.options.length ? f.options : ['默认']).forEach(o => {
        const op = document.createElement('option'); op.value = op.textContent = o; ctrl.appendChild(op); });
      d.innerHTML = fieldHeader(f, false);
      d.appendChild(ctrl);
    } else if (f.type === 'textarea') {
      ctrl = document.createElement('textarea'); ctrl.style.minHeight = '80px';
      d.innerHTML = fieldHeader(f, false);
      d.appendChild(ctrl);
    } else if (f.type === 'checkbox') {
      ctrl = document.createElement('input'); ctrl.type = 'checkbox'; ctrl.style.width = 'auto';
      const wrap = document.createElement('label');
      wrap.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--text-2);cursor:pointer';
      wrap.appendChild(ctrl);
      wrap.appendChild(document.createTextNode(I18N.tr('启用')));
      ctrl.dataset.key = f.key;
      d.innerHTML = fieldHeader(f, false);
      d.appendChild(wrap);
    } else if (f.type === 'folder') {
      d.innerHTML = fieldHeader(f, false);
      buildFolderUI(f, d, { tr: s => I18N.tr(s), toast, hideCls: 'hidden' });
    } else {
      ctrl = document.createElement('input');
      ctrl.type = { number: 'number', date: 'date', email: 'email', url: 'url' }[f.type] || 'text';
      d.innerHTML = fieldHeader(f, false);
      d.appendChild(ctrl);
    }
    if (ctrl) {
      if (f.placeholder) ctrl.placeholder = f.placeholder;
      ctrl.dataset.key = f.key;
    }
    bindLinkBtn(d, f);
    area.appendChild(d);
  });
  applyLinkage();
  // 右键导入的执行内容自动填入
  if (window._pendingExec) {
    const firstText = FIELDS.find(f => f.type === 'textarea' && !f._hidden) ||
      FIELDS.find(f => !f._hidden);
    if (firstText) {
      const el = document.querySelector(`[data-key="${firstText.key}"]`);
      if (el && !el.value.trim()) {
        el.value = window._pendingExec;
        toast(`已把网页选中内容填入「${firstText.label || firstText.key}」`);
      }
    }
    delete window._pendingExec;
  }
  $('btnRun').disabled = false; $('btnReset').disabled = false;
  $('btnOpenPage').disabled = false; $('btnDlPage').disabled = false; $('btnSavePage').disabled = false;
  const linked = FIELDS.filter(f => f.showIf).length;
  $('formTag').textContent = I18N.tr(`${FIELDS.length} 个字段${linked ? ' · ' + linked + ' 个联动' : ''} · ${mode === 'ai' ? 'AI 设计' : mode === 'manual' ? '手动' : '自动解析'}`);
  $('formTag').className = 'tag mode-badge ' + (mode === 'ai' ? 'mode-ai' : 'mode-heuristic');
  step(3);
}

$('btnAutoUI').onclick = () => {
  if (!SKILL) return;
  mode = 'heuristic';
  FIELDS = SKILL.placeholders.map(p => ({
    key: p.key, label: guessLabel(p.key), type: inferType(p.key, p.hint),
    hint: p.hint || '', options: inferType(p.key, p.hint) === 'select' ? ['正式', '轻松', '简洁', '详细'] : null }));
  if (!FIELDS.length) {
    FIELDS = [{ key: 'task', label: '任务描述', type: 'textarea', hint: '告诉 AI 这次要执行什么' }];
    toast('未发现 {{占位符}}，已生成通用任务输入框');
  }
  renderForm(); toast(`已生成 ${FIELDS.length} 个字段的界面`);
};

$('btnManualUI').onclick = () => {
  const key = prompt('字段名（英文 key）：'); if (!key) return;
  const label = prompt('显示名称：', guessLabel(key)) || key;
  const type = prompt('类型：text / textarea / number / select / checkbox / date / folder', 'text'); if (!type) return;
  let options = null; if (type === 'select') options = (prompt('选项，逗号分隔：', 'A,B,C') || 'A,B,C').split(',').map(s => s.trim());
  mode = FIELDS.length ? mode : 'manual';
  FIELDS.push({ key, label, type, hint: '', options }); renderForm(); toast('已添加字段 ' + key);
};

$('btnAIGen').onclick = async () => {
  if (!SKILL) { toast('请先上传并解析 Skill'); return; }
  const c = await getCfg();
  if (!c.base || !c.key || !c.model) { toast('请先在下方填写模型配置'); return; }
  const refsText = SKILL.refs.filter(r => !r.skipped && r.content)
    .map(r => `\n--- 附件 ${r.name} ---\n${r.content.slice(0, 6000)}`).join('');
  const sys = '你是 UI 设计师。用户会给一个 AI Skill 的完整定义，请为它设计一个填写表单界面。' +
    '只输出 JSON 数组，不要任何其他文字。每个元素：{"key":"英文变量名","label":"中文显示名","type":"text|textarea|number|select|date|checkbox|folder","hint":"一句中文填写提示","options":["select 时的选项"]}。' +
    '字段 2-6 个，覆盖该 Skill 运行所需的全部输入；按语义选择类型：长文本用 textarea，有限选项用 select，日期用 date，是/否开关用 checkbox，数量用 number，需要用户提供本地目录/文件集（待检查、待分析的本地资料）时用 folder。' +
    '参数联动：仅当某个字段确实依赖另一字段的取值（选了某些值才需要填写、否则无意义）时，为它加可选字段 "showIf":{"key":"父字段key","values":["触发显示的选项值"]}；values 取父字段 select 的选项，或 checkbox 的"是"/"否"。大多数字段不需要 showIf，不要滥用。';
  const user = `Skill 名称：${SKILL.name}\n描述：${SKILL.description}\n\n正文：\n${SKILL.body.slice(0, 8000)}${refsText}`;
  setRun(true, 'AI 正在分析 Skill 并设计界面…');
  try {
    const text = await chat([{ role: 'system', content: sys }, { role: 'user', content: user }], false, c);
    const j = JSON.parse(text.replace(/^```(json)?|```$/g, '').trim());
    if (!Array.isArray(j) || !j.length) throw new Error('返回格式异常');
    FIELDS = j.map(f => ({
      key: f.key, label: f.label || f.key, type: f.type || 'text', hint: f.hint || '',
      options: f.options || null,
      showIf: (f.showIf && f.showIf.key && Array.isArray(f.showIf.values) && f.showIf.values.length)
        ? { key: f.showIf.key, values: f.showIf.values.map(String) } : null
    }));
    mode = 'ai';
    $('skMode').textContent = I18N.tr('AI 设计'); $('skMode').className = 'mode-badge mode-ai';
    renderForm(); toast(`AI 设计了 ${FIELDS.length} 个字段的界面`);
  } catch (e) { toast('AI 生成失败：' + e.message); }
  setRun(false);
};

/* ===== 执行 ===== */
$('btnRun').onclick = run;
$('btnReset').onclick = () => {
  FIELDS = []; renderForm();
  $('formArea').className = 'empty';
  $('formArea').innerHTML = '<div class="big">🧩</div>上传并解析 Skill 后点击「生成界面」';
  $('formTag').textContent = I18N.tr('尚未生成'); $('btnRun').disabled = true; $('btnReset').disabled = true;
  $('output').removeAttribute('data-noi18n');
  $('output').classList.remove('md'); $('output').classList.add('term');
  $('output').textContent = I18N.tr('执行结果将在这里流式输出…');
  $('segBar').classList.add('hidden');
  $('btnOpenPage').disabled = true; $('btnDlPage').disabled = true; $('btnSavePage').disabled = true;
  // 内嵌浏览器复位为「不涉及」
  resultHtml = null;
  $('browserFrame').removeAttribute('srcdoc'); $('browserFrame').style.display = 'none';
  $('browserEmpty').classList.remove('hidden');
  $('browserTag').textContent = I18N.tr('不涉及');
  ['brOpen', 'brDl', 'brSave'].forEach(id => $(id).classList.add('hidden'));
};

async function run() {
  if (running) return;
  const c = await getCfg();
  if (!c.base || !c.key || !c.model) { toast('请先填写模型配置'); return; }
  applyLinkage();
  /* 底层真执行判定：Skill 带脚本 且 本地执行器在线 */
  const skillHasScripts = hostHasScripts(SKILL.refs);
  const hostOK = await hostPing();
  if (skillHasScripts && !hostOK)
    toast(I18N.tr('检测到 Skill 含脚本，但本地执行器未连接，本次将以纯模型模式执行（在本机运行 python3 skill-forge-host.py 并点「检测」可真执行）'));
  const hostMode = hostOK && skillHasScripts;
  const values = {};
  let visibleCount = 0;
  for (const f of FIELDS) {
    if (f._hidden) continue;   // 联动隐藏的字段不参与执行
    if (f.type === 'folder') {
      const box = document.querySelector(`#formArea .field[data-fkey="${f.key}"]`);
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
    const el = document.querySelector(`[data-key="${f.key}"]`);
    if (f.type === 'checkbox') { values[f.key] = el && el.checked ? '是' : '否'; visibleCount++; continue; }
    const v = (el ? el.value.trim() : '');
    if (!v) { toast(`请填写「${f.label || f.key}」`); el && el.focus(); return; }
    values[f.key] = v; visibleCount++;
  }
  if (!visibleCount) { toast('没有可见的输入字段，请检查参数联动设置'); return; }
  window._lastValues = values;
  const refText = SKILL.refs.filter(r => !r.skipped && r.content)
    .map(r => `\n\n### 参考文件：${r.name}\n${r.content.slice(0, 8000)}`).join('');

  /* ===== 底层真执行：安装技能包 → 模型驱动命令循环 ===== */
  if (hostMode) {
    $('output').classList.remove('md'); $('output').classList.add('term');
    $('output').textContent = ''; $('output').setAttribute('data-noi18n', '1');
    $('output').classList.remove('hidden');
    try {
      const runStartTs = Math.floor(Date.now() / 1000) - 2;   // 用于识别执行期间新生成的文件
      setRun(true, '正在把技能包安装到本地执行器…');
      /* 收集勾选的本地文件（含二进制），随技能包一并上传到 input/ 目录 */
      const inputFiles = await folderCollectFiles(FIELDS, f => document.querySelector(`#formArea .field[data-fkey="${f.key}"]`));
      const files = [{ path: 'SKILL.md', content: SKILL.raw }]
        .concat(SKILL.refs.filter(r => r.content).map(r => ({ path: r.name, content: r.content })))
        .concat(inputFiles);
      const up = await hostUploadSkill(SKILL.name, files);
      const print = line => {
        $('output').textContent += ($('output').textContent ? '\n' : '') + line;
        $('output').scrollTop = $('output').scrollHeight;
      };
      print(`[host] 技能包已安装：${up.dir}（${up.files} 个文件${inputFiles.length ? '，含 ' + inputFiles.length + ' 个待检文件已放入 input/' : ''}）`);
      const scriptList = SKILL.refs.filter(r => r.content && /\.(py|sh)$/i.test(r.name))
        .map(r => '- ' + r.name).join('\n');
      const inputNote = inputFiles.length
        ? `用户选择的待检文件已上传到技能目录的 input/ 子目录（相对路径保持原样，如 input/xxx.py）。处理目标就是这些文件，请直接对 input/ 下的文件执行。\n`
        : '';
      const sys = '你是一个执行「Skill」的助手，运行在用户本机的命令执行环境中。\n'
        + `# Skill 名称\n${SKILL.name}\n` + (SKILL.description ? `# 描述\n${SKILL.description}\n` : '')
        + `# 完整指令\n${SKILL.body}${refText}`
        + `\n\n# 本地执行环境\n技能包已安装到目录：${up.dir}（命令默认在此目录执行，SKILL.md 在该目录下，脚本如 scripts/xxx.py 位于其子目录）\n`
        + (scriptList ? `可用脚本：\n${scriptList}\n` : '')
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
        + Object.entries(values).map(([k, v]) => `【${k}】\n${v}`).join('\n\n');
      const chatOnce = async msgs => {
        const res = await fetch(c.base.replace(/\/+$/, '') + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + c.key },
          body: JSON.stringify({ model: c.model, messages: msgs, stream: false, temperature: 0.3 })
        });
        if (!res.ok) { let d = ''; try { d = (await res.json()).error?.message || ''; } catch (e) {} throw new Error(`HTTP ${res.status} ${d}`); }
        return (await res.json()).choices[0].message.content.trim();
      };
      const answer = await hostAgentRun({
        sys, user, dir: up.dir,
        status: s => { $('runStatus').textContent = I18N.tr(s); },
        print,
        chat: chatOnce
      });
      lastResult = answer;
      print('\n────────── 最终结果 ──────────\n' + answer);
      setRun(false, `完成（底层真执行 · 结果 ${answer.length} 字符）`, 'ok');
      $('btnCopy').disabled = false; $('btnDownload').disabled = false;
      updateResultActions();
      await loadGeneratedHtml(up.dir, runStartTs);   // 加载执行期间磁盘上生成的 HTML 报告
      await saveHistory();
    } catch (e) {
      setRun(false, '执行失败：' + e.message, 'err');
      $('output').textContent += '\n❌ ' + e.message;
    }
    return;
  }

  const folderText = await folderCollectText(FIELDS, f => document.querySelector(`#formArea .field[data-fkey="${f.key}"]`));
  // 告知模型：文件内容已附上，禁止以「缺少路径/无法访问」为由拒绝
  const folderNote = folderText ? '\n\n# 本地文件说明\n用户已在浏览器端选择了本地待检文件，内容已全文附在上方「### 本地文件：<路径>」小节中（路径为文件名/相对路径形式，浏览器安全机制不提供绝对路径）。你没有访问用户文件系统的能力，请直接基于已附上的文件内容执行 Skill；不要以「缺少文件路径」「无法访问文件」「无法执行本地自查」为由拒绝或要求补充信息。' : '';
  const hasFolderPick = FIELDS.some(f => f.type === 'folder' && !f._hidden && values[f.key]);
  if (hasFolderPick && !folderText) toast(I18N.tr('注意：所选文件均无法读取为文本（可能全是二进制），未附加任何文件内容'));
  const sys = `你是一个执行「Skill」的助手。\n# Skill 名称\n${SKILL.name}\n${SKILL.description ? '# 描述\n' + SKILL.description + '\n' : ''}# 完整指令\n${SKILL.body}${refText}${folderText}${folderNote}`;
  const user = '请根据上述 Skill 指令处理以下输入：\n' +
    Object.entries(values).map(([k, v]) => `【${k}】\n${v}`).join('\n\n') +
    '\n\n直接输出 Skill 要求的最终结果，不要解释执行过程。';
  setRun(true, '正在调用模型…'); $('output').classList.remove('md'); $('output').classList.add('term');
  $('output').textContent = '';
  $('output').setAttribute('data-noi18n', '1');
  try {
    const used = await chat([{ role: 'system', content: sys }, { role: 'user', content: user }], true, c);
    setRun(false, `完成（输出 ${lastResult.length} 字符${used ? ' · ' + used + ' tokens' : ''}）`, 'ok');
    $('btnCopy').disabled = false; $('btnDownload').disabled = false;
    // 结果保持终端原样输出；需要美化可切「渲染」视图
    setResultView('term');
    updateResultActions();
    await saveHistory();
  } catch (e) {
    setRun(false, '执行失败：' + e.message, 'err');
    $('output').textContent = '❌ ' + e.message + '\n\n' + I18N.tr('常见原因：\n1. API 地址不正确（应以 /v1 结尾）\n2. Key 无效或额度不足\n3. 网络无法访问该接口');
  }
}

function setRun(on, text, cls, extra) {
  running = on; $('btnRun').disabled = on;
  $('runDot').className = 'dot ' + (on ? 'run' : cls === 'ok' ? 'ok' : cls === 'err' ? 'err' : '');
  $('runStatus').textContent = I18N.tr(text || (on ? '执行中…' : '待执行'));
  if (on) $('tokenInfo').textContent = ''; else if (extra) $('tokenInfo').textContent = extra;
}

/* OpenAI 兼容 chat，SSE 流式 */
let lastResult = '';
async function chat(messages, stream, c) {
  const res = await fetch(c.base.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + c.key },
    body: JSON.stringify({ model: c.model, messages, stream: !!stream, temperature: 0.7 })
  });
  if (!res.ok) {
    let d = ''; try { d = (await res.json()).error?.message || ''; } catch (e) {}
    throw new Error(`HTTP ${res.status} ${d}`);
  }
  if (!stream) { const j = await res.json(); return j.choices[0].message.content.trim(); }
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '', out = '', used = null;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      const s = line.trim(); if (!s.startsWith('data:')) continue;
      const payload = s.slice(5).trim(); if (payload === '[DONE]') continue;
      try {
        const j = JSON.parse(payload);
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) { out += delta; $('output').textContent = out;
          $('runStatus').textContent = '正在输出… ' + out.length + ' 字符'; }
        if (j.usage) used = j.usage.total_tokens;
      } catch (e) {}
    }
  }
  lastResult = out;
  return used;
}

$('btnCopy').onclick = () => { navigator.clipboard.writeText($('output').textContent); toast('已复制'); };
$('btnDownload').onclick = () => {
  const blob = new Blob([$('output').textContent], { type: 'text/markdown' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = (SKILL ? SKILL.name : 'result') + '-结果.md'; a.click();
};

/* ===== 结果 HTML 单独打开/下载 ===== */
let resultHtml = null, htmlUrl = null, browserHtml = null;

/* 把 HTML 片段补全成可独立打开的完整文档 */
function wrapHtmlFragment(frag) {
  return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">\n</head>\n<body>\n' +
    frag + '\n</body>\n</html>';
}

/* 宽松识别：完整文档 / ```html 代码块 / 明显的 HTML 片段 都算 */
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

/* ===== 结果视图：默认终端（与终端输出完全一致），可选 Markdown 渲染 ===== */
let resultView = 'term';
function setResultView(v) {
  resultView = v;
  $('segTerm').classList.toggle('on', v === 'term');
  $('segMd').classList.toggle('on', v === 'md');
  if (v === 'md') {
    $('output').classList.add('md'); $('output').classList.remove('term');
    $('output').innerHTML = renderMarkdown(lastResult);
  } else {
    $('output').classList.remove('md'); $('output').classList.add('term');
    $('output').textContent = lastResult;
  }
}
$('segTerm').onclick = () => setResultView('term');
$('segMd').onclick = () => setResultView('md');

function updateResultActions() {
  resultHtml = extractHtml(lastResult || '');
  browserHtml = resultHtml;
  $('segBar').classList.toggle('hidden', !lastResult);
  const bFrame = $('browserFrame'), bEmpty = $('browserEmpty');
  if (resultHtml) {
    bFrame.srcdoc = resultHtml; bFrame.style.display = 'block';
    bEmpty.classList.add('hidden');
    $('browserTag').textContent = I18N.tr('已渲染结果页面');
    ['brOpen', 'brDl', 'brSave'].forEach(id => $(id).classList.remove('hidden'));
    toast('检测到 HTML 页面，已在内嵌浏览器中渲染');
  } else {
    bFrame.removeAttribute('srcdoc'); bFrame.style.display = 'none';
    bEmpty.classList.remove('hidden');
    $('browserTag').textContent = I18N.tr('不涉及');
    ['brOpen', 'brDl', 'brSave'].forEach(id => $(id).classList.add('hidden'));
  }
}

/* ===== 内嵌浏览器：加载执行器上真实生成的 HTML 报告文件 ===== */
async function browserLoadLocal(path) {
  try {
    const r = await hostReadFile(path);
    browserHtml = r.text;
    $('browserFrame').srcdoc = r.text;
    $('browserFrame').style.display = 'block';
    $('browserEmpty').classList.add('hidden');
    $('browserTag').textContent = '📄 ' + path.split('/').pop();
    ['brOpen', 'brDl', 'brSave'].forEach(id => $(id).classList.remove('hidden'));
    $('browserSrc').value = path;
  } catch (e) { toast('读取执行器上的 HTML 失败：' + e.message); }
}
/* 执行结束后调用：发现执行期间在技能目录里生成的 .html 文件并挂入来源选择 */
async function loadGeneratedHtml(dir, sinceTs) {
  try {
    const r = await hostFindHtml(dir, sinceTs);
    const files = r.files || [];
    if (!files.length) return;
    const sel = $('browserSrc');
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
    sel.classList.toggle('hidden', sel.options.length < 2);
    if (!resultHtml) await browserLoadLocal(files[0].path);   // 结果无 HTML 时自动加载最新生成的
  } catch (e) { /* 执行器离线等场景静默跳过 */ }
}
$('browserSrc').onchange = () => {
  const v = $('browserSrc').value;
  if (v === '__inline__') {
    browserHtml = resultHtml;
    if (resultHtml) {
      $('browserFrame').srcdoc = resultHtml;
      $('browserFrame').style.display = 'block';
      $('browserEmpty').classList.add('hidden');
      $('browserTag').textContent = I18N.tr('已渲染结果页面');
      ['brOpen', 'brDl', 'brSave'].forEach(id => $(id).classList.remove('hidden'));
    }
  } else if (v) browserLoadLocal(v);
};
/* 打开一个生成出来的 HTML 页面：
   扩展内走 doc.html + 沙箱页（blob 会继承扩展 CSP，页面里的脚本会被拦）；无插件环境直接用 blob */
async function openHtmlPage(html, title) {
  if (!html) return;
  if (HAS_CHROME && chrome.tabs) {
    const { resultDocs = {} } = await chrome.storage.local.get(['resultDocs']);
    const id = uid();
    resultDocs[id] = { html, title: title || '页面', date: Date.now() };
    const keys = Object.keys(resultDocs);
    if (keys.length > 30) keys.slice(0, keys.length - 30).forEach(k => delete resultDocs[k]);
    await chrome.storage.local.set({ resultDocs });
    chrome.tabs.create({ url: chrome.runtime.getURL('doc.html?id=' + id) });
    return;
  }
  if (htmlUrl) URL.revokeObjectURL(htmlUrl);
  htmlUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  window.open(htmlUrl, '_blank');
}

/* 内嵌浏览器栏的操作按钮（browserHtml = 当前预览的 HTML：结果内联或磁盘生成的文件） */
$('brOpen').onclick = async () => {
  if (!browserHtml) return;
  await openHtmlPage(browserHtml, (SKILL ? SKILL.name : '页面') + '-页面');
  toast('已在新标签页打开 HTML 页面');
};
$('brDl').onclick = () => {
  if (!browserHtml) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([browserHtml], { type: 'text/html' }));
  a.download = (SKILL ? SKILL.name : 'result') + '-页面.html'; a.click();
};
$('brSave').onclick = async () => {
  if (!browserHtml) return;
  await addPage({ name: (SKILL ? SKILL.name : '页面') + '-页面', type: 'static', html: browserHtml });
};

/* ===== 独立工具页：界面 → 可单独打开的 HTML 页面 ===== */
/* 资源来源：扩展内 fetch(tool.css / tool.js / tool.html)；独立版由构建脚本注入 window.__TOOL_ASSETS */
async function getToolAssets() {
  if (window.__TOOL_ASSETS) return window.__TOOL_ASSETS;
  const base = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL('') : '';
  const get = p => fetch(base + p).then(r => r.text());
  const [css, js, shell, i18n] = await Promise.all([get('tool.css'), get('tool.js'), get('tool.html'), get('i18n.js')]);
  window.__TOOL_ASSETS = { css, js, shell, i18n };
  return window.__TOOL_ASSETS;
}

function toolPayload(skill, fields, cfg, includeKey) {
  return JSON.stringify({
    name: skill.name,
    description: skill.description || '',
    body: skill.body || '',
    refs: (skill.refs || []).filter(r => !r.skipped && r.content)
      .map(r => ({ name: r.name, content: String(r.content).slice(0, 8000) })),
    fields: fields.map(f => ({ key: f.key, label: f.label || f.key, type: f.type || 'text', hint: f.hint || '',
      options: f.options || null, showIf: f.showIf ? { key: f.showIf.key, values: [...f.showIf.values] } : null })),
    cfg: { base: cfg.base || '', model: cfg.model || '', key: includeKey ? (cfg.key || '') : '' }
  }).replace(/</g, '\\u003c');
}

/* 把 tool.html 的 body 抽出来（保证单文件版与扩展页完全同构） */
function toolBody(shell) {
  const s = shell.indexOf('<body>');
  let e = shell.indexOf('<script src="i18n.js">');
  if (e < 0) e = shell.indexOf('<script src="tool.js">');
  return (s >= 0 && e > s ? shell.slice(s + 6, e) : '').trim();
}

/* 生成可直接双击打开的单文件页面 */
async function buildToolPage(skill, fields, cfg, includeKey) {
  const { css, js, shell, i18n } = await getToolAssets();
  const payload = toolPayload(skill, fields, cfg, includeKey);
  const safeJs = String(js).replace(/<\/script/gi, '<\\/script');
  const safeI18n = String(i18n || '').replace(/<\/script/gi, '<\\/script');
  const lang = (window.I18N && I18N.getLang()) || 'zh';
  return '<!DOCTYPE html>\n<html lang="' + (lang === 'zh' ? 'zh-CN' : 'en') + '">\n<head>\n<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    '<title>' + escapeHtml(skill.name) + ' · Skill 工具</title>\n<style>\n' + css + '\n</style>\n</head>\n' +
    toolBody(shell) +
    '\n<script>window.SKILL_PAYLOAD = ' + payload + ';</' + 'script>\n' +
    '<script>\n' + safeI18n + '\n</' + 'script>\n' +
    '<script>\n' + safeJs + '\n</' + 'script>\n</body>\n</html>\n';
}

/* 在新标签页打开当前界面 */
$('btnOpenPage').onclick = async () => {
  if (!SKILL || !FIELDS.length) { toast('请先生成界面'); return; }
  const cfg = await getCfg();
  const payload = JSON.parse(toolPayload(SKILL, FIELDS, cfg, true));

  if (HAS_CHROME && chrome.tabs) {
    // 扩展内：存 payload 后打开真正的扩展页（blob 页面会继承扩展 CSP，内联脚本会被拦）
    const { toolPages = {} } = await chrome.storage.local.get(['toolPages']);
    const id = uid();
    toolPages[id] = payload;
    const keys = Object.keys(toolPages);
    if (keys.length > 20) keys.slice(0, keys.length - 20).forEach(k => delete toolPages[k]);
    await chrome.storage.local.set({ toolPages });
    chrome.tabs.create({ url: chrome.runtime.getURL('tool.html?id=' + id) });
    toast('已在新标签页打开独立界面（可直接执行）');
    return;
  }

  try {
    const html = await buildToolPage(SKILL, FIELDS, cfg, true);
    const w = window.open(URL.createObjectURL(new Blob([html], { type: 'text/html' })), '_blank');
    if (!w) toast('浏览器拦截了新标签页，请允许弹窗后重试');
    else toast('已在新标签页打开独立界面');
  } catch (e) { toast('打开失败：' + e.message); }
};

/* 导出 / 下载界面 HTML（不含 Key） */
$('btnDlPage').onclick = async () => {
  if (!SKILL || !FIELDS.length) { toast('请先生成界面'); return; }
  const cfg = await getCfg();
  try {
    const html = await buildToolPage(SKILL, FIELDS, cfg, false);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    a.download = (SKILL.name || 'skill') + '-界面.html'; a.click();
    toast('已下载单文件界面（为安全未包含 API Key）');
  } catch (e) { toast('导出失败：' + e.message); }
};

/* ===== 轻量 Markdown 渲染（表格/代码块/列表/标题） ===== */
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
      html += `<h${l}>` + inline(line.replace(/^#+\s*/, '')) + `</h${l}>`; continue;
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

/* ===== 生成历史 ===== */
async function saveHistory() {
  try {
    const entry = {
      id: uid(), skillName: SKILL.name, skillRaw: SKILL.raw, refs: SKILL.refs,
      fieldsSchema: FIELDS.map(f => { const { _hidden, ...rest } = f; return rest; }), values: window._lastValues || {},
      result: lastResult.slice(0, 200000), isHtml: !!resultHtml, html: resultHtml || '',
      mode: mode || 'heuristic', date: Date.now()
    };
    const { history = [] } = await store.get(['history']);
    history.unshift(entry);
    if (history.length > 50) history.length = 50;
    await store.set({ history });
    renderHistory();
  } catch (e) {
    console.error('历史保存失败', e);
    toast('⚠️ 历史保存失败：' + (e.message || e));
  }
}

async function renderHistory() {
  const { history = [] } = await store.get(['history']);
  $('histCount').textContent = history.length ? history.length + ' 条' : '';
  const list = $('histList');
  if (!history.length) {
    list.innerHTML = '<p style="font-size:12px;color:var(--text-3)">还没有生成记录。执行成功后会自动保存（保留最近 50 条），点击任意记录可查看页面、或用当时的 Skill 和参数重新生成。</p>';
    return;
  }
  list.innerHTML = '';
  history.forEach(h => {
    const d = document.createElement('div'); d.className = 'hist-item';
    d.innerHTML = `<span>${h.isHtml ? '🌐' : '📄'}</span>
      <span class="n">${escapeHtml(h.skillName)}</span>
      <span class="badge ${h.isHtml ? 'html' : 'text'}">${h.isHtml ? 'HTML' : '文本'}</span>
      <span class="d">${new Date(h.date).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
      <span class="del" title="删除">✕</span>`;
    d.addEventListener('click', e => { if (e.target.classList.contains('del')) return; openViewer(h.id); });
    d.querySelector('.del').addEventListener('click', async e => {
      e.stopPropagation();
      await store.set({ history: history.filter(x => x.id !== h.id) });
      renderHistory(); toast('已删除该条记录');
    });
    list.appendChild(d);
  });
}

/* ===== 结果查看器 + 重新生成 ===== */
let viewerEntry = null;
async function openViewer(id) {
  const { history = [] } = await store.get(['history']);
  const h = history.find(x => x.id === id); if (!h) return;
  viewerEntry = h;
  $('vwTitle').textContent = h.skillName;
  $('vwMeta').textContent = new Date(h.date).toLocaleString('zh-CN') + ' · ' + (h.isHtml ? 'HTML 页面' : '文本结果');
  const body = $('vwBody'); body.innerHTML = '';
  body.setAttribute('data-noi18n', '1');   // 查看器内容是 LLM 产物，不参与界面翻译
  if (h.isHtml) {
    const ifr = document.createElement('iframe');
    ifr.setAttribute('sandbox', 'allow-scripts');
    ifr.srcdoc = h.html; ifr.className = 'vw-frame';
    body.style.padding = '0';
    body.appendChild(ifr);
    $('vwOpen').classList.remove('hidden');
    $('vwSavePage').classList.remove('hidden');
  } else {
    body.style.padding = '16px';
    const div = document.createElement('div');
    div.innerHTML = renderMarkdown(h.result);
    body.appendChild(div);
    $('vwOpen').classList.add('hidden');
    $('vwSavePage').classList.add('hidden');
  }
  $('viewer').classList.remove('hidden');
}
function closeViewer() { $('viewer').classList.add('hidden'); viewerEntry = null; }
$('vwClose').onclick = closeViewer;
$('viewer').addEventListener('click', e => { if (e.target === $('viewer')) closeViewer(); });
$('vwOpen').onclick = () => {
  if (!viewerEntry || !viewerEntry.html) return;
  openHtmlPage(viewerEntry.html, viewerEntry.skillName + '-页面');
};
$('vwDownload').onclick = () => {
  if (!viewerEntry) return;
  const isH = viewerEntry.isHtml;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([isH ? viewerEntry.html : viewerEntry.result],
    { type: isH ? 'text/html' : 'text/markdown' }));
  a.download = viewerEntry.skillName + '-结果.' + (isH ? 'html' : 'md'); a.click();
};
$('vwRegen').onclick = () => {
  if (!viewerEntry) return;
  const h = viewerEntry;
  closeViewer();
  currentSkillId = null;
  loadSkill(h.skillRaw, h.refs || [], h.skillName);
  FIELDS = (h.fieldsSchema || []).map(f => ({ ...f }));
  mode = h.mode || 'heuristic';
  renderForm();
  FIELDS.forEach(f => {
    const el = document.querySelector(`[data-key="${f.key}"]`);
    if (el && h.values && h.values[f.key] != null) el.value = h.values[f.key];
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
  toast('已载入当时的 Skill 与界面，参数已回填，可修改后重新执行');
};

/* ===== 我的页面：保存生成的界面/结果页面，一键直达，可管理 ===== */
async function getPages() { const { pages = [] } = await store.get(['pages']); return pages; }
async function savePages(list) { await store.set({ pages: list.slice(0, 100) }); }

async function addPage(entry) {
  try {
    const pages = await getPages();
    // 同名同类型则覆盖更新（保留原 id 与位置）
    const i = pages.findIndex(p => p.name === entry.name && p.type === entry.type);
    entry.id = i >= 0 ? pages[i].id : uid();
    entry.date = Date.now();
    if (i >= 0) pages[i] = entry; else pages.unshift(entry);
    await savePages(pages);
    renderPages();
    toast(i >= 0 ? '已更新「我的页面」中的同名页面' : '已存入「我的页面」，下次点击即可直接使用');
    return entry;
  } catch (e) {
    console.error('页面保存失败', e);
    toast('⚠️ 页面保存失败：' + (e.message || e));
  }
}

async function deletePage(id) {
  await savePages((await getPages()).filter(p => p.id !== id));
  renderPages(); toast('已删除该页面');
}

async function openPageEntry(p) {
  if (p.type === 'static') {
    if (HAS_CHROME && chrome.tabs) { chrome.tabs.create({ url: chrome.runtime.getURL('doc.html?id=' + p.id) }); return; }
    window.open(URL.createObjectURL(new Blob([p.html], { type: 'text/html' })), '_blank');
    return;
  }
  // tool 页面：扩展内打开 tool.html?id=；独立版现场构建单文件页
  if (HAS_CHROME && chrome.tabs) { chrome.tabs.create({ url: chrome.runtime.getURL('tool.html?id=' + p.id) }); return; }
  try {
    const cfg = await getCfg();
    const html = await buildToolPage(
      { name: p.name, description: p.payload.description, body: p.payload.body, refs: p.payload.refs },
      p.payload.fields, cfg, true);
    window.open(URL.createObjectURL(new Blob([html], { type: 'text/html' })), '_blank');
  } catch (e) { toast('打开失败：' + e.message); }
}

async function renderPages() {
  const pages = await getPages();
  $('pageCount').textContent = pages.length ? pages.length + ' 个' : '';
  const list = $('pageList');
  if (!pages.length) {
    list.innerHTML = '<p style="font-size:12px;color:var(--text-3)">还没有保存的页面。把生成的界面或结果里的 HTML 页面「存入我的页面」，下次在这里（或插件弹窗）点击即可直接打开使用。</p>';
    return;
  }
  list.innerHTML = '';
  pages.forEach(p => {
    const d = document.createElement('div'); d.className = 'hist-item page-item';
    d.innerHTML = `<span>${p.type === 'tool' ? '🧩' : '🌐'}</span>
      <span class="n" title="点击可重命名">${escapeHtml(p.name)}</span>
      <span class="badge ${p.type === 'tool' ? 'tool' : 'html'}">${p.type === 'tool' ? '工具页' : '网页'}</span>
      <span class="d">${new Date(p.date).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
      <span class="del" title="删除">✕</span>`;
    d.addEventListener('click', async e => {
      if (e.target.classList.contains('del') || e.target.isContentEditable) return;
      openPageEntry(p);
    });
    d.querySelector('.n').addEventListener('dblclick', async e => {
      e.stopPropagation();
      const el = e.target; el.contentEditable = 'true'; el.focus();
      document.execCommand && document.getSelection().selectAllChildren(el);
      const done = async ok => {
        el.contentEditable = 'false';
        const nv = el.textContent.trim();
        if (ok && nv && nv !== p.name) {
          p.name = nv;
          const pages = await getPages();
          const it = pages.find(x => x.id === p.id);
          if (it) { it.name = nv; await savePages(pages); }
          toast('已重命名为「' + nv + '」');
        }
        renderPages();
      };
      el.addEventListener('blur', () => done(true), { once: true });
      el.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); }
        if (ev.key === 'Escape') { el.textContent = p.name; el.blur(); }
      });
    });
    d.querySelector('.del').addEventListener('click', async e => {
      e.stopPropagation(); await deletePage(p.id);
    });
    list.appendChild(d);
  });
}

/* 保存入口 ①：把当前生成的工具界面存入 */
$('btnSavePage').onclick = async () => {
  if (!SKILL || !FIELDS.length) { toast('请先生成界面'); return; }
  const cfg = await getCfg();
  await addPage({
    name: SKILL.name || '未命名工具页', type: 'tool',
    payload: JSON.parse(toolPayload(SKILL, FIELDS, cfg, false))
  });
};

/* 保存入口 ②：内嵌浏览器栏的「存入我的页面」（见 brSave） */

/* 保存入口 ③：历史查看器里的 HTML 存入 */
$('vwSavePage').onclick = async () => {
  if (!viewerEntry || !viewerEntry.html) return;
  closeViewer();
  await addPage({ name: viewerEntry.skillName + '-页面', type: 'static', html: viewerEntry.html });
};

$('pageRefresh').onclick = async () => { await renderPages(); toast('页面列表已刷新'); };

/* 配置自动保存 */
['cfgBase', 'cfgKey', 'cfgModel'].forEach(id => $(id).addEventListener('change', saveCfg));

/* ===== 示例 Skill ===== */
const DEMO_SKILL = `---
name: weekly-report
description: 把本周零散的工作记录整理成一份结构清晰的周报，风格可调。
---

# 周报生成器

你是一位专业的职场写作助手。请把用户提供的本周工作素材整理成一份周报。

## 要求
1. 结构分为：本周成果、数据亮点、问题与风险、下周计划 四个部分
2. 成果使用"动词开头 + 具体结果"的句式，突出价值而非流水账
3. 如有数字，提炼为 1-2 个数据亮点
4. 总长度控制在 400 字以内

## 输入参数
- work: 本周工作记录，杂乱无序也没关系
- issues: 遇到的问题或风险，可为空
- plan: 下周计划
- tone: 周报语气，正式 / 轻松 / 简洁

## 输出
直接输出整理好的周报全文。

{{work}} {{issues}} {{plan}} {{tone}}`;
