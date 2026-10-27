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

/* ===== 界面生成 ===== */
function renderForm() {
  const area = $('formArea'); area.className = ''; area.style.cssText = ''; area.innerHTML = '';
  if (!FIELDS.length) { area.innerHTML = '<p style="color:var(--text-3)">暂无字段。</p>'; return; }
  FIELDS.forEach(f => {
    const d = document.createElement('div'); d.className = 'field';
    let ctrl;
    if (f.type === 'select') {
      ctrl = document.createElement('select');
      (f.options && f.options.length ? f.options : ['默认']).forEach(o => {
        const op = document.createElement('option'); op.value = op.textContent = o; ctrl.appendChild(op); });
    } else if (f.type === 'textarea') {
      ctrl = document.createElement('textarea'); ctrl.style.minHeight = '80px';
    } else if (f.type === 'checkbox') {
      ctrl = document.createElement('input'); ctrl.type = 'checkbox'; ctrl.style.width = 'auto';
      const wrap = document.createElement('label');
      wrap.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--text-2);cursor:pointer';
      wrap.appendChild(ctrl);
      wrap.appendChild(document.createTextNode('启用'));
      ctrl.dataset.key = f.key;
      d.innerHTML = `<div class="fl">${escapeHtml(f.label || f.key)}
        <span class="fk">${escapeHtml(f.key)}</span></div>` +
        (f.hint ? `<div class="hint">${escapeHtml(f.hint)}</div>` : '');
      d.appendChild(wrap); area.appendChild(d);
      return;
    } else {
      ctrl = document.createElement('input');
      ctrl.type = { number: 'number', date: 'date', email: 'email', url: 'url' }[f.type] || 'text';
    }
    if (f.placeholder) ctrl.placeholder = f.placeholder;
    ctrl.dataset.key = f.key;
    d.innerHTML = `<div class="fl">${escapeHtml(f.label || f.key)} <span class="req">必填</span>
      <span class="fk">${escapeHtml(f.key)}</span></div>` +
      (f.hint ? `<div class="hint">${escapeHtml(f.hint)}</div>` : '');
    d.appendChild(ctrl); area.appendChild(d);
  });
  // 右键导入的执行内容自动填入
  if (window._pendingExec) {
    const firstText = FIELDS.find(f => f.type === 'textarea') || FIELDS[0];
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
  $('formTag').textContent = I18N.tr(`${FIELDS.length} 个字段 · ${mode === 'ai' ? 'AI 设计' : mode === 'manual' ? '手动' : '自动解析'}`);
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
  const type = prompt('类型：text / textarea / number / select', 'text'); if (!type) return;
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
    '只输出 JSON 数组，不要任何其他文字。每个元素：{"key":"英文变量名","label":"中文显示名","type":"text|textarea|number|select|date|checkbox","hint":"一句中文填写提示","options":["select 时的选项"]}。' +
    '字段 2-6 个，覆盖该 Skill 运行所需的全部输入；按语义选择类型：长文本用 textarea，有限选项用 select，日期用 date，是/否开关用 checkbox，数量用 number。';
  const user = `Skill 名称：${SKILL.name}\n描述：${SKILL.description}\n\n正文：\n${SKILL.body.slice(0, 8000)}${refsText}`;
  setRun(true, 'AI 正在分析 Skill 并设计界面…');
  try {
    const text = await chat([{ role: 'system', content: sys }, { role: 'user', content: user }], false, c);
    const j = JSON.parse(text.replace(/^```(json)?|```$/g, '').trim());
    if (!Array.isArray(j) || !j.length) throw new Error('返回格式异常');
    FIELDS = j.map(f => ({ key: f.key, label: f.label || f.key, type: f.type || 'text', hint: f.hint || '', options: f.options || null }));
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
  $('output').textContent = I18N.tr('执行结果将在这里流式输出…');
  $('btnOpenPage').disabled = true; $('btnDlPage').disabled = true; $('btnSavePage').disabled = true;
};

async function run() {
  if (running) return;
  const c = await getCfg();
  if (!c.base || !c.key || !c.model) { toast('请先填写模型配置'); return; }
  const values = {};
  for (const f of FIELDS) {
    const el = document.querySelector(`[data-key="${f.key}"]`);
    if (f.type === 'checkbox') { values[f.key] = el && el.checked ? '是' : '否'; continue; }
    const v = (el ? el.value.trim() : '');
    if (!v) { toast(`请填写「${f.label || f.key}」`); el && el.focus(); return; }
    values[f.key] = v;
  }
  window._lastValues = values;
  const refText = SKILL.refs.filter(r => !r.skipped && r.content)
    .map(r => `\n\n### 参考文件：${r.name}\n${r.content.slice(0, 8000)}`).join('');
  const sys = `你是一个执行「Skill」的助手。\n# Skill 名称\n${SKILL.name}\n${SKILL.description ? '# 描述\n' + SKILL.description + '\n' : ''}# 完整指令\n${SKILL.body}${refText}`;
  const user = '请根据上述 Skill 指令处理以下输入：\n' +
    Object.entries(values).map(([k, v]) => `【${k}】\n${v}`).join('\n\n') +
    '\n\n直接输出 Skill 要求的最终结果，不要解释执行过程。';
  setRun(true, '正在调用模型…'); $('output').classList.remove('md'); $('output').textContent = '';
  $('output').setAttribute('data-noi18n', '1');
  try {
    const used = await chat([{ role: 'system', content: sys }, { role: 'user', content: user }], true, c);
    setRun(false, 'ok', `完成（输出 ${lastResult.length} 字符${used ? ' · ' + used + ' tokens' : ''}）`);
    $('btnCopy').disabled = false; $('btnDownload').disabled = false;
    updateResultActions();
    // 非 HTML 结果用 markdown 渲染（表格/代码块/列表）
    if (!resultHtml) { $('output').classList.add('md'); $('output').innerHTML = renderMarkdown(lastResult); }
    await saveHistory();
  } catch (e) {
    setRun(false, 'err', '执行失败：' + e.message);
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
let resultHtml = null, htmlUrl = null;

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

function setResultSeg(preview) {
  $('segPreview').classList.toggle('on', preview);
  $('segCode').classList.toggle('on', !preview);
  $('outPreviewWrap').classList.toggle('hidden', !preview);
  $('output').classList.toggle('hidden', preview);
}

function updateResultActions() {
  resultHtml = extractHtml(lastResult || $('output').textContent || '');
  ['btnOpenHtml', 'btnDlHtml', 'segBar', 'btnSaveHtmlPage'].forEach(id => $(id).classList.toggle('hidden', !resultHtml));
  if (resultHtml) {
    $('outPreview').srcdoc = resultHtml;
    setResultSeg(true);
    toast('检测到 HTML 页面，已渲染预览，可单独打开');
  } else {
    $('outPreviewWrap').classList.add('hidden');
    $('output').classList.remove('hidden');
  }
}
$('segPreview').onclick = () => setResultSeg(true);
$('segCode').onclick = () => setResultSeg(false);
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

$('btnOpenHtml').onclick = async () => {
  if (!resultHtml) return;
  await openHtmlPage(resultHtml, (SKILL ? SKILL.name : '页面') + '-页面');
  toast('已在新标签页打开 HTML 页面');
};
$('btnDlHtml').onclick = () => {
  if (!resultHtml) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([resultHtml], { type: 'text/html' }));
  a.download = (SKILL ? SKILL.name : 'result') + '-页面.html'; a.click();
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
    fields: fields.map(f => ({ key: f.key, label: f.label || f.key, type: f.type || 'text', hint: f.hint || '', options: f.options || null })),
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
      fieldsSchema: FIELDS.map(f => ({ ...f })), values: window._lastValues || {},
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

/* 保存入口 ②：把执行结果里的 HTML 页面存入 */
$('btnSaveHtmlPage').onclick = async () => {
  if (!resultHtml) return;
  await addPage({ name: (SKILL ? SKILL.name : '页面') + '-页面', type: 'static', html: resultHtml });
};

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
