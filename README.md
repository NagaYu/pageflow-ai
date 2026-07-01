<div align="center">

# ⚡ PageFlow AI

**Zero copy-paste at work.** A Manifest V3 Chrome extension that automates tedious data entry into business systems — meeting-notes transfer, expense input, and calendar blocking — from a single click in your toolbar.

[![tests](https://img.shields.io/badge/tests-25%20passed-brightgreen)](tests/run_tests.js)
[![manifest](https://img.shields.io/badge/Manifest-V3-blue)](PageFlowAI/manifest.json)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

[Installation Guide](CHROME_EXTENSION_GUIDE.md) · [Privacy Policy](PRIVACY_POLICY.md)

</div>

---

## Screenshots

> Load the extension in Chrome and capture these from the live popup (the popup uses Chrome extension APIs and only runs inside Chrome). Drop the images here once captured.

| Form Mapper | Expense Pilot | Calendar Blocker |
|---|---|---|
| _add screenshot_ | _add screenshot_ | _add screenshot_ |

## Features

| Feature | What it does |
|---|---|
| ⚡ **SmartFormMapper** | Paste meeting-notes text and it analyzes the labels of the form on the current page (input/textarea/select) via DOM parsing, then fills every field in one click |
| 🧾 **ExpensePilot** | Drag & drop a receipt PDF or image → extracts date, amount, and vendor, infers the accounting category from context, and auto-selects dropdowns |
| 🛠 **DevCleanShortcut** | One button to clean up local port conflicts, zombie Docker processes, and stale caches (via a local agent on 127.0.0.1) |
| 📅 **CalendarBlocker** | From today's tasks and time estimates, finds free slots and blocks "focus time" into Google Calendar in one click |

- 🌙 Modern, Tailwind-style UI with dark-mode support
- 🔒 Manifest V3 compliant — no inline scripts, no `eval`, no remote code; minimal permissions
- 🧩 No build step — just load the folder

## Installation

1. Clone this repository or download it as a ZIP
2. Open `chrome://extensions` in Chrome and turn on **Developer mode** (top right)
3. Click **"Load unpacked"** and select the `PageFlowAI` folder

For detailed usage, demo sample text, and how to start the local agent, see **[CHROME_EXTENSION_GUIDE.md](CHROME_EXTENSION_GUIDE.md)**.

## AI analysis (optional)

Only needed to analyze image / scanned-PDF receipts: register an [Anthropic API key](https://console.anthropic.com/) in the ⚙️ Settings tab.
The key is **stored only in this device's extension storage (`chrome.storage.local`)** and is never sent anywhere except `api.anthropic.com`. Every other feature works without a key.

## Development & testing

```bash
node tests/run_tests.js   # 25 tests: manifest integrity / CSP static checks / parsing logic
```

## Security

- Minimal permissions (`activeTab` + on-demand injection — no always-on content scripts across all sites)
- The only non-TLS host permission is `http://127.0.0.1:8765` (the local dev-cleanup agent)
- The local agent runs an allowlist of fixed commands only (no arbitrary command execution) and rejects requests from web pages via an Origin check (HTTP 403)
- See [PRIVACY_POLICY.md](PRIVACY_POLICY.md) for the full data-handling statement

## License

[MIT](LICENSE) © 2026 NagaYu
