# RMS Multitool

Chrome extension for [`CurrentRMS`](https://www.current-rms.com/) that adds:

- Multi‑store stock visibility directly on opportunities
- Quote and crew dashboards for at‑a‑glance scheduling and organisation
- A quote mute system to hide internal items from client PDFs while keeping them in the opportunity

---

## Features

### Multi‑Store Stock Checker

See usable stock across multiple stores without leaving the opportunity screen.

- **Three modes** — switch between Off, Simple, and Date‑Aware from the extension popup
- **Off**: CurrentRMS behaves exactly as normal, with no extra indicators
- **Simple Mode**:
  - Shows the **total held quantity per enabled store** on each item row
  - At‑a‑glance text tags like `📦 Store 1: 50 | Store 2: 12 | Store 3: 8`
  - Stores with **zero stock are highlighted in red** so problem locations stand out immediately
- **Date‑Aware Mode**:
  - Shows **real availability for the quote’s date range**, not just what’s on the shelf
  - Takes into account **overlapping orders and reserved quotations** so you see what’s actually free to use
  - Uses **colour‑coded tags** per store to indicate whether an item is fully available, just quoted elsewhere, partially committed, or overbooked
  - Hover over a tag to see **which jobs are using the stock**, giving context before you promise gear

The goal is to make it obvious, from the quote screen alone, **where stock can be pulled from and where conflicts exist**, so planners don’t have to bounce between reports or stores to make simple decisions.

---

### Quote Mute System *(introduced in v1.4.x)*

Hide groups and items from client‑facing PDFs **without** deleting them from the opportunity.

- **Per‑row eye toggles**:
  - Each item and group row in the opportunity editor gets an eye icon
  - Click to **mute/unmute** content that you don’t want the client to see (e.g. internal allowances, backup items, discounts, or internal breakdowns)
- **Client PDFs stay clean**:
  - Muted groups and items are **omitted from the PDF** while staying in the opportunity for internal use
  - Totals are **automatically adjusted** so the PDF numbers match what the client is meant to see
- **Visual feedback in the editor**:
  - Muted rows are **dimmed with a red tint** and show a clear “MUTED” indicator
  - Child rows of a muted group visually follow the parent’s state so it’s obvious what’s hidden
- **Totals that match what’s visible**:
  - The **opportunity total at the bottom** of the page shows both the adjusted total and a “was $X” reference
  - The **revenue summary panel** (Rental Charge Total, Charge Total, Tax Total, Total With Tax) also reflects muted amounts with “was” indicators
- **Safe for teams**:
  - Mute state is stored centrally so **all users see the same mute/unmute status**
  - Can be **enabled or disabled from the extension popup** if you only want to use it on certain workflows

On the PDF side, a dedicated Liquid template handles hiding muted content and adjusting totals, so **what you see as “live” in the editor is exactly what your client sees on the exported PDF.**

---

### Quote Dashboard

A Kanban‑style overview of upcoming quotes so your team can see **what’s coming up, who it belongs to, and how long it’s been waiting**.

- **Department‑based columns**:
  - Each department gets its own column
  - Columns appear only when there are quotes that match that department’s rules, keeping the board focused
- **Time‑based filtering**:
  - Filter by **month** (previous/next) or toggle **“All Months”** to see everything
  - Automatically filters to **future events**, so old jobs don’t clutter the board
- **Rich quote cards**:
  - Show **event start and end dates**
  - Sorted by **start date** (soonest first) within each department
  - Compact layout that shows the **most important triggers at a glance**, with hover details when needed
- **Monitoring and alerts**:
  - A **“time on board”** timer for each card shows how long it has been waiting in that column
  - Optional **email alerts** can notify you when a quote has been sitting too long
- **Built for the office:
  - Designed to be **TV/monitor friendly** for constant display in the office
  - Integrated directly into **CurrentRMS navigation** as a “Quote Dashboard” tab

The dashboard is meant to be your team’s **shared radar** for upcoming work — what’s new, what’s stuck, and what needs attention next.

---

### Crew / Services Dashboard

A dedicated view for **crew and services**, separate from the main quote dashboard.

- **Service‑focused layout**:
  - Shows jobs specifically in terms of **crew and labour assignments**
  - Makes it easy for operations or crew chiefs to see **who’s needed where, and when**
- **Flexible date range handling**:
  - Uses the same **month navigation** as the quote dashboard
  - **“All Months”** is enabled by default so you don’t accidentally hide jobs that span broader windows
  - Jobs that span multiple months appear in **all relevant months**, so long‑running events are never lost

Use this view as a **live schedule for services**, separate from the gear and quoting view.

---

## Installation

1. Download or clone this repo.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the extension folder.
5. Click the **RMS Multitool** icon and enter your **CurrentRMS subdomain** and **API key**.
6. Configure your **stores** (name and ID for each).
7. Choose your **stock display mode** (Off / Simple / Date‑Aware).
8. Toggle **Quote Mute** on or off as needed.
9. Open any **CurrentRMS opportunity** — you’ll see stock tags and mute toggles on each item row.
10. Open the **Quote Dashboard** either from the popup or via the “Quote Dashboard” tab in the CurrentRMS navigation bar.

---

## Liquid Template Setup (for Quote Mute PDFs)

To enable Quote Mute on client PDFs:

1. In CurrentRMS, go to **System Setup → Document Templates**.
2. Edit your **quote template body**.
3. Use the portable `mute-system-snippet.liquid` to add mute support to an existing template.
4. The snippet is organised into three logical sections:
   - **Section A** — goes at the very top and prepares the values used later in the template.
   - **Section B** — wraps around your item rendering loop so muted content is excluded from the output.
   - **Section C** — shows how to build a cost summary using the adjusted values.

The template takes care of **hiding muted items and groups** and ensures your **subtotals and grand totals line up** with what’s actually shown on the PDF.

---

## Department & Dashboard Configuration

Each dashboard column (department) can be triggered by a combination of:

- **Product IDs** — specific CurrentRMS product IDs
- **Product Groups** — selected from a dropdown of your account’s groups
- **Keywords** — searched against product names and/or custom keywords

A quote appears in a department’s column if **any** of its line items match **any** of that department’s rules.

This allows you to model departments in a flexible way — by product type, by product group, by keywords, or a mix of all three.

---

## Email Alerts (Optional, via EmailJS)

The extension can send **styled HTML email alerts** when quotes have been sitting on the dashboard longer than your chosen threshold.

Quick one‑time setup with [EmailJS](https://www.emailjs.com/) (free tier available):

1. Create a free account at `emailjs.com`.
2. Add your email provider under **Email Services** and copy the **Service ID**.
3. Under **Email Templates**, create a template with:
   - **To Email:** `{{to_email}}`
   - **Subject:** `{{subject}}`
   - **Content:** `{{{html_body}}}` (triple braces to allow HTML)
4. Copy your **Template ID** and **Public Key**.
5. Paste these values into the **dashboard settings** in the extension.

Once configured, the dashboard can trigger **automated notifications** to your team when quotes need attention.

---

## Updating

When a new version is available, the extension popup shows a **green notification** with a download link.

To update manually:

1. Download the latest zip from this repo.
2. Extract and replace the files in your existing extension folder.
3. Go to `chrome://extensions` and click the **reload** button on RMS Multitool.

---

## Releasing a New Version (for maintainers)

When you cut a new version:

1. Update `version.json` with the new `version` and `changelog`.
2. Update the `CURRENT_VERSION` constant in `popup.js`.
3. Update the `version` field in `manifest.json`.

Push the changes to the `main` branch. Existing installations will see the update notification the next time they open the popup.

---

## Version History (Highlights)

- **1.4.5**
  - Enhancements to Quote Mute (faster toggling, clearer visual states, better totals handling)
  - Quote Dashboard improvements (month navigation and more graceful handling under load)
  - Crew Dashboard refinements (month navigation and clearer default view)
  - Liquid template improvements for cleaner handling of muted content
- **1.4.0**
  - Initial release of the **Quote Mute** system with eye toggles and Liquid integration
- **1.3.0**
  - **Date‑Aware** stock availability with colour‑coded tags and hover details
- **1.2.0**
  - **Kanban quote dashboard**, email alerts, auto‑update checker, and navigation tab integration
- **1.1.0**
  - First version of the **dashboard** feature
- **1.0.0**
  - Initial release with the **multi‑store stock checker**
