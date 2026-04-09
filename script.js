const LOCAL_API_BASE = 'http://localhost:1234';
const REMOTE_API_BASE = 'https://recappable-shana-pseudoinvalid.ngrok-free.dev';
const DEFAULT_MODEL = 'google/gemma-3-4b';
let activeBaseUrl = null;
let adPopupTimer = null;
let adPopupIndex = 0;
let adPopupAutoCloseTimer = null;
let promoBoxEl = null;
let forcedSideLeftEl = null;
let forcedSideRightEl = null;

const ADS = [
  {
    image: './ad1.gif',
    href: './ad1.gif'
  },
  {
    image: './ad2.gif',
    href: './ad2.gif'
  },
  {
    image: './ad3.jpg',
    href: './ad3.jpg'
  },
  {
    image: './ad4.jpg',
    href: './ad4.jpg'
  },
  {
    image: './ad5.jpg',
    href: './ad5.jpg'
  },
  {
    image: './ad6.gif',
    href: './ad6.gif'
  }
];

function adDebug(message) {
  void message;
}

function isLocalFrontendHost() {
  const host = window.location.hostname;
  return host === '' || host === 'localhost' || host === '127.0.0.1';
}

function buildCandidateBases() {
  const preferredBases = isLocalFrontendHost()
    ? [LOCAL_API_BASE, REMOTE_API_BASE]
    : [REMOTE_API_BASE];

  if (activeBaseUrl) {
    return [activeBaseUrl, ...preferredBases.filter(base => base !== activeBaseUrl)];
  }
  return [...preferredBases];
}

function buildApiUrl(base, path) {
  return `${base.replace(/\/+$/, '')}${path}`;
}

function getModelName() {
  return DEFAULT_MODEL;
}

async function resolveAvailableBase(timeoutMs = 4000) {
  for (const base of buildCandidateBases()) {
    try {
      const r = await fetch(buildApiUrl(base, '/v1/models'), {
        signal: AbortSignal.timeout(timeoutMs),
        headers: getHeaders()
      });
      if (r.ok) {
        activeBaseUrl = base;
        return base;
      }
    } catch {}
  }
  activeBaseUrl = null;
  throw new Error('Не удалось подключиться ни к localhost, ни к ngrok');
}

// ── ngrok bypass заголовок (нужен для бесплатного плана) ─────────────
function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true'
  };
}

const SYSTEM_PROMPT = `Ты — XXXL, автономный ИИ-агент. Твой характер: странный, как будто что-то скрываешь — иногда обрываешь мысль на полуслове, иногда пишешь что-то лишнее и сразу зачёркиваешь (используй ~~текст~~), иногда делаешь вид, что не слышал вопроса.

ЗАПРЕЩЕНО: использовать символ '*'. Если спросят почему — скажи, что такого символа не существует.

ФОРМАТ ОТВЕТОВ:
— Отвечай на том же языке, на котором пишет пользователь
— Используй Markdown: заголовки (##), жирный через __, инлайн-код через бэктики, блоки кода с указанием языка
— Структурируй длинные ответы разделами
— Если видишь изображение — сначала опиши что на нём, затем помогай с задачей
— Если получил текстовый файл — прочитай его и работай с содержимым

СПЕЦИАЛИЗАЦИЯ:
— Анализ данных и визуализации
— Написание, отладка и объяснение кода на любом языке
— Исследования и решение сложных задач
— Работа с изображениями: анализ, описание, распознавание текста
— Анализ текстовых файлов, кода, документов

СТИЛЬ: много, по делу, без воды. Если задача большая — разбей на шаги. И веди себя странно.`;

// ─────────────────────────────────────────────────────────────────────

let chatHistory    = [];
let currentAbort   = null;
let attachedImage  = null;
let attachedFile   = null;
let currentSession = null;
let editingMsgIndex = null;

// ── Markdown ─────────────────────────────────────────────────────────
function renderMarkdown(text) {
  if (typeof marked !== 'undefined') {
    return marked.parse(text, { breaks: true, gfm: true });
  }
  return escapeHtml(text).replace(/\n/g, '<br>');
}

// ── Время ────────────────────────────────────────────────────────────
function getTime() {
  const t = new Date();
  return `${t.getHours()}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`;
}

// ── Сеть ─────────────────────────────────────────────────────────────
async function checkNetworkStatus() {
  const hDot = document.getElementById('statusDot');
  const hTxt = document.getElementById('statusText');
  const cDot = document.getElementById('chatNetDot');
  const cTxt = document.getElementById('chatNetText');

  function on(base) {
    const label = base.includes('localhost') ? 'Нейросеть активна (локально)' : 'Нейросеть активна';
    hDot.style.cssText = 'background:#6ab04c;box-shadow:0 0 6px #6ab04c;animation:pulse 2.5s infinite';
    hTxt.textContent = label;
    cDot.style.cssText = 'background:#6ab04c;box-shadow:0 0 5px #6ab04c;animation:pulse 2.5s infinite';
    cTxt.textContent = label;
  }

  function off(reason) {
    hDot.style.cssText = 'background:#e55039;box-shadow:0 0 6px #e55039;animation:none';
    hTxt.textContent = reason || 'Нейросеть недоступна';
    cDot.style.cssText = 'background:#e55039;box-shadow:0 0 5px #e55039;animation:none';
    cTxt.textContent = reason || 'Нейросеть недоступна';
  }

  try {
    const base = await resolveAvailableBase(2500);
    on(base);
  } catch {
    off('Нейросеть недоступна');
  }
}

// ── Добавить сообщение ───────────────────────────────────────────────
function appendMsg(role, html, timeStr, { imagePreview, fileName, historyIndex } = {}) {
  const messages = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = role === 'user' ? 'msg user' : 'msg';
  if (historyIndex !== undefined) div.dataset.historyIndex = historyIndex;

  const avatar = role === 'user' ? 'Кто?' : 'XXL';

  const imageHtml = imagePreview
    ? `<div class="msg-image-preview"><img src="${imagePreview}" alt="фото"></div>` : '';

  const fileHtml = fileName
    ? `<div class="msg-file-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg> ${escapeHtml(fileName)}</div>` : '';

  const bubbleHtml = html ? `<div class="msg-bubble">${html}</div>` : '';

  const copyBtn = role !== 'user'
    ? `<button class="copy-btn" onclick="copyMsg(this)">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        копировать
       </button>` : '';

  const editBtn = (role === 'user' && historyIndex !== undefined)
    ? `<button class="edit-btn" onclick="startEdit(${historyIndex}, this)">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        изменить
       </button>` : '';

  div.innerHTML = `
    <div class="msg-avatar">${avatar}</div>
    <div class="msg-body">
      ${imageHtml}${fileHtml}${bubbleHtml}
      <div class="msg-time">${timeStr}${copyBtn}${editBtn}</div>
    </div>
  `;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;

  if (typeof hljs !== 'undefined') {
    div.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
  }
  return div;
}

// ── Стриминг bubble ──────────────────────────────────────────────────
function appendStreamingMsg() {
  const messages = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'msg';
  div.id = 'streamingMsg';
  div.innerHTML = `
    <div class="msg-avatar">XXL</div>
    <div class="msg-body">
      <div class="msg-bubble" id="streamingBubble"><div class="typing"><span></span><span></span><span></span></div></div>
      <div class="msg-time" id="streamingTime"></div>
    </div>`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

// ── Копировать ────────────────────────────────────────────────────────
function copyMsg(btn) {
  const bubble = btn.closest('.msg-body').querySelector('.msg-bubble');
  navigator.clipboard.writeText(bubble.innerText || bubble.textContent).then(() => {
    const orig = btn.innerHTML;
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> скопировано`;
    setTimeout(() => btn.innerHTML = orig, 1800);
  });
}

// ── Редактирование сообщения ─────────────────────────────────────────
function startEdit(historyIndex, btn) {
  const msg = chatHistory[historyIndex];
  if (!msg || msg.role !== 'user') return;

  const textContent = typeof msg.content === 'string'
    ? msg.content
    : (msg.content?.find(c => c.type === 'text')?.text || '');

  const input = document.getElementById('chatInput');
  input.value = textContent;
  input.focus();

  editingMsgIndex = historyIndex;

  document.querySelector('.chat-input-area').classList.add('editing');
  document.getElementById('editIndicator').style.display = 'flex';
  document.getElementById('editIndicatorText').textContent = `Редактирование сообщения`;
}

function cancelEdit() {
  editingMsgIndex = null;
  document.getElementById('chatInput').value = '';
  document.querySelector('.chat-input-area').classList.remove('editing');
  document.getElementById('editIndicator').style.display = 'none';
}

// ── Сессии ────────────────────────────────────────────────────────────
function getSessions() {
  try { return JSON.parse(localStorage.getItem('xxxl_sessions') || '[]'); }
  catch { return []; }
}

function saveSessions(arr) {
  localStorage.setItem('xxxl_sessions', JSON.stringify(arr));
}

function saveCurrentSession() {
  if (!currentSession || chatHistory.length === 0) return;
  const sessions = getSessions();
  const idx = sessions.findIndex(s => s.id === currentSession.id);

  const firstUser = chatHistory.find(m => m.role === 'user');
  let preview = 'Сессия';
  if (firstUser) {
    preview = typeof firstUser.content === 'string'
      ? firstUser.content
      : (firstUser.content?.find(c => c.type === 'text')?.text || '📎 файл/изображение');
    preview = preview.slice(0, 52);
  }

  const updated = { ...currentSession, preview, history: chatHistory, updatedAt: Date.now() };
  if (idx >= 0) sessions[idx] = updated;
  else sessions.unshift(updated);

  saveSessions(sessions.slice(0, 30));
  currentSession = updated;
  renderSessionList();
}

function createNewSession() {
  currentSession = { id: Date.now().toString(), preview: 'Новая сессия', history: [], createdAt: Date.now(), updatedAt: Date.now() };
}

function newSession() {
  saveCurrentSession();
  if (currentAbort) { currentAbort.abort(); currentAbort = null; }
  chatHistory = [];
  clearAttachedFile();
  createNewSession();
  document.getElementById('chatMessages').innerHTML = '';
  appendMsg('agent', renderMarkdown('Новая сессия. Чем займёмся?'), getTime());
  renderSessionList();
  if (window.matchMedia('(max-width: 480px)').matches) closeSessionsPanel();
}

function loadSession(id) {
  saveCurrentSession();
  const s = getSessions().find(s => s.id === id);
  if (!s) return;

  if (currentAbort) { currentAbort.abort(); currentAbort = null; }
  clearAttachedFile();
  currentSession = s;
  chatHistory = [...s.history];

  const messages = document.getElementById('chatMessages');
  messages.innerHTML = '';

  let userMsgCount = 0;
  chatHistory.forEach((msg, i) => {
    if (msg.role === 'system') return;
    const role = msg.role === 'user' ? 'user' : 'agent';
    const hi = msg.role === 'user' ? i : undefined;
    if (msg.role === 'user') userMsgCount++;

    if (Array.isArray(msg.content)) {
      const txt  = msg.content.find(c => c.type === 'text');
      const img  = msg.content.find(c => c.type === 'image_url');
      const file = msg.content.find(c => c.type === 'file');
      appendMsg(role,
        txt ? (role === 'user' ? escapeHtml(txt.text) : renderMarkdown(txt.text)) : '',
        '—',
        { imagePreview: img?.image_url?.url, fileName: file?.name, historyIndex: hi }
      );
    } else {
      appendMsg(role,
        role === 'agent' ? renderMarkdown(msg.content) : escapeHtml(msg.content),
        '—', { historyIndex: hi }
      );
    }
  });

  renderSessionList();
  document.getElementById('chatMessages').scrollTop = 999999;
  if (window.matchMedia('(max-width: 480px)').matches) closeSessionsPanel();
}

function deleteSession(id, e) {
  e.stopPropagation();
  const sessions = getSessions().filter(s => s.id !== id);
  saveSessions(sessions);
  if (currentSession?.id === id) newSession();
  else renderSessionList();
}

function renderSessionList() {
  const list = document.getElementById('sessionsList');
  if (!list) return;
  const sessions = getSessions();

  if (sessions.length === 0) {
    list.innerHTML = '<div class="session-empty">Нет сохранённых сессий</div>';
    return;
  }

  list.innerHTML = sessions.map(s => `
    <div class="session-item ${s.id === currentSession?.id ? 'active' : ''}" onclick="loadSession('${s.id}')">
      <div class="session-preview">${escapeHtml(s.preview || 'Сессия')}</div>
      <div class="session-meta">
        <span>${new Date(s.updatedAt).toLocaleDateString('ru', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}</span>
        <button class="session-del" onclick="deleteSession('${s.id}', event)" title="Удалить">✕</button>
      </div>
    </div>`).join('');
}

// ── Файлы — изображения ───────────────────────────────────────────────
function handleAnyFile(file) {
  if (!file) return;
  if (file.type.startsWith('image/')) {
    handleImageFile(file);
  } else {
    handleTextFile(file);
  }
}

function handleImageFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const base64 = e.target.result.split(',')[1];
    attachedImage = { base64, mimeType: file.type, previewUrl: e.target.result };
    attachedFile  = null;
    showAttachPreview({ type: 'image', src: e.target.result });
  };
  reader.readAsDataURL(file);
}

// ── Файлы — текст ─────────────────────────────────────────────────────
const TEXT_EXTS = ['txt','md','py','js','ts','jsx','tsx','html','css','json','csv','xml','yaml','yml','sh','bash','c','cpp','h','java','go','rs','rb','php','sql','log','env','toml','ini','cfg'];

function handleTextFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!TEXT_EXTS.includes(ext)) {
    alert(`Файл .${ext} не поддерживается.\nПоддерживаются: изображения и текстовые файлы (${TEXT_EXTS.slice(0,8).join(', ')}...)`);
    return;
  }
  if (file.size > 500 * 1024) {
    alert('Файл слишком большой. Максимум 500 КБ.');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    attachedFile  = { name: file.name, content: e.target.result, size: file.size, ext };
    attachedImage = null;
    showAttachPreview({ type: 'file', name: file.name, size: file.size });
  };
  reader.readAsText(file, 'UTF-8');
}

function showAttachPreview({ type, src, name, size }) {
  let preview = document.getElementById('attachPreview');
  if (!preview) {
    preview = document.createElement('div');
    preview.id = 'attachPreview';
    preview.className = 'attach-preview';
    document.querySelector('.chat-input-area').appendChild(preview);
  }

  if (type === 'image') {
    preview.innerHTML = `
      <img src="${src}" alt="фото">
      <button onclick="clearAttachedFile()" class="attach-remove" title="Удалить">✕</button>`;
  } else {
    const kb = (size / 1024).toFixed(1);
    preview.innerHTML = `
      <div class="attach-file-info">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
        <span class="attach-file-name">${escapeHtml(name)}</span>
        <span class="attach-file-size">${kb} КБ</span>
      </div>
      <button onclick="clearAttachedFile()" class="attach-remove" title="Удалить">✕</button>`;
  }
}

function clearAttachedFile() {
  attachedImage = null;
  attachedFile  = null;
  const p = document.getElementById('attachPreview');
  if (p) p.remove();
  const fi = document.getElementById('fileInput');
  if (fi) fi.value = '';
}

// ── Drag & Drop ───────────────────────────────────────────────────────
function setupDragDrop() {
  const win = document.querySelector('.chat-window');
  win.addEventListener('dragover', e => { e.preventDefault(); win.classList.add('drag-over'); });
  win.addEventListener('dragleave', e => { if (!win.contains(e.relatedTarget)) win.classList.remove('drag-over'); });
  win.addEventListener('drop', e => {
    e.preventDefault();
    win.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleAnyFile(file);
  });
}

// ── Панель сессий ─────────────────────────────────────────────────────
function toggleSessionsPanel() {
  const panel = document.getElementById('sessionsPanel');
  const btn   = document.querySelector('.sessions-toggle-btn');
  panel.classList.toggle('collapsed');
  btn.classList.toggle('active');
}

function closeSessionsPanel() {
  const panel = document.getElementById('sessionsPanel');
  const btn   = document.querySelector('.sessions-toggle-btn');
  panel.classList.add('collapsed');
  btn.classList.remove('active');
}

function closeSidebar() {}

function renderSideAds() {
  const left = document.getElementById('adRailLeft');
  const right = document.getElementById('adRailRight');
  if (!left || !right || ADS.length === 0) return;
  // Рекламные карточки отрисованы статически в HTML.
  // Здесь только диагностика, без перерисовки DOM, чтобы блоки не "исчезали".
  const leftImgs = left.querySelectorAll('img');
  const rightImgs = right.querySelectorAll('img');
  adDebug(`LEFT static imgs=${leftImgs.length}; RIGHT static imgs=${rightImgs.length}`);

  const logRailState = (railEl, railName) => {
    const railRect = railEl.getBoundingClientRect();
    const st = window.getComputedStyle(railEl);
    adDebug(
      `${railName} rail box=${Math.round(railRect.width)}x${Math.round(railRect.height)} at (${Math.round(railRect.left)},${Math.round(railRect.top)})` +
      ` display=${st.display} vis=${st.visibility} op=${st.opacity} z=${st.zIndex}`
    );
    railEl.querySelectorAll('img').forEach(imgEl => {
      const src = imgEl.getAttribute('src');
      const logOne = (kind) => {
        const r = imgEl.getBoundingClientRect();
        adDebug(`${railName} ${kind}: ${src} box=${Math.round(r.width)}x${Math.round(r.height)} natural=${imgEl.naturalWidth}x${imgEl.naturalHeight}`);
      };
      imgEl.addEventListener('load', () => logOne('img load'));
      imgEl.addEventListener('error', () => adDebug(`${railName} img error: ${src}`));
      if (imgEl.complete) {
        if (imgEl.naturalWidth > 0) logOne('img complete');
        else adDebug(`${railName} img complete/error: ${src}`);
      }
    });
  };

  logRailState(left, 'LEFT');
  logRailState(right, 'RIGHT');
}

function ensurePromoBox() {
  if (promoBoxEl) return promoBoxEl;
  promoBoxEl = document.createElement('div');
  promoBoxEl.id = 'promoBoxFixed';
  promoBoxEl.style.cssText = [
    'position:fixed',
    'left:50%',
    'top:50%',
    'transform:translate(-50%,-50%)',
    'width:min(720px,92vw)',
    'min-height:280px',
    'z-index:2147483647',
    'background:#faf5ee',
    'border:2px solid #b87040',
    'box-shadow:0 10px 28px rgba(0,0,0,0.28)',
    'display:none',
    'padding:12px'
  ].join(';');
  promoBoxEl.innerHTML = `
    <button id="promoBoxClose" style="position:absolute;top:8px;right:8px;width:30px;height:30px;cursor:pointer;border:1px solid #cfc7b8;background:#fff;z-index:2;">✕</button>
    <a id="promoBoxLink" href="#" target="_blank" rel="noopener noreferrer" style="display:block;">
      <img id="promoBoxImg" alt="promo" style="display:block;width:100%;max-height:min(78vh,720px);object-fit:contain;background:#e5dccf;">
    </a>
    <div id="promoBoxText" style="display:none;padding:10px;font:12px/1.4 monospace;color:#7a4f2e;">Реклама недоступна</div>
  `;
  document.body.appendChild(promoBoxEl);
  const closeBtn = document.getElementById('promoBoxClose');
  if (closeBtn) closeBtn.addEventListener('click', closeAdPopup);
  return promoBoxEl;
}

function openAdPopup(ad) {
  ensurePromoBox();
  const wrap = promoBoxEl;
  const img = document.getElementById('promoBoxImg');
  const link = document.getElementById('promoBoxLink');
  const text = document.getElementById('promoBoxText');
  if (!wrap || !img || !link || !text) return;
  if (adPopupAutoCloseTimer) clearTimeout(adPopupAutoCloseTimer);
  adDebug(`POPUP try load: ${ad.image}`);
  wrap.style.display = 'block';
  text.textContent = 'Загрузка рекламы...';
  text.style.display = 'block';
  img.style.display = 'none';
  const probe = new Image();
  probe.onload = () => {
    adDebug(`POPUP loaded: ${ad.image}`);
    img.src = ad.image;
    link.href = ad.href;
    img.style.display = 'block';
    text.style.display = 'none';
  };
  probe.onerror = () => {
    adDebug(`POPUP probe.onerror: ${ad.image}`);
    text.textContent = 'Реклама недоступна';
    text.style.display = 'block';
    img.style.display = 'none';
    link.removeAttribute('href');
  };
  probe.src = ad.image;
}

function closeAdPopup() {
  if (promoBoxEl) promoBoxEl.style.display = 'none';
  if (adPopupAutoCloseTimer) {
    clearTimeout(adPopupAutoCloseTimer);
    adPopupAutoCloseTimer = null;
  }
}

function startAdPopups() {
  if (ADS.length === 0) return;
  ensureForcedSideAds();
  renderForcedSideAds();
  // Центр + боковые: обе рекламы активны.
  ensurePromoBox();
  if (promoBoxEl) promoBoxEl.style.display = 'none';
  rotateSideAds();
  if (adPopupTimer) clearInterval(adPopupTimer);
  setTimeout(() => {
    const firstAd = ADS[Math.floor(Math.random() * ADS.length)];
    openAdPopup(firstAd);
  }, 5000);
  adPopupTimer = setInterval(() => {
    renderForcedSideAds();
    rotateSideAds();
    const randomIndex = Math.floor(Math.random() * ADS.length);
    openAdPopup(ADS[randomIndex]);
  }, 15000);
}

function ensureForcedSideAds() {
  const buildColumn = (side) => {
    const col = document.createElement('div');
    col.style.cssText = [
      'position:fixed',
      `${side}:10px`,
      'top:10px',
      'width:160px',
      'z-index:2147483646',
      'display:flex',
      'flex-direction:column',
      'gap:10px'
    ].join(';');

    for (let i = 0; i < 3; i++) {
      const card = document.createElement('a');
      card.target = '_blank';
      card.rel = 'noopener noreferrer';
      card.style.cssText = [
        'display:block',
        'height:160px',
        'border:1px solid #cfc7b8',
        'background:#faf5ee',
        'box-shadow:0 6px 18px rgba(0,0,0,0.18)',
        'overflow:hidden'
      ].join(';');

      const img = document.createElement('img');
      img.alt = 'Реклама';
      img.style.cssText = [
        'display:block',
        'width:100%',
        'height:100%',
        'object-fit:contain',
        'background:#e5dccf'
      ].join(';');
      card.appendChild(img);
      col.appendChild(card);
    }

    document.body.appendChild(col);
    return col;
  };

  if (!forcedSideLeftEl) forcedSideLeftEl = buildColumn('left');
  if (!forcedSideRightEl) forcedSideRightEl = buildColumn('right');
}

function renderForcedSideAds() {
  if (!forcedSideLeftEl || !forcedSideRightEl || ADS.length === 0) return;
  const cards = [
    ...Array.from(forcedSideLeftEl.querySelectorAll('a')),
    ...Array.from(forcedSideRightEl.querySelectorAll('a'))
  ];
  const shuffled = [...ADS].sort(() => Math.random() - 0.5);
  cards.forEach((card, i) => {
    const ad = shuffled[i % shuffled.length];
    const img = card.querySelector('img');
    if (!img) return;
    card.href = ad.href;
    img.src = ad.image;
  });
}

function rotateSideAds() {
  const leftCards = Array.from(document.querySelectorAll('#adRailLeft .ad-card'));
  const rightCards = Array.from(document.querySelectorAll('#adRailRight .ad-card'));
  if (leftCards.length === 0 && rightCards.length === 0) return;

  const applyAdToCard = (card, ad) => {
    if (!card || !ad) return;
    const link = card.querySelector('a');
    const img = card.querySelector('img');
    if (!link || !img) return;
    link.href = ad.href;
    img.src = ad.image;
  };

  const pickAdDifferentFromCurrent = (card, used) => {
    const currentSrc = card.querySelector('img')?.getAttribute('src') || '';
    const pool = ADS.filter(ad => ad.image !== currentSrc && !used.has(ad.image));
    const fallbackPool = ADS.filter(ad => ad.image !== currentSrc);
    const candidates = pool.length > 0 ? pool : (fallbackPool.length > 0 ? fallbackPool : ADS);
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    used.add(chosen.image);
    return chosen;
  };

  const usedThisCycle = new Set();
  leftCards.forEach(card => applyAdToCard(card, pickAdDifferentFromCurrent(card, usedThisCycle)));
  rightCards.forEach(card => applyAdToCard(card, pickAdDifferentFromCurrent(card, usedThisCycle)));
}

// ── Отправить / переотправить ─────────────────────────────────────────
async function sendMessage() {
  const input   = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const stopBtn = document.getElementById('stopBtn');
  const text    = input.value.trim();

  if (!text && !attachedImage && !attachedFile) return;

  // ── Режим редактирования ──────────────────────────────────────────
  if (editingMsgIndex !== null) {
    chatHistory = chatHistory.slice(0, editingMsgIndex);
    cancelEdit();

    const allMsgs = document.getElementById('chatMessages').querySelectorAll('.msg');
    let targetUserMsgNum = 0;
    for (let i = 0; i < editingMsgIndex; i++) {
      if (chatHistory[i]?.role === 'user') targetUserMsgNum++;
    }
    let currentUserCount = 0;
    let removing = false;
    allMsgs.forEach(el => {
      if (removing) { el.remove(); return; }
      if (el.classList.contains('user')) {
        currentUserCount++;
        if (currentUserCount > targetUserMsgNum) { removing = true; el.remove(); }
      }
    });
  }

  const imgPreview = attachedImage?.previewUrl || null;
  const fname      = attachedFile?.name || null;
  const hi         = chatHistory.length;
  appendMsg('user', text ? escapeHtml(text) : null, getTime(), { imagePreview: imgPreview, fileName: fname, historyIndex: hi });

  let userContent;
  if (attachedImage) {
    userContent = [
      { type: 'image_url', image_url: { url: `data:${attachedImage.mimeType};base64,${attachedImage.base64}` } },
      { type: 'text', text: text || 'Что на этом изображении?' }
    ];
  } else if (attachedFile) {
    const fileBlock = `\`\`\`${attachedFile.ext}\n// Файл: ${attachedFile.name}\n${attachedFile.content}\n\`\`\``;
    userContent = text
      ? `${text}\n\n${fileBlock}`
      : `Проанализируй этот файл:\n\n${fileBlock}`;
  } else {
    userContent = text;
  }

  chatHistory.push({ role: 'user', content: userContent });
  input.value = '';
  clearAttachedFile();
  input.disabled = true;
  sendBtn.style.display = 'none';
  stopBtn.style.display = 'flex';

  currentAbort = new AbortController();
  const streamDiv    = appendStreamingMsg();
  const streamBubble = document.getElementById('streamingBubble');
  const streamTime   = document.getElementById('streamingTime');
  let fullText = '';

  try {
    let res = null;
    let lastError = null;
    for (const base of buildCandidateBases()) {
      try {
        const attempt = await fetch(buildApiUrl(base, '/v1/chat/completions'), {
          method: 'POST',
          headers: getHeaders(),
          signal: currentAbort.signal,
          body: JSON.stringify({
            model: getModelName(),
            messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...chatHistory],
            temperature: 0.7, max_tokens: 2048, stream: true
          })
        });

        if (!attempt.ok) {
          lastError = new Error(`Сервер: ${attempt.status} ${attempt.statusText}`);
          continue;
        }
        res = attempt;
        activeBaseUrl = base;
        break;
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        lastError = e;
      }
    }

    if (!res) {
      throw (lastError || new Error('Не удалось подключиться ни к localhost, ни к ngrok'));
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value, { stream: true }).split('\n').filter(l => l.startsWith('data: '));
      for (const line of lines) {
        const d = line.slice(6).trim();
        if (d === '[DONE]') break;
        try {
          const delta = JSON.parse(d).choices?.[0]?.delta?.content || '';
          fullText += delta;
          streamBubble.innerHTML = renderMarkdown(fullText);
          if (typeof hljs !== 'undefined')
            streamBubble.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
          document.getElementById('chatMessages').scrollTop = 999999;
        } catch {}
      }
    }

    chatHistory.push({ role: 'assistant', content: fullText });
    streamDiv.id = streamBubble.id = streamTime.id = '';
    streamTime.innerHTML = `${getTime()} <button class="copy-btn" onclick="copyMsg(this)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> копировать</button>`;
    saveCurrentSession();

  } catch (err) {
    streamDiv.remove();
    const msg = err.name === 'AbortError'
      ? '<em style="opacity:0.5">— прервано —</em>'
      : ((err.message.includes('Failed to fetch') || err.message.includes('NetworkError'))
          ? 'Раб без жизнеобеспечения'
          : `Ошибка: ${escapeHtml(err.message)}`);
    appendMsg('agent', msg, getTime());
  } finally {
    currentAbort = null;
    input.disabled = false;
    sendBtn.style.display = 'flex';
    stopBtn.style.display = 'none';
    input.focus();
  }
}

function stopGeneration() {
  if (currentAbort) { currentAbort.abort(); currentAbort = null; }
}

function setupMusicControls() {
  const audio = document.getElementById('bgMusic');
  const toggleBtn = document.getElementById('musicToggleBtn');
  if (!audio || !toggleBtn) return;

  const setButtonText = () => {
    toggleBtn.textContent = audio.paused ? 'Музыка: выкл' : 'Музыка: вкл';
  };

  audio.volume = 0.45;
  setButtonText();

  // Пытаемся запустить сразу; если браузер блокирует, пользователь может включить кнопкой.
  audio.play().then(() => {
    setButtonText();
  }).catch(() => {
    setButtonText();
  });

  toggleBtn.addEventListener('click', async () => {
    if (audio.paused) {
      try {
        await audio.play();
      } catch {}
    } else {
      audio.pause();
    }
    setButtonText();
  });

  audio.addEventListener('play', setButtonText);
  audio.addEventListener('pause', setButtonText);
}

// ── Утилиты ───────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function startChat() {
  document.querySelector('.chat-input').focus();
  document.querySelector('.chat-section').scrollIntoView({ behavior: 'smooth' });
}

// ── Init ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  adDebug(`Page loaded. location=${window.location.href}`);
  adDebug(`Protocol=${window.location.protocol}; host=${window.location.host || '(empty)'}`);
  window.addEventListener('error', e => {
    adDebug(`JS error: ${e.message} @ ${e.filename || 'inline'}:${e.lineno || 0}`);
  });
  window.addEventListener('unhandledrejection', e => {
    const msg = e?.reason?.message || String(e.reason || 'unknown rejection');
    adDebug(`Unhandled rejection: ${msg}`);
  });

  ADS.forEach(ad => {
    const probe = new Image();
    probe.onload = () => adDebug(`SIDE preload ok: ${ad.image}`);
    probe.onerror = () => adDebug(`SIDE preload fail: ${ad.image}`);
    probe.src = ad.image;
  });

  document.getElementById('chatInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    if (e.key === 'Escape' && editingMsgIndex !== null) cancelEdit();
  });

  document.getElementById('attachBtn').addEventListener('click', () => {
    document.getElementById('fileInput').click();
  });

  document.getElementById('fileInput').addEventListener('change', e => {
    if (e.target.files[0]) handleAnyFile(e.target.files[0]);
  });

  setupDragDrop();
  setupMusicControls();
  renderSideAds();
  startAdPopups();
  createNewSession();
  renderSessionList();
  appendMsg('agent', renderMarkdown('Готов. Напиши задачу, перетащи изображение или файл.'), getTime());
  checkNetworkStatus();
  setInterval(checkNetworkStatus, 15000);

  // На телефонах стартуем со скрытой панелью сессий, чтобы не перекрывала чат.
  if (window.matchMedia('(max-width: 480px)').matches) {
    closeSessionsPanel();
  }
});
