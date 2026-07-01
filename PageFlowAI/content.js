// PageFlow AI - content script
// Injected on demand via chrome.scripting.executeScript only when the popup
// needs it. Analyzes the DOM of the current page to infer field labels and
// auto-fills the given key/value pairs into the best-matching fields
// (also handles controlled components such as React/Vue).

(() => {
  'use strict';
  if (window.__pageflowAI) return;
  window.__pageflowAI = true;

  // Label synonym groups for common business-form fields
  const GROUPS = {
    name: ['name', 'full name', 'your name', 'contact name', 'first name', 'last name', 'requester', 'username'],
    company: ['company', 'company name', 'organization', 'organisation', 'business name', 'employer'],
    department: ['department', 'division', 'team'],
    email: ['email', 'e-mail', 'email address'],
    phone: ['phone', 'phone number', 'telephone', 'mobile', 'contact number', 'cell'],
    date: ['date', 'expense date', 'transaction date', 'event date', 'due date', 'purchase date'],
    amount: ['amount', 'total', 'total amount', 'price', 'cost', 'expense amount', 'sum'],
    subject: ['subject', 'title', 'topic', 'meeting title'],
    body: ['description', 'details', 'notes', 'note', 'memo', 'summary', 'comments', 'comment', 'message', 'remarks', 'reason', 'body'],
    address: ['address', 'street address', 'location address'],
    category: ['category', 'expense category', 'account', 'account code', 'expense type'],
    vendor: ['vendor', 'payee', 'merchant', 'store', 'supplier', 'paid to'],
    place: ['location', 'venue', 'place', 'room'],
    attendees: ['attendees', 'participants', 'members'],
    decision: ['decision', 'conclusion', 'resolution'],
    todo: ['todo', 'action item', 'action items', 'next steps', 'follow up', 'follow-up', 'task'],
    project: ['project', 'project name', 'project code'],
    url: ['url', 'link', 'website', 'homepage']
  };

  const normalize = (s) => String(s || '')
    .toLowerCase()
    .replace(/[\s:=*()[\]<>.,!?"'#-]/g, '');

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

  // How well a field's candidate labels match the entry key (0-1)
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
  // Label inference: label[for] / ancestor <label> / aria / placeholder /
  // table / definition list / sibling elements
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
      } catch (e) { /* ignore invalid id */ }
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
    // Table layout: <th>Label</th><td><input></td>
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
    // Definition list: <dt>Label</dt><dd><input></dd>
    const dd = el.closest('dd');
    if (dd) {
      const dt = dd.previousElementSibling;
      if (dt && dt.tagName === 'DT') push(dt.textContent);
    }
    // Immediately preceding sibling element
    const sib = el.previousElementSibling;
    if (sib && /^(LABEL|SPAN|DIV|P|B|STRONG|H[1-6])$/.test(sib.tagName)) push(sib.textContent);
    // Parent element text (last resort)
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
  // Writing values (supports React/Vue controlled components + fires events)
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

  // Coerce the value to match the field's input type
  function coerceValue(field, value) {
    const v = String(value).trim();
    if (field.type === 'date') {
      const m = v.match(/(20\d{2})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/);
      if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
      return null; // don't put an unparsable value into a date input
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
      const truthy = /^(yes|true|on|1|checked|required)$/i.test(String(value).trim());
      el.checked = truthy;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      flash(el);
      return truthy ? 'Checked' : 'Unchecked';
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
  // Main: map entries [{key, value}] onto the page's form fields
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
        // Type hints: prefer an email input for email, a date input for date, etc.
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
            label: bestField.labels[0] || bestField.el.name || '(unnamed field)',
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
      label: f.labels[0] || '(label unknown)',
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
    return false; // synchronous response
  });
})();
