# PageFlow AI — Chrome Extension Guide

> **Zero copy-paste at work.** Automate tedious data entry into business systems — meeting-notes-to-form transfer, expense entry, dev-environment cleanup, and calendar blocking — with a single click from the Chrome toolbar.

---

## 1. Installation (takes about a minute)

1. Type `chrome://extensions` into Chrome's address bar and open it
2. Turn on **"Developer mode"** in the top-right corner
3. Click **"Load unpacked"**
4. Select the **`PageFlowAI` folder** from this repository
5. Pin **PageFlow AI** from the puzzle-piece icon 🧩 in the toolbar

That's it — no build step, no `npm install` required.

> 💡 To try the bundled demo form (`PageFlowAI/demo/demo_form.html`) over `file://`, go to
> `chrome://extensions` → PageFlow AI → "Details" → turn on **"Allow access to file URLs"**.
> (This is not needed for a normal `https://` business system.)

---

## 2. Features and usage

### ⚡ SmartFormMapper — one-click transfer from meeting notes to a form

1. Open the page you want to fill in (Salesforce, HubSpot, an internal inquiry form, etc.)
2. Open PageFlow AI, go to the **"⚡ Mapper" tab**, and paste your meeting-notes text
   (use the 📋 button to paste from the clipboard, or select text on any page and right-click → "Send selected text to PageFlow AI")
3. Click **"⚡ Autofill"**

It parses the page's `<label>` / `aria-label` / placeholder / table headers, etc. via DOM analysis, and uses a synonym dictionary ("Name", "Company", "Email", "Category", ...) to match each field automatically. Filled fields are highlighted in purple. Works with React / Vue-based forms too.

Use **🔍 Scan form** to preview which labels the extension detects for each field on the page before you autofill.

#### 📋 Sample meeting notes for a demo (copy and try it)

```
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
```

Open `PageFlowAI/demo/demo_form.html` and paste the text above to see every field — from Name to Description — get filled in at once.

---

### 🧾 ExpensePilot — auto-fill an expense report from a receipt

1. Drag and drop a receipt **PDF or image (screenshot)** into the **"🧾 Expense" tab**
2. The date, amount, vendor, and **category (auto-inferred)** are extracted — edit if needed
3. With your expense-report page open, click **"⚡ Autofill expense form"**

- **Text-based PDFs** are parsed entirely on-device (nothing is sent anywhere)
- **Images and scanned PDFs** — add an **Anthropic API key** in the Settings tab and Claude analyzes them
- If neither applies, paste the receipt text into "Paste receipt text" and the same parsing logic runs

The category is inferred from keywords (taxi/train → Travel, cafe → Meals & Entertainment, restaurant/bar → Meals & Entertainment, Amazon/office supplies → Office Supplies, etc.). The expense form's "Category" dropdown is auto-selected by fuzzy-matching the option text.

#### 📋 Sample receipt for a demo (try it in the text-paste box)

```
Green Cab Co.
123 Market St, San Francisco, CA
Tel 415-555-0199
2026-06-09 9:45 PM
Fare              $28.00
Pickup fee          $2.50
Total             $34.80
Amount tendered   $50.00
Change            $15.20
```

→ Extracts date `2026-06-09`, amount `34.8` (correctly excluding "amount tendered" / "change"), and category `Travel`.

---

### 🛠 DevCleanShortcut — one-click dev-environment cleanup

Buttons in the popup talk to a small local agent (127.0.0.1:8765) that clears port conflicts, zombie Docker processes, and stale caches.

**Start the agent (once, in a terminal):**

```bash
python3 PageFlowAI/local-agent/pageflow_agent.py
```

| Button | What it does |
|---|---|
| 🔌 Free port | Finds whatever process is holding the given port (default 3000) via `lsof` and kills it |
| 🐳 Clean Docker | Prunes stopped containers / dangling images / unused networks / build cache |
| 🧹 Clear caches | Runs `npm cache verify` / `yarn cache clean` / `pip3 cache purge` |
| 🚀 Run all | Runs everything above in sequence and shows the log |

**Safety design:** the agent binds only to 127.0.0.1 and can only execute the fixed commands listed above (no arbitrary command execution). It also rejects calls from ordinary web pages via an Origin check (HTTP 403), accepting only requests from `chrome-extension://`.

---

### 📅 CalendarBlocker — auto-block "focus time" from your task list

1. In the **"📅 Calendar" tab**, enter today's task names and estimated time (minutes)
2. Set your working hours (default 9:00 AM–6:00 PM), lunch break, and any existing events (one per line, e.g. `10:00-11:00 Standup`)
3. Click **"🔍 Find free time"** → proposed work blocks that avoid conflicts are shown
4. Click **"📅 Block all on calendar"** → Google Calendar's event-creation screen opens in tabs — just **click Save**

No OAuth setup needed — as long as you're signed in to your Google account, anyone can use it right away. Your task list is saved automatically and restored the next time you open the popup.

---

## 3. ⚙️ AI settings (optional — needed for image receipt analysis)

1. Get an API key from the [Anthropic Console](https://console.anthropic.com/)
2. In PageFlow AI's **⚙️ tab**, paste the key and save

- The key is stored **only in this device's extension storage (`chrome.storage.local`)** and is never sent anywhere except to the Anthropic API
- Analysis uses `claude-opus-4-8` with structured JSON-schema output for reliable extraction of date/amount/category
- All other features — text PDFs, pasted text, the Mapper, Dev, and Calendar tabs — work fully without an API key

---

## 4. Folder structure

```
PageFlowAI/                  ← the folder you select for "Load unpacked"
├── manifest.json            Manifest V3 definition
├── popup.html / popup.css   Popup UI (dark-mode support)
├── popup.js                 Orchestrates the 4 features
├── parser.js                Text parsing & schedule calculation (testable with Node)
├── pdf_extract.js           Lightweight PDF text extraction (uses DecompressionStream)
├── content.js                DOM parsing & autofill (injected on demand via activeTab)
├── background.js             Service worker for the right-click context menu
├── icons/                   Icons (16/48/128px)
├── demo/demo_form.html       A sample business-system-style form for testing
└── local-agent/pageflow_agent.py  Local agent for the Dev-clean feature
tests/run_tests.js           Automated tests (node tests/run_tests.js)
```

---

## 5. Testing and security verification

```bash
node tests/run_tests.js          # 25 tests (manifest / CSP static checks / parsing logic)
```

Verified:

- ✅ Manifest V3 compliant, all referenced files exist
- ✅ No inline scripts or inline event handlers (compatible with MV3's default `script-src 'self'` CSP)
- ✅ No `eval` / `new Function` / remote code loading
- ✅ Minimal permissions (`activeTab` + on-demand injection — no always-on content scripts across all sites)
- ✅ The only non-TLS host permission is `http://127.0.0.1:8765`
- ✅ The local agent uses an allowlist of fixed commands plus an Origin check (403)

---

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| "This page is not supported" | The extension doesn't run on `chrome://` or Web Store pages. Use it on a regular web page |
| Can't autofill the demo form (file://) | Turn on "Allow access to file URLs" in the extension's details page |
| Some fields don't get filled | Use "🔍 Scan form" to check the labels the page exposes, and adjust the key names in your text to match |
| Can't analyze an image receipt | Set an API key in the ⚙️ tab (or use "Paste receipt text" instead) |
| The Dev tab shows "Agent not running" | Keep `python3 PageFlowAI/local-agent/pageflow_agent.py` running |
| Calendar tabs don't open | Check your browser's popup-blocking settings. A single bulk booking opens at most 8 tabs |
