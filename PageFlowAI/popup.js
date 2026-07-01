// PageFlow AI - popup.js
// UI control for the 4 features (SmartFormMapper / ExpensePilot / DevCleanShortcut / CalendarBlocker).
// CSP compliant: no inline scripts, no eval, no remote code loading.

'use strict';

const $ = (sel) => document.querySelector(sel);
const AGENT_BASE = 'http://127.0.0.1:8765';
const CLAUDE_MODEL = 'claude-opus-4-8';

// ---------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------
function setStatus(msg, kind) {
  const bar = $('#statusBar');
  bar.textContent = msg || '';
  bar.className = 'status' + (kind ? ` ${kind}` : '');
  if (msg) setTimeout(() => { if (bar.textContent === msg) bar.textContent = ''; }, 6000);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function renderCard(container, kind, html) {
  container.innerHTML = `<div class="result-card ${kind}">${html}</div>`;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isInjectableUrl(url) {
  // file:// is for the demo form (works if "Allow access to file URLs" is enabled in extension details)
  return /^(https?|file):\/\//.test(url || '');
}

async function ensureContentScript(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'PFA_PING' });
    if (res && res.ok) return;
  } catch (e) { /* not injected yet -> inject it */ }
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

async function sendToPage(message) {
  const tab = await getActiveTab();
  if (!tab || !isInjectableUrl(tab.url)) {
    throw new Error('This page is not supported (chrome:// or an extension page, etc). Please open a regular web page.');
  }
  await ensureContentScript(tab.id);
  return chrome.tabs.sendMessage(tab.id, message);
}

// ---------------------------------------------------------------
// Theme toggle (dark-mode support)
// ---------------------------------------------------------------
async function initTheme() {
  const { pfaTheme } = await chrome.storage.local.get('pfaTheme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(pfaTheme || (prefersDark ? 'dark' : 'light'));

  $('#themeToggle').addEventListener('click', async () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    await chrome.storage.local.set({ pfaTheme: next });
  });
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('#themeToggle').textContent = theme === 'dark' ? '☀️' : '🌙';
}

// ---------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------
function initTabs() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $(`#tab-${btn.dataset.tab}`).classList.add('active');
      if (btn.dataset.tab === 'dev') checkAgent();
    });
  });
}

// ===============================================================
// 1. SmartFormMapper
// ===============================================================
function initMapper() {
  const textarea = $('#mapperText');
  const result = $('#mapperResult');

  // Pick up text sent via the right-click context menu
  chrome.storage.local.get('pfaPendingText').then(({ pfaPendingText }) => {
    if (pfaPendingText) {
      textarea.value = pfaPendingText;
      chrome.storage.local.remove('pfaPendingText');
      chrome.runtime.sendMessage({ type: 'PFA_CLEAR_BADGE' }).catch(() => {});
      setStatus('Loaded the text sent via right-click', 'ok');
    }
  });

  $('#btnPaste').addEventListener('click', async () => {
    try {
      textarea.value = await navigator.clipboard.readText();
      setStatus('Pasted from clipboard', 'ok');
    } catch (e) {
      setStatus('Could not read the clipboard', 'err');
    }
  });

  $('#btnScan').addEventListener('click', async () => {
    try {
      renderCard(result, 'ok', '<span class="spinner"></span>Scanning the page…');
      const res = await sendToPage({ type: 'PFA_SCAN' });
      if (!res || !res.ok) throw new Error(res && res.error || 'Scan failed');
      if (!res.fields.length) {
        renderCard(result, 'warn', 'No fillable form fields were found.');
        return;
      }
      const items = res.fields.slice(0, 20).map((f) =>
        `<li><strong>${esc(f.label)}</strong> <span class="muted">(${esc(f.tag)}${f.type ? ':' + esc(f.type) : ''})</span></li>`
      ).join('');
      renderCard(result, 'ok',
        `<span class="badge">${res.fields.length}</span>fields detected<ul>${items}</ul>`);
    } catch (e) {
      renderCard(result, 'err', esc(e.message));
    }
  });

  $('#btnMap').addEventListener('click', async () => {
    const text = textarea.value.trim();
    if (!text) {
      renderCard(result, 'warn', 'Please paste some text.');
      return;
    }
    const entries = PageFlowParser.extractFieldsFromText(text);
    if (!entries.length) {
      renderCard(result, 'warn',
        'No "label: value" pairs were found.<br>Example: include a line like "Name: John Smith".');
      return;
    }
    try {
      renderCard(result, 'ok', '<span class="spinner"></span>Mapping…');
      const res = await sendToPage({ type: 'PFA_FILL', entries });
      if (!res || !res.ok) throw new Error(res && res.error || 'Autofill failed');
      renderFillReport(result, res, entries.length);
    } catch (e) {
      renderCard(result, 'err', esc(e.message));
    }
  });
}

function renderFillReport(container, res, entryCount) {
  if (!res.filled.length) {
    renderCard(container, 'warn',
      `Extracted ${entryCount} item(s) from the text, but no matching form fields were found ` +
      `(fields on page: ${res.totalFields}). Use "🔍 Scan form" to check the detected labels.`);
    return;
  }
  const rows = res.filled.map((f) =>
    `<div class="kv"><span>✅ ${esc(f.label)}</span><span class="v">${esc(f.value)}</span></div>`
  ).join('');
  const skipped = res.unmatched.length
    ? `<div class="muted" style="margin-top:6px">Unmatched: ${res.unmatched.map(esc).join(' / ')}</div>`
    : '';
  renderCard(container, 'ok',
    `<span class="badge">${res.filled.length}</span>field(s) autofilled${rows ? rows : ''}${skipped}`);
}

// ===============================================================
// 2. ExpensePilot
// ===============================================================
function initExpense() {
  const dz = $('#dropZone');
  const fileInput = $('#fileInput');
  const result = $('#expenseResult');

  dz.addEventListener('click', () => fileInput.click());
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('dragover');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleReceiptFile(file);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleReceiptFile(fileInput.files[0]);
    fileInput.value = '';
  });

  $('#btnParseReceipt').addEventListener('click', () => {
    const text = $('#receiptText').value.trim();
    if (!text) { setStatus('Please paste the receipt text', 'err'); return; }
    const data = PageFlowParser.extractReceiptData(text);
    showExpenseForm(data, 'Text parsed');
  });

  $('#btnFillExpense').addEventListener('click', async () => {
    const entries = [];
    const add = (key, value) => { if (value) entries.push({ key, value: String(value) }); };
    add('Date', $('#expDate').value);
    add('Amount', $('#expAmount').value);
    add('Vendor', $('#expVendor').value);
    add('Category', $('#expCategory').value);
    add('Memo', $('#expMemo').value);
    if (!entries.length) { setStatus('There is nothing to fill in', 'err'); return; }
    try {
      renderCard(result, 'ok', '<span class="spinner"></span>Filling in the expense form…');
      const res = await sendToPage({ type: 'PFA_FILL', entries });
      if (!res || !res.ok) throw new Error(res && res.error || 'Autofill failed');
      renderFillReport(result, res, entries.length);
    } catch (e) {
      renderCard(result, 'err', esc(e.message));
    }
  });

  async function handleReceiptFile(file) {
    const result = $('#expenseResult');
    try {
      renderCard(result, 'ok', `<span class="spinner"></span>Analyzing "${esc(file.name)}"…`);
      const { pfaApiKey } = await chrome.storage.local.get('pfaApiKey');

      if (file.type === 'text/plain' || /\.txt$/i.test(file.name)) {
        const text = await file.text();
        showExpenseForm(PageFlowParser.extractReceiptData(text), 'Text file parsed');
        result.innerHTML = '';
        return;
      }

      if (file.type === 'application/pdf') {
        const text = await PageFlowPdf.extractPdfText(await file.arrayBuffer());
        if (text) {
          showExpenseForm(PageFlowParser.extractReceiptData(text), 'Extracted text from the PDF');
          result.innerHTML = '';
          return;
        }
        // Could not decode (e.g. scanned / embedded CID font) -> fall back to AI
        if (pfaApiKey) {
          const data = await aiExtractReceipt(file, pfaApiKey);
          showExpenseForm(data, 'Claude analyzed the PDF 🤖');
          result.innerHTML = '';
          return;
        }
        renderCard(result, 'warn',
          'This PDF is in a format that can\'t be parsed locally (scanned / embedded font).<br>' +
          'Register an API key in the ⚙️ Settings tab to enable AI analysis, or use "Paste receipt text" below.');
        return;
      }

      if (/^image\//.test(file.type)) {
        if (!pfaApiKey) {
          renderCard(result, 'warn',
            'Analyzing images requires AI. Register an Anthropic API key in the ⚙️ Settings tab.');
          return;
        }
        const data = await aiExtractReceipt(file, pfaApiKey);
        showExpenseForm(data, 'Claude analyzed the image 🤖');
        result.innerHTML = '';
        return;
      }

      renderCard(result, 'warn', 'Supported formats: PDF / PNG / JPEG / WebP / GIF / TXT.');
    } catch (e) {
      renderCard(result, 'err', `Parsing error: ${esc(e.message)}`);
    }
  }
}

function showExpenseForm(data, message) {
  $('#expenseForm').classList.remove('hidden');
  if (data.date) $('#expDate').value = data.date;
  if (data.amount != null) $('#expAmount').value = data.amount;
  if (data.vendor) $('#expVendor').value = data.vendor;
  if (data.category) {
    const sel = $('#expCategory');
    const opt = [...sel.options].find((o) => o.value === data.category || o.textContent === data.category);
    if (opt) sel.value = opt.value;
  }
  if (data.memo) $('#expMemo').value = data.memo;
  setStatus(message, 'ok');
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

// Extract structured data from a receipt via the Claude API (direct browser access)
async function aiExtractReceipt(file, apiKey) {
  const b64 = await fileToBase64(file);
  const isPdf = file.type === 'application/pdf';
  const mediaBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : { type: 'image', source: { type: 'base64', media_type: file.type, data: b64 } };

  const schema = {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'Transaction date as YYYY-MM-DD. Empty string if unknown' },
      amount: { type: 'number', description: 'Total amount (including tax)' },
      vendor: { type: 'string', description: 'Merchant / vendor name' },
      category: {
        type: 'string',
        enum: ['Travel', 'Meals & Entertainment', 'Office Supplies', 'Books & Subscriptions', 'Communications', 'Utilities', 'Software & Subscriptions', 'Lodging', 'Miscellaneous'],
        description: 'Expense accounting category'
      },
      memo: { type: 'string', description: 'Short description of the item(s) or purpose' }
    },
    required: ['date', 'amount', 'vendor', 'category', 'memo'],
    additionalProperties: false
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      output_config: { format: { type: 'json_schema', schema } },
      messages: [{
        role: 'user',
        content: [
          mediaBlock,
          { type: 'text', text: 'Extract the information needed for an expense report from this receipt.' }
        ]
      }]
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('The API key is invalid (401). Please check the Settings tab.');
    throw new Error(`Claude API error (${res.status}): ${body.slice(0, 160)}`);
  }
  const data = await res.json();
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) throw new Error('The AI response did not contain any text');
  return JSON.parse(textBlock.text);
}

// ===============================================================
// 3. DevCleanShortcut
// ===============================================================
function devLog(line, clear) {
  const log = $('#devLog');
  if (clear) log.textContent = '';
  log.textContent += (log.textContent ? '\n' : '') + line;
  log.scrollTop = log.scrollHeight;
}

async function agentFetch(path, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 20000);
  try {
    const res = await fetch(`${AGENT_BASE}${path}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function checkAgent() {
  const dot = $('#agentDot');
  const label = $('#agentStatus');
  try {
    const info = await agentFetch('/health', 1800);
    dot.className = 'dot on';
    label.textContent = `Agent connected (v${info.version || '?'} / ${info.platform || ''})`;
    return true;
  } catch (e) {
    dot.className = 'dot off';
    label.textContent = 'Agent not running — start pageflow_agent.py';
    return false;
  }
}

function initDev() {
  checkAgent();
  $('#btnAgentRetry').addEventListener('click', checkAgent);

  const run = async (label, path) => {
    if (!(await checkAgent())) {
      devLog('❌ Could not connect to the agent. In a terminal, run:\n   python3 local-agent/pageflow_agent.py', true);
      return;
    }
    devLog(`▶ Running ${label}…`, true);
    try {
      const res = await agentFetch(path);
      for (const step of (res.steps || [])) {
        devLog(`${step.ok ? '✅' : '⚠️'} ${step.name}`);
        if (step.output) devLog(step.output.trim().split('\n').map((l) => '   ' + l).join('\n'));
      }
      devLog(res.ok ? '🎉 Done' : '⚠️ Some steps failed');
    } catch (e) {
      devLog(`❌ Execution error: ${e.message}`);
    }
  };

  $('#btnPorts').addEventListener('click', () => {
    const port = parseInt($('#devPort').value, 10);
    if (!port || port < 1 || port > 65535) { setStatus('Invalid port number', 'err'); return; }
    run(`freeing port ${port}`, `/clean/ports?port=${port}`);
  });
  $('#btnDocker').addEventListener('click', () => run('Docker cleanup', '/clean/docker'));
  $('#btnCache').addEventListener('click', () => run('cache cleanup', '/clean/cache'));
  $('#btnAll').addEventListener('click', () => {
    const port = parseInt($('#devPort').value, 10) || 3000;
    run('full cleanup', `/clean/all?port=${port}`);
  });
}

// ===============================================================
// 4. CalendarBlocker
// ===============================================================
let lastSchedule = [];

function taskRowTemplate(title, minutes) {
  const row = document.createElement('div');
  row.className = 'task-row';
  const t = document.createElement('input');
  t.type = 'text'; t.className = 't-title'; t.placeholder = 'e.g. Draft the proposal deck';
  t.value = title || '';
  const m = document.createElement('input');
  m.type = 'number'; m.className = 't-min'; m.min = '5'; m.step = '5';
  m.placeholder = 'min'; m.title = 'Estimated time (minutes)';
  m.value = minutes || '';
  const del = document.createElement('button');
  del.className = 't-del'; del.title = 'Remove'; del.textContent = '✕';
  del.addEventListener('click', () => { row.remove(); saveTasks(); });
  row.append(t, m, del);
  return row;
}

function readTasks() {
  return [...document.querySelectorAll('.task-row')]
    .map((row) => ({
      title: row.querySelector('.t-title').value.trim(),
      minutes: parseInt(row.querySelector('.t-min').value, 10) || 0
    }))
    .filter((t) => t.title && t.minutes > 0);
}

async function saveTasks() {
  await chrome.storage.local.set({ pfaTasks: readTasks() });
}

function initCalendar() {
  const rows = $('#taskRows');
  const result = $('#scheduleResult');
  const bookAll = $('#btnBookAll');

  chrome.storage.local.get('pfaTasks').then(({ pfaTasks }) => {
    const tasks = (pfaTasks && pfaTasks.length) ? pfaTasks : [{ title: '', minutes: '' }];
    tasks.forEach((t) => rows.appendChild(taskRowTemplate(t.title, t.minutes)));
  });

  rows.addEventListener('change', saveTasks);
  $('#btnAddTask').addEventListener('click', () => rows.appendChild(taskRowTemplate()));

  $('#btnSchedule').addEventListener('click', () => {
    const tasks = readTasks();
    if (!tasks.length) {
      renderCard(result, 'warn', 'Please enter a task name and estimated time (minutes).');
      bookAll.classList.add('hidden');
      return;
    }
    saveTasks();
    const { blocks, unplaced } = PageFlowParser.computeSchedule(tasks, {
      baseDate: new Date(),
      now: new Date(),
      start: $('#calStart').value || '09:00',
      end: $('#calEnd').value || '18:00',
      lunchStart: $('#calLunchStart').value,
      lunchEnd: $('#calLunchEnd').value,
      busy: PageFlowParser.parseBusyLines($('#calBusy').value),
      bufferMinutes: 5
    });
    lastSchedule = blocks;
    if (!blocks.length) {
      renderCard(result, 'warn', 'No free slot was found in the remaining time today. Try extending the end time or splitting tasks up.');
      bookAll.classList.add('hidden');
      return;
    }
    const fmt = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    result.innerHTML = blocks.map((b, i) =>
      `<div class="slot"><span class="time">${fmt(b.start)}–${fmt(b.end)}</span>` +
      `<span class="title">${esc(b.title)}</span>` +
      `<button class="btn ghost small slot-book" data-i="${i}">Book</button></div>`
    ).join('') + (unplaced.length
      ? `<div class="result-card warn">Tasks that didn't fit: ${unplaced.map(esc).join(' / ')}</div>` : '');
    result.querySelectorAll('.slot-book').forEach((btn) => {
      btn.addEventListener('click', () => bookBlock(blocks[Number(btn.dataset.i)]));
    });
    bookAll.classList.remove('hidden');
  });

  bookAll.addEventListener('click', async () => {
    if (!lastSchedule.length) return;
    const toOpen = lastSchedule.slice(0, 8); // avoid opening too many tabs
    for (const block of toOpen) {
      await bookBlock(block, true);
    }
    if (lastSchedule.length > 8) {
      setStatus('Only 8 can be opened at once. Use the individual "Book" buttons for the rest.', 'err');
    } else {
      setStatus(`Opened ${toOpen.length} event-creation tab(s). Click "Save" in each tab to confirm.`, 'ok');
    }
  });
}

async function bookBlock(block, background) {
  const url = PageFlowParser.buildCalendarUrl(
    `🛡 Focus time: ${block.title}`, block.start, block.end,
    `Focus-time block reserved by PageFlow AI.\nEstimate: ${block.minutes} min`);
  await chrome.tabs.create({ url, active: !background });
}

// ===============================================================
// 5. Settings
// ===============================================================
function initSettings() {
  const input = $('#apiKey');
  const status = $('#keyStatus');

  chrome.storage.local.get('pfaApiKey').then(({ pfaApiKey }) => {
    if (pfaApiKey) {
      input.value = pfaApiKey;
      status.textContent = '✅ API key set — AI analysis of image / scanned-PDF receipts is enabled';
    }
  });

  $('#btnSaveKey').addEventListener('click', async () => {
    const key = input.value.trim();
    if (!key) { setStatus('Please enter an API key', 'err'); return; }
    await chrome.storage.local.set({ pfaApiKey: key });
    status.textContent = '✅ Saved — AI analysis of image / scanned-PDF receipts is enabled';
    setStatus('API key saved', 'ok');
  });

  $('#btnClearKey').addEventListener('click', async () => {
    await chrome.storage.local.remove('pfaApiKey');
    input.value = '';
    status.textContent = 'No API key is set';
    setStatus('API key deleted', 'ok');
  });
}

// ===============================================================
// Bootstrap
// ===============================================================
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initTabs();
  initMapper();
  initExpense();
  initDev();
  initCalendar();
  initSettings();
});
