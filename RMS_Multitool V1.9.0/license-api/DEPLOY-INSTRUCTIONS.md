# Deploy license-api to Vercel (bypass Root Directory)

**Still getting 404 when entering a product key?** The URL `https://rms-multitool.vercel.app/api/validate` only works if this **license-api** folder was deployed to the **rms-multitool** project. If you deployed from the main extension folder or with the wrong root, the API route is not there. Fix: run the steps below from **this folder** and when asked **"Link to existing project?"** choose **Y** and select **rms-multitool** so the same URL starts serving the API.

If Vercel keeps saying "Root Directory does not exist", deploy from your computer instead.

## Steps

1. **Open Terminal** (not in Cursor – use macOS Terminal or iTerm).

2. **Go into the license-api folder:**
   ```bash
   cd "/Users/AudioHawes/Downloads/RMS_Multitool V1.3.0/license-api"
   ```

3. **Log in to Vercel (if needed):**
   ```bash
   vercel login
   ```

4. **Deploy:**
   ```bash
   vercel --prod
   ```
   - If it asks "Set up and deploy?", choose **Y**.
   - If it asks "Which scope?" pick your account (e.g. dan-hawes-projects).
   - If it asks "Link to existing project?" choose **Y** and pick **rms-multitool** so the same URL works, or **N** to create a new project (you’ll get a new URL and must update `LICENSE_API_URL` in background.js).

5. **Note the URL** Vercel prints (e.g. `https://rms-multitool.vercel.app`).

6. **Add your Lemon Squeezy key** in Vercel:  
   [Vercel Dashboard](https://vercel.com/dan-hawes-projects/rms-multitool/settings/environment-variables) → **Environment Variables** → add **LEMONSQUEEZY_API_KEY** → Redeploy.

7. **Test:** In the extension popup, use "devSetTrialExpired" in the console, then enter a Lemon Squeezy test license code.

This deploys only the contents of `license-api` and does not use Root Directory or GitHub for this deploy.
