// PageFlow AI - popup.js
// 4 機能（SmartFormMapper / ExpensePilot / DevCleanShortcut / CalendarBlocker）の UI 制御。
// CSP 準拠: インラインスクリプトなし・eval なし・リモートコード読み込みなし。

'use strict';

const $ = (sel) => document.querySelector(sel);
const AGENT_BASE = 'http://127.0.0.1:8765';
const CLAUDE_MODEL = 'claude-opus-4-8';

// ---------------------------------------------------------------
// 共通ユーティリティ
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
  // file:// はデモフォーム用（拡張機能の詳細設定で「ファイルのURLへのアクセス」を許可した場合に有効）
  return /^(https?|file):\/\//.test(url || '');
}

async function ensureContentScript(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'PFA_PING' });
    if (res && res.ok) return;
  } catch (e) { /* 未注入 → 注入する */ }
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

async function sendToPage(message) {
  const tab = await getActiveTab();
  if (!tab || !isInjectableUrl(tab.url)) {
    throw new Error('このページでは利用できません（chrome:// や拡張機能ページ等）。通常の Web ページで開いてください。');
  }
  await ensureContentScript(tab.id);
  return chrome.tabs.sendMessage(tab.id, message);
}

// ---------------------------------------------------------------
// テーマ切替（ダークモード対応）
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
// タブ切替
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

  // 右クリックメニュー経由のテキストを取り込む
  chrome.storage.local.get('pfaPendingText').then(({ pfaPendingText }) => {
    if (pfaPendingText) {
      textarea.value = pfaPendingText;
      chrome.storage.local.remove('pfaPendingText');
      chrome.runtime.sendMessage({ type: 'PFA_CLEAR_BADGE' }).catch(() => {});
      setStatus('右クリックで送ったテキストを読み込みました', 'ok');
    }
  });

  $('#btnPaste').addEventListener('click', async () => {
    try {
      textarea.value = await navigator.clipboard.readText();
      setStatus('クリップボードから貼り付けました', 'ok');
    } catch (e) {
      setStatus('クリップボードを読み取れませんでした', 'err');
    }
  });

  $('#btnScan').addEventListener('click', async () => {
    try {
      renderCard(result, 'ok', '<span class="spinner"></span>ページを解析中…');
      const res = await sendToPage({ type: 'PFA_SCAN' });
      if (!res || !res.ok) throw new Error(res && res.error || '解析に失敗しました');
      if (!res.fields.length) {
        renderCard(result, 'warn', '入力可能なフォームが見つかりませんでした。');
        return;
      }
      const items = res.fields.slice(0, 20).map((f) =>
        `<li><strong>${esc(f.label)}</strong> <span class="muted">(${esc(f.tag)}${f.type ? ':' + esc(f.type) : ''})</span></li>`
      ).join('');
      renderCard(result, 'ok',
        `<span class="badge">${res.fields.length}</span>個のフィールドを検出しました<ul>${items}</ul>`);
    } catch (e) {
      renderCard(result, 'err', esc(e.message));
    }
  });

  $('#btnMap').addEventListener('click', async () => {
    const text = textarea.value.trim();
    if (!text) {
      renderCard(result, 'warn', 'テキストを貼り付けてください。');
      return;
    }
    const entries = PageFlowParser.extractFieldsFromText(text);
    if (!entries.length) {
      renderCard(result, 'warn',
        '「項目名: 値」の形式が見つかりませんでした。<br>例)「氏名: 山田太郎」のような行を含めてください。');
      return;
    }
    try {
      renderCard(result, 'ok', '<span class="spinner"></span>マッピング中…');
      const res = await sendToPage({ type: 'PFA_FILL', entries });
      if (!res || !res.ok) throw new Error(res && res.error || '入力に失敗しました');
      renderFillReport(result, res, entries.length);
    } catch (e) {
      renderCard(result, 'err', esc(e.message));
    }
  });
}

function renderFillReport(container, res, entryCount) {
  if (!res.filled.length) {
    renderCard(container, 'warn',
      `テキストから ${entryCount} 項目を抽出しましたが、一致するフォーム項目が見つかりませんでした` +
      `（ページ内フィールド: ${res.totalFields} 個）。「🔍 フォーム検出」でラベルを確認してください。`);
    return;
  }
  const rows = res.filled.map((f) =>
    `<div class="kv"><span>✅ ${esc(f.label)}</span><span class="v">${esc(f.value)}</span></div>`
  ).join('');
  const skipped = res.unmatched.length
    ? `<div class="muted" style="margin-top:6px">未マッチ: ${res.unmatched.map(esc).join(' / ')}</div>`
    : '';
  renderCard(container, 'ok',
    `<span class="badge">${res.filled.length}</span>項目を自動入力しました${rows ? rows : ''}${skipped}`);
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
    if (!text) { setStatus('レシートのテキストを貼り付けてください', 'err'); return; }
    const data = PageFlowParser.extractReceiptData(text);
    showExpenseForm(data, 'テキストを解析しました');
  });

  $('#btnFillExpense').addEventListener('click', async () => {
    const entries = [];
    const add = (key, value) => { if (value) entries.push({ key, value: String(value) }); };
    add('日付', $('#expDate').value);
    add('金額', $('#expAmount').value);
    add('支払先', $('#expVendor').value);
    add('勘定科目', $('#expCategory').value);
    add('内容', $('#expMemo').value);
    if (!entries.length) { setStatus('入力する値がありません', 'err'); return; }
    try {
      renderCard(result, 'ok', '<span class="spinner"></span>経費フォームへ入力中…');
      const res = await sendToPage({ type: 'PFA_FILL', entries });
      if (!res || !res.ok) throw new Error(res && res.error || '入力に失敗しました');
      renderFillReport(result, res, entries.length);
    } catch (e) {
      renderCard(result, 'err', esc(e.message));
    }
  });

  async function handleReceiptFile(file) {
    const result = $('#expenseResult');
    try {
      renderCard(result, 'ok', `<span class="spinner"></span>「${esc(file.name)}」を解析中…`);
      const { pfaApiKey } = await chrome.storage.local.get('pfaApiKey');

      if (file.type === 'text/plain' || /\.txt$/i.test(file.name)) {
        const text = await file.text();
        showExpenseForm(PageFlowParser.extractReceiptData(text), 'テキストファイルを解析しました');
        result.innerHTML = '';
        return;
      }

      if (file.type === 'application/pdf') {
        const text = await PageFlowPdf.extractPdfText(await file.arrayBuffer());
        if (text) {
          showExpenseForm(PageFlowParser.extractReceiptData(text), 'PDF からテキストを抽出しました');
          result.innerHTML = '';
          return;
        }
        // 日本語 CID フォント等で抽出不能 → AI フォールバック
        if (pfaApiKey) {
          const data = await aiExtractReceipt(file, pfaApiKey);
          showExpenseForm(data, 'Claude が PDF を解析しました 🤖');
          result.innerHTML = '';
          return;
        }
        renderCard(result, 'warn',
          'この PDF はローカル解析できない形式でした（スキャン/日本語埋め込みフォント）。<br>' +
          '⚙️ 設定タブで API キーを登録すると AI 解析できます。下の「テキスト貼り付け」でも入力できます。');
        return;
      }

      if (/^image\//.test(file.type)) {
        if (!pfaApiKey) {
          renderCard(result, 'warn',
            '画像の解析には AI が必要です。⚙️ 設定タブで Anthropic API キーを登録してください。');
          return;
        }
        const data = await aiExtractReceipt(file, pfaApiKey);
        showExpenseForm(data, 'Claude が画像を解析しました 🤖');
        result.innerHTML = '';
        return;
      }

      renderCard(result, 'warn', '対応形式は PDF / PNG / JPEG / WebP / GIF / TXT です。');
    } catch (e) {
      renderCard(result, 'err', `解析エラー: ${esc(e.message)}`);
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
    reader.onerror = () => reject(new Error('ファイルを読み込めませんでした'));
    reader.readAsDataURL(file);
  });
}

// Claude API で領収書から構造化データを抽出（ブラウザ直接アクセス）
async function aiExtractReceipt(file, apiKey) {
  const b64 = await fileToBase64(file);
  const isPdf = file.type === 'application/pdf';
  const mediaBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : { type: 'image', source: { type: 'base64', media_type: file.type, data: b64 } };

  const schema = {
    type: 'object',
    properties: {
      date: { type: 'string', description: '利用日 YYYY-MM-DD。不明なら空文字' },
      amount: { type: 'integer', description: '合計金額（税込・円）' },
      vendor: { type: 'string', description: '店名・支払先' },
      category: {
        type: 'string',
        enum: ['旅費交通費', '会議費', '接待交際費', '消耗品費', '通信費', '新聞図書費', '水道光熱費', '地代家賃', '雑費'],
        description: '日本の経費精算で使う勘定科目'
      },
      memo: { type: 'string', description: '品目・用途の短い説明' }
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
          { type: 'text', text: 'この領収書から経費精算に必要な情報を抽出してください。' }
        ]
      }]
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('API キーが無効です（401）。設定タブで確認してください。');
    throw new Error(`Claude API エラー (${res.status}): ${body.slice(0, 160)}`);
  }
  const data = await res.json();
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) throw new Error('AI 応答にテキストが含まれていません');
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
    label.textContent = `エージェント接続中 (v${info.version || '?'} / ${info.platform || ''})`;
    return true;
  } catch (e) {
    dot.className = 'dot off';
    label.textContent = 'エージェント未起動 — pageflow_agent.py を実行してください';
    return false;
  }
}

function initDev() {
  checkAgent();
  $('#btnAgentRetry').addEventListener('click', checkAgent);

  const run = async (label, path) => {
    if (!(await checkAgent())) {
      devLog('❌ エージェントに接続できません。ターミナルで以下を実行:\n   python3 local-agent/pageflow_agent.py', true);
      return;
    }
    devLog(`▶ ${label} を実行中…`, true);
    try {
      const res = await agentFetch(path);
      for (const step of (res.steps || [])) {
        devLog(`${step.ok ? '✅' : '⚠️'} ${step.name}`);
        if (step.output) devLog(step.output.trim().split('\n').map((l) => '   ' + l).join('\n'));
      }
      devLog(res.ok ? '🎉 完了しました' : '⚠️ 一部のステップが失敗しました');
    } catch (e) {
      devLog(`❌ 実行エラー: ${e.message}`);
    }
  };

  $('#btnPorts').addEventListener('click', () => {
    const port = parseInt($('#devPort').value, 10);
    if (!port || port < 1 || port > 65535) { setStatus('ポート番号が不正です', 'err'); return; }
    run(`ポート ${port} の解放`, `/clean/ports?port=${port}`);
  });
  $('#btnDocker').addEventListener('click', () => run('Docker クリーンアップ', '/clean/docker'));
  $('#btnCache').addEventListener('click', () => run('キャッシュ削除', '/clean/cache'));
  $('#btnAll').addEventListener('click', () => {
    const port = parseInt($('#devPort').value, 10) || 3000;
    run('フルクリーンアップ', `/clean/all?port=${port}`);
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
  t.type = 'text'; t.className = 't-title'; t.placeholder = '例) 提案資料の作成';
  t.value = title || '';
  const m = document.createElement('input');
  m.type = 'number'; m.className = 't-min'; m.min = '5'; m.step = '5';
  m.placeholder = '分'; m.title = '見積もり時間（分）';
  m.value = minutes || '';
  const del = document.createElement('button');
  del.className = 't-del'; del.title = '削除'; del.textContent = '✕';
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
      renderCard(result, 'warn', 'タスク名と見積もり時間（分）を入力してください。');
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
      renderCard(result, 'warn', '今日の残り時間に収まる空きが見つかりませんでした。終了時刻を延ばすか、タスクを分割してください。');
      bookAll.classList.add('hidden');
      return;
    }
    const fmt = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    result.innerHTML = blocks.map((b, i) =>
      `<div class="slot"><span class="time">${fmt(b.start)}–${fmt(b.end)}</span>` +
      `<span class="title">${esc(b.title)}</span>` +
      `<button class="btn ghost small slot-book" data-i="${i}">登録</button></div>`
    ).join('') + (unplaced.length
      ? `<div class="result-card warn">収まらなかったタスク: ${unplaced.map(esc).join(' / ')}</div>` : '');
    result.querySelectorAll('.slot-book').forEach((btn) => {
      btn.addEventListener('click', () => bookBlock(blocks[Number(btn.dataset.i)]));
    });
    bookAll.classList.remove('hidden');
  });

  bookAll.addEventListener('click', async () => {
    if (!lastSchedule.length) return;
    const toOpen = lastSchedule.slice(0, 8); // タブの開きすぎを防止
    for (const block of toOpen) {
      await bookBlock(block, true);
    }
    if (lastSchedule.length > 8) {
      setStatus('一度に開けるのは 8 件までです。残りは個別の「登録」を使ってください。', 'err');
    } else {
      setStatus(`${toOpen.length} 件の予定作成タブを開きました。各タブで「保存」を押せば確定です。`, 'ok');
    }
  });
}

async function bookBlock(block, background) {
  const url = PageFlowParser.buildCalendarUrl(
    `🛡 作業時間: ${block.title}`, block.start, block.end,
    `PageFlow AI が確保した集中作業ブロックです。\n見積もり: ${block.minutes}分`);
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
      status.textContent = '✅ API キー設定済み — 画像・スキャン PDF の AI 解析が有効です';
    }
  });

  $('#btnSaveKey').addEventListener('click', async () => {
    const key = input.value.trim();
    if (!key) { setStatus('API キーを入力してください', 'err'); return; }
    await chrome.storage.local.set({ pfaApiKey: key });
    status.textContent = '✅ 保存しました — 画像・スキャン PDF の AI 解析が有効です';
    setStatus('API キーを保存しました', 'ok');
  });

  $('#btnClearKey').addEventListener('click', async () => {
    await chrome.storage.local.remove('pfaApiKey');
    input.value = '';
    status.textContent = 'API キーは未設定です';
    setStatus('API キーを削除しました', 'ok');
  });
}

// ===============================================================
// 起動
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
