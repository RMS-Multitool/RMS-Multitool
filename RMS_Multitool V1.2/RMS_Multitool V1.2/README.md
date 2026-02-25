# RMS Multitool

Chrome extension for [CurrentRMS](https://www.current-rms.com/) — multi-store stock checker and quote attention dashboard.

## Features

- **Multi-store stock checker** — View stock levels across multiple CurrentRMS stores directly on product pages
- **Quote Dashboard** — Kanban-style board showing upcoming events that need department attention, displayed on a TV/monitor
  - Configurable departments with product group, keyword, and product ID triggers
  - Live product search from your CurrentRMS inventory
  - Only shows upcoming events (past events filtered out)
  - Hover tooltips showing all flagged items per quote
  - Time-on-board timer for each card
  - **Email alerts** via EmailJS when quotes sit unattended past a configurable threshold
  - Auto-update checker from this GitHub repo

## Installation

1. Download or clone this repo
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** → select the extension folder
5. Click the RMS Multitool icon → enter your CurrentRMS subdomain and API key
6. Click **Open Quote Dashboard** to launch the dashboard

## Updating

When a new version is available, the dashboard settings panel will show an update notification with a download link. After downloading:

1. Extract the zip
2. Replace the files in your extension folder
3. Go to `chrome://extensions` → click the reload button on RMS Multitool

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Extension manifest (v3) |
| `popup.html/js` | Extension popup with settings and dashboard link |
| `dashboard.html/js` | Quote dashboard (opens in its own tab) |
| `content.js` | Content script for multi-store stock display |
| `background.js` | Service worker for stock API calls |
| `version.json` | Version file for auto-update checker |
| `emailjs-template.html` | Email template for EmailJS alerts |

## EmailJS Setup

1. Create a free account at [emailjs.com](https://www.emailjs.com/)
2. Add an email service (Gmail, Outlook, etc.)
3. Create a template — use the provided `emailjs-template.html` or your own with these variables:
   - `{{quote_name}}` `{{reference}}` `{{department}}` `{{customer}}`
   - `{{event_dates}}` `{{time_on_board}}` `{{trigger_items}}` `{{dashboard_url}}` `{{to_email}}`
4. Paste your Service ID, Template ID, and Public Key into the dashboard settings

## Version History

- **1.2.0** — Kanban dashboard, email alerts, auto-update checker, live product search
- **1.1.0** — Dashboard feature added
- **1.0.0** — Initial release with multi-store stock checker
