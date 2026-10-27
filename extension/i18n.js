/* Skill 工坊 · 中英文双语（i18n）
   用法：
     I18N.tr('中文文案')            → 当前语言下的文案（动态消息用）
     I18N.apply(root)               → 翻译 root 下所有文本节点 / placeholder / title
     I18N.setLang('zh' | 'en')      → 切换语言（持久化 + 自动重译 + 触发 i18n:change 事件）
   说明：只翻译界面 chrome；Skill 自己的字段名、提示、LLM 输出属于内容，保持原样。 */
(function () {
  const DICT = {
    /* ===== 独立版专属 ===== */
    'Skill 工坊 · 独立版': 'Skill Forge · Standalone',
    '独立版：双击打开即用，无需安装插件 · 上传任意 SKILL.md → 生成界面 → 单独打开为 HTML 页面':
      'Standalone build: open by double-click, no install needed · Upload any SKILL.md → build a UI → open it as an HTML page',
    'OpenAI 兼容接口（OpenAI / DeepSeek / Kimi / Ollama 等）· 独立版数据存于浏览器 localStorage':
      'OpenAI-compatible API (OpenAI / DeepSeek / Kimi / Ollama …) · standalone data is kept in this browser’s localStorage',

    /* ===== 工作台 header / 步骤 ===== */
    'Skill 工坊 · 工作台': 'Skill Forge · Workbench',
    '上传任意 SKILL.md → 自动生成适配界面 → 填参数调用 LLM 执行':
      'Upload any SKILL.md → auto-generate a matching UI → fill it in and run with an LLM',
    '1 上传 Skill': '1 Upload',
    '2 生成界面': '2 Build UI',
    '3 执行': '3 Run',

    /* ===== 横幅 / 提示 ===== */
    '📥 网页选中内容已导入（来自右键「存入 Skill 工坊」）':
      '📥 Selected page content imported (via right-click “Save to Skill Forge”)',
    '解析并存入技能库': 'Parse & save to library',
    '▶ 网页选中内容已导入（来自右键「执行选中内容」），加载 Skill 后会自动填入':
      '▶ Selected page content imported (via right-click “Run with Skill”). It will be filled in once a Skill is loaded',
    '⚠️ 当前环境拦截了浏览器本地存储（常见于内嵌预览面板），数据':
      '⚠️ This environment blocks browser local storage (common in embedded preview panes). Data is',
    '仅本次会话有效': 'valid for this session only',
    '，刷新后会丢失。请用浏览器直接打开本文件，或安装浏览器插件版以永久保存。':
      ', and will be lost on refresh. Open this file directly in a browser, or install the extension to persist data.',

    /* ===== 技能库 ===== */
    '📚 技能库': '📚 Skill Library',
    '还没有保存的 Skill。上传后点「存入技能库」，或在网页中选中 SKILL.md 内容右键保存。':
      'No saved Skills yet. Upload one and click “Save to library”, or select SKILL.md content on a web page and use the right-click menu.',
    '还没有保存的 Skill': 'No saved Skills yet',
    '技能库': 'Skill Library',
    '💾 存入技能库': '💾 Save to library',
    '🔄 更新技能库': '🔄 Update library',
    '查看原文': 'View source',

    /* ===== 上传 ===== */
    '① 上传 Skill': '① Upload Skill',
    '支持 .md / 文件夹': '.md / folder supported',
    '拖拽': 'Drag',
    '技能压缩包 .zip': 'skill package .zip',
    '/ 文件夹到这里，或点击选择': '/ folder here, or click to select',
    '选择文件 / .zip': 'Choose files / .zip',
    '选择文件夹': 'Choose folder',
    '试用示例': 'Try a sample',
    '或直接粘贴': 'or paste directly',
    '解析粘贴内容': 'Parse pasted content',
    '把 SKILL.md 完整内容粘贴到这里…': 'Paste the full SKILL.md here…',
    '⚡ 生成界面': '⚡ Build UI',

    /* ===== 模型配置 ===== */
    '⚙ 模型配置': '⚙ Model Settings',
    '存于插件本地存储': 'stored in the extension',
    '存于本机浏览器': 'stored in this browser',
    'OpenAI 兼容接口（OpenAI / DeepSeek / Kimi / Ollama 等）':
      'OpenAI-compatible API (OpenAI / DeepSeek / Kimi / Ollama …)',
    'OpenAI 兼容接口（只存在本机浏览器）': 'OpenAI-compatible API (kept in this browser only)',
    'API 地址（Base URL，以 /v1 结尾）': 'API base URL (ends with /v1)',
    'API 地址（以 /v1 结尾）': 'API base URL (ends with /v1)',
    '模型名称': 'Model name',
    '🤖 AI 智能设计界面': '🤖 AI-designed UI',
    '✏ 手动补字段': '✏ Add fields manually',

    /* ===== 生成的界面 ===== */
    '② 生成的工具界面': '② Generated Tool UI',
    '尚未生成': 'not built yet',
    '上传并解析 Skill 后点击「生成界面」': 'Upload and parse a Skill, then click “Build UI”',
    '▶ 用 LLM 执行此 Skill': '▶ Run this Skill with an LLM',
    '清空': 'Clear',
    '🌐 新标签页打开此界面': '🌐 Open this UI in a new tab',
    '⬇ 保存为 .html': '⬇ Save as .html',
    '📥 存入我的页面': '📥 Save to My Pages',
    '把当前这个界面打包成一个独立 HTML 工具页，在新标签页单独打开':
      'Package this UI as a standalone HTML tool page and open it in a new tab',
    '下载为单文件 HTML，可双击打开、发给别人':
      'Download a single-file HTML that opens on double-click and can be shared',
    '保存到「我的页面」，下次一键打开直接用': 'Save to My Pages for one-click reuse later',

    /* ===== 执行结果 ===== */
    '③ 执行结果': '③ Result',
    '执行结果': 'Result',
    '待执行': 'Idle',
    '🖼 页面预览': '🖼 Preview',
    '⌨ 源码': '⌨ Source',
    '页面预览': 'Preview',
    '执行结果将在这里流式输出…': 'The result will stream here…',
    '复制结果': 'Copy result',
    '复制': 'Copy',
    '下载 .md': 'Download .md',
    '🌐 单独打开为 HTML 页面': '🌐 Open as HTML page',
    '🌐 新标签页打开页面': '🌐 Open page in a new tab',
    '下载 .html': 'Download .html',
    '⬇ 下载 .html': '⬇ Download .html',
    '🧾 查看源码': '🧾 View source',

    /* ===== 生成历史 ===== */
    '🗂 生成历史': '🗂 Run History',
    '还没有生成记录。执行成功后会自动保存（保留最近 50 条），点击任意记录可查看页面、或用当时的 Skill 和参数重新生成。':
      'No runs yet. Successful runs are saved automatically (last 50). Click a record to view its page, or regenerate with the same Skill and inputs.',
    '刷新历史': 'Refresh history',
    '清空全部历史': 'Clear all history',
    '🔄 重新生成': '🔄 Regenerate',
    '🌐 新标签页打开': '🌐 Open in a new tab',
    '⬇ 下载': '⬇ Download',
    '✕ 关闭': '✕ Close',
    'HTML': 'HTML',
    '文本': 'Text',

    /* ===== 我的页面 ===== */
    '🧩 我的页面': '🧩 My Pages',
    '还没有保存的页面。把生成的界面或结果里的 HTML 页面「存入我的页面」，下次在这里（或插件弹窗）点击即可直接打开使用。':
      'No saved pages yet. Store a generated UI or an HTML result into “My Pages”, then open it here (or from the popup) with one click.',
    '还没有保存的页面': 'No saved pages yet',
    '刷新列表': 'Refresh list',
    '工具页': 'Tool',
    '网页': 'Web page',

    /* ===== 工具页（tool.html） ===== */
    'Skill 工具': 'Skill Tool',
    'Skill 工坊 · 独立页面': 'Skill Forge · standalone page',
    '输入参数': 'Inputs',
    '▶ 执行': '▶ Run',
    '← 回到工坊': '← Back to Forge',

    /* ===== 弹窗（popup） ===== */
    '⚒ Skill 工坊': '⚒ Skill Forge',
    '上传 Skill → 生成界面 → 调用 LLM 执行': 'Upload a Skill → build a UI → run it with an LLM',
    '⚒ 打开工作台': '⚒ Open workbench',
    '⚙ 模型配置 ': '⚙ Model settings ',
    '小技巧：在网页里': 'Tip: on any web page, ',
    '选中 SKILL.md 全文': 'select the full SKILL.md',
    '，右键「存入 Skill 工坊」即可保存；选中任意内容可右键直接送入执行。':
      ', right-click “Save to Skill Forge”. Select any other content and right-click to run it directly.'
  };

  /* 不带变量、但由脚本动态填入的文案 */
  const EXACT_EXTRA = {
    '执行中…': 'Running…',
    '正在调用模型…': 'Calling the model…',
    'AI 正在分析 Skill 并设计界面…': 'AI is analysing the Skill and designing the UI…',
    '执行失败': 'Run failed',
    '已复制': 'Copied',
    '已复制到剪贴板': 'Copied to clipboard',
    '历史已刷新': 'History refreshed',
    '页面列表已刷新': 'Page list refreshed',
    '已清空全部历史': 'All history cleared',
    '已删除该条记录': 'Record deleted',
    '已删除该页面': 'Page deleted',
    '已更新「我的页面」中的同名页面': 'Updated the existing page with the same name',
    '已存入「我的页面」，下次点击即可直接使用': 'Saved to My Pages — click it next time to use',
    '已在新标签页打开独立界面': 'Opened the standalone UI in a new tab',
    '已在新标签页打开独立界面（可直接执行）': 'Opened the standalone UI in a new tab (ready to run)',
    '已在新标签页打开 HTML 页面': 'Opened the HTML page in a new tab',
    '已下载单文件界面（为安全未包含 API Key）': 'Single-file UI downloaded (API Key excluded for safety)',
    '已载入当时的 Skill 与界面，参数已回填，可修改后重新执行':
      'Loaded that run’s Skill and UI with inputs restored — edit and run again',
    '已解析并存入技能库，可继续生成界面': 'Parsed and saved to the library — you can build the UI now',
    '未找到 SKILL.md、Markdown 或 .zip 文件': 'No SKILL.md, Markdown or .zip file found',
    '压缩包里没有找到 SKILL.md': 'No SKILL.md found in the package',
    '内容太短，请粘贴完整 SKILL.md': 'Content too short — please paste the full SKILL.md',
    '未发现 {{占位符}}，已生成通用任务输入框': 'No {{placeholders}} found — a generic task input was created',
    '浏览器拦截了新标签页，请允许弹窗后重试': 'The browser blocked the new tab — allow pop-ups and retry',
    '请先上传并解析 Skill': 'Upload and parse a Skill first',
    '请先填写模型配置': 'Fill in the model settings first',
    '请先在下方填写模型配置': 'Fill in the model settings below first',
    '请先生成界面': 'Build the UI first',
    '技能不存在或已删除': 'This Skill no longer exists',
    '检测到 HTML 页面，已渲染预览，可单独打开':
      'HTML page detected — preview rendered, you can open it standalone',
    '没有找到要展示的界面数据。': 'No UI data to display.',
    '没有找到页面内容。': 'Page content not found.',
    '请先填写模型配置（地址 / Key / 模型）': 'Fill in the model settings first (URL / Key / model)',
    '填写提示': 'Hint',
    '模型配置：': 'Model settings: ',
    '已就绪': 'ready',
    '未完成': 'not configured',
    '启 用': 'Enable',
    '启用': 'Enable',
    '个字段': 'fields',
    '已解析': 'Parsed',
    'AI 设计': 'AI-designed',
    '手动': 'manual',
    '自动解析': 'auto-parsed',
    '执行结果将在这里流式输出…': 'The result will stream here…',
    '常见原因：\n1. API 地址不正确（应以 /v1 结尾）\n2. Key 无效或额度不足\n3. 网络无法访问该接口':
      'Common causes:\n1. The API URL is wrong (must end with /v1)\n2. Invalid Key or quota exhausted\n3. The endpoint is unreachable from this browser',
    '常见原因：接口地址需以 /v1 结尾；Key 无效或额度不足；浏览器跨域限制。':
      'Common causes: the API URL must end with /v1; invalid Key or quota exhausted; browser CORS restrictions.'
  };

  /* 带变量的动态文案 */
  const PATTERNS = [
    [/^(\d+) 个$/, (m) => m[1]],
    [/^(\d+) 条$/, (m) => m[1] + (m[1] === '1' ? ' item' : ' items')],
    [/^(\d+) 个字段$/, (m) => m[1] + (m[1] === '1' ? ' field' : ' fields')],
    [/^Skill 解析完成：(.*)$/, (m) => 'Skill parsed: ' + m[1]],
    [/^已存入技能库：(.*)$/, (m) => 'Saved to library: ' + m[1]],
    [/^已删除：(.*)$/, (m) => 'Deleted: ' + m[1]],
    [/^请填写「(.*)」$/, (m) => 'Please fill in “' + m[1] + '”'],
    [/^已生成 (\d+) 个字段的界面$/, (m) => 'Generated a form with ' + m[1] + ' field(s)'],
    [/^AI 设计了 (\d+) 个字段的界面$/, (m) => 'AI designed a UI with ' + m[1] + ' field(s)'],
    [/^多技能包：已批量导入 (\d+) 个 Skill 到技能库，当前加载第 1 个$/,
      (m) => 'Multi-skill package: imported ' + m[1] + ' Skills into the library, loading the first one'],
    [/^压缩包解析完成：(.*)$/, (m) => 'Package parsed: ' + m[1]],
    [/^含 (\d+) 个附带文件$/, (m) => m[1] + ' attachment(s)'],
    [/^完成（输出 (\d+) 字符(.*)）$/, (m) => 'Done (' + m[1] + ' chars' + m[2] + ')'],
    [/^完成（(\d+) 字符）$/, (m) => 'Done (' + m[1] + ' chars)'],
    [/^正在输出… (\d+) 字符$/, (m) => 'Streaming… ' + m[1] + ' chars'],
    [/^正在解压 (.*) …$/, (m) => 'Extracting ' + m[1] + ' …'],
    [/^执行失败：(.*)$/, (m) => 'Run failed: ' + m[1]],
    [/^已重命名为「(.*)」$/, (m) => 'Renamed to “' + m[1] + '”'],
    [/^已添加字段 (.*)$/, (m) => 'Field added: ' + m[1]],
    [/^AI 生成失败：(.*)$/, (m) => 'AI generation failed: ' + m[1]],
    [/^压缩包解析失败：(.*)$/, (m) => 'Package parse failed: ' + m[1]],
    [/^导出失败：(.*)$/, (m) => 'Export failed: ' + m[1]],
    [/^打开失败：(.*)$/, (m) => 'Open failed: ' + m[1]],
    [/^历史保存失败：(.*)$/, (m) => 'History save failed: ' + m[1]],
    [/^页面保存失败：(.*)$/, (m) => 'Page save failed: ' + m[1]],
    [/^已把网页选中内容填入「(.*)」$/, (m) => 'Filled the selected page content into “' + m[1] + '”'],
    [/^检测到 HTML 页面，已渲染预览，可单独打开$/, () => 'HTML page detected — preview rendered, you can open it standalone'],
    [/^已就绪（(.*)）$/, (m) => 'ready (' + m[1] + ')'],
    [/^已完成（(.*)）$/, (m) => 'Done (' + m[1] + ')'],
    [/^正文 (\d+) 字符$/, (m) => m[1] + ' chars in body'],
    [/^占位符 (\d+) 个$/, (m) => m[1] + ' placeholder(s)'],
    [/^(\d+) 个字段 · (.*)$/, (m) => m[1] + ' fields · ' + (DICT[m[2]] || EXACT_EXTRA[m[2]] || m[2])]
  ];

  /* 纯中文标点/短词的兜底（tool.js、doc.js 里的少量动态文案） */

  const LANG_KEY = 'skill_forge_lang';
  const hasLS = (() => { try { localStorage.setItem('__i18n_probe', '1'); localStorage.removeItem('__i18n_probe'); return true; } catch (e) { return false; } })();

  function detect() {
    try {
      const s = hasLS ? localStorage.getItem(LANG_KEY) : null;
      if (s === 'zh' || s === 'en') return s;
    } catch (e) {}
    const n = String(navigator.language || 'zh').toLowerCase();
    return n.indexOf('zh') === 0 ? 'zh' : 'en';
  }

  let lang = detect();

  function tr(s) {
    if (lang === 'zh' || typeof s !== 'string') return s;
    const raw = s;
    const key = s.trim();
    if (!key) return s;
    let out = DICT[key] || EXACT_EXTRA[key] || null;
    if (out === null) {
      for (const [re, fn] of PATTERNS) {
        const m = key.match(re);
        if (m) { out = fn(m); break; }
      }
    }
    if (out === null) return raw;
    // 保留原有前后空白
    const lead = raw.match(/^\s*/)[0], tail = raw.match(/\s*$/)[0];
    return lead + out + tail;
  }

  const SKIP = '[data-noi18n],script,style';

  function apply(root) {
    const start = root && root.nodeType === 1 ? root : document.body;
    if (!start) return;
    // 文本节点
    const walker = document.createTreeWalker(start, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p || p.closest(SKIP)) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      if (node.__zh === undefined) node.__zh = node.nodeValue;
      const next = lang === 'zh' ? node.__zh : tr(node.__zh);
      if (node.nodeValue !== next) node.nodeValue = next;   // 避免同值写入造成 MutationObserver 循环
    });
    // placeholder / title
    start.querySelectorAll('[placeholder],[title]').forEach(el => {
      if (el.closest('[data-noi18n]')) return;
      if (el.hasAttribute('placeholder')) {
        if (el.__zhPh === undefined) el.__zhPh = el.getAttribute('placeholder');
        el.setAttribute('placeholder', lang === 'zh' ? el.__zhPh : tr(el.__zhPh));
      }
      if (el.hasAttribute('title')) {
        if (el.__zhTi === undefined) el.__zhTi = el.getAttribute('title');
        el.setAttribute('title', lang === 'zh' ? el.__zhTi : tr(el.__zhTi));
      }
    });
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }

  function syncSwitchers() {
    document.querySelectorAll('.langsw button').forEach(b => {
      b.classList.toggle('on', b.dataset.l === lang);
    });
  }

  function setLang(l) {
    if (l !== 'zh' && l !== 'en') return;
    lang = l;
    try { if (hasLS) localStorage.setItem(LANG_KEY, l); } catch (e) {}
    try { if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) chrome.storage.local.set({ lang: l }); } catch (e) {}
    apply(document.body);
    syncSwitchers();
    document.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang: l } }));
  }

  /* 注入切换器样式（避免每个页面都改 CSS） */
  const css = '.langsw{display:inline-flex;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,.45);' +
    'margin-left:auto;flex-shrink:0;background:rgba(255,255,255,.14)}' +
    '.langsw button{border:none;background:transparent;color:inherit;font:inherit;font-size:11.5px;' +
    'padding:4px 10px;cursor:pointer;opacity:.75;border-radius:0}' +
    '.langsw button.on{background:#fff;color:#2563eb;font-weight:700;opacity:1}' +
    '.langsw.dark{border-color:#d1d5db;background:#fff}' +
    '.langsw.dark button{color:#374151}' +
    '.langsw.dark button.on{background:#2563eb;color:#fff}';

  function boot() {
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
    document.querySelectorAll('.langsw').forEach(box => {
      box.addEventListener('click', e => {
        const b = e.target.closest('button[data-l]');
        if (b) setLang(b.dataset.l);
      });
    });
    apply(document.body);
    syncSwitchers();
    document.addEventListener('i18n:change', syncSwitchers);
  }

  window.I18N = { tr, apply, setLang, getLang: () => lang, dict: DICT };
  window.tr = tr;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
