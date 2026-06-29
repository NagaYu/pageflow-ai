# Privacy Policy — PageFlow AI

_Last updated: 2026-06-29_

PageFlow AI ("the extension") is designed to keep your data on your own device. This policy explains exactly what the extension does and does not do with your information.

## Summary

- **No analytics, no tracking, no advertising.** The extension contains no telemetry and sends nothing to the developer.
- **No data is sent to the developer or any third party**, except a single optional case described below (your own Anthropic API key, only when you choose to analyze an image/PDF receipt).
- **All settings and data are stored locally** on your device using the browser's `chrome.storage.local`.

## Data the extension handles

| Data | Where it is processed | Where it is stored | Sent off-device? |
|---|---|---|---|
| Meeting-notes / form text you paste | In the page you target, in your browser | Not persisted | No |
| Receipt text from text-based PDFs | Locally in your browser | Not persisted | No |
| Receipt **images / scanned PDFs** | Sent to Anthropic's API **only if you enable AI analysis** | Not persisted by the extension | Yes — to `api.anthropic.com` only |
| Anthropic API key (optional) | Used to call the Anthropic API | `chrome.storage.local` (your device) | Sent only as the auth header to `api.anthropic.com` |
| Calendar tasks & time estimates | Locally in your browser | `chrome.storage.local` (your device) | No (Google Calendar event creation opens in a normal browser tab you control) |
| Theme / UI preferences | Locally | `chrome.storage.local` | No |

## Optional AI analysis

If — and only if — you add your own Anthropic API key in the Settings tab and then analyze an **image or scanned-PDF receipt**, the extension sends that file's contents to Anthropic's API (`https://api.anthropic.com`) to extract the date, amount, vendor, and category. This request is made directly from your browser using your key. No copy is sent to the extension developer. Anthropic's handling of that request is governed by Anthropic's own privacy terms. Text-based PDFs and pasted text are parsed entirely on-device and are never transmitted.

## Local cleanup agent

The optional DevCleanShortcut feature communicates only with a local agent at `http://127.0.0.1:8765` that you run yourself. This agent never leaves your machine, executes only a fixed allowlist of cleanup commands, and rejects requests from web pages. No data from this feature is transmitted over the internet.

## Permissions and why they are needed

- `activeTab` / `scripting` — to read form labels and fill fields on the page you explicitly act on (injected on demand, not always-on)
- `storage` — to save your preferences, calendar tasks, and (optional) API key locally
- `contextMenus` — to offer the "Send selected text to PageFlow AI" right-click action
- `clipboardRead` — to let you paste from the clipboard with a button
- Host permission `https://api.anthropic.com/*` — optional AI receipt analysis (your key)
- Host permission `http://127.0.0.1:8765/*` — the local cleanup agent you run yourself

## Data retention and deletion

The extension does not maintain any remote database. To delete all locally stored data, remove the extension from `chrome://extensions`, or use the "Delete" button in the Settings tab to remove your stored API key.

## Contact

Questions about this policy can be raised via the project's GitHub issues page.
