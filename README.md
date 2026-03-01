# RMS Multitool

Chrome extension for [CurrentRMS](https://www.current-rms.com/) — multi-store stock checker, quote & crew dashboards, warehouse dashboard, and quote mute system.

## License & trial

**Multi-store stock checker (including Date-Aware mode)** is available without a license — set your subdomain, API key, and stock mode in the popup and it works straight away.

All other features require a valid license. **New installs get a 7-day free trial** with full access. After the trial, enter your license code in the extension popup to continue.

**Features that need a license (After a 7 Day free trial):**
- Quote Mute (hide items/groups from client PDFs)
- Quote Dashboard (Kanban, email alerts, department config)
- Crew/Services Dashboard
- Warehouse Dashboard (Ready to prep, Mark ready to prep, Loaded for delivery)

one time purchase of $25 to unlock all features

---

## Features

### Multi-Store Stock Checker

Three display modes, selectable from the extension popup:

#### Off
Stock display disabled — CurrentRMS behaves as normal.

#### Simple Mode
- Shows total held stock per enabled store on each item row
- Quick at-a-glance view: `📦 Store 1: 50 | Store 2: 12 | Store 3: 8`
- Stores with zero stock shown in red

#### Date-Aware Mode
- Shows **actual availability** for the quote's date range — not just total held stock
- Queries all overlapping orders and reserved quotations to calculate what's truly available per store
- **Colour-coded tags** per store:
  - 🟢 **Green** — fully available, no conflicts
  - 🔵 **Blue** — available, but quoted on other open quotes (shown as info)
  - 🟠 **Orange** — partially committed (shows available/held, e.g. `12/50`)
  - 🔴 **Red** — zero or negative availability (overbooked or no stock)
- **Current store uses CurrentRMS's own number** — reads the DOM value directly for perfect accuracy
- **Other stores calculated via API** — held stock minus booked minus reserved
- **Hover tooltips** — hover any store tag to see exactly which jobs are using the stock
- **Two-phase loading** — firm bookings load first; open/provisional quotes load in the background
- **Pre-warm cache** — cache building starts the moment you land on an opportunity page
- **15-minute cache** — subsequent product lookups are instant; shared across all products on the page
- **Live settings reload** — change mode in the popup and tags update instantly

---

### Quote Mute System

Hide groups and items from client-facing quote PDFs without deleting them from the opportunity.

#### How It Works
1. **Eye toggle icons** appear on every item and group row in the opportunity editor
2. Click the eye icon to mute — the group name is tagged with `[MUTED:charge:tax]` via the API
3. The **Liquid template** reads these tags, hides the muted content, and adjusts all totals
4. **Multi-user safe** — mute state is stored in the CurrentRMS API, not in the browser

#### Extension Features
- **Instant toggle** — only 2 API calls per mute/unmute (parent group only, no child cascade)
- **Red-tinted dimming** — muted rows show with a red tint and "MUTED" badge for clear visibility
- **Visual cascade** — all children of a muted group are dimmed instantly via DOM (no API calls)
- **Page total override** — the opportunity total at the bottom of the page updates to reflect muted amounts, with a "was $X" indicator
- **Revenue panel override** — Rental Charge Total, Charge Total, Tax Total, and Total With Tax in the sidebar all update in red with "was" indicators
- **State persistence** — muted state survives page refresh (synced from API on load)
- **Nested group deduplication** — child groups inside a muted parent are not double-counted
- **Clean name display** — `[MUTED:xxx:xxx]` tags are stripped from visible group names in the UI
- **On/off toggle** — enable or disable Quote Mute from the extension popup (takes effect immediately)

#### Liquid Template
The Liquid template (`quote-template-body.liquid`) handles the PDF side:
- Hides muted groups and all their children from the rendered output
- Hides individually muted items (via `[MUTED]` in description)
- Subtracts muted charges from all totals (subtotals, cost summary, grand total)
- Calculates tax adjustments using the embedded charge:tax values
- Strips `[MUTED:xxx:xxx]` tags from any visible group names and subtotal labels
- Compatible with the existing `*HIDE*` tag system
- Self-contained — see `mute-system-snippet.liquid` for a portable version you can add to other templates

---

### Quote Dashboard
- **Kanban board** — each department gets its own column, only visible when it has flagged quotes
- **Month navigation** — filter by month (prev/next), or toggle "All Months" to see everything
- **Future events only** — dual-layer filtering excludes past events automatically
- **Event dates** on every card with start → end range
- **Sorted by start date** — soonest events first within each department
- **Compact cards** — max 3 trigger chips visible, hover to see the full list
- **Time-on-board timer** — tracks how long each quote has been sitting on the dashboard
- **Email alerts via EmailJS** — styled HTML email when a quote sits unattended past your threshold
- **Auto-update checker** — checks GitHub for new versions
- **CurrentRMS nav integration** — "Quote Dashboard" tab injected into the top navigation bar
- **Configurable stages** — choose which opportunity stages to monitor
- **Adjustable poll interval** — 1, 2, 5, or 10 minute refresh cycles
- **TV/monitor friendly** — designed for widescreen display
- **API rate limiting** — batch size of 5 with 500ms delays, exponential backoff retry on 429 errors

### Crew/Services Dashboard
- **Dedicated services view** — separate dashboard for crew and labour assignments
- **Month navigation** — same month filtering as the quote dashboard
- **Default "All Months"** — shows all jobs on first load to prevent columns disappearing unexpectedly
- **Date-range overlap** — jobs spanning multiple months appear in all relevant months

### Warehouse Dashboard *(v1.5.0)*
- **Board view** — columns: Ready to prep, In prep, Ready to load, Not in workflow
- **Client name** on each job tile; **Mark ready to prep** on quote pages and **Loaded & Ready for Delivery** on the dashboard
- **Focus job** — open a quote then the dashboard; that job is highlighted and always loaded
- **14-day window** — jobs ending within 14 days; configurable refresh interval
- Open from the extension popup when your subdomain and API key are set

---

## Installation

1. Download or clone this repo
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** → select the extension folder
5. Click the RMS Multitool icon — you’ll start a **7-day trial** with all features. Enter your CurrentRMS subdomain and API key
6. Configure your stores (name and ID for each)
7. Select your stock display mode (Off / Simple / Date-Aware)
8. Toggle Quote Mute on/off as needed
9. Open any CurrentRMS opportunity — stock tags and mute toggles appear on each item row
10. Use **Open Quote Dashboard**, **Open Services Dashboard**, or **Open Warehouse Dashboard** from the popup, or the "Quote Dashboard" tab in the CurrentRMS navigation bar

After the trial, enter your license code in the popup to continue using all features.

### Liquid Template Setup

To enable Quote Mute on client PDFs:

1. In CurrentRMS, go to **System Setup → Document Templates**
2. Edit your quote template body
3. Paste the contents of `quote-template-body.liquid` (or use the portable `mute-system-snippet.liquid` to add mute support to an existing template)
4. The snippet has three sections:
   - **Section A** — paste at the very top (calculates muted totals)
   - **Section B** — wrap around your item rendering loop (hides muted items)
   - **Section C** — example cost summary using the adjusted variables


## Stock Display Modes

### How Date-Aware Mode Works

1. When you open an opportunity, the extension immediately fetches the opportunity's start and end dates
2. It queries all overlapping opportunities (orders and reserved quotations) from the API
3. For each overlapping opportunity, it fetches the item list and tallies committed quantities per product per store
4. This commitment data is cached for 15 minutes and shared across all products on the page
5. For each item row, it fetches the product's held stock per store and subtracts firm commitments
6. The current store's availability is read directly from CurrentRMS's own DOM for perfect accuracy
7. Results are displayed as colour-coded tags with hover tooltips showing job details

### API Usage

Date-aware mode makes the following API calls on first load:
- 1 call to fetch the opportunity details (dates, store)
- 1–2 calls to list overlapping opportunities (paginated)
- ~10–15 calls to fetch items for each overlapping order/reserved quote (parallelised)
- 1 call per product for stock levels (held quantities)

After the initial cache build (~2–3 seconds), subsequent product lookups are instant.

Quote Mute makes 2 API calls per toggle (GET + PUT on the parent group only). The state sync on page load makes 1–2 calls to fetch all items.

CurrentRMS API rate limit: 60 requests per 60 seconds. The extension uses batch sizes of 3–5 with delays between batches, and exponential backoff retry (2s, 4s, 8s) on 429 errors.

## Quote Mute — Technical Details

### Muting a Group
1. Click the eye icon on a group row → extension fetches the group via API
2. Reads `charge_excluding_tax_total` and `tax_total` from the API response
3. Appends `[MUTED:charge:tax]` to the group name via PUT
4. All child rows are visually dimmed (red tint) via DOM — no API calls for children
5. Page total and revenue panel update instantly

### Muting an Individual Item
1. Click the eye icon on an item row → extension fetches the item via API
2. Appends `[MUTED]` to the item description via PUT
3. Item row is visually dimmed

### On the PDF (Liquid Template)
1. Template loops through `order.items` and parses `[MUTED:charge:tax]` from group names
2. Sums charges from topmost muted groups only (nested children skipped to avoid double-counting)
3. Hides all muted groups, their children, and their subtotals from the rendered output
4. Subtracts muted charges from: rental total, ex-tax total, tax total, inc-tax total
5. Strips `[MUTED:xxx:xxx]` from any visible group names and subtotal labels

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

## Updating

When a new version is available, the extension popup will show a green notification with a download link.

To update manually:
1. Download the latest zip from this repo
2. Extract and replace the files in your extension folder
3. Go to `chrome://extensions` → click the reload button on RMS Multitool
