# Privacy Policy — RMS Multitool

**Last updated:** April 2026

This privacy policy applies to the RMS Multitool Chrome extension.

---

## Overview

RMS Multitool is a Chrome browser extension that adds enhanced functionality to the [CurrentRMS](https://www.current-rms.com/) web application. This policy explains what data the extension accesses, how it is used, and what is not collected.

---

## Data accessed by the extension

The extension reads and modifies page content within the CurrentRMS web application (`app.current-rms.com`) solely to provide its features. This includes:

- Quote and opportunity line items (to support the Quote Mute feature)
- Product and stock availability data (to support the multi-store stock checker)
- Page totals and revenue figures displayed within CurrentRMS
- Opportunity date ranges (used to calculate date-aware stock availability)

This data is accessed locally within your browser session and is used only to modify the display and behaviour of the CurrentRMS interface for the current user.

---

## Data storage

The extension stores limited preference and state data locally in your browser using Chrome's built-in storage API (`chrome.storage.local`). This data:

- Remains entirely on your device
- Is never transmitted to any external server
- Is used only to preserve your settings, store configuration, license key, and muted item state between sessions

A 15-minute in-memory cache is used during a browser session to reduce API calls when using Date-Aware stock mode. This cache is not persisted to disk and is cleared when the tab is closed.

---

## CurrentRMS API usage

The extension makes calls to the CurrentRMS API on your behalf using the API key you provide. These calls are made directly from your browser to CurrentRMS's own servers — no data passes through any third-party server operated by RMS Multitool. Your API key is stored locally in `chrome.storage.local` and is never transmitted anywhere other than to `app.current-rms.com`.

---

## Email alerts (optional)

The Quote Dashboard feature optionally integrates with [EmailJS](https://www.emailjs.com/) to send alert emails when quotes sit unattended past a configurable threshold. If you configure this feature:

- Your EmailJS Service ID, Template ID, and Public Key are stored locally in `chrome.storage.local`
- Email content is sent directly from your browser to EmailJS's servers in accordance with [EmailJS's own privacy policy](https://www.emailjs.com/legal/privacy-policy/)
- RMS Multitool does not operate or have access to any email infrastructure

This feature is entirely optional and requires you to set it up with your own EmailJS account. It is not enabled by default.

---

## Data we do not collect

RMS Multitool does not collect, transmit, sell, or share any personal data. Specifically:

- No personally identifiable information (PII) is collected
- No usage analytics or telemetry are gathered
- No data is sent to any server operated by RMS Multitool
- No browsing history outside of `app.current-rms.com` is accessed
- No data is shared with third parties

---

## Permissions

The extension requests only the permissions necessary for its features to function:

| Permission | Why it's needed |
|---|---|
| `storage` | Save your settings, API key, store config, and muted item state locally |
| `host_permissions: app.current-rms.com` | Read and modify CurrentRMS pages; make API calls on your behalf |
| `alarms` | Power the dashboard polling interval (1–10 minute refresh cycles) |

No permissions are used to access data outside of the CurrentRMS application.

---

## Changes to this policy

If this policy changes in a meaningful way, the "last updated" date at the top of this page will be revised. Continued use of the extension after any update constitutes acceptance of the revised policy.

---

## Contact

For questions about this policy, please [open an issue on GitHub](https://github.com/RMS-Multitool/RMS-Multitool/issues).
