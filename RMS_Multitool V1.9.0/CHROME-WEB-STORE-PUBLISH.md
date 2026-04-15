# Publish RMS Multitool to the Chrome Web Store

## 1. Developer account (one-time)

1. Go to the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Sign in with the Google account you want to use for publishing.
3. Accept the developer agreement and pay the **one-time registration fee** (about $5).
4. Use an email you check often; you can’t change it later.

## 2. Prepare the extension package

Create a **ZIP file** that contains only the extension files. The **manifest must be in the root** of the ZIP (not inside a folder).

**Include these (from the extension folder):**
- `manifest.json`
- `background.js`
- `content.js`
- `popup.js`
- `popup.html`
- `quote-mute.js`
- `dashboard.html`
- `dashboard.js`
- `services-dashboard.html`
- `services-dashboard.js`
- `warehouse-dashboard.html`
- `warehouse-dashboard.js`
- `icons/` folder (icon-16.png, icon-48.png, icon-128.png)

**Do not include:**  
`license-api/`, `screenshot-demos/`, `README.md`, `LEMON_SQUEEZY_SETUP.md`, `CHROME-WEB-STORE-PUBLISH.md`, `version.json`, `mute-system-snippet.liquid`, or any `.git` / hidden files.

**Quick way to zip (Terminal, from the extension folder):**
```bash
cd "/Users/AudioHawes/Downloads/RMS_Multitool V1.3.0"
zip -r rms-multitool-1.5.0.zip manifest.json background.js content.js popup.js popup.html quote-mute.js dashboard.html dashboard.js services-dashboard.html services-dashboard.js warehouse-dashboard.html warehouse-dashboard.js icons/ -x "*.DS_Store"
```

## 3. Store listing assets (required)

To avoid using real/private Current RMS data in screenshots, use the **screenshot-demos** folder: open the HTML files in Chrome (they use fake data only) and capture screenshots. See `screenshot-demos/README.md`.

Prepare these **before** submitting:

| Asset | Size | Required |
|-------|------|----------|
| **Small promo tile** | 440×280 px | Yes (PNG/JPEG) |
| **Marquee promo tile** | 1400×560 px | Optional but recommended |
| **Screenshots** | 1280×800 px | At least 1, up to 5 |
| **Store icon** | 128×128 px | Yes (you have this in `icons/icon-128.png`) |
| **Promo video** | YouTube link | Optional |

## 4. Upload and fill in the dashboard

1. In the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole), click **Add new item**.
2. Click **Choose file**, select your ZIP, then **Upload**.
3. Complete each tab:
   - **Store listing**  
     Category, short description (from manifest is used), **detailed description**, and the images above.
   - **Privacy**  
     Declare the extension’s **single purpose** and how you handle data (e.g. “License key is sent to our server for validation; settings stored locally”).
   - **Distribution**  
     Choose **Public** (searchable), **Unlisted** (link-only), or **Private**. Pick countries if needed.
4. When everything is complete, click **Submit for Review**.

## 5. After submission

- Review usually takes a few days.
- You’ll get email about approval, rejection, or requested changes.
- If approved, the extension goes live (or stays staged if you chose “defer publish”).

## 6. Updates later

For each update: bump the **version** in `manifest.json`, create a new ZIP (same rules as above), open your item in the dashboard, go to **Package**, upload the new ZIP, then **Submit for Review** again.

---

**Useful links**
- [Publish in the Chrome Web Store](https://developer.chrome.com/docs/webstore/publish)
- [Prepare your extension](https://developer.chrome.com/docs/webstore/prepare)
- [Store listing (images, description)](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)
- [Privacy practices](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
