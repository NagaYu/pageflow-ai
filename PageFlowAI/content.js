// PageFlow AI - content script
// ポップアップから必要なときだけ chrome.scripting.executeScript で注入される。
// ページ上のフォームを DOM 解析してラベルを推定し、与えられた key/value を
// 最適なフィールドへ自動入力する（React 等の制御コンポーネントにも対応）。

(() => {
  'use strict';
  if (window.__pageflowAI) return;
  window.__pageflowAI = true;

  // ラベル同義語グループ（日本語の社内システム頻出語を優先）
  const GROUPS = {
    name: ['氏名', '名前', 'お名前', '担当者', '担当者名', '申請者', 'フルネーム', 'name', 'your-name', 'fullname', 'username'],
    company: ['会社名', '会社', '企業名', '法人名', '所属', '組織', '団体名', '貴社名', 'company', 'organization', 'corp'],
    department: ['部署', '部門', '所属部署', '課', 'department', 'division'],
    email: ['メールアドレス', 'メール', 'email', 'mail', 'e-mail', 'eメール'],
    phone: ['電話番号', '電話', 'tel', 'phone', '携帯', '携帯番号', '連絡先'],
    date: ['日付', '日時', '利用日', '実施日', '開催日', '購入日', '支払日', '発生日', '申請日', 'date'],
    amount: ['金額', '合計', '合計金額', '価格', '費用', '料金', '支払額', '経費金額', 'amount', 'price', 'total', 'cost'],
    subject: ['件名', 'タイトル', '題名', '議題', '案件名', '案件', 'subject', 'title'],
    body: ['内容', '詳細', '本文', '備考', 'メモ', '摘要', '概要', '説明', '議事内容', 'コメント', '申請理由', 'description', 'note', 'memo', 'comment', 'message', 'remarks', 'detail', 'body'],
    address: ['住所', '所在地', 'address'],
    category: ['勘定科目', '科目', '費目', '経費区分', 'カテゴリ', 'カテゴリー', '経費種別', 'category'],
    vendor: ['支払先', '支払い先', '店名', '店舗名', '取引先', '購入先', '利用先', 'vendor', 'payee', 'store'],
    place: ['場所', '会場', '開催場所', 'location', 'venue'],
    attendees: ['参加者', '出席者', 'メンバー', 'attendees', 'participants'],
    decision: ['決定事項', '結論', 'decision'],
    todo: ['todo', '宿題', 'アクション', 'ネクストアクション', '次回', 'action', 'task', 'やること'],
    project: ['プロジェクト', 'プロジェクト名', '案件番号', 'project'],
    url: ['url', 'リンク', 'link', 'サイト', 'ホームページ']
  };

  const normalize = (s) => String(s || '')
    .toLowerCase()
    .replace(/[\s　:：=＝*＊※必須（）()「」【】\[\]<>＜＞॰、。.,!?！？]/g, '');

  function groupOf(label) {
    const n = normalize(label);
    if (!n) return null;
    let partial = null;
    for (const [group, words] of Object.entries(GROUPS)) {
      for (const w of words) {
        const wn = normalize(w);
        if (!wn) continue;
        if (n === wn) return group;
        if (!partial && (n.includes(wn) || wn.includes(n))) partial = group;
      }
    }
    return partial;
  }

  // フィールドのラベル候補と入力テキストのキーがどれだけ一致するか (0〜1)
  function scoreMatch(fieldLabels, entryKey) {
    const e = normalize(entryKey);
    if (!e) return 0;
    let best = 0;
    const eg = groupOf(entryKey);
    for (const label of fieldLabels) {
      const f = normalize(label);
      if (!f) continue;
      if (f === e) return 1.0;
      if (f.includes(e) || e.includes(f)) best = Math.max(best, 0.85);
      const fg = groupOf(label);
      if (fg && eg && fg === eg) best = Math.max(best, 0.75);
    }
    return best;
  }

  // ---------------------------------------------------------------
  // ラベル推定: label[for] / 親label / aria / placeholder / table / dl / 兄弟要素
  // ---------------------------------------------------------------
  function cleanText(node) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll('input, select, textarea, button, script, style').forEach((n) => n.remove());
    return clone.textContent || '';
  }

  function getLabelTexts(el) {
    const labels = [];
    const push = (t) => {
      t = String(t || '').replace(/\s+/g, ' ').trim();
      if (t && t.length <= 60) labels.push(t);
    };
    if (el.id) {
      try {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l) push(cleanText(l));
      } catch (e) { /* 無効な id は無視 */ }
    }
    const parentLabel = el.closest('label');
    if (parentLabel) push(cleanText(parentLabel));
    push(el.getAttribute('aria-label'));
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      lb.split(/\s+/).forEach((id) => {
        const n = document.getElementById(id);
        if (n) push(n.textContent);
      });
    }
    push(el.placeholder);
    // テーブルレイアウト: <th>ラベル</th><td><input></td>
    const td = el.closest('td');
    if (td) {
      const prev = td.previousElementSibling;
      if (prev && /^(TH|TD)$/.test(prev.tagName)) push(prev.textContent);
      const tr = td.closest('tr');
      if (tr && tr.cells && tr.cells.length && td.cellIndex > 0) {
        const table = tr.closest('table');
        const headRow = table && table.tHead && table.tHead.rows[0];
        if (headRow && headRow.cells[td.cellIndex]) push(headRow.cells[td.cellIndex].textContent);
      }
    }
    // 定義リスト: <dt>ラベル</dt><dd><input></dd>
    const dd = el.closest('dd');
    if (dd) {
      const dt = dd.previousElementSibling;
      if (dt && dt.tagName === 'DT') push(dt.textContent);
    }
    // 直前の兄弟要素
    const sib = el.previousElementSibling;
    if (sib && /^(LABEL|SPAN|DIV|P|B|STRONG|H[1-6])$/.test(sib.tagName)) push(sib.textContent);
    // 親要素のテキスト（最終手段）
    if (!labels.length && el.parentElement) push(cleanText(el.parentElement));
    push(el.name);
    push(el.id);
    return [...new Set(labels)];
  }

  function isVisible(el) {
    if (!el.getClientRects().length) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  function collectFields() {
    const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'password', 'file']);
    const els = [...document.querySelectorAll('input, textarea, select')];
    const fields = [];
    for (const el of els) {
      if (el.disabled || el.readOnly) continue;
      const type = (el.type || '').toLowerCase();
      if (el.tagName === 'INPUT' && SKIP_TYPES.has(type)) continue;
      if (!isVisible(el)) continue;
      fields.push({ el, tag: el.tagName.toLowerCase(), type, labels: getLabelTexts(el) });
    }
    return fields;
  }

  // ---------------------------------------------------------------
  // 値の書き込み（React/Vue の制御コンポーネント対応 + イベント発火）
  // ---------------------------------------------------------------
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function ensureHighlightStyle() {
    if (document.getElementById('pfa-style')) return;
    const style = document.createElement('style');
    style.id = 'pfa-style';
    style.textContent =
      '.pfa-filled{outline:2px solid #6366f1 !important;outline-offset:1px;' +
      'box-shadow:0 0 0 4px rgba(99,102,241,.25) !important;' +
      'transition:outline .3s ease, box-shadow .3s ease;}';
    document.head.appendChild(style);
  }

  function flash(el) {
    ensureHighlightStyle();
    el.classList.add('pfa-filled');
    setTimeout(() => el.classList.remove('pfa-filled'), 2500);
  }

  // 型に合わせて値を整形
  function coerceValue(field, value) {
    const v = String(value).trim();
    if (field.type === 'date') {
      const m = v.match(/(20\d{2})\s*[\/年.\-]\s*(\d{1,2})\s*[\/月.\-]\s*(\d{1,2})/);
      if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
      return null; // date input に解釈不能な値は入れない
    }
    if (field.type === 'number') {
      const digits = v.replace(/[^\d.\-]/g, '');
      return digits || null;
    }
    if (field.type === 'time') {
      const m = v.match(/(\d{1,2}):(\d{2})/);
      return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
    }
    return v;
  }

  function fillSelect(el, value) {
    const nv = normalize(value);
    let best = null;
    let bestScore = 0;
    for (const opt of el.options) {
      const candidates = [opt.textContent, opt.value, opt.label];
      for (const c of candidates) {
        const nc = normalize(c);
        if (!nc) continue;
        let score = 0;
        if (nc === nv) score = 1.0;
        else if (nc.includes(nv) || nv.includes(nc)) score = 0.8;
        if (score > bestScore) { bestScore = score; best = opt; }
      }
    }
    if (best && bestScore >= 0.8) {
      setNativeValue(el, best.value);
      return best.textContent.trim();
    }
    return null;
  }

  function fillField(field, value) {
    const el = field.el;
    if (field.tag === 'select') {
      const picked = fillSelect(el, value);
      if (picked === null) return null;
      flash(el);
      return picked;
    }
    if (field.type === 'checkbox') {
      const truthy = /^(はい|あり|有|yes|true|on|1|✓|要)$/i.test(String(value).trim());
      el.checked = truthy;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      flash(el);
      return truthy ? 'チェックON' : 'チェックOFF';
    }
    if (field.type === 'radio') {
      const radios = el.name
        ? [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)]
        : [el];
      const nv = normalize(value);
      for (const r of radios) {
        const rl = getLabelTexts(r).map(normalize).join('|');
        if (normalize(r.value) === nv || (nv && rl.includes(nv))) {
          r.checked = true;
          r.dispatchEvent(new Event('change', { bubbles: true }));
          flash(r);
          return value;
        }
      }
      return null;
    }
    const coerced = coerceValue(field, value);
    if (coerced === null) return null;
    setNativeValue(el, coerced);
    flash(el);
    return coerced;
  }

  // ---------------------------------------------------------------
  // メイン: entries [{key, value}] をページのフォームにマッピング
  // ---------------------------------------------------------------
  const THRESHOLD = 0.6;

  function fillForms(entries) {
    const fields = collectFields();
    const usedFields = new Set();
    const filled = [];
    const unmatched = [];

    for (const entry of entries) {
      let bestField = null;
      let bestScore = 0;
      for (const field of fields) {
        if (usedFields.has(field.el)) continue;
        let score = scoreMatch(field.labels, entry.key);
        // 型ヒント: メールは email 型、日付は date 型を優遇
        const eg = groupOf(entry.key);
        if (eg === 'email' && field.type === 'email') score += 0.1;
        if (eg === 'date' && field.type === 'date') score += 0.1;
        if (eg === 'phone' && field.type === 'tel') score += 0.1;
        if (eg === 'body' && field.tag === 'textarea') score += 0.05;
        if (score > bestScore) { bestScore = score; bestField = field; }
      }
      if (bestField && bestScore >= THRESHOLD) {
        const applied = fillField(bestField, entry.value);
        if (applied !== null) {
          usedFields.add(bestField.el);
          filled.push({
            key: entry.key,
            label: bestField.labels[0] || bestField.el.name || '(無名フィールド)',
            value: String(applied).slice(0, 80)
          });
          continue;
        }
      }
      unmatched.push(entry.key);
    }
    return { ok: true, totalFields: fields.length, filled, unmatched };
  }

  function scanForms() {
    return collectFields().map((f, i) => ({
      index: i + 1,
      tag: f.tag,
      type: f.type || '',
      label: f.labels[0] || '(ラベル不明)',
      candidates: f.labels.slice(0, 3)
    }));
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    try {
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'PFA_PING') {
        sendResponse({ ok: true });
      } else if (msg.type === 'PFA_SCAN') {
        sendResponse({ ok: true, fields: scanForms() });
      } else if (msg.type === 'PFA_FILL') {
        sendResponse(fillForms(Array.isArray(msg.entries) ? msg.entries : []));
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message || e) });
    }
    return false; // 同期応答
  });
})();
