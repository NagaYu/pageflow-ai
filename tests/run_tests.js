#!/usr/bin/env node
// PageFlow AI - automated tests
//   node tests/run_tests.js
// 1) manifest.json validity / 2) static CSP-violation checks / 3) parser.js unit tests

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

test('manifest_version is 3 (MV3)', () => assertEq(manifest.manifest_version, 3));
test('required keys are present', () => {
  for (const k of ['name', 'version', 'action', 'background', 'icons']) {
    assert(manifest[k], `missing key: ${k}`);
  }
});
test('all referenced files exist', () => {
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
test('non-TLS host permissions are limited to 127.0.0.1 (MV3 requirement)', () => {
  const insecure = (manifest.host_permissions || []).filter((h) => h.startsWith('http://'));
  assert(insecure.every((h) => h.startsWith('http://127.0.0.1')),
    `http:// must only be allowed for 127.0.0.1: ${insecure.join(', ')}`);
});

// ----------------------------------------------------------------
console.log('\n[2] CSP / security static checks');
// ----------------------------------------------------------------
const popupHtml = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');

test('popup.html has no inline <script>', () => {
  const inline = popupHtml.match(/<script(?![^>]*\bsrc=)[^>]*>[^<]*\S[^<]*<\/script>/i);
  assert(!inline, `inline script found: ${inline && inline[0].slice(0, 60)}`);
});
test('popup.html has no inline event handlers (onclick, etc.)', () => {
  assert(!/\son[a-z]+\s*=\s*["']/i.test(popupHtml), 'inline event handler found');
});
test('popup.html loads no remote script/CSS', () => {
  assert(!/<(script|link)[^>]+(src|href)\s*=\s*["']https?:/i.test(popupHtml), 'remote resource found');
});

const jsFiles = ['popup.js', 'content.js', 'background.js', 'parser.js', 'pdf_extract.js'];
for (const f of jsFiles) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  test(`${f}: does not use eval / new Function`, () => {
    assert(!/\beval\s*\(/.test(src), 'eval() found');
    assert(!/new\s+Function\s*\(/.test(src), 'new Function() found');
  });
}

// ----------------------------------------------------------------
console.log('\n[3] parser.js unit tests');
// ----------------------------------------------------------------
const P = require(path.join(ROOT, 'parser.js'));

const SAMPLE_MINUTES = `
[Weekly Sync Notes]
Date: 2026/06/10 2:00 PM
Location: Conference Room 3
Name: John Smith
Company: Acme Corporation
Department: Sales & Planning
Email: john.smith@example.com
Phone: 415-555-0182
Subject: Regular sync on the new product launch
Decision: Launch date confirmed for June 20
Description: Price stays at $49.80. Prepare marketing materials before the next meeting.
`;

test('extractFieldsFromText: extracts basic "key: value" pairs', () => {
  const entries = P.extractFieldsFromText(SAMPLE_MINUTES);
  const get = (k) => (entries.find((e) => e.key === k) || {}).value;
  assertEq(get('Name'), 'John Smith', 'name');
  assertEq(get('Company'), 'Acme Corporation', 'company');
  assertEq(get('Email'), 'john.smith@example.com', 'email');
  assertEq(get('Phone'), '415-555-0182', 'phone');
  assertEq(get('Subject'), 'Regular sync on the new product launch', 'subject');
});

test('extractFieldsFromText: handles bullet markers and [Bracket] style', () => {
  const entries = P.extractFieldsFromText('Decision: Launch confirmed\n[Owner] Alice');
  const get = (k) => (entries.find((e) => e.key === k) || {}).value;
  assertEq(get('Decision'), 'Launch confirmed');
  assertEq(get('Owner'), 'Alice');
});

test('extractFieldsFromText: does not misdetect the "https:" of a URL as a key', () => {
  const entries = P.extractFieldsFromText('Reference: https://example.com/page\nhttps://foo.bar');
  assert(!entries.some((e) => /^https?$/i.test(e.key)), 'treated https as a key');
});

const SAMPLE_RECEIPT = `
Green Cab Co.
123 Market St, San Francisco, CA
Tel 415-555-0199
2026-06-09 9:45 PM
Fare              $28.00
Pickup fee          $2.50
Total             $34.80
Amount tendered   $50.00
Change            $15.20
`;

test('extractReceiptData: extracts the total amount correctly (excludes tendered/change)', () => {
  const r = P.extractReceiptData(SAMPLE_RECEIPT);
  assertEq(r.amount, 34.8, 'amount');
});
test('extractReceiptData: normalizes the date to YYYY-MM-DD', () => {
  const r = P.extractReceiptData(SAMPLE_RECEIPT);
  assertEq(r.date, '2026-06-09', 'date');
});
test('extractReceiptData: extracts the vendor name', () => {
  const r = P.extractReceiptData(SAMPLE_RECEIPT);
  assertEq(r.vendor, 'Green Cab Co.', 'vendor');
});
test('extractReceiptData: infers category Travel for a taxi receipt', () => {
  const r = P.extractReceiptData(SAMPLE_RECEIPT);
  assertEq(r.category, 'Travel', 'category');
});
test('extractReceiptData: parses a "Month D, YYYY" date and infers Meals & Entertainment', () => {
  const r = P.extractReceiptData('Starbucks\nJune 1, 2026\nTotal $5.80');
  assertEq(r.date, '2026-06-01');
  assertEq(r.category, 'Meals & Entertainment');
  assertEq(r.amount, 5.8);
});
test('extractReceiptData: parses a US-style MM/DD/YYYY date', () => {
  const r = P.extractReceiptData('Office Depot\n06/09/2026\nTotal $12.00');
  assertEq(r.date, '2026-06-09');
  assertEq(r.category, 'Office Supplies');
});

test('parseBusyLines: parses "10:00-11:00 Standup"', () => {
  const busy = P.parseBusyLines('10:00-11:00 Standup\n15:30~16:00');
  assertEq(busy.length, 2);
  assertEq(busy[0].start, '10:00');
  assertEq(busy[0].title, 'Standup');
  assertEq(busy[1].title, 'Existing event');
});

test('computeSchedule: places tasks around lunch and existing events', () => {
  const base = new Date(2026, 5, 10); // 2026-06-10
  const { blocks, unplaced } = P.computeSchedule(
    [{ title: 'Draft proposal', minutes: 120 }, { title: 'Review', minutes: 60 }],
    {
      baseDate: base,
      now: new Date(2026, 5, 9), // the day before -> can be placed starting at 9:00 today
      start: '09:00', end: '18:00',
      lunchStart: '12:00', lunchEnd: '13:00',
      busy: [{ start: '10:00', end: '11:00', title: 'Standup' }],
      bufferMinutes: 0
    }
  );
  assertEq(unplaced.length, 0, 'all tasks placed');
  assertEq(blocks.length, 2);
  // 9:00-10:00 is only 1h, too short for 120 min -> 11:00-13:00 also collides with lunch
  // -> the first slot that fits is 13:00-15:00
  assertEq(blocks[0].start.getHours(), 13, 'task 1 starts at 13:00');
  assertEq(blocks[0].end.getHours(), 15, 'task 1 ends at 15:00');
  assertEq(blocks[1].start.getHours(), 15, 'task 2 starts right after, at 15:00');
});

test('computeSchedule: a task that does not fit goes into unplaced', () => {
  const base = new Date(2026, 5, 10);
  const { blocks, unplaced } = P.computeSchedule(
    [{ title: 'Huge task', minutes: 600 }],
    { baseDate: base, now: new Date(2026, 5, 9), start: '09:00', end: '12:00' }
  );
  assertEq(blocks.length, 0);
  assertEq(unplaced[0], 'Huge task');
});

test('buildCalendarUrl: generates a Google Calendar event-creation URL', () => {
  const url = P.buildCalendarUrl(
    'Focus time: Test',
    new Date(2026, 5, 10, 13, 0),
    new Date(2026, 5, 10, 15, 0),
    'detail'
  );
  assert(url.startsWith('https://calendar.google.com/calendar/render?'), 'base URL');
  assert(url.includes('20260610T130000%2F20260610T150000'), `dates parameter: ${url}`);
});

test('guessCategory: classifies common keywords', () => {
  assertEq(P.guessCategory('Uber ride downtown'), 'Travel');
  assertEq(P.guessCategory('Barnes & Noble bookstore'), 'Books & Subscriptions');
  assertEq(P.guessCategory('Mystery shop'), 'Miscellaneous');
});

// ----------------------------------------------------------------
console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
