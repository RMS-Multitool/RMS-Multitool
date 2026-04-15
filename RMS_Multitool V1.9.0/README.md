# RMS Multitool

A Chrome extension for [CurrentRMS](https://www.current-rms.com/) built for AV and event production teams. Adds multi-store stock checking, a fully automated event sheet generator, quote & crew dashboards, a warehouse workflow board, and a quote mute system — all without leaving your browser.

## License & Trial

**Multi-store stock checker (Simple and Date-Aware modes)** is available without a license.

All other features require a valid license. **New installs get a 7-day free trial** with full access. After the trial, enter your license code in the extension popup to continue.

**Features that require a license (trial or full):**
- Event Sheet Generator
- Quote Mute
- Quote Dashboard
- Crew & Vehicles Dashboard
- Warehouse Dashboard

---

## Features

### Event Sheet Generator

Generates a professional, print-ready event sheet PDF directly from a CurrentRMS opportunity — no copy-pasting required.

#### How It Works
Open any opportunity in CurrentRMS → click **Event Sheet** in the RMS Multitool nav dropdown. The sheet auto-fills from the API and you fill in the remaining details before downloading.

#### Auto-Filled from CurrentRMS
- **Job details** — opportunity number, job name, venue, client, dates
- **Equipment list** — pulled from the opportunity's line items; pricing hidden; accessories, labour, and subtotals filtered out automatically
- **Production requirements** — any custom field data mapped to the sheet
- **Contacts** — venue and client contact details from the opportunity

#### Manual Sections (you fill in)
- **Show times** — time, activity, location, notes; drag-to-reorder rows; add day-separator headers; multiple rows supported
- **Crew list** — name and role; drag-to-reorder
- **External links** — label + URL pairs for shared Google Docs, site surveys, etc.; drag-to-reorder
- **Setup locations** — freeform location/access notes with labelled blocks
- **Onsite information** — venue access, generator, parking, Wi-Fi, delivery details
- **Tech / Backline** — freeform notes
- **Notes** — general production notes

#### Additional Quotes
Combine gear from multiple CurrentRMS opportunities into a single event sheet — useful when one event spans several quotes.
- Type an opportunity number or paste the full CurrentRMS URL
- Each added quote's gear appears as its own **Equipment** section labelled with the source job number and name
- Shows all item groups including cables and accessories (not filtered like the main quote)
- Drag-to-reorder sections; remove with ✕
- Added quotes persist in saved drafts

#### Site Plans
- Upload site plan images (PNG/JPG) or PDFs
- Drag-to-reorder site plans
- Images are embedded in the PDF; PDFs are appended as extra pages

#### AI Extraction (Claude)
- Upload a venue EO, promoter worksheet, or client schedule in any format (PDF, DOCX, image)
- Claude reads the document and pre-fills show times, crew, venue access, and notes fields automatically
- Requires an Anthropic API key (set in the extension popup)

#### Draft Save & Restore
- Save a draft at any time — restores all fields including show times, crew, site plans, and additional quotes
- Drafts stored in Google Drive (full data including site plan binaries) and localStorage (metadata)

#### PDF Output
- Downloads a clean, paginated A4 PDF
- Black-and-white header banner with job name, venue, and date
- Equipment table with quantities; groups and section headings preserved
- Site plan images and PDFs appended as extra pages
- Footer on every page: event name, date, and "Confidential — Internal Use Only"

---

### Multi-Store Stock Checker

Three display modes, selectable from the extension popup:

#### Off
Stock display disabled — CurrentRMS behaves as normal.

#### Simple Mode
- Shows total held stock per enabled store on each item row
- Quick at-a-glance view: `📦 FOHP Aus: 50 | PICA: 12 | TTY: 8`
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
- **Unmute All** button in the summary bar at the bottom of the page

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

### Crew & Vehicles Dashboard
- **Dedicated services view** — separate dashboard for crew and labour assignments
- **Month navigation** — same month filtering as the quote dashboard
- **Default "All Months"** — shows all jobs on first load to prevent columns disappearing unexpectedly
- **Date-range overlap** — jobs spanning multiple months appear in all relevant months

### Warehouse Dashboard
- **Board view** — columns: Ready to prep, In prep, Ready to load, Not in workflow
- **Client name** on each job tile
- **Mark ready to prep** — button injected into opportunity pages
- **Loaded & Ready for Delivery** — mark directly from the dashboard
- **Focus job** — open a quote then the dashboard; that job is highlighted and always loaded
- **14-day window** — jobs ending within 14 days; configurable refresh interval

---

### CrewBase
- Quick-launch button in the extension popup and in the RMS Multitool nav dropdown
- Opens your CrewBase admin panel directly in a new tab

---

### Group Configuration
- Configure how opportunity line item groups are classified and displayed in the event sheet equipment list
- Accessible from the extension popup

---

## Navigation Bar Integration

The extension injects an **RMS Multitool** dropdown into the CurrentRMS top navigation bar with links to:
- Quote Dashboard
- Crew & Vehicles
- Warehouse Dashboard
- CrewBase
- Event Sheet (on opportunity pages)

---

## Installation

1. Download or clone this repo
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** → select the extension folder
5. Click the RMS Multitool icon — enter your CurrentRMS **subdomain** and **API key**
6. You'll start a **7-day free trial** with all features unlocked
7. Configure your stores (name and ID for each)
8. Select your stock display mode (Off / Simple / Date-Aware)
9. Open any CurrentRMS opportunity to see stock tags, mute toggles, and the Event Sheet option

After the trial, enter your license code in the popup to continue using all features.

### Liquid Template Setup (Quote Mute)

To enable Quote Mute on client PDFs:

1. In CurrentRMS, go to **System Setup → Document Templates**
2. Edit your quote template body
3. Paste the contents of `quote-template-body.liquid` (or use the portable `mute-system-snippet.liquid` to add mute support to an existing template)
4. The snippet has three sections:
   - **Section A** — paste at the very top (calculates muted totals)
   - **Section B** — wrap around your item rendering loop (hides muted items)
   - **Section C** — example cost summary using the adjusted variables

### AI Extraction Setup (Event Sheet)

1. Create a free account at [anthropic.com](https://console.anthropic.com/)
2. Generate an API key
3. Paste it into the **Anthropic API Key** field in the extension popup
4. The upload zone in the Event Sheet will activate

---

## API Usage

**Date-Aware stock mode** makes the following calls on first load:
- 1 call to fetch the opportunity details (dates, store)
- 1–2 calls to list overlapping opportunities (paginated)
- ~10–15 calls to fetch items for each overlapping order/reserved quote (parallelised)
- 1 call per product for stock levels (held quantities)

After the initial cache build (~2–3 seconds), subsequent lookups are instant. Cache lasts 15 minutes.

**Quote Mute** makes 2 API calls per toggle (GET + PUT on the parent group only). State sync on page load makes 1–2 calls.

**Event Sheet** makes 1 call on load to fetch the full opportunity including items, participants, venue, and member data.

CurrentRMS API rate limit: 60 requests/60 seconds. The extension uses batch sizes of 3–5 with delays, and exponential backoff (2s, 4s, 8s) on 429 errors.

---

## Email Alerts Setup (Quote Dashboard)

Sends styled HTML alert emails via [EmailJS](https://www.emailjs.com/) (free tier: 200 emails/month).

1. Create a free account at [emailjs.com](https://www.emailjs.com/signup)
2. Go to **Email Services** → add your Gmail/Outlook → copy the **Service ID**
3. Go to **Email Templates** → Create New Template:
   - **To Email:** `{{to_email}}`
   - **Subject:** `{{subject}}`
   - **Content** (Code editor): `{{{html_body}}}` ← triple braces
4. Save → copy the **Template ID**
5. Go to **Account** → copy your **Public Key**
6. Paste all three into the dashboard settings panel

---

## Updating

When a new version is available, the extension popup shows a green notification with a download link.

To update manually:
1. Download the latest zip from this repo
2. Extract and replace the files in your extension folder
3. Go to `chrome://extensions` → click the reload button on RMS Multitool

---

## Version History

- **1.9.0** — Additional Quotes (combine gear from multiple opportunities into one event sheet), CrewBase quick-launch in popup and nav menu, drag-to-reorder additional quotes, full URL paste support for opportunity lookup
- **1.8.0** — Event Sheet Generator: auto-fill from CurrentRMS, show times with drag-to-reorder, crew list, site plan upload (images + PDF append), AI extraction via Claude, draft save/restore to Google Drive, Additional Quotes feature
- **1.5.0** — Lemon Squeezy license validation via Vercel API, 7-day trial. Warehouse dashboard, Mark ready to prep, Loaded for delivery
- **1.4.5** — Quote Mute: instant toggle, red-tinted dimming, page total & revenue panel overrides, nested group deduplication, clean name display, on/off toggle, state persistence. Dashboard: month navigation, API rate limiting with exponential backoff. Crew Dashboard: month navigation, default All Months
- **1.4.0** — Quote Mute system: eye toggle icons, `[MUTED]` tagging via API, Liquid template integration, mute cascade, summary bar, portable snippet
- **1.3.0** — Date-aware stock availability, colour-coded store tags, hover tooltips, two-phase cache, pre-warm, 15-minute cache, three-mode stock toggle, live settings reload
- **1.2.0** — Kanban dashboard, email alerts, auto-update checker, live product search, CurrentRMS nav tab
- **1.1.0** — Dashboard feature added
- **1.0.0** — Initial release with multi-store stock checker
