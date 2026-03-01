# RMS Multitool — License validation API (Lemon Squeezy)

This folder contains a small serverless API that validates license keys with [Lemon Squeezy](https://docs.lemonsqueezy.com/api/license-api/validate-license-key). **Never put your Lemon Squeezy API key in the extension;** it goes here as an environment variable on your server.

## Deploy to Vercel (free)

**Important:** You must deploy from **this folder** (`license-api`), not from the parent extension folder. Deploying from the wrong folder causes `NOT_FOUND` for `/api/validate`.

1. Install Vercel CLI: `npm i -g vercel` (or use the Vercel dashboard).
2. **`cd` into this folder**, then run: `vercel`
3. In the [Vercel dashboard](https://vercel.com/dashboard) → your project → **Settings** → **Environment Variables**:
   - Name: `LEMONSQUEEZY_API_KEY`
   - Value: your Lemon Squeezy API key (from Lemon Squeezy → Settings → API)
   - Save and redeploy.

4. Your endpoint will be: `https://YOUR-PROJECT.vercel.app/api/validate`

## Wire up the extension

1. In **background.js** (in the main extension folder), set:
   ```javascript
   const LICENSE_API_URL = 'https://YOUR-PROJECT.vercel.app/api/validate';
   ```

2. In **manifest.json**, add your API origin to `host_permissions`:
   ```json
   "host_permissions": [ "https://YOUR-PROJECT.vercel.app/*", ... ]
   ```

3. Reload the extension. Users can then enter their Lemon Squeezy license key in the popup; the extension will send it to this API, which validates it with Lemon Squeezy and returns unlock.

## Request / response

- **POST** `/api/validate`
- **Body:** `{ "code": "USER_ENTERED_LICENSE_KEY" }`
- **Response:** `{ "valid": true, "type": "unlock" }` or `{ "valid": false }`

The extension expects exactly that shape so it can unlock when `valid: true`.

## CORS

The handler sends `Access-Control-Allow-Origin: *` and handles `OPTIONS` so the Chrome extension (or any origin) can call `/api/validate` from the browser.

## Troubleshooting

- **HTTP 404 on `/api/validate`** — You must deploy from **this folder** (`license-api`), not from the parent extension folder. From a terminal: `cd license-api` then `vercel`. If your Vercel project was created from the parent folder, create a new project from inside `license-api` (or redeploy with `vercel --prod` from `license-api`) and set `LICENSE_API_URL` in `background.js` to the URL Vercel gives you (e.g. `https://your-project.vercel.app/api/validate`).
- **"License server not configured"** — Set `LEMONSQUEEZY_API_KEY` in Vercel (Settings → Environment Variables) and redeploy.
- **"Invalid code" / "Invalid or expired license key"** — The key was rejected by Lemon Squeezy (wrong key, expired, or disabled). Check the key in [Lemon Squeezy → Store → Licenses](https://app.lemonsqueezy.com/licenses).
- **Extension says "Network error"** — The Vercel URL in `background.js` (`LICENSE_API_URL`) must match your deployed project and be in `manifest.json` `host_permissions`. The API now responds with CORS headers so the extension can call it.
