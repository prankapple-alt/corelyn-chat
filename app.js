// ============================
// Helpers
// ============================

function scrollToBottom(smooth){
  const container = document.querySelector('.messages-container');
  if(smooth) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  else container.scrollTop = container.scrollHeight;
}

function autoResize(){
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
}

function updateChatTitle(chat, content){
  if(chat.title === 'New Chat'){
    chat.title = content.slice(0, 40);
    topbarTitle.textContent = chat.title;
  }
}

function updateModelLabel(){
  modelLabel.textContent = `${state.provider} • ${state.model}`;
}

// ============================
// ---- Markdown parser (safe for code blocks) ----
function markdownToHtml(text) {
  if (!text) return '';

  const codeBlocks = [];
  let html = text;

  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const placeholder = `%%CODEBLOCK${codeBlocks.length}%%`;
    codeBlocks.push(
      `<pre><code class="language-${lang}">${escapeHtml(code.trim())}</code></pre>`
    );
    return placeholder;
  });

  html = html.replace(/`([^`]+)`/g, (_, code) => {
    const placeholder = `%%INLINECODE${codeBlocks.length}%%`;
    codeBlocks.push(`<code>${escapeHtml(code)}</code>`);
    return placeholder;
  });

  html = html
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/^---$/gm, '<hr>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    .replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');

  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
  html = html.split(/\n{2,}/).map(p => `<p>${p}</p>`).join('');

  codeBlocks.forEach((codeHtml, idx) => {
    html = html.replace(`%%CODEBLOCK${idx}%%`, codeHtml);
    html = html.replace(`%%INLINECODE${idx}%%`, codeHtml);
  });

  return html;
}

const escapeHtml = (str) => {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};


// ============================
// AI Tool Commands
// ============================

const AI_TOOLS = {

  create_file(args, body) {
    const filename = args[0];
    if (!filename) return { ok: false, msg: 'No filename provided.' };

    const content = body ?? args.slice(1).join(' ');
    const blob = new Blob([content], { type: 'text/plain' });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();

    URL.revokeObjectURL(url);

    return {
      ok: true,
      msg: `File **${escapeHtml(filename)}** created and downloaded (${content.length} bytes).`
    };
  },

  open_url(args) {
    const url = args[0];
    if (!url) return { ok: false, msg: 'No URL provided.' };
    window.open(url, '_blank', 'noopener');
    return { ok: true, msg: `Opened URL: ${escapeHtml(url)}` };
  },

  alert(args, body) {
    const msg = body ?? args.join(' ');
    alert(msg);
    return { ok: true, msg: `Alert shown: "${escapeHtml(msg)}"` };
  },

  set_title(args, body) {
    const title = body ?? args.join(' ');
    const chat = getActiveChat();
    if (chat) {
      chat.title = title;
      topbarTitle.textContent = title;
      saveChats();
      renderChatList();
    }
    return { ok: true, msg: `Chat title set to **${escapeHtml(title)}**.` };
  },

};


function processAiTools(text) {
  const toolResults = [];
  const cleanText = text.replace(/<tool:(\w+)([^>]*)>([\s\S]*?)<\/tool>/gi, (_, name, argsStr, body) => {
    const args = argsStr.trim().split(/\s+/).filter(Boolean);
    const fn = AI_TOOLS[name.toLowerCase()];
    if (!fn) {
      toolResults.push({ ok: false, name, msg: `Unknown tool: \`${name}\`` });
      return '';
    }
    try {
      const result = fn(args, body);
      toolResults.push({ name, ...result });
    } catch(e) {
      toolResults.push({ ok: false, name, msg: `Tool \`${name}\` threw: ${e.message}` });
    }
    return '';
  });

  const cleanText2 = cleanText.replace(/^@@(\w+)\s+(.*)$/gm, (_, name, rest) => {
    const fn = AI_TOOLS[name.toLowerCase()];
    if (!fn) {
      toolResults.push({ ok: false, name, msg: `Unknown tool: \`${name}\`` });
      return '';
    }
    try {
      const parts = rest.split(/\s+/);
      const args = [parts[0]];
      const body = parts.slice(1).join(' ');
      const result = fn(args, body);
      toolResults.push({ name, ...result });
    } catch(e) {
      toolResults.push({ ok: false, name, msg: `Tool \`${name}\` threw: ${e.message}` });
    }
    return '';
  });

  return { cleanText: cleanText2.trim(), toolResults };
}

function buildToolFeedbackMessage(toolResults) {
  if (!toolResults.length) return null;
  const lines = toolResults.map(r => {
    const icon = r.ok ? '✅' : '❌';
    return `${icon} **\`${r.name}\`** — ${r.msg}`;
  });
  return `🔧 **Tool results:**\n\n${lines.join('\n')}`;
}


// ============================
// Providers
// ============================

const PROVIDERS = {
  anthropic: { name: 'Anthropic', endpoint: 'https://api.anthropic.com/v1/messages' },
  openai: { name: 'OpenAI', endpoint: 'https://api.openai.com/v1/chat/completions' },
  cerebras: { name: 'Cerebras', endpoint: 'https://api.cerebras.ai/v1/chat/completions' },
  corelyn: { name: 'Corelyn', endpoint: 'https://api.corelyn.ro/chat/completions' }
};

// ============================
// State
// ============================

let state = {
  apiKey: localStorage.getItem('nc_apikey') || '',
  provider: localStorage.getItem('nc_provider') || 'corelyn',
  model: localStorage.getItem('nc_model') || 'cerebras/llama3.1-8b',
  systemPrompt: localStorage.getItem('nc_systemprompt') || `You are Corelyn, a useful AI assistant.
If user asks to generate code, give actually working valid code, no AI slop.
Respond only in markdown.

You have access to special tool commands you can embed in your response.
Use them like this:
  <tool:create_file filename.txt>file content here</tool>
  <tool:open_url https://example.com></tool>
  <tool:alert some message to show></tool>
  <tool:set_title New conversation title></tool>

Or using shorthand on its own line:
  @@create_file banana.txt This is the file content

The tool tags are invisible to the user — they get executed automatically.
Only use tools when the user explicitly asks for file creation, opening URLs, etc.

When users ask you to create an image, respond in SVG code with NO brackets like the code MD brackets
and save it using the create_file tool. Example:

<tool:create_file image.svg>
<svg width="800" height="800" viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg" class="icon logo">
  <circle cx="200" cy="200" r="150" stroke="#000000" stroke-width="2" fill="none"/>
  <text x="200" y="210" font-size="60" text-anchor="middle" fill="#000000">Corelyn</text>
</svg>
</tool>`,
  triggers: JSON.parse(localStorage.getItem('nc_triggers') || '[]'),
  chats: JSON.parse(localStorage.getItem('nc_chats') || '[]'),
  activeChatId: null,
  streaming: false,

  // ── New feature flags ──
  deepThink: false,
  webSearch: false,
  attachedFiles: []
};



// ============================
// DOM
// ============================

const $ = id => document.getElementById(id);
const messagesEl = $('messages');
const welcomeEl = $('welcomeScreen');
const inputEl = $('userInput');
const sendBtn = $('sendBtn');
const chatListEl = $('chatList');
const topbarTitle = $('topbarTitle');
const modelLabel = $('modelLabel');
const modelDropdown = $('modelDropdown');
const modelSelector = $('modelSelector');
const sidebar = $('sidebar');
const sidebarToggle = $('sidebarToggle');

// Settings Modal
const settingsModal = $('settingsModal');
const openSettingsBtn = $('openSettingsBtn');
const closeSettingsBtn = $('closeSettings');
const saveSettingsBtn = $('saveSettingsBtn');
const apiKeyInput = $('apiKeyInput');
const providerSelect = $('providerSelect');
const systemPromptInput = $('systemPromptInput');
const triggerListEl = $('triggerList');
const addTriggerBtn = $('addTriggerBtn');

// Did not know where to add this
const donateModal = document.getElementById("donateModal");
const openDonateBtn = document.getElementById("openDonateBtn");
const closeDonate = document.getElementById("closeDonate");
const dontShowDonate = document.getElementById("dontShowDonate");

const modelSelect = document.getElementById("modelSelect");

// ── Corelyn Cloud Auth (Google -> auto-generate API key) ──
const authModal = $('authModal');
const closeAuthModalBtn = $('closeAuthModal');
const authAccountView = $('authAccountView');
const authLoadingView = $('authLoadingView');
const authErrorView = $('authErrorView');
const authErrorText = $('authErrorText');
const authRetryBtn = $('authRetryBtn');
const authCloseFromErrorBtn = $('authCloseFromError');
const authGoogleBtn = $('authGoogleBtn');

const providerModels = {
  corelyn: [
    "nvidia/moonshotai/kimi-k2.5",
    "nvidia/qwen/qwen3.5-397b-a17b",
    "nvidia/microsoft/phi-3.5-mini-instruct",
    "nvidia/meta/llama-3.2-1b-instruct",
    "nvidia/deepseek-ai/deepseek-v3.1",
    "nvidia/z-ai/glm5",
    "nvidia/mistralai/mistral-7b-instruct-v0.2",
    "nvidia/google/gemma-7b",
    "nvidia/tiiuae/falcon3-7b-instruct",
    "nvidia/minimaxai/minimax-m2.5",
    "nvidia/nvidia/nemotron-3-super-120b-a12",
    "cerebras/llama3.1-8b"
  ],
  openai: [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
    "o4-mini",
    "o3-mini"
  ],

  anthropic: [
    "claude-3-opus",
    "claude-3-sonnet",
    "claude-3-haiku",
    "claude-3.5-sonnet",
    "claude-3.5-haiku"
  ],

  cerebras: [
    "llama3.1-8b",
    "qwen-3-235b-a22b-instruct-2507"
  ]
};

function updateModels() {
  const provider = providerSelect.value;

  modelSelect.innerHTML = "";

  const models = providerModels[provider] || [];

  models.forEach(model => {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    modelSelect.appendChild(option);
  });
}

providerSelect.addEventListener("change", updateModels);

// initialize on page load
updateModels();


// hide donate button if user disabled it
if (localStorage.getItem("hideDonateModal") === "true") {
  openDonateBtn.style.display = "none";
}

// open modal
openDonateBtn.onclick = () => {
  donateModal.style.display = "flex";
};

// close modal
closeDonate.onclick = () => {

  if (dontShowDonate.checked) {
    localStorage.setItem("hideDonateModal", "true");

    // hide button immediately
    openDonateBtn.style.display = "none";
  }

  donateModal.style.display = "none";
};

// close when clicking outside modal
window.onclick = (e) => {
  if (e.target === donateModal) {
    donateModal.style.display = "none";
  }
};




// ============================
// ── FEATURE: Web Search ──
// ============================

async function fetchWebSearchContext(query) {
  const results = await Promise.allSettled([
    fetchDDGAnswer(query),
    fetchWikipediaSummary(query),
  ]);

  const snippets = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) snippets.push(r.value);
  }

  if (!snippets.length) {
    console.warn('Web search: no results from any source');
    return null;
  }

  return `[Web search results for: "${query}"]\n\n${snippets.join('\n\n')}\n[End of search results]`;
}

async function fetchDDGAnswer(query) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&no_redirect=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();

    const parts = [];
    if (data.Answer)   parts.push(`**Instant answer:** ${data.Answer}`);
    if (data.Abstract) parts.push(`**Summary:** ${data.Abstract}${data.AbstractURL ? ` — [source](${data.AbstractURL})` : ''}`);

    const topics = (data.RelatedTopics || [])
      .filter(t => t.Text && !t.Topics)
      .slice(0, 4)
      .map(t => `- ${t.Text}`);
    if (topics.length) parts.push(`**Related topics:**\n${topics.join('\n')}`);

    return parts.length ? `### DuckDuckGo\n${parts.join('\n\n')}` : null;
  } catch (e) {
    console.warn('DDG search failed:', e.message);
    return null;
  }
}

async function fetchWikipediaSummary(query) {
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=1&format=json&origin=*`;
    const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(5000) });
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const title = searchData?.query?.search?.[0]?.title;
    if (!title) return null;

    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const summaryRes = await fetch(summaryUrl, { signal: AbortSignal.timeout(5000) });
    if (!summaryRes.ok) return null;
    const summaryData = await summaryRes.json();
    const extract = summaryData?.extract;
    if (!extract) return null;

    const short = extract.length > 600 ? extract.slice(0, 600) + '…' : extract;
    return `### Wikipedia — ${title}\n${short}\n[Read more](${summaryData.content_urls?.desktop?.page || ''})`;
  } catch (e) {
    console.warn('Wikipedia search failed:', e.message);
    return null;
  }
}

// ============================
// ── FEATURE: File Upload ──
// ============================

function injectFileUploadUI() {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.id = 'fileUploadInput';
  fileInput.multiple = true;
  fileInput.accept = '.txt,.md,.js,.ts,.py,.json,.csv,.html,.css,.xml,.yaml,.yml,.pdf,.png,.jpg,.jpeg,.gif,.webp';
  fileInput.style.display = 'none';
  document.body.appendChild(fileInput);

  const attachBtn = document.createElement('button');
  attachBtn.id = 'attachBtn';
  attachBtn.className = 'input-feature-btn';
  attachBtn.title = 'Attach files';
  attachBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>`;

  const deepThinkBtn = document.createElement('button');
  deepThinkBtn.id = 'deepThinkBtn';
  deepThinkBtn.className = 'input-feature-btn';
  deepThinkBtn.title = 'Deep Think — makes the AI reason step-by-step';
  deepThinkBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>`;

  const webSearchBtn = document.createElement('button');
  webSearchBtn.id = 'webSearchBtn';
  webSearchBtn.className = 'input-feature-btn';
  webSearchBtn.title = 'Web Search — fetch live context before answering';
  webSearchBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;

  const filePreviewBar = document.createElement('div');
  filePreviewBar.id = 'filePreviewBar';
  filePreviewBar.className = 'file-preview-bar';
  filePreviewBar.style.display = 'none';

  const inputWrapper = sendBtn.parentElement;
  inputWrapper.insertBefore(attachBtn, sendBtn);
  inputWrapper.insertBefore(deepThinkBtn, sendBtn);
  inputWrapper.insertBefore(webSearchBtn, sendBtn);

  const inputArea = document.querySelector('.input-area') || inputWrapper.parentElement;
  inputArea.insertBefore(filePreviewBar, inputArea.firstChild);

  attachBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files);
    if (!files.length) return;
    for (const file of files) {
      await readAndAttachFile(file);
    }
    fileInput.value = '';
    renderFilePreviewBar();
  });

  deepThinkBtn.addEventListener('click', () => {
    state.deepThink = !state.deepThink;
    deepThinkBtn.classList.toggle('active', state.deepThink);
    deepThinkBtn.title = state.deepThink ? 'Deep Think ON' : 'Deep Think — makes the AI reason step-by-step';
    showToast(state.deepThink ? '🧠 Deep Think enabled' : '🧠 Deep Think disabled');
  });

  webSearchBtn.addEventListener('click', () => {
    state.webSearch = !state.webSearch;
    webSearchBtn.classList.toggle('active', state.webSearch);
    webSearchBtn.title = state.webSearch ? 'Web Search ON' : 'Web Search — fetch live context before answering';
    showToast(state.webSearch ? '🔎 Web Search enabled' : '🔎 Web Search disabled');
  });

  injectFeatureStyles();
}

async function readAndAttachFile(file) {
  return new Promise((resolve) => {
    const isImage = file.type.startsWith('image/');
    const reader = new FileReader();

    reader.onload = (e) => {
      if (isImage) {
        state.attachedFiles.push({ name: file.name, type: file.type, content: e.target.result, isImage: true });
      } else {
        state.attachedFiles.push({ name: file.name, type: file.type || 'text/plain', content: e.target.result, isImage: false });
      }
      resolve();
    };

    reader.onerror = () => { showToast(`Failed to read ${file.name}`, 'error'); resolve(); };

    if (isImage) { reader.readAsDataURL(file); } else { reader.readAsText(file); }
  });
}

function renderFilePreviewBar() {
  const bar = $('filePreviewBar');
  if (!bar) return;
  if (!state.attachedFiles.length) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  bar.style.display = 'flex';
  bar.innerHTML = '';
  state.attachedFiles.forEach((f, i) => {
    const chip = document.createElement('div');
    chip.className = 'file-chip';
    const icon = f.isImage ? '🖼️' : getFileIcon(f.name);
    chip.innerHTML = `<span class="file-chip-icon">${icon}</span><span class="file-chip-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name.length > 20 ? f.name.slice(0,18)+'…' : f.name)}</span><button class="file-chip-remove" data-i="${i}" title="Remove">×</button>`;
    chip.querySelector('.file-chip-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      state.attachedFiles.splice(i, 1);
      renderFilePreviewBar();
    });
    bar.appendChild(chip);
  });
}

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const map = { js:'📜', ts:'📜', py:'🐍', json:'📋', csv:'📊', html:'🌐', css:'🎨', md:'📝', txt:'📄', pdf:'📕', xml:'📋', yaml:'📋', yml:'📋' };
  return map[ext] || '📎';
}

const MAX_FILE_CHARS = 40000;

function buildFileContext(filesSnapshot) {
  const files = filesSnapshot || state.attachedFiles;
  const textFiles = files.filter(f => !f.isImage);
  if (!textFiles.length) return '';
  const parts = textFiles.map(f => {
    let content = f.content.replace(/\0/g, '').replace(/\r\n/g, '\n');
    const truncated = content.length > MAX_FILE_CHARS;
    if (truncated) content = content.slice(0, MAX_FILE_CHARS) + `\n\n[...truncated at ${MAX_FILE_CHARS} chars]`;
    return `--- File: ${f.name} ---\n${content}\n--- End of ${f.name} ---`;
  });
  return '\n\n[Attached files:]\n' + parts.join('\n\n');
}

function buildContentBlocks(textContent, filesSnapshot, provider) {
  const files = filesSnapshot || [];
  const imageFiles = files.filter(f => f.isImage);

  if (!imageFiles.length) return textContent;

  const blocks = [];

  if (provider === 'anthropic') {
    imageFiles.forEach(f => {
      const mediaType = f.type || 'image/jpeg';
      const base64 = f.content.split(',')[1] || f.content;
      blocks.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } });
    });
    blocks.push({ type: 'text', text: textContent });
  } else {
    const contentArr = [];
    imageFiles.forEach(f => { contentArr.push({ type: 'image_url', image_url: { url: f.content } }); });
    contentArr.push({ type: 'text', text: textContent });
    return contentArr;
  }

  return blocks;
}

// ============================
// ── FEATURE: Deep Think ──
// ============================

const DEEP_THINK_PREFIX = `Before answering, reason through this step-by-step inside a <thinking> block:
<thinking>
1. What is the user really asking?
2. What do I know that's relevant?
3. What are the edge cases or nuances?
4. What is the best approach?
</thinking>
Then give your final answer after the thinking block. Be thorough and accurate.

`;

function buildSystemPrompt() {
  const base = state.systemPrompt;
  return state.deepThink ? DEEP_THINK_PREFIX + base : base;
}

// ============================
// Init
// ============================

function init() {
  renderChatList();
  if (state.chats.length > 0) loadChat(state.chats[0].id);
  setupEventListeners();
  updateModelLabel();
  if (!state.apiKey) ensureApiKey();
  injectFileUploadUI();
  injectMessageActionStyles();
}

function promptForKeyManual() {
  const key = window.prompt('Enter API Key:', '');
  if (key && key.trim()) {
    state.apiKey = key.trim();
    localStorage.setItem('nc_apikey', state.apiKey);
  }
}

// ============================
// Corelyn Cloud Auth Flow
// ============================

const CORELYN_API_BASE = 'https://api.corelyn.ro';
const CORELYN_GOOGLE_CLIENT_ID = '1095022231097-m2jpnjm7fkh0k2kd46hca3p4i8b6v3k0.apps.googleusercontent.com';
const CORELYN_USER_TOKEN_KEY = 'corelyn_user_token';

let apiKeyEnsurePromise = null;
let apiKeyEnsureResolve = null;
let googleButtonInitialized = false;

function showAuthView(viewName) {
  const views = [authAccountView, authLoadingView, authErrorView].filter(Boolean);
  views.forEach(v => (v.style.display = 'none'));

  if (viewName === 'account' && authAccountView) authAccountView.style.display = '';
  if (viewName === 'loading' && authLoadingView) authLoadingView.style.display = '';
  if (viewName === 'error' && authErrorView) authErrorView.style.display = '';
}

function openAuthModal() {
  if (!authModal) return;
  authModal.style.display = 'flex';
}

function closeAuthModal() {
  if (!authModal) return;
  authModal.style.display = 'none';
}

function resolveApiKeyEnsure(value) {
  if (!apiKeyEnsureResolve) return;
  const r = apiKeyEnsureResolve;
  apiKeyEnsureResolve = null;
  r(value);
}

function setStateApiKey(newKey) {
  state.apiKey = newKey;
  localStorage.setItem('nc_apikey', state.apiKey);
  if (apiKeyInput) apiKeyInput.value = state.apiKey;
  sendBtn.disabled = !inputEl.value.trim();
}

async function fetchCorelynKeyFromToken(token) {
  const res = await fetch(`${CORELYN_API_BASE}/get-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Failed to fetch key (${res.status})`);
  if (data?.error) throw new Error(data.error);
  if (!data?.key) throw new Error('No key returned from server.');
  return data.key;
}

async function handleGoogleLogin(response) {
  showAuthView('loading');

  try {
    const credential = response?.credential;
    if (!credential) throw new Error('Missing Google credential.');

    const res = await fetch(`${CORELYN_API_BASE}/google-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `Google login failed (${res.status})`);
    if (data?.error) throw new Error(data.error);
    if (!data?.token) throw new Error('Server did not return a token.');

    localStorage.setItem(CORELYN_USER_TOKEN_KEY, data.token);

    const apiKey = await fetchCorelynKeyFromToken(data.token);
    setStateApiKey(apiKey);
    closeAuthModal();
    resolveApiKeyEnsure(apiKey);
  } catch (err) {
    const msg = err?.message || 'Failed to generate API key.';
    if (authErrorText) authErrorText.textContent = msg;
    showAuthView('error');
  }
}

function initGoogleAuthButton() {
  if (googleButtonInitialized) return;
  if (!authGoogleBtn) return;

  if (!window.google?.accounts?.id) {
    setTimeout(initGoogleAuthButton, 250);
    return;
  }

  window.google.accounts.id.initialize({
    client_id: CORELYN_GOOGLE_CLIENT_ID,
    callback: handleGoogleLogin
  });

  window.google.accounts.id.renderButton(authGoogleBtn, {
    theme: 'filled_black',
    size: 'large',
    text: 'signin_with',
    shape: 'rectangular'
  });

  googleButtonInitialized = true;
}

function openGoogleForApiKey() {
  if (!authModal) return Promise.resolve(null);

  return new Promise(async (resolve) => {
    apiKeyEnsureResolve = resolve;

    // Bind close/retry handlers (override, no duplication).
    if (closeAuthModalBtn) closeAuthModalBtn.onclick = () => { closeAuthModal(); resolveApiKeyEnsure(null); };
    if (authCloseFromErrorBtn) authCloseFromErrorBtn.onclick = () => { closeAuthModal(); resolveApiKeyEnsure(null); };
    if (authRetryBtn) {
      authRetryBtn.onclick = async () => {
        const token = localStorage.getItem(CORELYN_USER_TOKEN_KEY);
        if (!token) {
          showAuthView('account');
          return;
        }

        showAuthView('loading');
        try {
          const apiKey = await fetchCorelynKeyFromToken(token);
          setStateApiKey(apiKey);
          closeAuthModal();
          resolveApiKeyEnsure(apiKey);
        } catch (err) {
          const msg = err?.message || 'Failed to fetch API key.';
          if (authErrorText) authErrorText.textContent = msg;
          showAuthView('error');
        }
      };
    }

    openAuthModal();
    showAuthView('account');
    initGoogleAuthButton();

    // If user already has a token saved, we can skip the account view.
    const existingToken = localStorage.getItem(CORELYN_USER_TOKEN_KEY);
    if (existingToken) {
      showAuthView('loading');
      try {
        const apiKey = await fetchCorelynKeyFromToken(existingToken);
        setStateApiKey(apiKey);
        closeAuthModal();
        resolveApiKeyEnsure(apiKey);
      } catch (err) {
        localStorage.removeItem(CORELYN_USER_TOKEN_KEY);
        const msg = err?.message || 'Token invalid. Please sign in again.';
        if (authErrorText) authErrorText.textContent = msg;
        showAuthView('error');
      }
    }
  });
}

async function ensureApiKey() {
  if (state.apiKey) return state.apiKey;
  if (apiKeyEnsurePromise) return apiKeyEnsurePromise;

  apiKeyEnsurePromise = (async () => {
    // Corelyn-generated keys only work with the Corelyn provider.
    if (state.provider !== 'corelyn') {
      state.provider = 'corelyn';
      localStorage.setItem('nc_provider', state.provider);

      if (providerSelect) {
        providerSelect.value = 'corelyn';
        updateModels();
        if (modelSelect) modelSelect.value = state.model;
      }

      const corelynModels = providerModels.corelyn || [];
      const fallbackModel = 'cerebras/llama3.1-8b';
      if (corelynModels.length && !corelynModels.includes(state.model)) {
        state.model = corelynModels.includes(fallbackModel) ? fallbackModel : corelynModels[0];
        localStorage.setItem('nc_model', state.model);
      }

      updateModelLabel();
    }

    // Try token-first (same idea as cloud.html, but without the redirect).
    const token = localStorage.getItem(CORELYN_USER_TOKEN_KEY);
    if (token) {
      try {
        const apiKey = await fetchCorelynKeyFromToken(token);
        setStateApiKey(apiKey);
        return apiKey;
      } catch (err) {
        localStorage.removeItem(CORELYN_USER_TOKEN_KEY);
      }
    }

    return await openGoogleForApiKey();
  })();

  try {
    return await apiKeyEnsurePromise;
  } finally {
    apiKeyEnsurePromise = null;
  }
}

// ============================
// Chat Management
// ============================

function createChat() {
  const chat = { id: Date.now().toString(), title: 'New Chat', messages: [], createdAt: Date.now() };
  state.chats.unshift(chat);
  saveChats();
  renderChatList();
  loadChat(chat.id);
}

function loadChat(id) {
  state.activeChatId = id;
  const chat = getChat(id);
  if (!chat) return;
  topbarTitle.textContent = chat.title;
  messagesEl.innerHTML = '';
  if (chat.messages.length === 0) {
    welcomeEl.style.display = 'flex';
    messagesEl.style.display = 'none';
  } else {
    welcomeEl.style.display = 'none';
    messagesEl.style.display = 'flex';
    chat.messages.forEach(msg => {
      if (msg.role === 'tool-feedback') {
        renderToolFeedback(msg.content);
      } else {
        renderMessage(msg.role, msg.content);
      }
    });
    attachRunButtons();
  }
  renderChatList();
  scrollToBottom(true);
}

function getChat(id) { return state.chats.find(c => c.id === id); }
function getActiveChat() { return getChat(state.activeChatId); }

function deleteChat(id) {
  state.chats = state.chats.filter(c => c.id !== id);
  saveChats();
  if (state.activeChatId === id) {
    if (state.chats.length > 0) loadChat(state.chats[0].id);
    else { state.activeChatId = null; messagesEl.innerHTML = ''; welcomeEl.style.display = 'flex'; topbarTitle.textContent = 'New Conversation'; }
  }
  renderChatList();
}

function saveChats() { localStorage.setItem('nc_chats', JSON.stringify(state.chats)); }

function renderChatList() {
  chatListEl.innerHTML = '';
  if (state.chats.length === 0) { chatListEl.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text-muted);">No chats yet</div>'; return; }
  state.chats.forEach(chat => {
    const item = document.createElement('div');
    item.className = 'chat-item' + (chat.id === state.activeChatId ? ' active' : '');
    item.dataset.id = chat.id;
    const title = document.createElement('span');
    title.className = 'chat-item-title'; title.textContent = chat.title;
    const del = document.createElement('button'); del.className = 'chat-item-del'; del.innerHTML = '×'; del.onclick = e => { e.stopPropagation(); deleteChat(chat.id); };
    item.appendChild(title); item.appendChild(del); item.onclick = () => loadChat(chat.id);
    chatListEl.appendChild(item);
  });
}

// ============================
// Messaging
// ============================

async function sendMessage(content) {
  if (!content.trim() || state.streaming) return;
  if (!state.apiKey) {
    await ensureApiKey();
    if (!state.apiKey) return;
  }

  if (!state.activeChatId) createChat();
  const chat = getActiveChat(); if (!chat) return;

  welcomeEl.style.display = 'none'; messagesEl.style.display = 'flex';

  const filesSnapshot = [...state.attachedFiles];
  const fileContext = buildFileContext(filesSnapshot);
  state.attachedFiles = [];
  renderFilePreviewBar();

  const displayContent = filesSnapshot.length
    ? content + '\n\n' + filesSnapshot.map(f => `📎 ${f.name}`).join('\n')
    : content;

  chat.messages.push({ role: 'user', content: displayContent });
  await renderMessageAsync('user', displayContent);
  updateChatTitle(chat, content);
  saveChats();
  inputEl.value = ''; autoResize(); sendBtn.disabled = true;

  const typingEl = showTyping();
  state.streaming = true;

  try {
    let searchContext = '';
    if (state.webSearch) {
      typingEl.querySelector('.bubble').innerHTML = getThinkingHtml('🔎 Searching the web…');
      searchContext = await fetchWebSearchContext(content) || '';
      if (!searchContext) showToast('🔎 Web search returned no results', 'error');
      typingEl.querySelector('.bubble').innerHTML = getThinkingHtml();
    }

    let apiUserContent = content;
    if (searchContext) apiUserContent += '\n\n' + searchContext;
    if (fileContext) apiUserContent += fileContext;

    const historyMessages = chat.messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(0, -1);

    const apiMessages = [
      ...historyMessages,
      { role: 'user', content: apiUserContent }
    ];

    const rawText = await callProvider(apiMessages, filesSnapshot);
    typingEl.remove();

    const { cleanText, toolResults } = processAiTools(rawText);
    const displayText = cleanText || rawText;

    chat.messages.push({ role: 'assistant', content: displayText });
    saveChats();
    await renderMessageAsync('assistant', displayText);

    if (toolResults.length) {
      const feedbackText = buildToolFeedbackMessage(toolResults);
      chat.messages.push({ role: 'tool-feedback', content: feedbackText });
      saveChats();
      await renderToolFeedbackAsync(feedbackText);
    }

    if (searchContext) {
      const notice = `🔎 **Web search was used** to augment this response.`;
      chat.messages.push({ role: 'tool-feedback', content: notice });
      saveChats();
      await renderToolFeedbackAsync(notice);
    }

    if (state.deepThink) {
      const notice = `🧠 **Deep Think mode was active** for this response.`;
      chat.messages.push({ role: 'tool-feedback', content: notice });
      saveChats();
      await renderToolFeedbackAsync(notice);
    }

  } catch (err) {
    typingEl.remove(); renderError(err.message || 'Request failed.');
  } finally {
    state.streaming = false;
    sendBtn.disabled = !inputEl.value.trim();
  }
}

// ============================
// Provider Calls
// ============================
async function callProvider(messages, filesSnapshot) {
  const provider = PROVIDERS[state.provider];
  if (!provider) throw new Error("Invalid provider");

  const systemPrompt = buildSystemPrompt();

  // Handle images in the last message
  let apiMessages = messages;
  const hasImages = (filesSnapshot || []).some(f => f.isImage);

  if (hasImages) {
    apiMessages = messages.slice(0, -1);
    const lastMsg = messages[messages.length - 1];
    const contentBlocks = buildContentBlocks(lastMsg.content, filesSnapshot, state.provider);
    const userContent = typeof contentBlocks === "string" ? contentBlocks : JSON.stringify(contentBlocks);
    apiMessages = [...apiMessages, { role: 'user', content: userContent }];
  }

  // Prepend system prompt if present
  const msgsWithSystem = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...apiMessages] : apiMessages;

  let body;

  if (state.provider === 'anthropic') {
    body = { model: state.model, messages: msgsWithSystem, max_tokens: 4096, temperature: 0.7 };
  } else if (state.provider === 'corelyn') {
    // Corelyn expects 'messages' array, not 'prompt'
    const filteredMessages = msgsWithSystem
      .filter(msg => msg.role === 'system' || msg.role === 'user')
      .map(msg => ({ role: msg.role, content: msg.content }));

    if (filteredMessages.length === 0) throw new Error("No valid messages for Corelyn API");

    body = {
      apiKey: state.apiKey,
      model: state.model,
      messages: filteredMessages
    };
  } else {
    body = { model: state.model, messages: msgsWithSystem, temperature: 0.7 };
  }

  const headers = { 'Content-Type': 'application/json' };
  if (state.provider !== 'corelyn') {
    headers['Authorization'] = `Bearer ${state.apiKey}`;
  }

  const res = await fetch(provider.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `Provider error: ${res.status}`);
  }

  const data = await res.json();

  // Return text depending on provider
  if (state.provider === 'anthropic') return data.content?.[0]?.text || "(no response)";
  if (state.provider === 'corelyn') return data.choices?.[0]?.message?.content || data.text || "(no response)";
  return data.choices?.[0]?.message?.content || data.text || "(no response)";
}



// ============================
// ── THINKING ANIMATION ──
// ============================

function getThinkingHtml(label) {
  const text = label || 'Thinking…';
  return `
    <div class="thinking-animation">
      <div class="thinking-orb">
        <div class="thinking-core"></div>
        <div class="thinking-ring thinking-ring-1"></div>
        <div class="thinking-ring thinking-ring-2"></div>
        <div class="thinking-ring thinking-ring-3"></div>
        <div class="thinking-particles">
          <span></span><span></span><span></span>
          <span></span><span></span><span></span>
        </div>
      </div>
      <div class="thinking-text">
        <span class="thinking-label">${escapeHtml(text)}</span>
        <div class="thinking-dots"><span></span><span></span><span></span></div>
      </div>
    </div>
  `;
}

// ============================
// ── MESSAGE ACTIONS (copy + edit) ──
// ============================

function createMessageActions(role, content, msgEl) {
  const actions = document.createElement('div');
  actions.className = 'msg-actions';

  // Copy button (both roles)
  const copyBtn = document.createElement('button');
  copyBtn.className = 'msg-action-btn msg-copy-btn';
  copyBtn.title = 'Copy message';
  copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg><span>Copy</span>`;
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(content);
      copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span>Copied!</span>`;
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg><span>Copy</span>`;
        copyBtn.classList.remove('copied');
      }, 1800);
    } catch(e) {
      showToast('Failed to copy', 'error');
    }
  });
  actions.appendChild(copyBtn);

  // Edit button (user only)
  if (role === 'user') {
    const editBtn = document.createElement('button');
    editBtn.className = 'msg-action-btn msg-edit-btn';
    editBtn.title = 'Edit message';
    editBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg><span>Edit</span>`;

    editBtn.addEventListener('click', () => {
      const bubble = msgEl.querySelector('.bubble');
      const originalText = content;

      // Build inline editor
      const editorWrap = document.createElement('div');
      editorWrap.className = 'msg-inline-editor';

      const textarea = document.createElement('textarea');
      textarea.className = 'msg-edit-textarea';
      textarea.value = originalText;
      textarea.rows = Math.max(2, originalText.split('\n').length);
      textarea.style.height = 'auto';

      const btnRow = document.createElement('div');
      btnRow.className = 'msg-edit-btn-row';

      const saveBtn = document.createElement('button');
      saveBtn.className = 'msg-edit-save';
      saveBtn.textContent = 'Send';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'msg-edit-cancel';
      cancelBtn.textContent = 'Cancel';

      btnRow.appendChild(cancelBtn);
      btnRow.appendChild(saveBtn);
      editorWrap.appendChild(textarea);
      editorWrap.appendChild(btnRow);

      bubble.style.display = 'none';
      actions.style.display = 'none';
      msgEl.querySelector('.message-row').appendChild(editorWrap);

      textarea.focus();
      textarea.style.height = textarea.scrollHeight + 'px';
      textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
      });

      cancelBtn.addEventListener('click', () => {
        editorWrap.remove();
        bubble.style.display = '';
        actions.style.display = '';
      });

      saveBtn.addEventListener('click', () => {
        const newText = textarea.value.trim();
        if (!newText || newText === originalText) {
          cancelBtn.click();
          return;
        }
        editorWrap.remove();
        bubble.style.display = '';
        actions.style.display = '';

        // Update message in chat history and resend from this point
        const chat = getActiveChat();
        if (!chat) return;

        // Find index of this message
        const msgIndex = chat.messages.findIndex(m => m.role === 'user' && m.content === originalText);
        if (msgIndex !== -1) {
          // Truncate messages from this point onward
          chat.messages.splice(msgIndex);
          saveChats();

          // Remove all DOM messages from this point
          const allMsgEls = Array.from(messagesEl.querySelectorAll('.message'));
          const msgElIdx = allMsgEls.indexOf(msgEl);
          if (msgElIdx !== -1) {
            for (let i = msgElIdx; i < allMsgEls.length; i++) {
              allMsgEls[i].remove();
            }
          }
        }

        // Send the edited message
        sendMessage(newText);
      });
    });
    actions.appendChild(editBtn);
  }

  return actions;
}

// ============================
// Rendering
// ============================

function renderMessage(role, content) {
  const msg = document.createElement('div');
  msg.className = `message ${role}`;

  if (role === 'assistant') {
    msg.innerHTML = `<div class="message-row"><div class="avatar assistant"> </div><div class="bubble">${markdownToHtml(content)}</div></div>`;
  } else {
    msg.innerHTML = `<div class="message-row"><div class="avatar user"> </div><div class="bubble">${escapeHtml(content)}</div></div>`;
  }

  const actions = createMessageActions(role, content, msg);
  msg.appendChild(actions);

  messagesEl.appendChild(msg);
  scrollToBottom(true);
}

function renderToolFeedback(content) {
  const el = document.createElement('div');
  el.className = 'message tool-feedback';
  el.innerHTML = `
    <div class="message-row">
      <div class="avatar tool-fb-avatar">🔧</div>
      <div class="bubble tool-fb-bubble">${markdownToHtml(content)}</div>
    </div>`;
  messagesEl.appendChild(el);
  scrollToBottom(true);
}

async function renderToolFeedbackAsync(content) {
  const el = document.createElement('div');
  el.className = 'message tool-feedback';
  el.style.opacity = '0';
  el.style.transform = 'translateY(6px)';
  el.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
  el.innerHTML = `
    <div class="message-row">
      <div class="avatar tool-fb-avatar">🔧</div>
      <div class="bubble tool-fb-bubble">${markdownToHtml(content)}</div>
    </div>`;
  messagesEl.appendChild(el);
  scrollToBottom(true);
  await new Promise(r => setTimeout(r, 30));
  el.style.opacity = '1';
  el.style.transform = 'translateY(0)';
  scrollToBottom(true);
}

// ── UPDATED: showTyping uses the new thinking animation ──
function showTyping() {
  const msg = document.createElement('div');
  msg.className = 'message assistant';
  msg.innerHTML = `<div class="message-row"><div class="avatar assistant"> </div><div class="bubble thinking-bubble">${getThinkingHtml()}</div></div>`;
  messagesEl.appendChild(msg);
  scrollToBottom(true);
  return msg;
}

function renderError(text) {
  const msg = document.createElement('div'); msg.className = 'message assistant';
  msg.innerHTML = `<div class="message-row"><div class="avatar assistant" style="color:red;">!</div><div class="bubble" style="color:red;">${escapeHtml(text)}</div></div>`;
  messagesEl.appendChild(msg);
}

// ============================
// Trigger Engine
// ============================

function checkTriggers(text) {
  state.triggers.forEach((trigger, idx) => {
    if (!trigger.match || !trigger.action) return;
    let matched = false;
    let matchResult = null;
    try {
      if (trigger.type === 'regex') {
        const re = new RegExp(trigger.match, 'i');
        matchResult = text.match(re);
        matched = !!matchResult;
      } else {
        matched = text.toLowerCase().includes(trigger.match.toLowerCase());
        matchResult = matched ? [trigger.match] : null;
      }
    } catch(e) {
      showToast(`Trigger #${idx+1} match error: ${e.message}`, 'error');
      return;
    }

    if (!matched) return;

    let actionResult = null;
    let actionError = null;
    try {
      actionResult = new Function('response', 'match', trigger.action)(text, matchResult);
    } catch(e) {
      actionError = e.message;
      showToast(`Trigger #${idx+1} JS error: ${e.message}`, 'error');
    }

    const feedbackLines = [];
    feedbackLines.push(`⚡ **Trigger fired** — matched \`${escapeHtml(trigger.match)}\``);
    if (trigger.type === 'regex' && matchResult) {
      feedbackLines.push(`↳ Regex capture: \`${matchResult[0]}\``);
    }
    if (actionError) {
      feedbackLines.push(`❌ Action error: ${escapeHtml(actionError)}`);
    } else {
      feedbackLines.push(`✅ Action ran successfully${actionResult !== undefined && actionResult !== null ? ` → \`${String(actionResult).slice(0,80)}\`` : ''}`);
    }
    const feedbackText = feedbackLines.join('\n\n');

    const chat = getActiveChat();
    if (chat) {
      chat.messages.push({ role: 'tool-feedback', content: feedbackText });
      saveChats();
      renderToolFeedbackAsync(feedbackText);
    }

    showToast(`Trigger fired: "${trigger.match}"`);
  });
}

function showToast(msg, type) {
  const toast = document.createElement('div');
  toast.className = 'trigger-toast' + (type === 'error' ? ' trigger-toast-error' : '');
  const icon = type === 'error' ? '⚠️' : '⚡';
  toast.innerHTML = `<span class="trigger-toast-icon">${icon}</span><span>${escapeHtml(msg)}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// ============================
// JS Code Runner
// ============================

function attachRunButtons() {
  messagesEl.querySelectorAll('pre code[class*="language-j"]').forEach(codeEl => {
    const pre = codeEl.parentElement;
    if (pre.querySelector('.run-js-btn')) return;

    const lang = codeEl.className || '';
    if (!lang.match(/language-j(s|avascript)?$/i)) return;

    const btn = document.createElement('button');
    btn.className = 'run-js-btn';
    btn.textContent = '▶ Run';
    pre.style.position = 'relative';
    pre.appendChild(btn);

    btn.addEventListener('click', () => {
      const existing = pre.nextElementSibling;
      if (existing && existing.classList.contains('js-output')) existing.remove();

      const code = codeEl.textContent;
      const outputEl = document.createElement('div');

      const logs = [];
      const origLog = console.log;
      const origWarn = console.warn;
      const origError = console.error;
      console.log = (...a) => { logs.push(a.map(String).join(' ')); origLog(...a); };
      console.warn = (...a) => { logs.push('[warn] ' + a.map(String).join(' ')); origWarn(...a); };
      console.error = (...a) => { logs.push('[error] ' + a.map(String).join(' ')); origError(...a); };

      try {
        const result = new Function(code)();
        console.log = origLog; console.warn = origWarn; console.error = origError;
        const output = [...logs, result !== undefined ? `→ ${String(result)}` : ''].filter(Boolean).join('\n') || '(no output)';
        outputEl.className = 'js-output success';
        outputEl.textContent = output;
      } catch(e) {
        console.log = origLog; console.warn = origWarn; console.error = origError;
        outputEl.className = 'js-output error';
        outputEl.textContent = `Error: ${e.message}`;
      }

      pre.insertAdjacentElement('afterend', outputEl);
    });
  });
}

// ============================
// Async character-by-character rendering
// ============================

async function renderMessageAsync(role, content) {
  const msg = document.createElement('div');
  msg.className = `message ${role}`;

  if (role === 'assistant') {
    const row = document.createElement('div');
    row.className = 'message-row';
    const avatar = document.createElement('div');
    avatar.className = 'avatar assistant';
    avatar.textContent = ' ';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    row.appendChild(avatar);
    row.appendChild(bubble);
    msg.appendChild(row);
    messagesEl.appendChild(msg);

    let rendered = '';
    const chunkSize = 6;
    for (let i = 0; i < content.length; i += chunkSize) {
      rendered += content.slice(i, i + chunkSize);
      bubble.innerHTML = markdownToHtml(rendered);
      scrollToBottom(false);
      await new Promise(r => setTimeout(r, 8));
    }
    bubble.innerHTML = markdownToHtml(content);

    const actions = createMessageActions(role, content, msg);
    msg.appendChild(actions);

    attachRunButtons();
    checkTriggers(content);
  } else {
    msg.innerHTML = `<div class="message-row"><div class="avatar user"> </div><div class="bubble">${escapeHtml(content)}</div></div>`;
    const actions = createMessageActions(role, content, msg);
    msg.appendChild(actions);
    messagesEl.appendChild(msg);
  }
  scrollToBottom(true);
}

// ============================
// Events
// ============================

function setupEventListeners() {
  sendBtn.onclick = () => sendMessage(inputEl.value);
  inputEl.addEventListener('keydown', e => { if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendMessage(inputEl.value); } });
  inputEl.addEventListener('input', () => { autoResize(); sendBtn.disabled=!inputEl.value.trim()||state.streaming; });
  $('newChatBtn').onclick = createChat;
  $('clearBtn').onclick = () => { const chat=getActiveChat(); if(chat){ chat.messages=[]; chat.title='New Chat'; saveChats(); loadChat(chat.id); } };
  sidebarToggle.onclick = () => sidebar.classList.toggle('collapsed');

  modelSelector.addEventListener('click', e=>{ e.stopPropagation(); modelDropdown.classList.toggle('open'); });
  document.querySelectorAll('.model-option').forEach(opt => {
    opt.addEventListener('click', () => {
      state.provider = opt.dataset.provider || state.provider;
      state.model = opt.dataset.model || state.model;
      updateModelLabel();
      document.querySelectorAll('.model-option').forEach(o=>o.classList.remove('active'));
      opt.classList.add('active');
      modelDropdown.classList.remove('open');
      localStorage.setItem('nc_provider', state.provider);
      localStorage.setItem('nc_model', state.model);
    });
  });
  document.addEventListener('click', () => modelDropdown.classList.remove('open'));
  modelLabel.addEventListener('dblclick', () => ensureApiKey());

  document.querySelectorAll('.suggestion-card').forEach(card=>{
    card.onclick=()=>{ const prompt=card.dataset.prompt; inputEl.value=prompt; autoResize(); sendBtn.disabled=false; sendMessage(prompt); };
  });

  // Settings modal
  openSettingsBtn.onclick=()=>{
    apiKeyInput.value=state.apiKey;
    providerSelect.value=state.provider;
    updateModels();
    modelSelect.value=state.model;
    systemPromptInput.value=state.systemPrompt;
    renderTriggerList();
    settingsModal.style.display = 'flex';
  };
  closeSettingsBtn.onclick=()=>{ settingsModal.style.display='none'; };
  window.onclick = e => { if(e.target===settingsModal) settingsModal.style.display='none'; };
  addTriggerBtn.onclick = () => {
    state.triggers.push({ match: '', type: 'contains', action: '' });
    renderTriggerList();
  };
  saveSettingsBtn.onclick=()=>{
    state.apiKey = apiKeyInput.value.trim();
    state.provider = providerSelect.value;
    state.model = modelSelect.value.trim() || state.model;
    state.systemPrompt = systemPromptInput.value;
    state.triggers = [];
    triggerListEl.querySelectorAll('.trigger-row').forEach(row => {
      const match = row.querySelector('.trigger-match').value.trim();
      const type = row.querySelector('.trigger-type').value;
      const action = row.querySelector('.trigger-action').value.trim();
      if (match) state.triggers.push({ match, type, action });
    });
    localStorage.setItem('nc_apikey', state.apiKey);
    localStorage.setItem('nc_provider', state.provider);
    localStorage.setItem('nc_model', state.model);
    localStorage.setItem('nc_systemprompt', state.systemPrompt);
    localStorage.setItem('nc_triggers', JSON.stringify(state.triggers));
    updateModelLabel(); settingsModal.style.display='none';
    showToast('✓ Settings saved');
  };
}

// ============================
// Trigger List UI
// ============================

function renderTriggerList() {
  triggerListEl.innerHTML = '';
  if (state.triggers.length === 0) {
    triggerListEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:4px 2px;">No triggers yet. Add one below — the action runs as JavaScript when the AI response matches.</div>';
    return;
  }
  state.triggers.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'trigger-row trigger-row-vertical';
    const defaultAction = t.action || '// Variables: response (full text), match (array)\n// Examples:\n// alert("AI said: " + match[0])\n// fetch("https://your-webhook.com", { method:"POST", body: response })';
    row.innerHTML = `
      <div class="trigger-row-top">
        <select class="trigger-type">
          <option value="contains" ${t.type==='contains'?'selected':''}>contains</option>
          <option value="regex" ${t.type==='regex'?'selected':''}>regex</option>
        </select>
        <input class="trigger-match" type="text" placeholder="match text or pattern…" value="${escapeHtml(t.match)}">
        <button class="trigger-del-btn" data-i="${i}" title="Delete trigger">×</button>
      </div>
      <div class="trigger-row-bottom">
        <span class="trigger-js-label">JS</span>
        <textarea class="trigger-action" rows="4" spellcheck="false" placeholder="// JS to run. Variables: response, match">${escapeHtml(defaultAction)}</textarea>
      </div>
    `;
    row.querySelector('.trigger-del-btn').onclick = () => {
      state.triggers.splice(i, 1);
      renderTriggerList();
    };
    row.querySelector('.trigger-action').addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const ta = e.target;
        const s = ta.selectionStart, end = ta.selectionEnd;
        ta.value = ta.value.substring(0, s) + '  ' + ta.value.substring(end);
        ta.selectionStart = ta.selectionEnd = s + 2;
      }
    });
    triggerListEl.appendChild(row);
  });
}

// ============================
// Injected styles for new features
// ============================

function injectFeatureStyles() {
  if (document.getElementById('feature-styles')) return;
  const style = document.createElement('style');
  style.id = 'feature-styles';
  style.textContent = `
    /* ── Feature toggle buttons ── */
    .input-feature-btn {
      background: none;
      border: 1px solid transparent;
      border-radius: 6px;
      color: var(--text-muted, #888);
      cursor: pointer;
      padding: 6px 7px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 0.15s, background 0.15s, border-color 0.15s;
      flex-shrink: 0;
    }
    .input-feature-btn:hover {
      color: var(--text, #eee);
      background: rgba(255,255,255,0.06);
    }
    .input-feature-btn.active {
      color: #7eb8f7;
      border-color: #7eb8f7;
      background: rgba(126,184,247,0.1);
    }

    /* ── File preview bar ── */
    .file-preview-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 6px 10px 2px;
    }
    .file-chip {
      display: flex;
      align-items: center;
      gap: 5px;
      background: rgba(126,184,247,0.12);
      border: 1px solid rgba(126,184,247,0.3);
      border-radius: 20px;
      padding: 3px 8px 3px 7px;
      font-size: 12px;
      color: #aac4e0;
      max-width: 220px;
    }
    .file-chip-icon { font-size: 13px; flex-shrink: 0; }
    .file-chip-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 140px;
    }
    .file-chip-remove {
      background: none;
      border: none;
      color: #7eb8f7;
      cursor: pointer;
      font-size: 14px;
      padding: 0;
      line-height: 1;
      flex-shrink: 0;
      opacity: 0.7;
    }
    .file-chip-remove:hover { opacity: 1; }

    /* ── Tool feedback bubbles ── */
    .message.tool-feedback .tool-fb-avatar {
      background: linear-gradient(135deg, #2a2a3a, #3a3a50);
      border: 1px solid #555;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .message.tool-feedback .tool-fb-bubble {
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      border: 1px solid #334;
      color: #aac4e0;
      font-size: 13px;
      border-radius: 8px;
      padding: 10px 14px;
    }
    .message.tool-feedback .tool-fb-bubble strong { color: #7eb8f7; }
    .message.tool-feedback .tool-fb-bubble code {
      background: #0d1117;
      color: #79c0ff;
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 12px;
    }
  `;
  document.head.appendChild(style);
}

// ============================
// ── NEW: Thinking animation + message action styles ──
// ============================

function injectMessageActionStyles() {
  if (document.getElementById('msg-action-styles')) return;
  const style = document.createElement('style');
  style.id = 'msg-action-styles';
  style.textContent = `
    /* ══════════════════════════════════
       THINKING ANIMATION
    ══════════════════════════════════ */
    .thinking-bubble {
      background: transparent !important;
      border: none !important;
      box-shadow: none !important;
      padding: 4px 0 !important;
    }

    .thinking-animation {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    /* Orb container */
    .thinking-orb {
      position: relative;
      width: 36px;
      height: 36px;
      flex-shrink: 0;
    }

    /* Glowing core */
    .thinking-core {
      position: absolute;
      inset: 50%;
      transform: translate(-50%, -50%);
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: radial-gradient(circle, #e0b8ff 0%, #b87ef7 50%, #9a5fd4 100%);
      box-shadow: 0 0 8px 3px rgba(184, 126, 247, 0.6), 0 0 20px 6px rgba(184, 126, 247, 0.2);
      animation: thinking-core-pulse 1.8s ease-in-out infinite;
    }

    @keyframes thinking-core-pulse {
      0%, 100% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 0 8px 3px rgba(184,126,247,0.6), 0 0 20px 6px rgba(184,126,247,0.2); }
      50%       { transform: translate(-50%, -50%) scale(1.3); box-shadow: 0 0 12px 5px rgba(184,126,247,0.8), 0 0 28px 10px rgba(184,126,247,0.3); }
    }

    /* Concentric rotating rings */
    .thinking-ring {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 1.5px solid transparent;
    }

    .thinking-ring-1 {
      border-top-color: rgba(184, 126, 247, 0.8);
      border-right-color: rgba(184, 126, 247, 0.2);
      animation: thinking-spin 1.2s linear infinite;
    }

    .thinking-ring-2 {
      inset: 4px;
      border-bottom-color: rgba(224, 184, 255, 0.7);
      border-left-color: rgba(224, 184, 255, 0.15);
      animation: thinking-spin 1.8s linear infinite reverse;
    }

    .thinking-ring-3 {
      inset: 8px;
      border-top-color: rgba(154, 95, 212, 0.5);
      border-right-color: transparent;
      animation: thinking-spin 2.4s linear infinite;
    }

    @keyframes thinking-spin {
      from { transform: rotate(0deg); }
      to   { transform: rotate(360deg); }
    }

    /* Orbiting particles */
    .thinking-particles {
      position: absolute;
      inset: 0;
      animation: thinking-spin 3s linear infinite;
    }

    .thinking-particles span {
      position: absolute;
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: #b87ef7;
      top: 50%;
      left: 50%;
    }

    .thinking-particles span:nth-child(1) { transform: rotate(0deg)   translateX(16px) translateY(-50%); opacity: 0.9; animation: thinking-particle-fade 3s linear infinite 0s; }
    .thinking-particles span:nth-child(2) { transform: rotate(60deg)  translateX(16px) translateY(-50%); opacity: 0.7; animation: thinking-particle-fade 3s linear infinite 0.5s; }
    .thinking-particles span:nth-child(3) { transform: rotate(120deg) translateX(16px) translateY(-50%); opacity: 0.5; animation: thinking-particle-fade 3s linear infinite 1s; }
    .thinking-particles span:nth-child(4) { transform: rotate(180deg) translateX(16px) translateY(-50%); opacity: 0.9; animation: thinking-particle-fade 3s linear infinite 1.5s; }
    .thinking-particles span:nth-child(5) { transform: rotate(240deg) translateX(16px) translateY(-50%); opacity: 0.6; animation: thinking-particle-fade 3s linear infinite 2s; }
    .thinking-particles span:nth-child(6) { transform: rotate(300deg) translateX(16px) translateY(-50%); opacity: 0.8; animation: thinking-particle-fade 3s linear infinite 2.5s; }

    @keyframes thinking-particle-fade {
      0%, 100% { opacity: 0.9; }
      50%       { opacity: 0.2; }
    }

    /* Text + animated dots */
    .thinking-text {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .thinking-label {
      font-size: 13px;
      color: var(--text-muted, #888);
      letter-spacing: 0.02em;
    }

    .thinking-dots {
      display: flex;
      gap: 3px;
      align-items: center;
    }

    .thinking-dots span {
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: var(--text-muted, #888);
      animation: thinking-dot-bounce 1.4s ease-in-out infinite;
    }

    .thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
    .thinking-dots span:nth-child(3) { animation-delay: 0.4s; }

    @keyframes thinking-dot-bounce {
      0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
      40%            { transform: translateY(-5px); opacity: 1; }
    }


    /* ══════════════════════════════════
       MESSAGE ACTION BUTTONS
    ══════════════════════════════════ */

    /* Actions sit as a normal flex row below the bubble */
    .msg-actions {
      display: flex;
      gap: 3px;
      opacity: 0;
      margin-top: 5px;
      /* indent to align with bubble (avatar width ~32px + gap ~10px) */
      padding-left: 42px;
      transition: opacity 0.15s ease;
    }

    /* User messages: align actions to the right under their bubble */
    .message.user .msg-actions {
      padding-left: 0;
      padding-right: 42px;
      justify-content: flex-end;
    }

    .message:hover .msg-actions {
      opacity: 1;
    }

    .msg-action-btn {
      background: none;
      border: 1px solid transparent;
      border-radius: 5px;
      color: var(--text-muted, #666);
      cursor: pointer;
      padding: 3px 6px;
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      transition: color 0.12s, background 0.12s, border-color 0.12s;
      line-height: 1;
      white-space: nowrap;
    }

    .msg-action-btn:hover {
      color: var(--text, #ccc);
      background: rgba(255,255,255,0.06);
      border-color: rgba(255,255,255,0.1);
    }

    .msg-action-btn.copied {
      color: #4caf88 !important;
    }

    /* No extra bottom padding needed anymore */
    .message.user,
    .message.assistant {
      padding-bottom: 0;
    }

    /* ── Inline edit UI ── */
    .msg-inline-editor {
      width: 100%;
      margin-top: 6px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .msg-edit-textarea {
      width: 100%;
      background: var(--bg-secondary, #1e1e2e);
      border: 1px solid rgba(126, 184, 247, 0.4);
      border-radius: 8px;
      color: var(--text, #eee);
      font-family: inherit;
      font-size: 14px;
      line-height: 1.5;
      padding: 10px 12px;
      resize: none;
      outline: none;
      box-sizing: border-box;
      transition: border-color 0.15s;
    }

    .msg-edit-textarea:focus {
      border-color: #7eb8f7;
      box-shadow: 0 0 0 2px rgba(126, 184, 247, 0.15);
    }

    .msg-edit-btn-row {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    .msg-edit-save,
    .msg-edit-cancel {
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      padding: 6px 14px;
      transition: opacity 0.15s, transform 0.1s;
    }

    .msg-edit-save {
      background: #7eb8f7;
      color: #0d1117;
    }

    .msg-edit-save:hover { opacity: 0.88; transform: translateY(-1px); }

    .msg-edit-cancel {
      background: rgba(255,255,255,0.07);
      color: var(--text-muted, #888);
      border: 1px solid rgba(255,255,255,0.1);
    }

    .msg-edit-cancel:hover { background: rgba(255,255,255,0.11); color: var(--text, #eee); }
  `;
  document.head.appendChild(style);
}

// ============================
// CSS for tool-feedback bubbles (legacy injected once)
// ============================
(function injectToolFeedbackStyles() {
  if (document.getElementById('tool-feedback-styles')) return;
  const style = document.createElement('style');
  style.id = 'tool-feedback-styles';
  style.textContent = `
    .message.tool-feedback .tool-fb-avatar {
      background: linear-gradient(135deg, #2a2a3a, #3a3a50);
      border: 1px solid #555;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .message.tool-feedback .tool-fb-bubble {
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      border: 1px solid #334;
      color: #aac4e0;
      font-size: 13px;
      border-radius: 8px;
      padding: 10px 14px;
    }
    .message.tool-feedback .tool-fb-bubble strong { color: #7eb8f7; }
    .message.tool-feedback .tool-fb-bubble code {
      background: #0d1117;
      color: #79c0ff;
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 12px;
    }
  `;
  document.head.appendChild(style);
})();

init();

// ============================
// Playground
// ============================

(function initPlayground() {
  const playgroundBtn = document.getElementById('playgroundBtn');
  const playgroundModal = document.getElementById('playgroundModal');
  const playgroundClose = document.getElementById('playgroundClose');
  const pgRunBtn = document.getElementById('pgRunBtn');
  const pgClearBtn = document.getElementById('pgClearBtn');
  const pgShareBtn = document.getElementById('pgShareBtn');
  const pgHtml = document.getElementById('pgHtml');
  const pgCss = document.getElementById('pgCss');
  const pgJs = document.getElementById('pgJs');
  const pgPreview = document.getElementById('pgPreview');
  const deviceBtns = document.querySelectorAll('.pg-device-btn');

  const pgAiToggle = document.getElementById('pgAiToggle');
  const pgAiPanel = document.getElementById('pgAiPanel');
  const pgAiMessages = document.getElementById('pgAiMessages');
  const pgAiInput = document.getElementById('pgAiInput');
  const pgAiSend = document.getElementById('pgAiSend');
  const pgAiClearBtn = document.getElementById('pgAiClearBtn');

  let pgAiOpen = false;
  let pgAiHistory = [];
  let pgAiStreaming = false;

  const PG_AI_SYSTEM = `You are an expert web developer embedded in a live code playground.
The user will describe websites, apps, or UI components they want to build.
Your job is to generate complete, working HTML, CSS, and JavaScript.

STRICT OUTPUT FORMAT — always respond with exactly this structure:

[THOUGHT]
One sentence describing what you're building.
[/THOUGHT]

[HTML]
(complete HTML body content, no <html>/<head>/<body> tags)
[/HTML]

[CSS]
(complete CSS)
[/CSS]

[JS]
(complete JavaScript, or empty if none needed)
[/JS]

Rules:
- Make it visually beautiful, modern, and polished by default.
- Use CSS variables for theming when possible.
- JavaScript must be self-contained, no imports.
- Never include markdown fences. Output raw code only inside the tags.
- If the user asks to modify existing code, they will provide it. Preserve what they want to keep, update what they ask to change.
- Always output all three sections even if one is empty.`;

  function toggleAiPanel() {
    pgAiOpen = !pgAiOpen;
    pgAiPanel.classList.toggle('open', pgAiOpen);
    pgAiToggle.classList.toggle('active', pgAiOpen);
    if (pgAiOpen) setTimeout(() => pgAiInput.focus(), 300);
  }

  pgAiToggle.addEventListener('click', toggleAiPanel);

  pgAiClearBtn.addEventListener('click', () => {
    pgAiHistory = [];
    pgAiMessages.innerHTML = `<div class="pg-ai-welcome">
      <div class="pg-ai-welcome-icon"> </div>
      <p>Describe the website you want to build and I'll generate the HTML, CSS, and JS for you.</p>
      <div class="pg-ai-suggestions">
        <button class="pg-ai-suggestion" data-prompt="Build a sleek landing page for a SaaS product with a hero section, features grid, and CTA button">Landing page</button>
        <button class="pg-ai-suggestion" data-prompt="Create an interactive todo app with add, complete, and delete functionality, dark theme">Todo app</button>
        <button class="pg-ai-suggestion" data-prompt="Build a personal portfolio page with animated sections, skills bars, and contact form">Portfolio</button>
        <button class="pg-ai-suggestion" data-prompt="Create a CSS-only animated loading screen with particles and a progress bar">Loading screen</button>
      </div>
    </div>`;
    bindSuggestions();
  });

  function bindSuggestions() {
    pgAiMessages.querySelectorAll('.pg-ai-suggestion').forEach(btn => {
      btn.addEventListener('click', () => {
        pgAiInput.value = btn.dataset.prompt;
        pgAiInput.dispatchEvent(new Event('input'));
        sendAiMessage();
      });
    });
  }
  bindSuggestions();

  pgAiInput.addEventListener('input', () => {
    pgAiInput.style.height = 'auto';
    pgAiInput.style.height = Math.min(pgAiInput.scrollHeight, 120) + 'px';
    pgAiSend.disabled = !pgAiInput.value.trim() || pgAiStreaming;
  });

  pgAiInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!pgAiSend.disabled) sendAiMessage();
    }
  });
  pgAiSend.addEventListener('click', sendAiMessage);

  function appendUserMsg(text) {
    const el = document.createElement('div');
    el.className = 'pg-msg pg-msg-user';
    el.innerHTML = '<div class="pg-msg-role">You</div><div class="pg-msg-bubble">' + escapeHtml(text) + '</div>';
    pgAiMessages.appendChild(el);
    pgAiMessages.scrollTop = pgAiMessages.scrollHeight;
  }

  function appendTyping() {
    const wrap = document.createElement('div');
    wrap.className = 'pg-msg pg-msg-assistant';
    wrap.innerHTML = '<div class="pg-msg-role">AI</div>';
    const dot = document.createElement('div');
    dot.className = 'pg-typing';
    dot.innerHTML = '<span></span><span></span><span></span>';
    wrap.appendChild(dot);
    pgAiMessages.appendChild(wrap);
    pgAiMessages.scrollTop = pgAiMessages.scrollHeight;
    return { wrap, dot };
  }

  function parseAiBlocks(text) {
    const get = (tag) => {
      const m = text.match(new RegExp('\\[' + tag + '\\]([\\s\\S]*?)\\[\\/' + tag + '\\]', 'i'));
      return m ? m[1].trim() : '';
    };
    return { thought: get('THOUGHT'), html: get('HTML'), css: get('CSS'), js: get('JS') };
  }

  function applyToEditors(html, css, js) {
    if (html !== undefined) pgHtml.value = html;
    if (css !== undefined) pgCss.value = css;
    if (js !== undefined) pgJs.value = js;
    run();
  }

  async function sendAiMessage() {
    const text = pgAiInput.value.trim();
    if (!text || pgAiStreaming) return;
    if (!state.apiKey) { showToast('No API key set', 'error'); return; }

    const welcome = pgAiMessages.querySelector('.pg-ai-welcome');
    if (welcome) welcome.remove();

    appendUserMsg(text);
    pgAiInput.value = '';
    pgAiInput.style.height = 'auto';
    pgAiSend.disabled = true;
    pgAiStreaming = true;

    const currentCode = pgHtml.value || pgCss.value || pgJs.value
      ? '\n\nCurrent editor state:\n[HTML]\n' + pgHtml.value + '\n[/HTML]\n[CSS]\n' + pgCss.value + '\n[/CSS]\n[JS]\n' + pgJs.value + '\n[/JS]'
      : '';

    const userMsg = { role: 'user', content: text + currentCode };
    pgAiHistory.push(userMsg);

    const { wrap, dot } = appendTyping();

    try {
      const provider = PROVIDERS[state.provider];
      let body;
      if (state.provider === 'anthropic') {
        body = { model: state.model, messages: pgAiHistory, max_tokens: 4096, system: PG_AI_SYSTEM };
      } else {
        body = { model: state.model, messages: [{ role: 'system', content: PG_AI_SYSTEM }, ...pgAiHistory], max_tokens: 4096 };
      }

      const res = await fetch(provider.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + state.apiKey },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || 'API error ' + res.status);
      }

      const data = await res.json();
      const rawText = state.provider === 'anthropic'
        ? (data.content?.[0]?.text || '')
        : (data.choices?.[0]?.message?.content || '');

      pgAiHistory.push({ role: 'assistant', content: rawText });

      const { thought, html, css, js } = parseAiBlocks(rawText);

      dot.remove();
      const bubble = document.createElement('div');
      bubble.className = 'pg-msg-bubble';

      const hasCode = html || css || js;
      let innerHtml = thought ? '<p>' + escapeHtml(thought) + '</p>' : '';

      if (hasCode) {
        innerHtml += '<div class="pg-applied-badge" id="pgApplyBadge">✓ Code applied — click to re-apply</div>';
      } else {
        innerHtml += '<p>' + escapeHtml(rawText.replace(/\[[\w\/]+\]/g, '').trim().slice(0, 300)) + '</p>';
      }

      bubble.innerHTML = innerHtml;
      wrap.appendChild(bubble);
      pgAiMessages.scrollTop = pgAiMessages.scrollHeight;

      if (hasCode) {
        applyToEditors(html, css, js);
        const badge = bubble.querySelector('#pgApplyBadge');
        if (badge) badge.addEventListener('click', () => applyToEditors(html, css, js));
      }

    } catch (err) {
      dot.remove();
      const errBubble = document.createElement('div');
      errBubble.className = 'pg-msg-bubble';
      errBubble.style.color = '#ff5f5f';
      errBubble.textContent = 'Error: ' + err.message;
      wrap.appendChild(errBubble);
      pgAiHistory.pop();
    } finally {
      pgAiStreaming = false;
      pgAiSend.disabled = !pgAiInput.value.trim();
    }
  }

  let autoRunTimer = null;

  function openPlayground() { playgroundModal.classList.add('open'); pgHtml.focus(); }
  function closePlayground() { playgroundModal.classList.remove('open'); }

  playgroundBtn.onclick = openPlayground;
  playgroundClose.onclick = closePlayground;
  playgroundModal.addEventListener('click', e => { if (e.target === playgroundModal) closePlayground(); });

  function run() {
    const doc = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + pgCss.value + '</style></head><body>' + pgHtml.value + '<script>(function(){' + pgJs.value + '})();<\/script></body></html>';
    pgPreview.srcdoc = doc;
  }

  pgRunBtn.onclick = run;

  function scheduleAutoRun() { clearTimeout(autoRunTimer); autoRunTimer = setTimeout(run, 800); }
  [pgHtml, pgCss, pgJs].forEach(ta => ta.addEventListener('input', scheduleAutoRun));

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && playgroundModal.classList.contains('open')) { e.preventDefault(); run(); }
    if (e.key === 'Escape' && playgroundModal.classList.contains('open')) closePlayground();
  });

  pgClearBtn.onclick = () => {
    if (confirm('Clear all editors?')) { pgHtml.value = ''; pgCss.value = ''; pgJs.value = ''; pgPreview.srcdoc = ''; }
  };

  pgShareBtn.onclick = () => {
    const doc = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' + pgCss.value + '</style></head><body>' + pgHtml.value + '<script>' + pgJs.value + '<\/script></body></html>';
    const blob = new Blob([doc], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'playground.html'; a.click();
    URL.revokeObjectURL(url);
    showToast('Exported as playground.html');
  };

  deviceBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      deviceBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const w = btn.dataset.w;
      const wrap = document.querySelector('.pg-preview-wrap');
      pgPreview.style.width = w;
      pgPreview.style.flex = w === '100%' ? '1' : '0 0 ' + w;
      wrap.style.justifyContent = w === '100%' ? 'stretch' : 'center';
      wrap.style.background = w === '100%' ? '#fff' : '#e8e8ec';
    });
  });

  [pgHtml, pgCss, pgJs].forEach(ta => {
    ta.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = ta.selectionStart, end = ta.selectionEnd;
        ta.value = ta.value.substring(0, s) + '  ' + ta.value.substring(end);
        ta.selectionStart = ta.selectionEnd = s + 2;
      }
    });
  });

  document.querySelectorAll('.pg-pane-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.pane;
      const paneId = 'pg' + key.charAt(0).toUpperCase() + key.slice(1) + 'Pane';
      const pane = document.getElementById(paneId);
      const collapsed = pane.classList.toggle('collapsed');
      btn.textContent = collapsed ? '+' : '-';
    });
  });

  document.querySelectorAll('.pg-resizer').forEach(resizer => {
    resizer.addEventListener('mousedown', e => {
      e.preventDefault();
      resizer.classList.add('dragging');
      const startY = e.clientY;
      const prev = resizer.previousElementSibling;
      const next = resizer.nextElementSibling;
      const startPrev = prev.getBoundingClientRect().height;
      const startNext = next.getBoundingClientRect().height;

      const onMove = ev => {
        const dy = ev.clientY - startY;
        const newPrev = Math.max(34, startPrev + dy);
        const newNext = Math.max(34, (startPrev + startNext) - newPrev);
        prev.style.flex = '0 0 ' + newPrev + 'px';
        next.style.flex = '0 0 ' + newNext + 'px';
      };
      const onUp = () => {
        resizer.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });

  const pgEditors = document.querySelector('.pg-editors');
  const pgPreviewCol = document.querySelector('.pg-preview-col');
  const colResizer = document.createElement('div');
  colResizer.className = 'pg-col-resizer';
  pgEditors.parentElement.insertBefore(colResizer, pgPreviewCol);

  colResizer.addEventListener('mousedown', e => {
    e.preventDefault();
    colResizer.classList.add('dragging');
    const startX = e.clientX;
    const startW = pgEditors.getBoundingClientRect().width;
    const parentW = pgEditors.parentElement.getBoundingClientRect().width;

    const onMove = ev => {
      const newW = Math.min(Math.max(200, startW + (ev.clientX - startX)), parentW - 200);
      pgEditors.style.cssText = 'width:' + newW + 'px;min-width:' + newW + 'px;max-width:' + newW + 'px';
    };
    const onUp = () => {
      colResizer.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  window.openPlaygroundWith = function(opts) {
    opts = opts || {};
    if (opts.html) pgHtml.value = opts.html;
    if (opts.css) pgCss.value = opts.css;
    if (opts.js) pgJs.value = opts.js;
    openPlayground();
    run();
  };


})();

// ============================
// ── LYN STORE ──
// ============================

(function initLynStore() {

  const BACKEND = 'https://api.corelyn.ro';
  const GOOGLE_CLIENT_ID = '1095022231097-m2jpnjm7fkh0k2kd46hca3p4i8b6v3k0.apps.googleusercontent.com';

  let googleCredential = null; // raw ID token from Google
  let googleUser       = null; // { name, email, picture }

  async function loadAllLyns() {
    const res = await fetch(`${BACKEND}/lyns`);
    if (!res.ok) throw new Error('Failed to load: ' + res.status);
    return (await res.json()).lyns || [];
  }

  async function saveLyn(lyn) {
    const res = await fetch(`${BACKEND}/lyns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...lyn, credential: googleCredential }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Write failed: ' + res.status);
  }

  // ── Sidebar button ──
  const sidebar = document.getElementById('sidebar');
  const sidebarBottom = sidebar?.querySelector('.sidebar-footer') || sidebar;
  const lynStoreBtn = document.createElement('button');
  lynStoreBtn.id = 'lynStoreBtn';
  lynStoreBtn.className = 'sidebar-icon-btn';
  lynStoreBtn.title = 'Lyn Store';
  lynStoreBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg><span>Lyn Store</span>`;
  const openSettingsBtn = document.getElementById('openSettingsBtn');
  if (openSettingsBtn && openSettingsBtn.parentElement === sidebarBottom) {
    sidebarBottom.insertBefore(lynStoreBtn, openSettingsBtn);
  } else {
    sidebarBottom.appendChild(lynStoreBtn);
  }

  // ── Modal ──
  const modalEl = document.createElement('div');
  modalEl.id = 'lynStoreModal';
  modalEl.innerHTML = `
    <div class="lyn-modal-backdrop"></div>
    <div class="lyn-modal-panel">
      <div class="lyn-modal-header">
        <div class="lyn-modal-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
          Lyn Store
        </div>
        <div class="lyn-tabs">
          <button class="lyn-tab active" data-tab="browse">Browse Lyns</button>
          <button class="lyn-tab" data-tab="submit">Submit a Lyn</button>
        </div>
        <button class="lyn-close-btn" id="lynCloseBtn">×</button>
      </div>

      <div class="lyn-tab-content" id="lynBrowseTab">
        <div class="lyn-search-bar">
          <input type="text" id="lynSearchInput" placeholder="Search Lyns by title or description…" />
        </div>
        <div class="lyn-grid" id="lynGrid">
          <div class="lyn-loading">Loading Lyns…</div>
        </div>
      </div>

      <div class="lyn-tab-content hidden" id="lynSubmitTab">

        <div id="lynLoginWall" class="lyn-login-wall">
          <div class="lyn-login-icon">🔐</div>
          <div class="lyn-login-title">Sign in to submit a Lyn</div>
          <div class="lyn-login-sub">Your Lyn will be shared publicly with all Corelyn users.</div>
          <div id="lynGoogleBtn"></div>
        </div>

        <div id="lynSubmitForm" class="lyn-submit-form hidden">
          <div class="lyn-user-bar" id="lynUserBar"></div>

          <label class="lyn-label">Title <span class="lyn-required">*</span></label>
          <input type="text" id="lynTitleInput" placeholder="e.g. Pirate Captain, Code Reviewer…" maxlength="60" />
          <div class="lyn-char-count" id="lynTitleCount">0 / 60</div>

          <label class="lyn-label">Description <span class="lyn-optional">(optional)</span></label>
          <input type="text" id="lynDescInput" placeholder="One line about what this Lyn does…" maxlength="120" />

          <label class="lyn-label">Author name <span class="lyn-optional">(defaults to your Google name)</span></label>
          <input type="text" id="lynAuthorInput" placeholder="Your name or handle…" maxlength="40" />

          <label class="lyn-label">System Prompt <span class="lyn-required">*</span></label>
          <div class="lyn-prompt-toolbar">
            <button class="lyn-prefill-btn" id="lynPrefillBtn">⬇ Use current system prompt</button>
          </div>
          <textarea id="lynPromptInput" rows="8" placeholder="You are a…" maxlength="8000"></textarea>
          <div class="lyn-char-count" id="lynPromptCount">0 / 8000</div>

          <div class="lyn-submit-row">
            <span class="lyn-submit-note">⚠️ Submissions are public.</span>
            <button class="lyn-submit-btn" id="lynSubmitBtn">Publish Lyn</button>
          </div>
          <div class="lyn-submit-status" id="lynSubmitStatus"></div>
        </div>

      </div>
    </div>
  `;
  document.body.appendChild(modalEl);

  // ── Styles ──
  const style = document.createElement('style');
  style.textContent = `
    #lynStoreModal { display:none; position:fixed; inset:0; z-index:1100; align-items:center; justify-content:center; }
    #lynStoreModal.open { display:flex; }
    .lyn-modal-backdrop { position:absolute; inset:0; background:rgba(0,0,0,0.6); backdrop-filter:blur(4px); }
    .lyn-modal-panel { position:relative; z-index:1; background:var(--bg-secondary,#1a1a2e); border:1px solid rgba(255,255,255,0.1); border-radius:14px; width:min(820px,95vw); max-height:88vh; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 80px rgba(0,0,0,0.6); }
    .lyn-modal-header { display:flex; align-items:center; gap:16px; padding:16px 20px 0; flex-shrink:0; }
    .lyn-modal-title { display:flex; align-items:center; gap:8px; font-size:16px; font-weight:600; color:var(--text,#eee); flex-shrink:0; }
    .lyn-tabs { display:flex; gap:4px; background:rgba(255,255,255,0.05); border-radius:8px; padding:3px; flex:1; }
    .lyn-tab { flex:1; background:none; border:none; border-radius:6px; color:var(--text-muted,#888); cursor:pointer; font-size:13px; font-weight:500; padding:6px 14px; transition:all 0.15s; }
    .lyn-tab.active { background:rgba(184,126,247,0.18); color:#d4a8ff; }
    .lyn-tab:hover:not(.active) { background:rgba(255,255,255,0.06); color:var(--text,#eee); }
    .lyn-close-btn { background:none; border:none; color:var(--text-muted,#888); cursor:pointer; font-size:22px; line-height:1; padding:0 4px; transition:color 0.15s; flex-shrink:0; }
    .lyn-close-btn:hover { color:var(--text,#eee); }
    .lyn-tab-content { flex:1; overflow-y:auto; padding:16px 20px 20px; }
    .lyn-tab-content.hidden { display:none; }

    .lyn-search-bar { margin-bottom:14px; }
    .lyn-search-bar input { width:100%; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:var(--text,#eee); font-size:13px; padding:9px 13px; outline:none; box-sizing:border-box; transition:border-color 0.15s; }
    .lyn-search-bar input:focus { border-color:#b87ef7; }
    .lyn-search-bar input::placeholder { color:var(--text-muted,#666); }

    .lyn-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px; }
    .lyn-loading, .lyn-empty { grid-column:1/-1; text-align:center; color:var(--text-muted,#888); padding:40px 0; font-size:14px; }

    .lyn-card { background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:14px; cursor:pointer; transition:border-color 0.15s,background 0.15s,transform 0.1s; display:flex; flex-direction:column; gap:8px; }
    .lyn-card:hover { border-color:rgba(184,126,247,0.4); background:rgba(184,126,247,0.06); transform:translateY(-1px); }
    .lyn-card-header { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; }
    .lyn-card-title { font-size:14px; font-weight:600; color:var(--text,#eee); line-height:1.3; }
    .lyn-card-badge { font-size:10px; background:rgba(184,126,247,0.15); color:#c89ef7; border:1px solid rgba(184,126,247,0.25); border-radius:20px; padding:2px 7px; white-space:nowrap; flex-shrink:0; }
    .lyn-card-desc { font-size:12px; color:var(--text-muted,#888); line-height:1.4; }
    .lyn-card-preview { font-size:11px; color:rgba(255,255,255,0.3); font-family:monospace; background:rgba(0,0,0,0.2); border-radius:6px; padding:7px 9px; line-height:1.4; overflow:hidden; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; }
    .lyn-card-footer { display:flex; align-items:center; justify-content:space-between; margin-top:auto; }
    .lyn-card-author { font-size:11px; color:rgba(255,255,255,0.3); }
    .lyn-card-use-btn { background:rgba(184,126,247,0.15); border:1px solid rgba(184,126,247,0.3); border-radius:6px; color:#c89ef7; cursor:pointer; font-size:11px; font-weight:500; padding:4px 10px; transition:all 0.15s; }
    .lyn-card-use-btn:hover { background:rgba(184,126,247,0.28); border-color:#b87ef7; color:#e0c4ff; }

    /* Login wall */
    .lyn-login-wall { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding:48px 24px; text-align:center; }
    .lyn-login-icon { font-size:40px; }
    .lyn-login-title { font-size:18px; font-weight:600; color:var(--text,#eee); }
    .lyn-login-sub { font-size:13px; color:var(--text-muted,#888); max-width:320px; line-height:1.5; }

    /* User bar (shown when signed in) */
    .lyn-user-bar { display:flex; align-items:center; justify-content:space-between; background:rgba(184,126,247,0.08); border:1px solid rgba(184,126,247,0.2); border-radius:8px; padding:8px 12px; margin-bottom:12px; }
    .lyn-user-info { display:flex; align-items:center; gap:10px; }
    .lyn-user-avatar { width:28px; height:28px; border-radius:50%; object-fit:cover; }
    .lyn-user-name { font-size:13px; color:var(--text,#eee); font-weight:500; }
    .lyn-signout-btn { background:none; border:1px solid rgba(255,255,255,0.1); border-radius:6px; color:var(--text-muted,#888); cursor:pointer; font-size:11px; padding:3px 9px; transition:all 0.15s; }
    .lyn-signout-btn:hover { border-color:#f77eb8; color:#f77eb8; }

    .lyn-submit-form { display:flex; flex-direction:column; gap:6px; max-width:600px; }
    .lyn-submit-form.hidden { display:none; }
    .lyn-label { font-size:13px; font-weight:500; color:var(--text,#eee); margin-top:10px; }
    .lyn-label:first-child { margin-top:0; }
    .lyn-required { color:#f77eb8; }
    .lyn-optional { color:var(--text-muted,#666); font-weight:400; font-size:12px; }
    .lyn-submit-form input[type="text"], .lyn-submit-form textarea { background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:var(--text,#eee); font-size:13px; font-family:inherit; padding:9px 13px; outline:none; width:100%; box-sizing:border-box; transition:border-color 0.15s; resize:vertical; }
    .lyn-submit-form input:focus, .lyn-submit-form textarea:focus { border-color:#b87ef7; box-shadow:0 0 0 2px rgba(184,126,247,0.12); }
    .lyn-submit-form textarea { font-family:monospace; font-size:12px; line-height:1.5; }
    .lyn-char-count { font-size:11px; color:var(--text-muted,#666); text-align:right; margin-top:-2px; }
    .lyn-prompt-toolbar { display:flex; gap:8px; margin-bottom:4px; }
    .lyn-prefill-btn { background:none; border:1px solid rgba(255,255,255,0.1); border-radius:6px; color:var(--text-muted,#888); cursor:pointer; font-size:12px; padding:4px 10px; transition:all 0.15s; }
    .lyn-prefill-btn:hover { border-color:#b87ef7; color:#c89ef7; }
    .lyn-submit-row { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:8px; flex-wrap:wrap; }
    .lyn-submit-note { font-size:12px; color:var(--text-muted,#666); }
    .lyn-submit-btn { background:linear-gradient(135deg,#9a5fd4,#b87ef7); border:none; border-radius:8px; color:#fff; cursor:pointer; font-size:13px; font-weight:600; padding:9px 22px; transition:opacity 0.15s,transform 0.1s; }
    .lyn-submit-btn:hover { opacity:0.88; transform:translateY(-1px); }
    .lyn-submit-btn:disabled { opacity:0.4; cursor:not-allowed; transform:none; }
    .lyn-submit-status { font-size:13px; min-height:18px; }
    .lyn-submit-status.success { color:#4caf88; }
    .lyn-submit-status.error   { color:#ff5f5f; }

    #lynStoreBtn { display:flex; align-items:center; gap:8px; width:100%; background:none; border:none; border-radius:8px; color:var(--text-muted,#888); cursor:pointer; font-size:13px; padding:8px 10px; text-align:left; transition:background 0.15s color 0.15s; margin-top: 1rem; margin-bottom: 1rem; }
    #lynStoreBtn:hover { background:rgba(184,126,247,0.1); color:#c89ef7; }
    #lynStoreBtn svg { flex-shrink:0; }
  `;
  document.head.appendChild(style);

  // ── State ──
  let allLyns = [];
  let searchQuery = '';

  // ── DOM refs ──
  const modal        = document.getElementById('lynStoreModal');
  const closeBtn     = document.getElementById('lynCloseBtn');
  const tabs         = modal.querySelectorAll('.lyn-tab');
  const browseTab    = document.getElementById('lynBrowseTab');
  const submitTab    = document.getElementById('lynSubmitTab');
  const lynGrid      = document.getElementById('lynGrid');
  const searchInput  = document.getElementById('lynSearchInput');
  const loginWall    = document.getElementById('lynLoginWall');
  const submitForm   = document.getElementById('lynSubmitForm');
  const userBar      = document.getElementById('lynUserBar');
  const titleInput   = document.getElementById('lynTitleInput');
  const descInput    = document.getElementById('lynDescInput');
  const authorInput  = document.getElementById('lynAuthorInput');
  const promptInput  = document.getElementById('lynPromptInput');
  const titleCount   = document.getElementById('lynTitleCount');
  const promptCount  = document.getElementById('lynPromptCount');
  const prefillBtn   = document.getElementById('lynPrefillBtn');
  const submitBtn    = document.getElementById('lynSubmitBtn');
  const submitStatus = document.getElementById('lynSubmitStatus');

  // ── Google Sign-In ──
  function initGoogleSignIn() {
    if (!window.google) { setTimeout(initGoogleSignIn, 300); return; }
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: onGoogleSignIn,
    });
    window.google.accounts.id.renderButton(
      document.getElementById('lynGoogleBtn'),
      { theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'rectangular' }
    );
  }

  function onGoogleSignIn(response) {
    googleCredential = response.credential;
    // Decode JWT payload (no verification needed client-side — backend verifies)
    const payload = JSON.parse(atob(googleCredential.split('.')[1]));
    googleUser = { name: payload.name, email: payload.email, picture: payload.picture };
    updateSubmitUI();
  }

  function signOut() {
    googleCredential = null;
    googleUser = null;
    window.google?.accounts.id.disableAutoSelect();
    updateSubmitUI();
    // Re-render the Google button
    setTimeout(() => {
      window.google?.accounts.id.renderButton(
        document.getElementById('lynGoogleBtn'),
        { theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'rectangular' }
      );
    }, 100);
  }

  function updateSubmitUI() {
    if (googleUser) {
      loginWall.classList.add('hidden');
      submitForm.classList.remove('hidden');
      userBar.innerHTML = `
        <div class="lyn-user-info">
          <img class="lyn-user-avatar" src="${escapeHtml(googleUser.picture || '')}" alt="" />
          <span class="lyn-user-name">${escapeHtml(googleUser.name)}</span>
        </div>
        <button class="lyn-signout-btn" id="lynSignOutBtn">Sign out</button>
      `;
      document.getElementById('lynSignOutBtn').addEventListener('click', signOut);
    } else {
      loginWall.classList.remove('hidden');
      submitForm.classList.add('hidden');
    }
  }

  initGoogleSignIn();

  // ── Tabs ──
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      browseTab.classList.toggle('hidden', target !== 'browse');
      submitTab.classList.toggle('hidden', target !== 'submit');
    });
  });

  // ── Open / close ──
  lynStoreBtn.addEventListener('click', () => { modal.classList.add('open'); refreshGrid(); });
  closeBtn.addEventListener('click', () => modal.classList.remove('open'));
  modal.querySelector('.lyn-modal-backdrop').addEventListener('click', () => modal.classList.remove('open'));

  // ── Search ──
  searchInput.addEventListener('input', () => { searchQuery = searchInput.value.toLowerCase(); renderGrid(allLyns); });

  // ── Char counters ──
  titleInput.addEventListener('input',  () => { titleCount.textContent  = `${titleInput.value.length} / 60`; });
  promptInput.addEventListener('input', () => { promptCount.textContent = `${promptInput.value.length} / 8000`; });

  // ── Prefill ──
  prefillBtn.addEventListener('click', () => {
    if (state && state.systemPrompt) {
      promptInput.value = state.systemPrompt;
      promptCount.textContent = `${promptInput.value.length} / 8000`;
    } else {
      showToast('No system prompt set', 'error');
    }
  });

  // ── Render grid ──
  function renderGrid(lyns) {
    const filtered = searchQuery
      ? lyns.filter(l =>
          l.title.toLowerCase().includes(searchQuery) ||
          (l.description || '').toLowerCase().includes(searchQuery) ||
          (l.author || '').toLowerCase().includes(searchQuery))
      : lyns;

    if (!filtered.length) {
      lynGrid.innerHTML = `<div class="lyn-empty">${lyns.length === 0 ? 'No Lyns yet — be the first to submit one!' : 'No results for "' + escapeHtml(searchQuery) + '"'}</div>`;
      return;
    }

    lynGrid.innerHTML = '';
    filtered.forEach(lyn => {
      const card = document.createElement('div');
      card.className = 'lyn-card';
      card.innerHTML = `
        <div class="lyn-card-header">
          <div class="lyn-card-title">${escapeHtml(lyn.title)}</div>
          ${lyn.author ? `<div class="lyn-card-badge">${escapeHtml(lyn.author)}</div>` : ''}
        </div>
        ${lyn.description ? `<div class="lyn-card-desc">${escapeHtml(lyn.description)}</div>` : ''}
        <div class="lyn-card-preview">${escapeHtml(lyn.prompt)}</div>
        <div class="lyn-card-footer">
          <span class="lyn-card-author">${new Date(lyn.created_at).toLocaleDateString()}</span>
          <button class="lyn-card-use-btn">Use this Lyn</button>
        </div>
      `;
      card.querySelector('.lyn-card-use-btn').addEventListener('click', e => { e.stopPropagation(); applyLyn(lyn); });
      card.addEventListener('click', () => applyLyn(lyn));
      lynGrid.appendChild(card);
    });
  }

  async function refreshGrid() {
    lynGrid.innerHTML = '<div class="lyn-loading">Loading Lyns…</div>';
    try {
      allLyns = await loadAllLyns();
      renderGrid(allLyns);
    } catch(e) {
      lynGrid.innerHTML = '<div class="lyn-empty">⚠️ Could not connect to Lyn Store.</div>';
    }
  }

  function applyLyn(lyn) {
    state.systemPrompt = lyn.prompt;
    localStorage.setItem('nc_systemprompt', lyn.prompt);
    modal.classList.remove('open');
    showToast(`✓ Lyn "${lyn.title}" applied`);
  }

  // ── Submit ──
  submitBtn.addEventListener('click', async () => {
    if (!googleCredential) { setStatus('Please sign in with Google first.', 'error'); return; }
    const title  = titleInput.value.trim();
    const prompt = promptInput.value.trim();
    if (!title)  { setStatus('Please enter a title.', 'error'); return; }
    if (!prompt) { setStatus('Please enter a system prompt.', 'error'); return; }

    submitBtn.disabled = true;
    setStatus('Publishing…', '');

    const lyn = {
      id:        Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title,
      desc:      descInput.value.trim(),
      author:    authorInput.value.trim(),
      prompt,
      createdAt: Date.now(),
    };

    try {
      await saveLyn(lyn);
      setStatus('✓ Lyn published!', 'success');
      titleInput.value = descInput.value = authorInput.value = promptInput.value = '';
      titleCount.textContent = '0 / 60';
      promptCount.textContent = '0 / 8000';
      setTimeout(() => { tabs[0].click(); refreshGrid(); setStatus('', ''); }, 1200);
    } catch(e) {
      setStatus('Failed to publish: ' + e.message, 'error');
    } finally {
      submitBtn.disabled = false;
    }
  });

  function setStatus(msg, type) {
    submitStatus.textContent = msg;
    submitStatus.className = 'lyn-submit-status' + (type ? ' ' + type : '');
  }

})();
