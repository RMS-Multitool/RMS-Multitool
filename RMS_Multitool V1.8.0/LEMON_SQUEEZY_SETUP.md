# Lemon Squeezy setup for RMS Multitool licenses

- **New installs:** The extension starts a **7-day free trial** of all features automatically when someone installs it. No code needed for the first 7 days.
- **After trial (or to unlock permanently):** Customers enter a **license key** from a Lemon Squeezy purchase. You validate that key via a small backend that calls Lemon Squeezy’s API.
- **Purchase link:** When no license is entered, the popup can show a “Purchase full version” button that opens your Lemon Squeezy checkout.

---

## Quick setup checklist

1. **Purchase link (popup)**  
   In `popup.js`, set `PURCHASE_URL` to your Lemon Squeezy checkout URL (e.g. from Product → Copy checkout link). Leave as `''` to hide the button.

2. **License validation (backend)**  
   - Create a product in Lemon Squeezy with **License keys** enabled.  
   - Build a small backend that accepts `POST { "code": "USER_KEY" }` and returns `{ "valid": true, "type": "unlock" }` or `{ "valid": false }` (see §3).  
   - In `background.js`, set `LICENSE_API_URL` to that backend URL (e.g. `https://yourdomain.com/api/rms-multitool/validate`).

3. **Extension permissions**  
   In `manifest.json`, add your backend origin to `host_permissions`, e.g. `"https://yourdomain.com/*"`, so the extension can call your API.

4. **Lemon Squeezy API key**  
   Use it **only** in your backend (e.g. as `LEMONSQUEEZY_API_KEY` in Vercel). **Never** put it in the extension or in git — anyone could extract it and abuse your Lemon Squeezy account.

---

## 1. Lemon Squeezy product with license keys

1. In [Lemon Squeezy](https://app.lemonsqueezy.com) create a **Product** (e.g. “RMS Multitool — Full license”).
2. Enable **License keys** for that product (in the product settings). Lemon Squeezy will generate a unique key per purchase.
3. When a customer pays, they see the license key on the order confirmation (and in the email). They enter that key in the extension.

You can have one product for “lifetime” and optionally another for “yearly” if you want; your backend can map Lemon Squeezy’s response to `type: 'unlock'` (or trial) when validating.

---

## 2. Validate keys via your backend (recommended)

Don’t call Lemon Squeezy from the extension (you’d have to put your API key in the extension). Use a small backend that:

**Optional:** The repo includes a ready-to-deploy serverless API in the **`license-api`** folder. See `license-api/README.md` to deploy it to Vercel and set your Lemon Squeezy API key as an environment variable. Then set `LICENSE_API_URL` in `background.js` to your deployed URL (e.g. `https://your-project.vercel.app/api/validate`).

Otherwise, use your own backend that:

1. Receives the code from the extension: `POST { "code": "USER_ENTERED_CODE" }`.
2. Calls Lemon Squeezy’s **License API** to validate that key.
3. Returns to the extension: `{ "valid": true, "type": "unlock" }` or `{ "valid": false }`.

**Lemon Squeezy License API:**  
`POST https://api.lemonsqueezy.com/v1/licenses/validate`  
Headers: `Authorization: Bearer YOUR_API_KEY`, `Accept: application/json`  
Body: `{ "license_key": "THE_CODE" }`  

Response includes `valid` and license details (e.g. status, product). If `valid` is true, your backend returns `{ "valid": true, "type": "unlock" }` to the extension.

**Get your API key:** Lemon Squeezy Dashboard → Settings → API. Create an API key and keep it only on your server.

---

## 3. Example backend (Node) for Lemon Squeezy

```javascript
// POST /api/rms-multitool/validate
app.post('/api/rms-multitool/validate', async (req, res) => {
  const code = (req.body && req.body.code) ? String(req.body.code).trim() : '';
  if (!code) return res.json({ valid: false });

  const lsRes = await fetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + process.env.LEMONSQUEEZY_API_KEY
    },
    body: JSON.stringify({ license_key: code })
  });
  const data = await lsRes.json().catch(() => ({}));

  if (data.valid === true) {
    // Optional: check data.license_key.status or product for trial vs lifetime
    return res.json({ valid: true, type: 'unlock' });
  }
  res.json({ valid: false });
});
```

Set `LICENSE_API_URL` in the extension to this endpoint (e.g. `https://yourdomain.com/api/rms-multitool/validate`) and add that origin to `host_permissions` in manifest.json.

---

## 4. Purchase link in the popup

- In **popup.js**, set `PURCHASE_URL` to your Lemon Squeezy checkout URL (must start with `https://`).
- When the user has **no valid license** (trial expired and no key entered), the popup shows a **“Purchase full version”** button that opens this URL in a new tab.
- When the user is licensed (trial or unlocked), the button is hidden.

Example: `const PURCHASE_URL = 'https://yoursite.lemonsqueezy.com/checkout/buy/abc123-product-id';`

---

## 5. Flow summary

| When | What happens |
|------|-------------------------------|
| **User installs extension** | 7-day trial starts automatically; all features work. |
| **During trial** | Popup shows “Trial: X days left”. No code needed. |
| **Trial expired** | Features are locked; popup shows “Purchase full version” (if `PURCHASE_URL` is set) and the license key field. |
| **User buys on Lemon Squeezy** | They get a license key on the receipt/email. |
| **User enters key in extension** | Extension sends it to your API → you validate with Lemon Squeezy → return `valid: true, type: 'unlock'` → extension unlocks permanently. |

You don’t send keys manually; Lemon Squeezy issues the key on purchase and your backend only validates it.
