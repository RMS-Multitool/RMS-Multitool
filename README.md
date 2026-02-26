# RMS Multitool

Chrome extension for [CurrentRMS](https://www.current-rms.com/) — multi-store stock checker with date-aware availability, quote attention dashboard, and email alerts.

## Features

### Multi-Store Stock Checker

Three display modes, selectable from the extension popup:

#### Off
Stock display disabled — CurrentRMS behaves as normal.

#### Simple Mode
- Shows total held stock per enabled store on each item row
- Quick at-a-glance view: `📦 FOHP Aus: 50 | PICA: 12 | TTY: 8`
- Stores with zero stock shown in red

#### Date-Aware Mode *(new in v1.3.0)*
- Shows **actual availability** for the quote's date range — not just total held stock
- Queries all overlapping orders and reserved quotations to calculate what's truly available per store
- **Colour-coded tags** per store:
  - 🟢 **Green** — fully available, no conflicts
  - 🔵 **Blue** — available, but quoted on other open quotes (shown as info)
  - 🟠 **Orange** — partially committed (shows available/held, e.g. `12/50`)
  - 🔴 **Red** — zero or negative availability (overbooked or no stock)
- **Current store uses CurrentRMS's own number** — reads the DOM value directly for perfect accuracy, including quarantine, post-rent unavailability, and delivery/collection buffers
- **Other stores calculated via API** — held stock minus booked (orders) minus reserved (reserved quotations)
- **Hover tooltips** — hover any store tag to see exactly which jobs are using the stock, with quantities and booking states
- **Two-phase loading** — firm bookings (orders + reserved quotes) load first for fast tag rendering; open/provisional quotes load in the background for tooltip enrichment
- **Pre-warm cache** — cache building starts the moment you land on an opportunity page, before product rows are scanned
- **15-minute cache** — subsequent product lookups are instant; cache shared across all products on the page
- **Live settings reload** — change mode in the popup and tags update instantly without refreshing the page

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
- **Auto-update checker** — checks this GitHub repo for new versions when you open the extension popup
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
6. Configure your stores (name and ID for each)
7. Select your stock display mode (Off / Simple / Date-Aware)
8. Open any CurrentRMS opportunity — stock tags appear on each item row
9. Click **Open Quote Dashboard** or use the "Quote Dashboard" tab in the CurrentRMS navigation bar

## Stock Display Modes

### How Date-Aware Mode Works

1. When you open an opportunity, the extension immediately fetches the opportunity's start and end dates
2. It queries all overlapping opportunities (orders and reserved quotations) from the API
3. For each overlapping opportunity, it fetches the item list and tallies committed quantities per product per store
4. This commitment data is cached for 15 minutes and shared across all products on the page
5. For each item row, it fetches the product's held stock per store and subtracts firm commitments
6. The current store's availability is read directly from CurrentRMS's own DOM (the green/red number it already displays) for perfect accuracy
7. Results are displayed as colour-coded tags with hover tooltips showing job details

### API Usage

Date-aware mode makes the following API calls on first load:
- 1 call to fetch the opportunity details (dates, store)
- 1–2 calls to list overlapping opportunities (paginated)
- ~10–15 calls to fetch items for each overlapping order/reserved quote (parallelised)
- 1 call per product for stock levels (held quantities)

After the initial cache build (~2–3 seconds), subsequent product lookups are instant. The cache is shared across all items on the page and persists for 15 minutes.

CurrentRMS API rate limit: 60 requests per 60 seconds. The extension stays well within this limit.

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

When a new version is available, the extension popup will show a green notification with a download link.

To update manually:
1. Download the latest zip from this repo
2. Extract and replace the files in your extension folder
3. Go to `chrome://extensions` → click the reload button on RMS Multitool

## Version History

- **1.3.0** — Date-aware stock availability mode, colour-coded store tags, hover tooltips with job details, two-phase cache loading, pre-warm on page load, 15-minute cache, parallel API requests, three-mode stock toggle (Off/Simple/Date-Aware), live settings reload
- **1.2.0** — Kanban dashboard, email alerts, auto-update checker, live product search, CurrentRMS nav tab, remote branding
- **1.1.0** — Dashboard feature added
- **1.0.0** — Initial release with multi-store stock checker
