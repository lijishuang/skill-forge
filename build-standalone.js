/* 把 skill-forge-extension 的 app.html / app.js / tool 资源 / i18n 合并成单文件独立版 */
const fs = require('fs');
const path = require('path');

const EXT = path.join(__dirname, 'skill-forge-extension');
const OUT = path.join(__dirname, 'skill-forge-standalone.html');

let html = fs.readFileSync(path.join(EXT, 'app.html'), 'utf8');
const appJs = fs.readFileSync(path.join(EXT, 'app.js'), 'utf8');
const i18nJs = fs.readFileSync(path.join(EXT, 'i18n.js'), 'utf8');
const assets = JSON.stringify({
  css: fs.readFileSync(path.join(EXT, 'tool.css'), 'utf8'),
  js: fs.readFileSync(path.join(EXT, 'tool.js'), 'utf8'),
  shell: fs.readFileSync(path.join(EXT, 'tool.html'), 'utf8'),
  i18n: i18nJs
}).replace(/</g, '\\u003c');   // 关键：内嵌 HTML/JS 里的 <!-- 与 <script 会让浏览器进入
                               // script-data-escaped/double-escaped 状态，吞掉真正的 </script>
                               // 边界导致整段 SyntaxError。JSON 里 \u003c 合法且等价于 <，一并规避。

const marker = '<script src="i18n.js"></script>\n<script src="app.js"></script>';
if (!html.includes(marker)) throw new Error('找不到脚本引用标记');

// 防御校验：裸内联的 i18n/app 段若含 <!--（script-data-escaped 入口）或 </script（提前截断）
// 会破坏 HTML 解析，禁止发布；<script 需在无 <!-- 前导时才安全
for (const [name, code] of [['i18n.js', i18nJs], ['app.js', appJs]]) {
  if (code.includes('<!--')) throw new Error(name + ' 含 <!--，内联到独立版会破坏 HTML 解析');
  if (/<\/script/i.test(code)) throw new Error(name + ' 含 </script>，内联到独立版会提前截断');
}

html = html.replace(marker,
  '<script>window.__TOOL_ASSETS = ' + assets + ';</' + 'script>\n' +
  '<script>\n' + i18nJs + '\n</' + 'script>\n' +
  '<script>\n' + appJs + '\n</' + 'script>');

html = html
  .replace('<title>Skill 工坊 · 工作台</title>', '<title>Skill 工坊 · 独立版</title>')
  .replace('<h1>Skill 工坊 · 工作台</h1>', '<h1>Skill 工坊 · 独立版</h1>')
  .replace('<p>上传任意 SKILL.md → 自动生成适配界面 → 填参数调用 LLM 执行</p>',
    '<p>独立版：双击打开即用，无需安装插件 · 上传任意 SKILL.md → 生成界面 → 单独打开为 HTML 页面</p>')
  .replace('OpenAI 兼容接口（OpenAI / DeepSeek / Kimi / Ollama 等）',
    'OpenAI 兼容接口（OpenAI / DeepSeek / Kimi / Ollama 等）· 独立版数据存于浏览器 localStorage')
  .replace('<span class="tag">存于插件本地存储</span>', '<span class="tag">存于本机浏览器</span>');

fs.writeFileSync(OUT, html);
console.log('✓ 独立版已生成 ' + (html.length / 1024).toFixed(1) + ' KB');

// 抽出各段内联脚本供语法校验
const scripts = [];
let idx = 0;
while (true) {
  const a = html.indexOf('<script>', idx);
  if (a < 0) break;
  const b = html.indexOf('</scr' + 'ipt>', a);
  if (b < 0) break;
  scripts.push(html.slice(a + 8, b));
  idx = b + 9;
}
scripts.forEach((s, i) => fs.writeFileSync('/tmp/_sa' + i + '.js', s));
console.log('内联脚本段数: ' + scripts.length);
