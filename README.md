# RMS Multitool

Chrome extension for [CurrentRMS](https://www.current-rms.com/) — multi-store stock checker and quote attention dashboard.

## Features

### Multi-Store Stock Checker
- View stock levels across multiple CurrentRMS stores directly on product pages
- Configurable store names and IDs
- Inline stock display on opportunity item rows

### Quote Dashboard
- **Kanban board** — each department gets its own column, only visible when it has flagged quotes
- **Future events only** — dual-layer filtering (API-side + client-side) excludes past events automatically
- **Event dates** on every card with start → end range
- **Sorted by start date** — soonest events first within each department
- **Compact cards** — max 3 trigger chips visible, hover any card to see the full list of flagged items in a popup tooltip
- **Time-on-board timer** — tracks how long each quote has been sitting on the dashboard, persists across refreshes
- **Email alerts via EmailJS** — sends a styled HTML email when a quote sits unattended past your chosen threshold
  - Fully embedded email template — everyone gets the same professional dark-themed alert email
  - Configurable alert threshold (any number of minutes, hours, or days)
  - Optional repeat alerts at custom intervals
  - "Emailed" banner on cards that have triggered an alert
  - Test email button to verify your setup
- **Auto-update checker** — checks this GitHub repo for new versions when you open settings
- **CurrentRMS nav integration** — "Quote Dashboard" tab injected directly into the CurrentRMS top navigation bar
- **Remote branding** — logo loaded from this repo so it stays consistent across all installations
- **Auto-populated dropdowns** — product groups fetched from your CurrentRMS account
- **Live product search** — type to search your 1000+ products without loading them all upfront
- **Configurable stages** — choose which opportunity stages to monitor (Draft, Provisional, Reserved, Order)
- **Adjustable poll interval** — 1, 2, 5, or 10 minute refresh cycles
- **TV/monitor friendly** — designed for widescreen display with horizontal scrolling columns

## Installation

1. Download or clone this repo
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** → select the extension folder
5. Click the RMS Multitool icon → enter your CurrentRMS subdomain and API key
6. Open any CurrentRMS page — you'll see "Quote Dashboard" in the top navigation bar
7. Or click the extension icon → **Open Quote Dashboard**

## Department Configuration

Each department can be triggered by any combination of:
- **Product IDs** — exact CurrentRMS product IDs (comma-separated)
- **Product Groups** — select from a dropdown populated from your account
- **Keywords** — live-search your product names or add custom keywords

A quote appears in a department's column if **any** of its line items match **any** of that department's rules.

## Email Alerts Setup (EmailJS)

The extension sends styled HTML alert emails via [EmailJS](https://www.emailjs.com/) (free tier: 200 emails/month).

### One-time setup (2 minutes):

1. Create a free account at [emailjs.com](https://www.emailjs.com/signup)
2. Go to **Email Services** → add your Gmail/Outlook → copy the **Service ID**
3. Go to **Email Templates** → Create New Template:
   - **To Email:** `{{to_email}}`
   - **Subject:** `{{subject}}`
   - **Content** (switch to Code editor): `{{{html_body}}}` ← triple braces!
4. Save → copy the **Template ID**
5. Go to **Account** → copy your **Public Key**
6. Paste all three into the dashboard settings

The email design is built into the extension — every installation sends the same professional styled alert.

## Updating

When a new version is available, the dashboard settings panel will show a green notification with a download link.

To update manually:
1. Download the latest zip from this repo
2. Extract and replace the files in your extension folder
3. Go to `chrome://extensions` → click the reload button on RMS Multitool

## Version History

- **1.2.0** — Kanban dashboard, email alerts, auto-update checker, live product search, CurrentRMS nav tab, remote branding
- **1.1.0** — Dashboard feature added
- **1.0.0** — Initial release with multi-store stock checker
