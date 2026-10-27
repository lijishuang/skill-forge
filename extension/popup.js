const $ = id => document.getElementById(id);
const openApp = q => chrome.tabs.create({ url: chrome.runtime.getURL('app.html' + (q || '')) });

async function init() {
  const { skills = [], pendingSave, pendingExec, cfg } =
    await chrome.storage.local.get(['skills', 'pendingSave', 'pendingExec', 'cfg']);

  // 待处理提示
  if (pendingSave) {
    $('pendingBanner').style.display = 'block';
    $('pendingBanner').innerHTML = '📥 有 1 条选中内容待存为 Skill，<b>打开工作台</b>后确认保存';
  } else if (pendingExec) {
    $('pendingBanner').style.display = 'block';
    $('pendingBanner').innerHTML = '▶ 有 1 条选中内容待执行，<b>打开工作台</b>后选择 Skill';
  }

  // 技能库
  const list = $('list');
  if (!skills.length) {
    list.innerHTML = '<div class="empty">还没有保存的 Skill<br>在工作台上传后点「存入技能库」</div>';
  } else {
    list.innerHTML = '';
    skills.forEach(s => {
      const d = document.createElement('div');
      d.className = 'skill';
      d.innerHTML = `<span>📄</span><span class="name">${escapeHtml(s.name)}</span><span class="del" title="删除">✕</span>`;
      d.querySelector('.name').parentElement.addEventListener('click', e => {
        if (e.target.classList.contains('del')) return;
        openApp('?load=' + encodeURIComponent(s.id));
      });
      d.querySelector('.del').addEventListener('click', async () => {
        const rest = skills.filter(x => x.id !== s.id);
        await chrome.storage.local.set({ skills: rest });
        init();
      });
      list.appendChild(d);
    });
  }

  // 配置状态
  const c = cfg || {};
  $('cfgStatus').innerHTML = c.base && c.key && c.model
    ? `模型配置：<span class="cfg-ok">已就绪（${escapeHtml(c.model)}）</span>`
    : `模型配置：<span class="cfg-no">未完成</span>，打开工作台后填写`;

  // 我的页面：点击直接打开对应页面
  const { pages = [] } = await chrome.storage.local.get(['pages']);
  const pl = $('pageList');
  $('pageTag').textContent = pages.length ? `(${pages.length})` : '';
  if (!pages.length) {
    pl.innerHTML = '<div class="empty">生成的界面 / HTML 页面存入后<br>点击这里直接打开使用</div>';
  } else {
    pl.innerHTML = '';
    pages.forEach(p => {
      const d = document.createElement('div');
      d.className = 'skill';
      d.innerHTML = `<span>${p.type === 'tool' ? '🧩' : '🌐'}</span>` +
        `<span class="name">${escapeHtml(p.name)}</span>` +
        `<span class="badge">${p.type === 'tool' ? '工具页' : '网页'}</span>` +
        `<span class="del" title="删除">✕</span>`;
      d.addEventListener('click', e => {
        if (e.target.classList.contains('del')) return;
        chrome.tabs.create({
          url: p.type === 'tool'
            ? chrome.runtime.getURL('tool.html?id=' + p.id)
            : chrome.runtime.getURL('doc.html?id=' + p.id)
        });
      });
      d.querySelector('.del').addEventListener('click', async () => {
        await chrome.storage.local.set({ pages: pages.filter(x => x.id !== p.id) });
        init();
      });
      pl.appendChild(d);
    });
  }

  if (window.I18N) I18N.apply(document.body);
}

document.addEventListener('i18n:change', () => init());

$('openApp').onclick = () => openApp('');
$('openCfg').onclick = () => openApp('#cfg');
init();

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}
