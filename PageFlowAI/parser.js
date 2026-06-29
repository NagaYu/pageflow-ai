// PageFlow AI - parser.js
// テキスト解析・スケジュール計算などの純粋ロジック。
// popup.html から <script> で読み込まれるほか、Node.js からも require して
// ユニットテストできるよう UMD 形式でエクスポートする。

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

  // ---------------------------------------------------------------
  // [SmartFormMapper] 議事録などの自由テキストから「キー: 値」を抽出
  // ---------------------------------------------------------------
  function extractFieldsFromText(text) {
    const entries = [];
    const seen = new Set();
    const lines = String(text || '').split(/\r?\n/);
    const BULLET = /^[\s\-・*●◆■□▼○>＞]+/;

    for (const rawLine of lines) {
      const line = rawLine.trim().replace(BULLET, '').trim();
      if (!line) continue;
      let key = '';
      let value = '';
      // 「【会社名】ACME」「[件名] 打合せ」形式（コロン省略可）
      let m = line.match(/^【([^】]{1,30})】\s*[:：=]?\s*(.+)$/) ||
              line.match(/^\[([^\]]{1,30})\]\s*[:：=]?\s*(.+)$/);
      if (m) {
        key = m[1]; value = m[2];
      } else {
        // 「氏名: 山田太郎」「会社名＝ACME」形式（区切り必須）
        m = line.match(/^([^:：=]{1,30})\s*[:：=]\s*(.+)$/);
        if (m) { key = m[1]; value = m[2]; }
      }
      key = (key || '').trim();
      value = (value || '').trim();
      if (!key || !value) continue;
      if (/^https?$/i.test(key)) continue; // URL の "https:" を誤検出しない
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ key, value });
    }

    // 補助抽出: キーが付いていなくても拾える定番パターン
    const whole = String(text || '');
    const helpers = [
      { key: 'メールアドレス', group: ['メール', 'mail'], re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
      { key: '電話番号', group: ['電話', 'tel'], re: /0\d{1,4}-\d{1,4}-\d{3,4}/ },
      { key: '日付', group: ['日付', '日時', 'date'], re: /20\d{2}\s*[\/年.\-]\s*\d{1,2}\s*[\/月.\-]\s*\d{1,2}日?/ },
      { key: '金額', group: ['金額', '合計', '円'], re: /[¥￥]\s?[0-9][0-9,]*|[0-9][0-9,]*\s*円/ }
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
  // [ExpensePilot] 領収書テキストから 日付・金額・店名・勘定科目 を抽出
  // ---------------------------------------------------------------
  const CATEGORY_RULES = [
    { category: '旅費交通費', words: ['タクシー', 'JR', '鉄道', 'バス', '航空', 'ANA', 'JAL', 'Suica', 'PASMO', 'ICOCA', 'ETC', '駐車', 'パーキング', 'ガソリン', '新幹線', '地下鉄', 'メトロ', '交通', '乗車', 'きっぷ', '運賃'] },
    { category: '会議費', words: ['カフェ', 'コーヒー', '珈琲', '喫茶', 'スターバックス', 'スタバ', 'ドトール', 'タリーズ', '会議室', '貸会議', 'ミーティング'] },
    { category: '接待交際費', words: ['居酒屋', 'レストラン', '料理', '寿司', '鮨', '焼肉', '焼鳥', '宴会', 'ダイニング', 'バー', '酒場', '割烹', 'ビール', '飲み放題', '宴'] },
    { category: '消耗品費', words: ['文具', '文房具', '事務用品', 'Amazon', 'アマゾン', 'ヨドバシ', 'ビックカメラ', 'ダイソー', 'セリア', 'コクヨ', 'インク', 'コピー用紙', '電池', 'ケーブル', 'マウス', 'ホームセンター', '東急ハンズ', 'ハンズ', 'ロフト'] },
    { category: '新聞図書費', words: ['書店', '書籍', 'ブック', 'BOOK', '紀伊國屋', '紀伊国屋', 'ジュンク', '丸善', '本屋', '雑誌', '新聞'] },
    { category: '通信費', words: ['切手', '郵便', 'レターパック', 'ゆうパック', 'SIM', '通信', 'モバイル', 'Wi-Fi', 'WiFi'] },
    { category: '水道光熱費', words: ['電気料金', 'ガス料金', '水道料金', '電力'] }
  ];

  function guessCategory(text) {
    const t = String(text || '');
    for (const rule of CATEGORY_RULES) {
      if (rule.words.some((w) => t.toLowerCase().includes(w.toLowerCase()))) {
        return rule.category;
      }
    }
    return '雑費';
  }

  function extractReceiptData(text) {
    const t = String(text || '');
    const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const result = { date: '', amount: null, vendor: '', category: '', memo: '' };

    // --- 日付 ---
    let m = t.match(/(20\d{2})\s*[\/年.\-]\s*(\d{1,2})\s*[\/月.\-]\s*(\d{1,2})/);
    if (m) result.date = fmtDate(m[1], m[2], m[3]);
    if (!result.date) {
      m = t.match(/令和\s*(\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
      if (m) result.date = fmtDate(2018 + Number(m[1]), m[2], m[3]);
    }
    if (!result.date) {
      m = t.match(/R\s?(\d{1,2})[.\/](\d{1,2})[.\/](\d{1,2})/);
      if (m) result.date = fmtDate(2018 + Number(m[1]), m[2], m[3]);
    }

    // --- 金額 ---
    // 「合計」を含む行を最優先。電話番号・お預り・釣銭などの行は除外する。
    const EXCLUDE = /(電話|TEL|FAX|お預|預り|釣|登録番号|ﾎﾟｲﾝﾄ|ポイント|会員|No\.)/i;
    const TOTAL = /(合\s*計|総額|お会計|ご請求|請求額|お買上|total)/i;
    let best = null;
    for (const line of lines) {
      if (EXCLUDE.test(line)) continue;
      const nums = [...line.matchAll(/[¥￥]\s*([0-9][0-9,]{0,12})|([0-9][0-9,]{0,12})\s*円/g)];
      for (const n of nums) {
        const raw = (n[1] || n[2] || '').replace(/,/g, '');
        const v = parseInt(raw, 10);
        if (!Number.isFinite(v) || v < 1 || v > 100000000) continue;
        const priority = TOTAL.test(line) ? 2 : 1;
        if (!best || priority > best.priority ||
            (priority === best.priority && v > best.value)) {
          best = { value: v, priority };
        }
      }
    }
    if (best) result.amount = best.value;

    // --- 店名（先頭付近の「領収書」等でない行） ---
    for (const line of lines.slice(0, 6)) {
      if (/領収書|領収証|レシート|receipt|明細|御計算書/i.test(line)) continue;
      if (/^[\d\s¥￥,.\-:\/年月日]+$/.test(line)) continue;
      if (EXCLUDE.test(line)) continue;
      result.vendor = line.replace(/様$/, '').trim();
      break;
    }

    result.category = guessCategory(t);
    return result;
  }

  // ---------------------------------------------------------------
  // [CalendarBlocker] 空き時間探索
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

  // 「10:00-11:00 定例MTG」形式の行を {start, end, title} に変換
  function parseBusyLines(text) {
    const busy = [];
    for (const rawLine of String(text || '').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const m = line.match(/(\d{1,2}:\d{2})\s*[-~〜ー]\s*(\d{1,2}:\d{2})\s*(.*)/);
      if (m) busy.push({ start: m[1], end: m[2], title: m[3].trim() || '既存の予定' });
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
      blocked.push({ s: timeAt(day, opts.lunchStart), e: timeAt(day, opts.lunchEnd), title: '昼休み' });
    }
    for (const b of (opts.busy || [])) {
      blocked.push({ s: timeAt(day, b.start), e: timeAt(day, b.end), title: b.title || '既存の予定' });
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

  // Google カレンダーの予定作成 URL（ログインしていれば 1 クリックで保存できる）
  function buildCalendarUrl(title, start, end, details) {
    const f = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
      `T${pad(d.getHours())}${pad(d.getMinutes())}00`;
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: title,
      dates: `${f(start)}/${f(end)}`,
      details: details || 'PageFlow AI で自動作成された作業ブロック',
      ctz: 'Asia/Tokyo'
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
