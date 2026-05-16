# FB Group Leads Extractor — Chrome Extension

A Manifest V3 Chrome extension that extracts lead data (names, profile URLs, post snippets) from Facebook Group pages and exports them as CSV or JSON.

## Features

- **Extract members** from the `/members` tab of any Facebook Group
- **Extract post authors** from the group feed (name + post snippet + profile URL)
- **Auto-scroll** to lazy-load more content before extracting
- **Deduplicates** by profile URL across sessions (stored in `chrome.storage.local`)
- **Export CSV or JSON** — ready to import into a CRM or spreadsheet
- Handles both `facebook.com` and `web.facebook.com`

## Installation (developer mode)

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select this `fb-leads-extension/` folder
4. The extension icon appears in the toolbar

## Usage

1. Go to a Facebook Group (e.g. `facebook.com/groups/<group-id>`)
2. Click the extension icon to open the popup
3. Choose what to extract:
   - **Auto detect** — picks members or posts based on the current URL
   - **Feed posts** — extracts authors from the visible post feed
   - **Members list** — navigate to the group's `/members` tab first
4. Optionally click **Auto-scroll** to scroll down and load more content, then stop it
5. Click **Extract Leads** — new profiles are saved and shown in the table
6. Click **Export CSV** or **Export JSON** to download your leads

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Extension manifest (MV3) |
| `content.js` | DOM scraper injected into Facebook group pages |
| `background.js` | Service worker — manages lead storage & deduplication |
| `popup.html` | Extension popup UI |
| `popup.css` | Popup styles |
| `popup.js` | Popup logic: extract, scroll, export, clear |
| `icons/` | Extension icons (16 / 48 / 128 px) |
| `generate-icons.js` | Helper script to regenerate icons (requires `canvas` npm pkg) |

## CSV columns

`#, Name, Profile URL, Info / Post Snippet, Post URL, Source, Extracted At`

## Notes

- Facebook renders content dynamically — scroll down before extracting to capture more leads
- The extension only reads the DOM; it does not use any undocumented Facebook API
- Stored leads persist across browser sessions until you click **Clear**
- Tested against `facebook.com` (2024 layout); Facebook DOM changes may require selector updates in `content.js`
