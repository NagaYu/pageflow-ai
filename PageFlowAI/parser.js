// PageFlow AI - parser.js
// Pure logic for text parsing and schedule calculation.
// Loaded via <script> from popup.html, and also require()-able from
// Node.js for unit testing — exported in UMD form.

(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.PageFlowParser = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');
  const fmtDate = (y, m, d) => `${y}-${pad(Number(m))}-${pad(Number(d))}`;
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  // ---------------------------------------------------------------
  // [SmartFormMapper] Extract "key: value" pairs from free-form text
  // such as meeting notes
  // ---------------------------------------------------------------
  function extractFieldsFromText(text) {
    const entries = [];
    const seen = new Set();
    const lines = String(text || '').split(/\r?\n/);
    const BULLET = /^[\s\-*•◆■□▼○>]+/;

    for (const rawLine of lines) {
      const line = rawLine.trim().replace(BULLET, '').trim();
      if (!line) continue;
      let key = '';
      let value = '';
      // "[Company] ACME" / "[Subject] Kickoff call" style (colon optional)
      let m = line.match(/^\[([^\]]{1,30})\]\s*[:=]?\s*(.+)$/);
      if (m) {
        key = m[1]; value = m[2];
      } else {
        // "Name: John Smith" / "Company = ACME" style (separator required)
        m = line.match(/^([^:=]{1,30})\s*[:=]\s*(.+)$/);
        if (m) { key = m[1]; value = m[2]; }
      }
      key = (key || '').trim();
      value = (value || '').trim();
      if (!key || !value) continue;
      if (/^https?$/i.test(key)) continue; // don't misdetect the "https:" of a URL as a key
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ key, value });
    }

    // Fallback extraction: common patterns that can be picked up even without a key
    const whole = String(text || '');
    const helpers = [
      { key: 'Email', group: ['email', 'mail'], re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
      { key: 'Phone', group: ['phone', 'tel', 'mobile'], re: /(?:\+?\d[\d\s.\-()]{7,}\d)/ },
      { key: 'Date', group: ['date', 'when'], re: /20\d{2}[\/.\-]\d{1,2}[\/.\-]\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+20\d{2}/i },
      { key: 'Amount', group: ['amount', 'total', 'price'], re: /[$€£]\s?[0-9][0-9,]*(?:\.\d{2})?/ }
    ];
    for (const h of helpers) {
      const covered = entries.some((e) =>
        h.group.some((g) => e.key.toLowerCase().includes(g.toLowerCase())));
      if (covered) continue;
      const m = whole.match(h.re);
      if (m) entries.push({ key: h.key, value: m[0].trim() });
    }
    return entries;
  }

  // ---------------------------------------------------------------
  // [ExpensePilot] Extract date / amount / vendor / category from receipt text
  // ---------------------------------------------------------------
  const CATEGORY_RULES = [
    { category: 'Travel', words: ['taxi', 'uber', 'lyft', 'train', 'rail', 'amtrak', 'bus', 'airline', 'flight', 'airfare', 'parking', 'toll', 'gas station', 'fuel', 'rental car', 'metro', 'subway', 'transit', 'fare', 'mileage'] },
    { category: 'Meals & Entertainment', words: ['restaurant', 'cafe', 'coffee', 'starbucks', 'diner', 'bar', 'pub', 'bistro', 'grill', 'bakery', 'catering', 'lunch', 'dinner', 'breakfast'] },
    { category: 'Office Supplies', words: ['staples', 'office depot', 'amazon', 'best buy', 'walmart', 'target', 'ink', 'toner', 'paper', 'batteries', 'cable', 'mouse', 'keyboard', 'stationery', 'supplies'] },
    { category: 'Books & Subscriptions', words: ['bookstore', 'barnes', 'kindle', 'book', 'magazine', 'subscription', 'newspaper', 'journal'] },
    { category: 'Communications', words: ['postage', 'stamps', 'fedex', 'ups', 'usps', 'shipping', 'sim card', 'mobile plan', 'wifi', 'wi-fi', 'internet bill', 'phone bill'] },
    { category: 'Utilities', words: ['electric bill', 'electricity', 'gas bill', 'water bill', 'utility', 'power company'] },
    { category: 'Software & Subscriptions', words: ['saas', 'software', 'license', 'subscription', 'app store', 'google workspace', 'microsoft 365', 'slack', 'zoom', 'adobe'] },
    { category: 'Lodging', words: ['hotel', 'motel', 'inn', 'airbnb', 'lodging', 'resort'] }
  ];

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function guessCategory(text) {
    const t = String(text || '');
    for (const rule of CATEGORY_RULES) {
      // Word-boundary match: a substring check would let a short keyword like
      // "bar" false-positive inside an unrelated word like "Barnes & Noble".
      if (rule.words.some((w) => new RegExp(`\\b${escapeRe(w.toLowerCase())}\\b`).test(t.toLowerCase()))) {
        return rule.category;
      }
    }
    return 'Miscellaneous';
  }

  function extractReceiptData(text) {
    const t = String(text || '');
    const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const result = { date: '', amount: null, vendor: '', category: '', memo: '' };

    // --- Date ---
    // ISO-ish: 2026-06-09, 2026/06/09
    let m = t.match(/\b(20\d{2})[\/.\-](\d{1,2})[\/.\-](\d{1,2})\b/);
    if (m) result.date = fmtDate(m[1], m[2], m[3]);
    // US-style: 06/09/2026 (month/day/year)
    if (!result.date) {
      m = t.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2})\b/);
      if (m) result.date = fmtDate(m[3], m[1], m[2]);
    }
    // "June 9, 2026" / "Jun 9 2026"
    if (!result.date) {
      m = t.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})\b/i);
      if (m) {
        const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
        if (mi) result.date = fmtDate(m[3], mi, m[2]);
      }
    }

    // --- Amount ---
    // Lines containing "Total" are preferred. Lines with phone numbers, change
    // due, or account/card numbers are excluded.
    const EXCLUDE = /(phone|tel|fax|change due|amount tendered|tendered|card no|account no|member(?:ship)?\s*(?:id|no)?\.?|points?\b)/i;
    const TOTAL = /(grand\s*total|sub\s*total|^total\b|amount due|balance due|total\s*due)/i;
    let best = null;
    for (const line of lines) {
      if (EXCLUDE.test(line)) continue;
      const nums = [...line.matchAll(/[$€£]\s?([0-9][0-9,]{0,12}(?:\.\d{2})?)/g)];
      for (const n of nums) {
        const raw = (n[1] || '').replace(/,/g, '');
        const v = parseFloat(raw);
        if (!Number.isFinite(v) || v < 0.01 || v > 100000000) continue;
        const priority = TOTAL.test(line) ? 2 : 1;
        if (!best || priority > best.priority ||
            (priority === best.priority && v > best.value)) {
          best = { value: v, priority };
        }
      }
    }
    if (best) result.amount = best.value;

    // --- Vendor (first line near the top that isn't a "Receipt" label etc.) ---
    for (const line of lines.slice(0, 6)) {
      if (/receipt|invoice|statement|order\s*summary/i.test(line)) continue;
      if (/^[\d\s$€£,.\-:\/]+$/.test(line)) continue;
      if (EXCLUDE.test(line)) continue;
      result.vendor = line.trim();
      break;
    }

    result.category = guessCategory(t);
    return result;
  }

  // ---------------------------------------------------------------
  // [CalendarBlocker] Free-time slot search
  // ---------------------------------------------------------------
  function timeAt(baseDate, hhmm) {
    const [h, mi] = String(hhmm).split(':').map(Number);
    const d = new Date(baseDate);
    d.setHours(h || 0, mi || 0, 0, 0);
    return d;
  }

  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function ceilToMinutes(date, step) {
    const ms = step * 60000;
    return new Date(Math.ceil(date.getTime() / ms) * ms);
  }

  // Convert lines like "10:00-11:00 Standup" into {start, end, title}
  function parseBusyLines(text) {
    const busy = [];
    for (const rawLine of String(text || '').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const m = line.match(/(\d{1,2}:\d{2})\s*[-~]\s*(\d{1,2}:\d{2})\s*(.*)/);
      if (m) busy.push({ start: m[1], end: m[2], title: m[3].trim() || 'Existing event' });
    }
    return busy;
  }

  // tasks: [{title, minutes}]
  // opts: {baseDate, now, start, end, lunchStart, lunchEnd, busy, bufferMinutes}
  function computeSchedule(tasks, opts) {
    opts = opts || {};
    const day = opts.baseDate instanceof Date ? new Date(opts.baseDate) : new Date();
    const dayStart = timeAt(day, opts.start || '09:00');
    const dayEnd = timeAt(day, opts.end || '18:00');

    const blocked = [];
    if (opts.lunchStart && opts.lunchEnd) {
      blocked.push({ s: timeAt(day, opts.lunchStart), e: timeAt(day, opts.lunchEnd), title: 'Lunch break' });
    }
    for (const b of (opts.busy || [])) {
      blocked.push({ s: timeAt(day, b.start), e: timeAt(day, b.end), title: b.title || 'Existing event' });
    }
    blocked.sort((a, b) => a.s - b.s);

    const now = opts.now instanceof Date ? opts.now : new Date();
    let cursor = sameDay(now, day) && now > dayStart
      ? ceilToMinutes(now, 15)
      : new Date(dayStart);
    if (cursor < dayStart) cursor = new Date(dayStart);

    const bufferMs = (Number(opts.bufferMinutes) || 0) * 60000;
    const blocks = [];
    const unplaced = [];

    for (const task of tasks) {
      const minutes = Math.max(5, Number(task.minutes) || 30);
      const dur = minutes * 60000;
      let tryStart = new Date(cursor);
      let placed = false;
      let guard = 0;
      while (tryStart.getTime() + dur <= dayEnd.getTime() && guard++ < 200) {
        const tryEnd = new Date(tryStart.getTime() + dur);
        const conflict = blocked.find((b) => tryStart < b.e && tryEnd > b.s);
        if (conflict) { tryStart = new Date(conflict.e); continue; }
        blocks.push({ title: task.title, minutes, start: new Date(tryStart), end: tryEnd });
        blocked.push({ s: new Date(tryStart), e: tryEnd, title: task.title });
        blocked.sort((a, b) => a.s - b.s);
        cursor = new Date(tryEnd.getTime() + bufferMs);
        placed = true;
        break;
      }
      if (!placed) unplaced.push(task.title);
    }
    return { blocks, unplaced };
  }

  // Google Calendar event-creation URL (saves in one click if already signed in)
  function buildCalendarUrl(title, start, end, details) {
    const f = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
      `T${pad(d.getHours())}${pad(d.getMinutes())}00`;
    let tz = 'UTC';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { /* keep UTC fallback */ }
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: title,
      dates: `${f(start)}/${f(end)}`,
      details: details || 'Focus-time block created automatically by PageFlow AI',
      ctz: tz
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  return {
    extractFieldsFromText,
    extractReceiptData,
    guessCategory,
    parseBusyLines,
    computeSchedule,
    buildCalendarUrl
  };
});
