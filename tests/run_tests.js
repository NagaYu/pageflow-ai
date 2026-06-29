#!/usr/bin/env node
// PageFlow AI - 自動テスト
//   node tests/run_tests.js
// 1) manifest.json の妥当性 / 2) CSP 違反パターンの静的検査 / 3) parser.js ユニットテスト

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'PageFlowAI');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ❌ ${name}\n     → ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'mismatch'}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  }
}

// ----------------------------------------------------------------
console.log('\n[1] manifest.json');
// ----------------------------------------------------------------
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

test('manifest_version は 3 (MV3)', () => assertEq(manifest.manifest_version, 3));
test('必須キーが揃っている', () => {
  for (const k of ['name', 'version', 'action', 'background', 'icons']) {
    assert(manifest[k], `missing key: ${k}`);
  }
});
test('参照ファイルがすべて存在する', () => {
  const files = [
    manifest.action.default_popup,
    manifest.background.service_worker,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon)
  ];
  for (const f of files) {
    assert(fs.existsSync(path.join(ROOT, f)), `missing file: ${f}`);
  }
});
test('非TLSのhost許可は 127.0.0.1 のみ (MV3 要件)', () => {
  const insecure = (manifest.host_permissions || []).filter((h) => h.startsWith('http://'));
  assert(insecure.every((h) => h.startsWith('http://127.0.0.1')),
    `http:// は 127.0.0.1 以外に許可しない: ${insecure.join(', ')}`);
});

// ----------------------------------------------------------------
console.log('\n[2] CSP / セキュリティ静的検査');
// ----------------------------------------------------------------
const popupHtml = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');

test('popup.html にインライン <script> がない', () => {
  const inline = popupHtml.match(/<script(?![^>]*\bsrc=)[^>]*>[^<]*\S[^<]*<\/script>/i);
  assert(!inline, `inline script found: ${inline && inline[0].slice(0, 60)}`);
});
test('popup.html にインラインイベントハンドラ (onclick 等) がない', () => {
  assert(!/\son[a-z]+\s*=\s*["']/i.test(popupHtml), 'inline event handler found');
});
test('popup.html にリモートスクリプト/CSS の読み込みがない', () => {
  assert(!/<(script|link)[^>]+(src|href)\s*=\s*["']https?:/i.test(popupHtml), 'remote resource found');
});

const jsFiles = ['popup.js', 'content.js', 'background.js', 'parser.js', 'pdf_extract.js'];
for (const f of jsFiles) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  test(`${f}: eval / new Function を使っていない`, () => {
    assert(!/\beval\s*\(/.test(src), 'eval() found');
    assert(!/new\s+Function\s*\(/.test(src), 'new Function() found');
  });
}

// ----------------------------------------------------------------
console.log('\n[3] parser.js ユニットテスト');
// ----------------------------------------------------------------
const P = require(path.join(ROOT, 'parser.js'));

const SAMPLE_MINUTES = `
【定例ミーティング議事録】
日時: 2026/06/10 14:00
場所: 第3会議室
氏名: 山田太郎
会社名: 株式会社サンプル商事
部署: 営業企画部
メールアドレス: taro.yamada@example.co.jp
電話番号: 03-1234-5678
件名: 新製品リリースに関する定例打合せ
・決定事項: リリース日は6月20日に確定
内容: 価格は¥49,800で据え置き。次回までに販促資料を準備する。
`;

test('extractFieldsFromText: 基本的な「キー: 値」を抽出できる', () => {
  const entries = P.extractFieldsFromText(SAMPLE_MINUTES);
  const get = (k) => (entries.find((e) => e.key === k) || {}).value;
  assertEq(get('氏名'), '山田太郎', '氏名');
  assertEq(get('会社名'), '株式会社サンプル商事', '会社名');
  assertEq(get('メールアドレス'), 'taro.yamada@example.co.jp', 'メール');
  assertEq(get('電話番号'), '03-1234-5678', '電話');
  assertEq(get('件名'), '新製品リリースに関する定例打合せ', '件名');
});

test('extractFieldsFromText: 箇条書き記号・【】形式を処理できる', () => {
  const entries = P.extractFieldsFromText('・決定事項: リリース確定\n【担当】鈴木');
  const get = (k) => (entries.find((e) => e.key === k) || {}).value;
  assertEq(get('決定事項'), 'リリース確定');
  assertEq(get('担当'), '鈴木');
});

test('extractFieldsFromText: URL の https: をキーとして誤検出しない', () => {
  const entries = P.extractFieldsFromText('参考: https://example.com/page\nhttps://foo.bar');
  assert(!entries.some((e) => /^https?$/i.test(e.key)), 'https をキーにしてしまった');
});

const SAMPLE_RECEIPT = `
グリーンタクシー株式会社
東京都港区芝公園1-2-3
TEL 03-9999-0000
2026年6月9日 21:45
乗車運賃          ¥3,200
迎車料金            ¥280
合計             ¥3,480
お預り           ¥5,000
お釣り           ¥1,520
`;

test('extractReceiptData: 合計金額を正しく抽出（お預り/釣銭を除外）', () => {
  const r = P.extractReceiptData(SAMPLE_RECEIPT);
  assertEq(r.amount, 3480, '金額');
});
test('extractReceiptData: 日付を YYYY-MM-DD に正規化', () => {
  const r = P.extractReceiptData(SAMPLE_RECEIPT);
  assertEq(r.date, '2026-06-09', '日付');
});
test('extractReceiptData: 店名を抽出', () => {
  const r = P.extractReceiptData(SAMPLE_RECEIPT);
  assertEq(r.vendor, 'グリーンタクシー株式会社', '店名');
});
test('extractReceiptData: 勘定科目をタクシー→旅費交通費と推定', () => {
  const r = P.extractReceiptData(SAMPLE_RECEIPT);
  assertEq(r.category, '旅費交通費', '勘定科目');
});
test('extractReceiptData: 令和表記の日付を変換', () => {
  const r = P.extractReceiptData('スターバックス 令和8年6月1日 合計 580円');
  assertEq(r.date, '2026-06-01');
  assertEq(r.category, '会議費');
  assertEq(r.amount, 580);
});

test('parseBusyLines: 「10:00-11:00 定例」を解析', () => {
  const busy = P.parseBusyLines('10:00-11:00 定例MTG\n15:30〜16:00');
  assertEq(busy.length, 2);
  assertEq(busy[0].start, '10:00');
  assertEq(busy[0].title, '定例MTG');
  assertEq(busy[1].title, '既存の予定');
});

test('computeSchedule: 昼休みと既存予定を避けて配置する', () => {
  const base = new Date(2026, 5, 10); // 2026-06-10
  const { blocks, unplaced } = P.computeSchedule(
    [{ title: '資料作成', minutes: 120 }, { title: 'レビュー', minutes: 60 }],
    {
      baseDate: base,
      now: new Date(2026, 5, 9), // 前日 → 当日 9:00 から配置できる
      start: '09:00', end: '18:00',
      lunchStart: '12:00', lunchEnd: '13:00',
      busy: [{ start: '10:00', end: '11:00', title: '定例' }],
      bufferMinutes: 0
    }
  );
  assertEq(unplaced.length, 0, '全タスク配置できる');
  assertEq(blocks.length, 2);
  // 9:00-10:00 は 1h しかなく 120 分は入らない → 11:00-13:00 も昼休みと衝突
  // → 最初に置けるのは 13:00-15:00
  assertEq(blocks[0].start.getHours(), 13, '1件目の開始は13時');
  assertEq(blocks[0].end.getHours(), 15, '1件目の終了は15時');
  assertEq(blocks[1].start.getHours(), 15, '2件目は連続して15時開始');
});

test('computeSchedule: 入り切らないタスクは unplaced に入る', () => {
  const base = new Date(2026, 5, 10);
  const { blocks, unplaced } = P.computeSchedule(
    [{ title: '巨大タスク', minutes: 600 }],
    { baseDate: base, now: new Date(2026, 5, 9), start: '09:00', end: '12:00' }
  );
  assertEq(blocks.length, 0);
  assertEq(unplaced[0], '巨大タスク');
});

test('buildCalendarUrl: Google カレンダー形式の URL を生成', () => {
  const url = P.buildCalendarUrl(
    '作業時間: テスト',
    new Date(2026, 5, 10, 13, 0),
    new Date(2026, 5, 10, 15, 0),
    'detail'
  );
  assert(url.startsWith('https://calendar.google.com/calendar/render?'), 'ベースURL');
  assert(url.includes('20260610T130000%2F20260610T150000'), `dates パラメータ: ${url}`);
  assert(url.includes('ctz=Asia%2FTokyo'), 'タイムゾーン');
});

test('guessCategory: 主要キーワードの分類', () => {
  assertEq(P.guessCategory('JR東日本 乗車券'), '旅費交通費');
  assertEq(P.guessCategory('紀伊國屋書店'), '新聞図書費');
  assertEq(P.guessCategory('謎の店'), '雑費');
});

// ----------------------------------------------------------------
console.log(`\n結果: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
