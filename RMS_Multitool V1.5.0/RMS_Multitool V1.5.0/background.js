// background.js — RMS Multitool v1.5.0

const TRIAL_DAYS = 7;
const LICENSE_KEYS = { trialStart: 'rms_trial_start', unlocked: 'rms_license_unlocked' };

// Your personal dev/testing code — stored as SHA-256 hex so it's not plain text.
const DEV_CODE_HASH = '7a29eeaee48a34d018ad77a311debdcfb4c5284bec937480595b382d1e188792';

// Simple test code that unlocks without calling Vercel. Set to empty to test Lemon Squeezy only.
const TEST_BYPASS_CODE = '';

// Your backend URL for validating customer codes (Lemon Squeezy license API on Vercel).
// API: POST JSON { "code": "USER_ENTERED_CODE" }, respond { "valid": true, "type": "unlock" } or { "valid": false }
// Must be deployed from the license-api folder; see license-api/DEPLOY-INSTRUCTIONS.md if you get 404.
const LICENSE_API_URL = 'https://rms-multitool.vercel.app/api/validate';

// Start 7-day trial automatically when the extension is first installed
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason !== 'install') return;
    chrome.storage.local.get([LICENSE_KEYS.trialStart, LICENSE_KEYS.unlocked], (r) => {
        if (r[LICENSE_KEYS.unlocked] === true) return;
        if (r[LICENSE_KEYS.trialStart] != null) return;
        chrome.storage.local.set({ [LICENSE_KEYS.trialStart]: Date.now() });
    });
});

async function sha256Hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(x => x.toString(16).padStart(2, '0')).join('');
}

function getLicenseStatus(cb) {
    chrome.storage.local.get([LICENSE_KEYS.trialStart, LICENSE_KEYS.unlocked], (r) => {
        let start = r[LICENSE_KEYS.trialStart];
        const unlocked = r[LICENSE_KEYS.unlocked] === true;
        // Safety: if no trial has ever been started and the user is not unlocked,
        // start a 7-day trial the first time we check license status.
        if (!unlocked && (typeof start !== 'number' || !isFinite(start))) {
            start = Date.now();
            chrome.storage.local.set({ [LICENSE_KEYS.trialStart]: start });
        }
        const now = Date.now();
        const trialMs = TRIAL_DAYS * 24 * 60 * 60 * 1000;
        const trialEnd = (typeof start === 'number') ? start + trialMs : null;
        const trialActive = trialEnd != null && now < trialEnd;
        const allowed = unlocked || trialActive;
        const trialDaysLeft = trialEnd != null && now < trialEnd ? Math.ceil((trialEnd - now) / (24 * 60 * 60 * 1000)) : null;
        cb({ allowed: allowed === true, unlocked, trialExpired: trialEnd != null && now >= trialEnd, trialDaysLeft });
    });
}

function validateLicenseCode(code, cb) {
    const raw = String(code || '').trim();
    if (!raw) { cb({ success: false }); return; }

    (async () => {
        // 1) Dev code: compare hash so your secret isn't in the source
        if (DEV_CODE_HASH) {
            const inputHash = await sha256Hex(raw);
            if (inputHash.toLowerCase() === DEV_CODE_HASH.toLowerCase()) {
                chrome.storage.local.set({ [LICENSE_KEYS.unlocked]: true }, () => cb({ success: true, type: 'unlock' }));
                return;
            }
        }

        // 2) Local test bypass (no API) — use while Vercel/Lemon Squeezy isn't working. Change TEST_BYPASS_CODE or remove for production.
        if (TEST_BYPASS_CODE && raw.toUpperCase().replace(/\s/g, '') === TEST_BYPASS_CODE.toUpperCase().replace(/\s/g, '')) {
            chrome.storage.local.set({ [LICENSE_KEYS.unlocked]: true }, () => cb({ success: true, type: 'unlock' }));
            return;
        }

        // 3) Customer codes: validate with your API (Lemon Squeezy via Vercel)
        if (LICENSE_API_URL) {
            try {
                const res = await fetch(LICENSE_API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code: raw })
                });
                const data = res.ok ? await res.json().catch(() => ({})) : await res.json().catch(() => ({})) || {};
                if (data.valid === true && (data.type === 'trial' || data.type === 'unlock')) {
                    if (data.type === 'unlock') {
                        chrome.storage.local.set({ [LICENSE_KEYS.unlocked]: true }, () => cb({ success: true, type: 'unlock' }));
                    } else {
                        chrome.storage.local.set({ [LICENSE_KEYS.trialStart]: Date.now() }, () => cb({ success: true, type: 'trial' }));
                    }
                    return;
                }
                cb({ success: false, error: data.error || (res.ok ? null : `HTTP ${res.status}`) });
                return;
            } catch (e) {
                cb({ success: false, error: e.message || 'Network error' });
                return;
            }
        }

        cb({ success: false });
    })();
}

function getHeaders(subdomain, apiKey) {
    return { 'X-SUBDOMAIN': subdomain, 'X-AUTH-TOKEN': apiKey, 'Content-Type': 'application/json' };
}

// ── Rate-limited Current RMS API queue (avoids 429 across dashboards and background) ─
const CURRENT_RMS_MIN_GAP_MS = 260;
const CURRENT_RMS_MAX_CONCURRENT = 2;
const CURRENT_RMS_429_WAIT_MS = 2200;
const currentRmsQueue = [];
let currentRmsLastTime = 0;
let currentRmsInFlight = 0;

function processCurrentRmsQueue() {
    if (currentRmsQueue.length === 0 || currentRmsInFlight >= CURRENT_RMS_MAX_CONCURRENT) return;

    const gap = CURRENT_RMS_MIN_GAP_MS - (Date.now() - currentRmsLastTime);
    if (gap > 0) {
        setTimeout(processCurrentRmsQueue, gap);
        return;
    }

    const item = currentRmsQueue.shift();
    if (!item) return;

    currentRmsInFlight++;
    currentRmsLastTime = Date.now();

    (async () => {
        let settings;
        try {
            settings = await new Promise(r => chrome.storage.sync.get(['subdomain', 'apiKey'], r));
        } catch (e) {
            currentRmsInFlight--;
            item.reject(e);
            processCurrentRmsQueue();
            return;
        }
        if (!settings.subdomain || !settings.apiKey) {
            currentRmsInFlight--;
            item.reject(new Error('not_configured'));
            processCurrentRmsQueue();
            return;
        }

        const headers = getHeaders(settings.subdomain, settings.apiKey);
        try {
            let res = await fetch(item.url, { method: 'GET', headers });
            if (res.status === 429) {
                await new Promise(r => setTimeout(r, CURRENT_RMS_429_WAIT_MS));
                res = await fetch(item.url, { method: 'GET', headers });
            }
            if (res.status === 429) {
                await new Promise(r => setTimeout(r, CURRENT_RMS_429_WAIT_MS * 1.5));
                res = await fetch(item.url, { method: 'GET', headers });
            }
            if (!res.ok) {
                const msg = res.status === 429 ? 'API 429 — Too many requests. Try again in a moment.' : 'API ' + res.status;
                item.reject(new Error(msg));
                currentRmsInFlight--;
                processCurrentRmsQueue();
                return;
            }
            const data = await res.json();
            item.resolve(data);
        } catch (e) {
            item.reject(e);
        } finally {
            currentRmsInFlight--;
            processCurrentRmsQueue();
        }
    })();
}

function enqueueCurrentRmsFetch(url) {
    return new Promise((resolve, reject) => {
        currentRmsQueue.push({ url, resolve, reject });
        processCurrentRmsQueue();
    });
}

// ── Auto-create "Ready for prep" custom field in Current RMS (global field, data per quote) ─
const READY_TO_PREP_CACHE_KEY = 'rms_ready_to_prep_field_key';
const READY_TO_PREP_FIELD_NAME = 'Ready for prep date';
const READY_TO_PREP_GROUP_NAME = 'RMS Multitool';

function normaliseOpportunityCustomFields(raw, fieldKey, customFieldId) {
    function isArrayLike(obj) {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
        const values = Object.values(obj);
        return values.length > 0 && values.every(function (v) { return typeof v === 'object' && v !== null && (v.value !== undefined || v.custom_field_id !== undefined || v.document_layout_name !== undefined || v.custom_field != null); });
    }
    function addItem(cf, v) {
        if (!v) return;
        const sub = v.custom_field;
        const rawK = v.document_layout_name || v.custom_field_key || v.key || (sub && (sub.document_layout_name || sub.custom_field_key || sub.key));
        const displayK = v.name || v.field_name || (sub && (sub.name || sub.field_name));
        function nk(s) { return s == null || typeof s !== 'string' ? s : s.toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_').trim(); }
        const k = rawK != null ? rawK : (displayK != null ? nk(displayK) : null);
        const val = v.value;
        if (k != null && val !== undefined) cf[k] = val;
        else if (customFieldId != null && v.custom_field_id != null && Number(v.custom_field_id) === Number(customFieldId) && val !== undefined) cf[fieldKey] = val;
    }
    const list = Array.isArray(raw) ? raw : (isArrayLike(raw) ? Object.values(raw) : null);
    if (list && list.length) {
        const cf = {};
        list.forEach(function (v) { addItem(cf, v); });
        if (fieldKey && customFieldId != null && (cf[fieldKey] == null || cf[fieldKey] === '')) {
            var byId = cf[String(customFieldId)] || cf[customFieldId];
            if (byId != null && byId !== '') cf[fieldKey] = byId;
        }
        return cf;
    }
    if (raw && typeof raw === 'object') {
        const cf = { ...raw };
        if (fieldKey && customFieldId != null && (cf[fieldKey] == null || cf[fieldKey] === '')) {
            var byId = cf[String(customFieldId)] || cf[customFieldId];
            if (byId != null && byId !== '') cf[fieldKey] = byId;
        }
        return cf;
    }
    return {};
}

async function ensureReadyToPrepCustomField(settings, headers) {
    const cached = await new Promise(r => chrome.storage.local.get([READY_TO_PREP_CACHE_KEY], o => r(o[READY_TO_PREP_CACHE_KEY])));
    if (cached) {
        if (typeof cached === 'object' && cached !== null && cached.fieldKey) return cached;
        var fieldKeyStr = typeof cached === 'string' ? cached : (cached && cached.fieldKey) || 'ready_for_prep_date';
        try {
            var cachedFields = await fetchAllPages('https://api.current-rms.com/api/v1/custom_fields', headers, 'custom_fields', 5);
            var existingCached = cachedFields.find(function (f) { return f.module_type === 'Opportunity' && (f.name === READY_TO_PREP_FIELD_NAME || (f.document_layout_name && String(f.document_layout_name).replace(/-/g, '_') === 'ready_for_prep_date')); });
            if (existingCached && existingCached.id != null) {
                var outCached = { fieldKey: existingCached.document_layout_name || fieldKeyStr, customFieldId: existingCached.id };
                await new Promise(r => chrome.storage.local.set({ [READY_TO_PREP_CACHE_KEY]: outCached }, r));
                return outCached;
            }
        } catch (e) { /* upgrade failed, use string cache */ }
        return { fieldKey: fieldKeyStr, customFieldId: undefined };
    }

    const allFields = await fetchAllPages('https://api.current-rms.com/api/v1/custom_fields', headers, 'custom_fields', 5);
    const existing = allFields.find(f => f.module_type === 'Opportunity' && (f.name === READY_TO_PREP_FIELD_NAME || (f.document_layout_name && String(f.document_layout_name).replace(/-/g, '_') === 'ready_for_prep_date')));
    if (existing && existing.document_layout_name) {
        const out = { fieldKey: existing.document_layout_name, customFieldId: existing.id };
        await new Promise(r => chrome.storage.local.set({ [READY_TO_PREP_CACHE_KEY]: out }, r));
        return out;
    }

    const groupsRes = await fetch('https://api.current-rms.com/api/v1/custom_field_groups?per_page=100', { method: 'GET', headers });
    const groupsData = await groupsRes.json();
    const groups = groupsData.custom_field_groups || [];
    let groupId = groups.find(g => g.name === READY_TO_PREP_GROUP_NAME)?.id;
    if (!groupId) {
        const createGroupRes = await fetch('https://api.current-rms.com/api/v1/custom_field_groups', {
            method: 'POST', headers,
            body: JSON.stringify({ custom_field_group: { name: READY_TO_PREP_GROUP_NAME, description: 'Used by RMS Multitool (e.g. warehouse dashboard).', sort_order: 999 } })
        });
        if (!createGroupRes.ok) throw new Error('Could not create custom field group');
        const groupJson = await createGroupRes.json();
        groupId = groupJson.custom_field_group?.id;
    }
    if (!groupId) throw new Error('Missing custom field group');

    const createFieldRes = await fetch('https://api.current-rms.com/api/v1/custom_fields', {
        method: 'POST', headers,
        body: JSON.stringify({
            custom_field: {
                name: READY_TO_PREP_FIELD_NAME,
                description: 'Date when this quote was marked ready for warehouse prep (set by RMS Multitool). Value is per quote.',
                module_type: 'Opportunity',
                field_type: 5,
                custom_field_group_id: groupId,
                sort_order: 1,
                settings: {}
            }
        })
    });
    if (!createFieldRes.ok) {
        const errText = await createFieldRes.text();
        throw new Error('Could not create custom field: ' + (errText || createFieldRes.status));
    }
    const fieldJson = await createFieldRes.json();
    const cf = fieldJson.custom_field;
    const fieldKey = cf?.document_layout_name || 'ready_for_prep_date';
    const out = { fieldKey, customFieldId: cf?.id };
    await new Promise(r => chrome.storage.local.set({ [READY_TO_PREP_CACHE_KEY]: out }, r));
    return out;
}

async function fetchAllPages(baseUrl, headers, key, maxPages) {
    maxPages = maxPages || 20;
    let all = [];
    for (let page = 1; page <= maxPages; page++) {
        const sep = baseUrl.includes('?') ? '&' : '?';
        const url = `${baseUrl}${sep}per_page=100&page=${page}`;
        try {
            const res = await fetch(url, { method: 'GET', headers });
            if (!res.ok) break;
            const data = await res.json();
            const items = data[key] || [];
            all = all.concat(items);
            if (items.length < 100) break;
        } catch (e) { break; }
    }
    return all;
}

// ── Two-phase commitment cache ───────────────────────────────
// Phase 1 (firm): orders + reserved quotes → affects availability numbers
// Phase 2 (soft): open/provisional quotes → tooltip info only, loads in background
let commitmentCache = {};
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
let buildingCache = {}; // lock to prevent duplicate builds

async function getCommitments(startDate, endDate, currentOppId, headers) {
    const cacheKey = `${startDate}|${endDate}|${currentOppId || ''}`;
    const cached = commitmentCache[cacheKey];
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
        return cached.productStoreMap;
    }

    // If already building, wait for it
    if (buildingCache[cacheKey]) {
        await buildingCache[cacheKey];
        const c = commitmentCache[cacheKey];
        if (c) return c.productStoreMap;
    }

    let resolveBuild;
    buildingCache[cacheKey] = new Promise(r => resolveBuild = r);
    const t0 = Date.now();

    // 1) Get all overlapping opportunities (single paginated call)
    const oppsUrl = `https://api.current-rms.com/api/v1/opportunities` +
        `?q[starts_at_lteq]=${encodeURIComponent(endDate)}` +
        `&q[ends_at_gteq]=${encodeURIComponent(startDate)}` +
        `&filtermode=all`;
    let allOpps = await fetchAllPages(oppsUrl, headers, 'opportunities', 10);

    // Only include opportunities that have dates and overlap the current quote's range
    const rangeStart = new Date(startDate), rangeEnd = new Date(endDate);
    allOpps = allOpps.filter(o => {
        if (!o.starts_at || !o.ends_at) return false;
        const oStart = new Date(o.starts_at), oEnd = new Date(o.ends_at);
        return oStart <= rangeEnd && oEnd >= rangeStart;
    });

    // Current RMS: state 1=draft, 2=provisional, 3=reserved, 4=order
    const firmOpps = allOpps.filter(o => {
        if (currentOppId && String(o.id) === String(currentOppId)) return false;
        return o.state === 4 || (o.state === 3 && parseInt(o.status) === 60);
    });
    const softOpps = allOpps.filter(o => {
        if (currentOppId && String(o.id) === String(currentOppId)) return false;
        return o.state === 1 || o.state === 2;
    });

    console.log(`[BG] Opps: ${firmOpps.length} firm, ${softOpps.length} soft (${Date.now() - t0}ms)`);

    const productStoreMap = {};

    function processItems(items, opp, category) {
        const sid = opp.store_id;
        const subj = (opp.subject || `Opp #${opp.id}`).substring(0, 50);
        for (const item of items) {
            const iid = item.item_id;
            if (!iid) continue;
            const qty = parseFloat(item.quantity) || 0;
            if (qty <= 0) continue;
            if (item.starts_at && item.ends_at) {
                if (new Date(item.ends_at) <= rangeStart || new Date(item.starts_at) >= rangeEnd) continue;
            }
            if (!productStoreMap[iid]) productStoreMap[iid] = {};
            if (!productStoreMap[iid][sid]) productStoreMap[iid][sid] = { booked: 0, reserved: 0, quoted: 0, jobs: [] };
            productStoreMap[iid][sid][category] += qty;
            productStoreMap[iid][sid].jobs.push({ name: subj, qty, state: category, oppId: opp.id });
        }
    }

    // 2) Fetch ALL firm opps in parallel (no batching delay — typically ≤15 calls)
    await Promise.all(firmOpps.map(async opp => {
        try {
            const res = await fetch(`https://api.current-rms.com/api/v1/opportunities/${opp.id}?include[]=opportunity_items`, { method: 'GET', headers });
            if (!res.ok) return;
            const data = await res.json();
            processItems(data.opportunity?.opportunity_items || [], opp, opp.state === 4 ? 'booked' : 'reserved');
        } catch (e) { /* skip */ }
    }));

    console.log(`[BG] Firm done in ${Date.now() - t0}ms — products: ${Object.keys(productStoreMap).length}`);

    // Cache immediately so tags can render
    commitmentCache[cacheKey] = { productStoreMap, timestamp: Date.now(), softLoaded: false };
    resolveBuild();
    delete buildingCache[cacheKey];

    // 3) Fetch soft opps in background (non-blocking)
    if (softOpps.length > 0) {
        (async () => {
            const BATCH = 15;
            for (let i = 0; i < softOpps.length; i += BATCH) {
                await Promise.all(softOpps.slice(i, i + BATCH).map(async opp => {
                    try {
                        const res = await fetch(`https://api.current-rms.com/api/v1/opportunities/${opp.id}?include[]=opportunity_items`, { method: 'GET', headers });
                        if (!res.ok) return;
                        const data = await res.json();
                        processItems(data.opportunity?.opportunity_items || [], opp, 'quoted');
                    } catch (e) { /* skip */ }
                }));
                if (i + BATCH < softOpps.length) await new Promise(r => setTimeout(r, 1500));
            }
            if (commitmentCache[cacheKey]) commitmentCache[cacheKey].softLoaded = true;
            console.log(`[BG] Soft done — total products: ${Object.keys(productStoreMap).length}`);
        })();
    } else {
        if (commitmentCache[cacheKey]) commitmentCache[cacheKey].softLoaded = true;
    }

    return productStoreMap;
}

// ── Message handler ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Rate-limited Current RMS GET — dashboards use this to avoid 429
    if (request.action === 'currentRmsFetch' && request.url && request.url.indexOf('api.current-rms.com') !== -1) {
        const SEND_RESPONSE_TIMEOUT_MS = 55000;
        let responded = false;
        function once(response) {
            if (responded) return;
            responded = true;
            try { sendResponse(response); } catch (e) { /* channel already closed */ }
        }
        const timeoutId = setTimeout(() => once({ success: false, error: 'Request timed out' }), SEND_RESPONSE_TIMEOUT_MS);
        enqueueCurrentRmsFetch(request.url)
            .then(data => { clearTimeout(timeoutId); once({ success: true, data }); })
            .catch(err => { clearTimeout(timeoutId); once({ success: false, error: (err && err.message) || String(err) }); });
        return true;
    }
    if (request.action === 'openTab' && request.url) {
        chrome.tabs.create({ url: request.url }, function () {
            sendResponse(typeof chrome.runtime.lastError === 'undefined' ? { success: true } : { success: false });
        });
        return true;
    }
    if (request.action === 'getLicenseStatus') {
        getLicenseStatus(sendResponse);
        return true;
    }
    if (request.action === 'validateLicenseCode') {
        validateLicenseCode(request.code, sendResponse);
        return true;
    }
    // Dev: set license state to "after 7-day trial" so you can test Lemon Squeezy validation from the popup.
    // From a Current RMS page console: chrome.runtime.sendMessage(chrome.runtime.id, { action: 'devSetTrialExpired' }, r => console.log(r));
    if (request.action === 'devSetTrialExpired') {
        const trialStart = Date.now() - (TRIAL_DAYS + 1) * 24 * 60 * 60 * 1000;
        chrome.storage.local.set({ [LICENSE_KEYS.unlocked]: false, [LICENSE_KEYS.trialStart]: trialStart }, () => sendResponse({ ok: true }));
        return true;
    }
    if (request.action === 'fetchStock') {
        chrome.storage.sync.get(['subdomain', 'apiKey', 'storeConfig'], (settings) => {
            if (!settings.apiKey || !settings.subdomain) { sendResponse({ success: false, error: 'not_configured' }); return; }
            const ids = Object.entries(settings.storeConfig || {}).filter(([, c]) => c.enabled).map(([id]) => parseInt(id));
            if (!ids.length) { sendResponse({ success: false, error: 'no_stores' }); return; }

            fetch(`https://api.current-rms.com/api/v1/stock_levels?q[item_id_eq]=${request.productId}&per_page=200`,
                { method: 'GET', headers: getHeaders(settings.subdomain, settings.apiKey) })
            .then(r => r.json()).then(data => {
                const t = {}; ids.forEach(id => t[id] = 0);
                (data.stock_levels || []).forEach(sl => {
                    if (ids.includes(sl.store_id) && ![10,30,40].includes(sl.stock_category))
                        t[sl.store_id] += parseFloat(sl.quantity_held) || 0;
                });
                sendResponse({ success: true, stores: ids.map(id => ({ store_id: id, available: t[id] })) });
            }).catch(() => sendResponse({ success: false, stores: [] }));
        });
        return true;
    }

    if (request.action === 'fetchAvailability') {
        const { productId, startDate, endDate, currentOpportunityId, currentStoreId, currentStoreAvail } = request;
        chrome.storage.sync.get(['subdomain', 'apiKey', 'storeConfig'], async (settings) => {
            if (!settings.apiKey || !settings.subdomain) { sendResponse({ success: false, error: 'not_configured' }); return; }
            const ids = Object.entries(settings.storeConfig || {}).filter(([, c]) => c.enabled).map(([id]) => parseInt(id));
            if (!ids.length) { sendResponse({ success: false, error: 'no_stores' }); return; }
            const headers = getHeaders(settings.subdomain, settings.apiKey);

            try {
                // Parallel: stock levels + commitment cache
                const [stockData, commitments] = await Promise.all([
                    fetch(`https://api.current-rms.com/api/v1/stock_levels?q[item_id_eq]=${productId}&per_page=200`,
                        { method: 'GET', headers }).then(r => r.json()),
                    getCommitments(startDate, endDate, currentOpportunityId, headers)
                ]);

                const held = {}; ids.forEach(id => held[id] = 0);
                (stockData.stock_levels || []).forEach(sl => {
                    if (ids.includes(sl.store_id) && ![10,30,40].includes(sl.stock_category))
                        held[sl.store_id] += parseFloat(sl.quantity_held) || 0;
                });

                const pc = commitments[productId] || {};
                const results = ids.map(storeId => {
                    const c = pc[storeId] || { booked: 0, reserved: 0, quoted: 0, jobs: [] };
                    let net = held[storeId] - c.booked - c.reserved;
                    const useDom = currentStoreId && String(storeId) === String(currentStoreId)
                        && currentStoreAvail !== undefined && currentStoreAvail !== null;
                    if (useDom) net = parseFloat(currentStoreAvail);
                    return { store_id: storeId, held: held[storeId], booked: c.booked, reserved: c.reserved,
                             quoted: c.quoted, available: net, jobs: c.jobs, fromDom: !!useDom };
                });
                sendResponse({ success: true, stores: results });
            } catch (err) {
                console.error('[BG] fetchAvailability error:', err);
                sendResponse({ success: false, error: err.message, stores: [] });
            }
        });
        return true;
    }

    if (request.action === 'fetchOpportunity') {
        chrome.storage.sync.get(['subdomain', 'apiKey'], async (settings) => {
            if (!settings.apiKey || !settings.subdomain) { sendResponse({ success: false, error: 'not_configured' }); return; }
            try {
                const res = await fetch(`https://api.current-rms.com/api/v1/opportunities/${request.opportunityId}`,
                    { method: 'GET', headers: getHeaders(settings.subdomain, settings.apiKey) });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const opp = (await res.json()).opportunity || {};
                sendResponse({ success: true, opportunity: {
                    id: opp.id, subject: opp.subject, starts_at: opp.starts_at, ends_at: opp.ends_at,
                    store_id: opp.store_id, state: opp.state, status: opp.status
                }});
            } catch (err) { sendResponse({ success: false, error: err.message }); }
        });
        return true;
    }

    // Set "Ready for prep" date on this quote. Uses the global custom field (created automatically if missing); data is per quote for the dashboard.
    if (request.action === 'updateOpportunityReadyToPrep') {
        const OPP_PUT_WHITELIST = [
            'store_id', 'project_id', 'member_id', 'billing_address_id', 'venue_id', 'tax_class_id',
            'subject', 'description', 'number', 'starts_at', 'ends_at', 'charge_starts_at', 'charge_ends_at',
            'ordered_at', 'quote_invalid_at', 'state', 'use_chargeable_days', 'chargeable_days', 'open_ended_rental',
            'invoiced', 'rating', 'revenue', 'customer_collecting', 'customer_returning', 'reference',
            'external_description', 'delivery_instructions', 'owned_by',
            'prep_starts_at', 'prep_ends_at', 'load_starts_at', 'load_ends_at', 'deliver_starts_at', 'deliver_ends_at',
            'setup_starts_at', 'setup_ends_at', 'show_starts_at', 'show_ends_at',
            'takedown_starts_at', 'takedown_ends_at', 'collect_starts_at', 'collect_ends_at',
            'unload_starts_at', 'unload_ends_at', 'deprep_starts_at', 'deprep_ends_at',
            'tag_list', 'assigned_surcharge_group_ids', 'cancellation_reason_id', 'cancellation_description',
            'invoice_charge_total', 'custom_fields', 'participants'
        ];
        chrome.storage.sync.get(['subdomain', 'apiKey'], async (settings) => {
            if (!settings.apiKey || !settings.subdomain) { sendResponse({ success: false, error: 'not_configured' }); return; }
            try {
                const headers = getHeaders(settings.subdomain, settings.apiKey);
                const { fieldKey, customFieldId } = await ensureReadyToPrepCustomField(settings, headers);
                const getRes = await fetch(`https://api.current-rms.com/api/v1/opportunities/${request.opportunityId}`,
                    { method: 'GET', headers });
                if (!getRes.ok) throw new Error(`HTTP ${getRes.status}`);
                const json = await getRes.json();
                const opp = json.opportunity || {};
                const baseCf = normaliseOpportunityCustomFields(opp.custom_fields, fieldKey, customFieldId);
                const customFields = { ...baseCf, [fieldKey]: new Date().toISOString().slice(0, 10) };
                const putBody = {};
                OPP_PUT_WHITELIST.forEach(k => { if (opp.hasOwnProperty(k)) putBody[k] = opp[k]; });
                putBody.custom_fields = customFields;
                const putRes = await fetch(`https://api.current-rms.com/api/v1/opportunities/${request.opportunityId}`,
                    { method: 'PUT', headers, body: JSON.stringify({ opportunity: putBody }) });
                if (!putRes.ok) {
                    const errBody = await putRes.text();
                    await new Promise(r => chrome.storage.local.remove(READY_TO_PREP_CACHE_KEY, r));
                    throw new Error(`HTTP ${putRes.status}` + (errBody ? ': ' + errBody.slice(0, 200) : ''));
                }
                sendResponse({ success: true });
            } catch (err) { sendResponse({ success: false, error: err.message }); }
        });
        return true;
    }

    // Clear "Ready for prep" date on a quote (for testing: reset so button shows "Mark ready to prep" again).
    if (request.action === 'clearOpportunityReadyToPrep') {
        const OPP_PUT_WHITELIST = [
            'store_id', 'project_id', 'member_id', 'billing_address_id', 'venue_id', 'tax_class_id',
            'subject', 'description', 'number', 'starts_at', 'ends_at', 'charge_starts_at', 'charge_ends_at',
            'ordered_at', 'quote_invalid_at', 'state', 'use_chargeable_days', 'chargeable_days', 'open_ended_rental',
            'invoiced', 'rating', 'revenue', 'customer_collecting', 'customer_returning', 'reference',
            'external_description', 'delivery_instructions', 'owned_by',
            'prep_starts_at', 'prep_ends_at', 'load_starts_at', 'load_ends_at', 'deliver_starts_at', 'deliver_ends_at',
            'setup_starts_at', 'setup_ends_at', 'show_starts_at', 'show_ends_at',
            'takedown_starts_at', 'takedown_ends_at', 'collect_starts_at', 'collect_ends_at',
            'unload_starts_at', 'unload_ends_at', 'deprep_starts_at', 'deprep_ends_at',
            'tag_list', 'assigned_surcharge_group_ids', 'cancellation_reason_id', 'cancellation_description',
            'invoice_charge_total', 'custom_fields', 'participants'
        ];
        chrome.storage.sync.get(['subdomain', 'apiKey'], async (settings) => {
            if (!settings.apiKey || !settings.subdomain) { sendResponse({ success: false, error: 'not_configured' }); return; }
            try {
                const headers = getHeaders(settings.subdomain, settings.apiKey);
                const { fieldKey, customFieldId } = await ensureReadyToPrepCustomField(settings, headers);
                const getRes = await fetch(`https://api.current-rms.com/api/v1/opportunities/${request.opportunityId}`,
                    { method: 'GET', headers });
                if (!getRes.ok) throw new Error(`HTTP ${getRes.status}`);
                const json = await getRes.json();
                const opp = json.opportunity || {};
                const customFields = normaliseOpportunityCustomFields(opp.custom_fields, fieldKey, customFieldId);
                delete customFields[fieldKey];
                const putBody = {};
                OPP_PUT_WHITELIST.forEach(k => { if (opp.hasOwnProperty(k)) putBody[k] = opp[k]; });
                putBody.custom_fields = customFields;
                const putRes = await fetch(`https://api.current-rms.com/api/v1/opportunities/${request.opportunityId}`,
                    { method: 'PUT', headers, body: JSON.stringify({ opportunity: putBody }) });
                if (!putRes.ok) {
                    const errBody = await putRes.text();
                    throw new Error(`HTTP ${putRes.status}` + (errBody ? ': ' + errBody.slice(0, 200) : ''));
                }
                await new Promise(r => chrome.storage.local.remove(READY_TO_PREP_CACHE_KEY, r));
                sendResponse({ success: true });
            } catch (err) { sendResponse({ success: false, error: err.message }); }
        });
        return true;
    }

    // Book out all item_assets on an opportunity (set status_id to 4 = booked out). Used when "Loaded & Ready for Delivery" is clicked with the option enabled.
    if (request.action === 'bookOutOpportunityItemAssets') {
        const opportunityId = request.opportunityId;
        if (!opportunityId) { sendResponse({ success: false, error: 'missing_opportunity_id' }); return true; }
        chrome.storage.sync.get(['subdomain', 'apiKey'], async (settings) => {
            if (!settings.apiKey || !settings.subdomain) { sendResponse({ success: false, error: 'not_configured' }); return; }
            const headers = getHeaders(settings.subdomain, settings.apiKey);
            const BOOKED_OUT_STATUS_ID = 4;
            try {
                const getRes = await fetch(
                    `https://api.current-rms.com/api/v1/opportunities/${opportunityId}?include[]=item_assets&include[]=opportunity_items&include[]=opportunity_items.item_assets&include[]=supplier_item_assets`,
                    { method: 'GET', headers }
                );
                if (!getRes.ok) throw new Error('HTTP ' + getRes.status);
                const json = await getRes.json();
                const opp = json.opportunity || {};
                const supplierIds = new Set((opp.supplier_item_assets || []).map(a => a.id));
                const items = opp.opportunity_items || [];
                function isXHireOrLabour(it) {
                    if (!it) return false;
                    const typeName = (it.opportunity_item_type_name || it.transaction_type_name || '').toLowerCase();
                    const name = (it.name || '').toLowerCase();
                    const groupName = (it.product_group_name || it.item_group_name || (it.product_group && it.product_group.name) || '').toLowerCase();
                    const h = typeName + ' ' + name + ' ' + groupName;
                    if (/subhire|sub-hire|sub-rent|x-hire|cross hire/.test(h)) return true;
                    if (/labour|tty crew|crew/.test(h)) return true;
                    return false;
                }
                const skipItemIds = new Set(items.filter(isXHireOrLabour).map(it => it.id));
                const flatAssets = opp.item_assets || [];
                const hasNested = items.some(it => (it.item_assets || []).length > 0);
                const toUpdate = [];
                function addIfNotBooked(a) {
                    if (!a || !a.id) return;
                    if (supplierIds.has(a.id)) return;
                    if (a.opportunity_item_id != null && skipItemIds.has(a.opportunity_item_id)) return;
                    const statusId = a.status_id != null ? Number(a.status_id) : null;
                    if (statusId === BOOKED_OUT_STATUS_ID) return;
                    toUpdate.push(a.id);
                }
                if (flatAssets.length > 0) flatAssets.forEach(addIfNotBooked);
                else if (hasNested) items.forEach(it => (it.item_assets || []).forEach(addIfNotBooked));
                // Run PUTs in parallel in batches of 10 so it's much faster
                const BATCH = 10;
                let updated = 0;
                for (let i = 0; i < toUpdate.length; i += BATCH) {
                    const batch = toUpdate.slice(i, i + BATCH);
                    const results = await Promise.all(batch.map(async (assetId) => {
                        try {
                            const res = await fetch(`https://api.current-rms.com/api/v1/opportunity_item_assets/${assetId}`,
                                { method: 'PUT', headers, body: JSON.stringify({ opportunity_item_asset: { status_id: BOOKED_OUT_STATUS_ID } }) });
                            if (res.ok) return true;
                            const errText = await res.text();
                            console.warn('[RMS] bookOut item_asset', assetId, res.status, errText.slice(0, 200));
                            return false;
                        } catch (e) {
                            console.warn('[RMS] bookOut item_asset', assetId, e.message);
                            return false;
                        }
                    }));
                    updated += results.filter(Boolean).length;
                }
                sendResponse({ success: true, updated, total: toUpdate.length });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        });
        return true;
    }

    if (request.action === 'getOpportunityReadyToPrepState') {
        chrome.storage.sync.get(['subdomain', 'apiKey'], async (settings) => {
            if (!settings.apiKey || !settings.subdomain) {
                sendResponse({ success: false, hasReady: false, error: 'not_configured' });
                return;
            }
            try {
                const headers = getHeaders(settings.subdomain, settings.apiKey);
                const { fieldKey, customFieldId } = await ensureReadyToPrepCustomField(settings, headers);
                const getRes = await fetch(`https://api.current-rms.com/api/v1/opportunities/${request.opportunityId}`,
                    { method: 'GET', headers });
                if (!getRes.ok) throw new Error(`HTTP ${getRes.status}`);
                const json = await getRes.json();
                const opp = json.opportunity || {};
                const customFields = normaliseOpportunityCustomFields(opp.custom_fields, fieldKey, customFieldId);
                const value = customFields[fieldKey];
                const hasReady = value != null && value !== '';
                sendResponse({ success: true, fieldKey, hasReady, value });
            } catch (err) {
                sendResponse({ success: false, hasReady: false, error: err.message });
            }
        });
        return true;
    }

    if (request.action === 'prewarmCache') {
        chrome.storage.sync.get(['subdomain', 'apiKey'], async (settings) => {
            if (!settings.apiKey || !settings.subdomain) { sendResponse({ success: false }); return; }
            await getCommitments(request.startDate, request.endDate, request.currentOpportunityId,
                getHeaders(settings.subdomain, settings.apiKey));
            sendResponse({ success: true });
        });
        return true;
    }

    if (request.action === 'clearCache') {
        commitmentCache = {}; buildingCache = {};
        sendResponse({ success: true });
        return true;
    }

    if (request.action === 'getReadyToPrepFieldKey') {
        chrome.storage.sync.get(['subdomain', 'apiKey'], async (settings) => {
            if (!settings.apiKey || !settings.subdomain) { sendResponse({ success: false, fieldKey: null }); return; }
            try {
                const headers = getHeaders(settings.subdomain, settings.apiKey);
                const { fieldKey, customFieldId } = await ensureReadyToPrepCustomField(settings, headers);
                sendResponse({ success: true, fieldKey, customFieldId });
            } catch (e) { sendResponse({ success: false, fieldKey: null, error: e.message }); }
        });
        return true;
    }
});
