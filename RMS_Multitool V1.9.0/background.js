// background.js — RMS Multitool v1.8.0

// ── Re-inject content scripts into already-open tabs on install/update ──────
// Without this, users have to manually refresh every tab whenever the
// extension reloads or updates — Chrome won't do it automatically.
// We always re-inject (never rely on a stale page flag) because the old
// content script context is dead after a reload even if the flag is still set.
chrome.runtime.onInstalled.addListener(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://alvgroup.current-rms.com/*' });
    for (const tab of tabs) {
        try {
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['quote-mute.js'] });
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['public-holiday.js'] });
        } catch (e) {
            // Tab may not be injectable (e.g. internal Chrome pages) — silently skip
        }
    }
});

function getLicenseStatus(cb) {
    // All features permanently unlocked, no key required.
    cb({ allowed: true, unlocked: true, trialExpired: false, trialDaysLeft: null });
}

function validateLicenseCode(code, cb) {
    // Accept any code (or empty) and report success so the UI shows "Unlocked".
    cb({ success: true, type: 'unlock' });
}

function getHeaders(subdomain, apiKey) {
    return { 'X-SUBDOMAIN': subdomain, 'X-AUTH-TOKEN': apiKey, 'Content-Type': 'application/json' };
}

// ── Rate-limited Current RMS API queue (avoids 429 across dashboards and background) ─
// In-memory cache for event sheet PDF data (avoids chrome.storage.local quota limits)
let _pendingPdfData = null;

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

async function getCommitments(startDate, endDate, currentOppId, headers, useChargeDates) {
    const cacheKey = `${startDate}|${endDate}|${currentOppId || ''}|${useChargeDates ? 'charge' : 'event'}`;
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
        let oStart, oEnd;
        if (useChargeDates) {
            // When In Use mode is on:
            // - Prefer charge / hire dates if they exist
            // - Fall back to event start/end only when no charge dates are set
            const oppStartRaw = o.charge_starts_at || o.starts_at;
            const oppEndRaw   = o.charge_ends_at || o.ends_at;
            if (!oppStartRaw || !oppEndRaw) return false;
            oStart = new Date(oppStartRaw);
            oEnd   = new Date(oppEndRaw);
        } else {
            if (!o.starts_at || !o.ends_at) return false;
            oStart = new Date(o.starts_at);
            oEnd   = new Date(o.ends_at);
        }
        return oStart <= rangeEnd && oEnd >= rangeStart;
    });

    // Ignore Lost / Dead opportunities entirely (by state or status name)
    allOpps = allOpps.filter(o => {
        const statusStr = String(o.status_name || o.status_label || o.status || '').toLowerCase();
        const stateStr = String(o.state_name || o.state_label || '').toLowerCase();
        if (statusStr.indexOf('lost') !== -1 || statusStr.indexOf('dead') !== -1) return false;
        if (stateStr.indexOf('lost') !== -1 || stateStr.indexOf('dead') !== -1) return false;
        return true;
    });

    // Current RMS state mapping:
    //   State 1 = Draft/Provisional  → excluded entirely (don't show, don't count)
    //   State 2 = Reserved quote     → counts against availability, shown as Reserved
    //   State 3 = Booked/Order       → counts against availability, shown as Booked
    //   State 4 = Booked/Order       → counts against availability, shown as Booked

    const firmOpps = allOpps.filter(o => {
        if (currentOppId && String(o.id) === String(currentOppId)) return false;
        return o.state === 2 || o.state === 3 || o.state === 4;
    });
    const softOpps = []; // state 1 excluded entirely

    console.log(`[BG] Opps: ${firmOpps.length} firm (${Date.now() - t0}ms)`);

    const productStoreMap = {};

    function processItems(items, opp, category) {
        const sid = opp.store_id;
        const subj = (opp.subject || `Opp #${opp.id}`).substring(0, 50);
        for (const item of items) {
            const iid = item.item_id || item.product_id || item.rentable_id;
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
            processItems(data.opportunity?.opportunity_items || [], opp, opp.state === 2 ? 'reserved' : 'booked');
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

// ── Port keepalive handler ────────────────────────────────────
// delivery-sheet.js opens a 'pdf-render-keepalive' port before triggering
// renderPdfToImages. An open Port is Chrome's documented way to prevent MV3
// service workers from being suspended during long async operations.
chrome.runtime.onConnect.addListener(function (port) {
    // Nothing to do — keeping the connection open is enough.
    // The port will be disconnected automatically when delivery-sheet.js is done.
});

// ── Message handler ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Generic external GET (e.g. public holiday API) — no auth headers
    if (request.action === 'genericFetch' && request.url) {
        fetch(request.url, { headers: { 'Accept': 'application/json' } })
            .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
            .then(data => sendResponse({ success: true, data }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

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
    // Write (PUT/PATCH/POST) to Current RMS — used by quote-mute content script to avoid CORS
    if (request.action === 'currentRmsWrite' && request.url && request.url.indexOf('api.current-rms.com') !== -1) {
        let responded = false;
        function once(response) {
            if (responded) return;
            responded = true;
            try { sendResponse(response); } catch (e) { /* channel already closed */ }
        }
        const timeoutId = setTimeout(() => once({ success: false, error: 'Request timed out' }), 55000);
        (async () => {
            try {
                const settings = await new Promise(r => chrome.storage.sync.get(['subdomain', 'apiKey'], r));
                if (!settings.subdomain || !settings.apiKey) throw new Error('not_configured');
                const headers = getHeaders(settings.subdomain, settings.apiKey);
                const res = await fetch(request.url, {
                    method: request.method || 'PUT',
                    headers,
                    body: request.body || undefined
                });
                if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
                const data = await res.json();
                clearTimeout(timeoutId);
                once({ success: true, data });
            } catch (e) {
                clearTimeout(timeoutId);
                once({ success: false, error: (e && e.message) || String(e) });
            }
        })();
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
    // ── Fetch all items from a template job (for group import config) ──────────
    if (request.action === 'getTemplateGroups') {
        (async () => {
            try {
                const settings = await new Promise(r => chrome.storage.sync.get(['subdomain', 'apiKey'], r));
                if (!settings.subdomain || !settings.apiKey) throw new Error('not_configured');
                const headers = getHeaders(settings.subdomain, settings.apiKey);
                let allItems = [];
                let page = 1;
                while (true) {
                    const url = `https://api.current-rms.com/api/v1/opportunities/${request.oppId}/opportunity_items?per_page=100&page=${page}`;
                    const res = await fetch(url, { method: 'GET', headers });
                    if (!res.ok) throw new Error(`API ${res.status}`);
                    const data = await res.json();
                    const items = data.opportunity_items || [];
                    allItems = allItems.concat(items);
                    if (items.length < 100) break;
                    page++;
                }
                // Groups: opportunity_item_type === 0, or name "Group", or no item_id and no transaction_type
                // (line items always have an item_id; groups/text items have item_id: null)
                const groups = allItems.filter(i => {
                    if (!i.name || !i.name.trim()) return false;
                    if (i.opportunity_item_type === 0) return true;
                    if (i.opportunity_item_type_name === 'Group') return true;
                    // Fallback: no product link and no transaction type = group or text item
                    if (!i.item_id && i.transaction_type === null) return true;
                    return false;
                });
                sendResponse({ success: true, items: groups });
            } catch (e) {
                sendResponse({ success: false, error: (e && e.message) || String(e) });
            }
        })();
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
        const { productId, startDate, endDate, currentOpportunityId, currentStoreId, currentStoreAvail, useChargeDates } = request;
        chrome.storage.sync.get(['subdomain', 'apiKey', 'storeConfig'], async (settings) => {
            if (!settings.apiKey || !settings.subdomain) { sendResponse({ success: false, error: 'not_configured' }); return; }
            const ids = Object.entries(settings.storeConfig || {}).filter(([, c]) => c.enabled).map(([id]) => parseInt(id));
            if (!ids.length) { sendResponse({ success: false, error: 'no_stores' }); return; }
            const headers = getHeaders(settings.subdomain, settings.apiKey);

            try {
                // Parallel: stock levels + commitment cache
                const [stockData, commitments] = await Promise.all([
                    fetch(`https://api.current-rms.com/api/v1/stock_levels?q[item_id_eq]=${productId}&per_page=200`,
                        { method: 'GET', headers }).then(r => {
                            if (!r.ok) throw new Error(`HTTP ${r.status} fetching stock levels`);
                            return r.json();
                        }),
                    getCommitments(startDate, endDate, currentOpportunityId, headers, !!useChargeDates)
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

    // ── Fetch full opportunity data for the Delivery Sheet generator ──────────
    if (request.action === 'fetchDeliverySheetData') {
        chrome.storage.sync.get(['subdomain', 'apiKey'], async (settings) => {
            if (!settings.apiKey || !settings.subdomain) { sendResponse({ success: false, error: 'not_configured' }); return; }
            try {
                const headers = getHeaders(settings.subdomain, settings.apiKey);
                const oppId = request.opportunityId;

                // Fetch opportunity with all relevant includes
                const oppRes = await fetch(
                    `https://api.current-rms.com/api/v1/opportunities/${oppId}` +
                    `?include[]=opportunity_items` +
                    `&include[]=participants` +
                    `&include[]=member` +
                    `&include[]=venue` +
                    `&opportunity_items_per_page=200`,
                    { method: 'GET', headers }
                );
                if (!oppRes.ok) throw new Error(`HTTP ${oppRes.status}`);
                const oppData = (await oppRes.json()).opportunity || {};

                // Normalise custom fields into a flat key→value map
                const rawCf = oppData.custom_fields;
                const customFields = {};
                if (rawCf) {
                    if (Array.isArray(rawCf)) {
                        rawCf.forEach(f => {
                            const key = (f.custom_field && f.custom_field.document_layout_name) || (f.custom_field && f.custom_field.name) || f.name;
                            if (key) customFields[key] = f.value;
                        });
                    } else if (typeof rawCf === 'object') {
                        Object.entries(rawCf).forEach(([k, v]) => {
                            const key = typeof v === 'object' && v !== null ? k : k;
                            const val = typeof v === 'object' && v !== null ? (v.value !== undefined ? v.value : v) : v;
                            customFields[key] = val;
                        });
                    }
                }

                // Extract participants
                const participants = oppData.participants || [];
                const organisation = participants.find(p => p.type === 'Organisation') || null;
                const contact = participants.find(p => p.type === 'Contact') || null;

                // Extract items (filter out muted)
                const rawItems = oppData.opportunity_items || [];
                const items = rawItems
                    .filter(item => {
                        const desc = item.description || '';
                        const name = item.name || '';
                        return !desc.includes('[MUTED') && !name.includes('*HIDE*');
                    })
                    .map(item => ({
                        id: item.id,
                        name: item.name,
                        quantity: item.quantity,
                        product_group_name: item.product_group_name,
                        item_group_name: item.item_group_name,
                        opportunity_item_type_name: item.opportunity_item_type_name,
                        is_group: item.opportunity_item_type_name === 'Group',
                        depth: item.depth || 0,
                        description: (item.description || '').replace(/\[MUTED[^\]]*\]/g, '').replace(/\[HIDEONLY\]/g, '').trim()
                    }));

                sendResponse({
                    success: true,
                    opportunity: {
                        id: oppData.id,
                        subject: oppData.subject,
                        number: oppData.number,
                        reference: oppData.reference,
                        starts_at: oppData.starts_at,
                        ends_at: oppData.ends_at,
                        charge_starts_at: oppData.charge_starts_at,
                        charge_ends_at: oppData.charge_ends_at,
                        document_date: oppData.document_date,
                        delivery_address_name: oppData.delivery_address_name,
                        delivery_address: oppData.delivery_address,
                        delivery_instructions: oppData.delivery_instructions,
                        state: oppData.state,
                        // Scheduling
                        prep_starts_at: oppData.prep_starts_at, prep_ends_at: oppData.prep_ends_at,
                        load_starts_at: oppData.load_starts_at, load_ends_at: oppData.load_ends_at,
                        deliver_starts_at: oppData.deliver_starts_at, deliver_ends_at: oppData.deliver_ends_at,
                        setup_starts_at: oppData.setup_starts_at, setup_ends_at: oppData.setup_ends_at,
                        show_starts_at: oppData.show_starts_at, show_ends_at: oppData.show_ends_at,
                        takedown_starts_at: oppData.takedown_starts_at, takedown_ends_at: oppData.takedown_ends_at,
                        collect_starts_at: oppData.collect_starts_at, collect_ends_at: oppData.collect_ends_at,
                        unload_starts_at: oppData.unload_starts_at, unload_ends_at: oppData.unload_ends_at,
                        deprep_starts_at: oppData.deprep_starts_at, deprep_ends_at: oppData.deprep_ends_at,
                        // Participants
                        organisation_name: organisation ? organisation.name : (oppData.member ? oppData.member.name : ''),
                        contact_name: contact ? contact.name : '',
                        contact_phone: contact ? (contact.telephone || '') : '',
                        contact_email: contact ? (contact.email || '') : '',
                        // Venue
                        venue_name: oppData.venue ? oppData.venue.name : (oppData.delivery_address_name || ''),
                        // Custom fields
                        custom_fields: customFields,
                        // Items
                        items
                    }
                });
            } catch (err) { sendResponse({ success: false, error: err.message }); }
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
                    id: opp.id,
                    subject: opp.subject,
                    starts_at: opp.starts_at,
                    ends_at: opp.ends_at,
                    charge_starts_at: opp.charge_starts_at,
                    charge_ends_at: opp.charge_ends_at,
                    store_id: opp.store_id,
                    state: opp.state,
                    status: opp.status,
                    document_date: opp.document_date,
                    created_at: opp.created_at
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
            await getCommitments(
                request.startDate,
                request.endDate,
                request.currentOpportunityId,
                getHeaders(settings.subdomain, settings.apiKey),
                !!request.useChargeDates
            );
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

    // Cache large PDF generation data in memory (avoids chrome.storage.local quota limits)
    if (request.action === 'cachePdfData') {
        _pendingPdfData = {
            html: request.html,
            filename: request.filename,
            sitePlanDataUrls: request.sitePlanDataUrls || []
        };
        sendResponse({ success: true });
        return true;
    }

    if (request.action === 'generatePdf') {
        (async () => {
            try {
                // If no HTML in the request, use the in-memory cache (preview page path)
                const src = (request.html) ? request : _pendingPdfData;
                if (!src || !src.html) throw new Error('No PDF data available — please reopen the preview.');
                const pdfUrls = src.sitePlanDataUrls || (src.sitePlanDataUrl ? [src.sitePlanDataUrl] : []);

                // Generate main event sheet PDF
                let mainBase64 = await htmlToPdfBase64(src.html);

                // Merge site plan PDFs (if any)
                if (pdfUrls.length) {
                    mainBase64 = await mergeAllPdfs(mainBase64, pdfUrls);
                }

                // Download the final PDF
                const filename = src.filename || request.filename;
                const dataUrl = 'data:application/pdf;base64,' + mainBase64;
                await new Promise((resolve, reject) => {
                    chrome.downloads.download({ url: dataUrl, filename: filename, saveAs: false }, (id) => {
                        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                        else resolve(id);
                    });
                });

                sendResponse({ success: true });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }
});

// ── PDF Generation via Chrome DevTools Protocol ───────────────────────────────

// Renders HTML in a hidden tab and returns the PDF as a base64 string.
// Does not merge or download — call mergeAllPdfs / chrome.downloads separately.
// options.margins — { top, bottom, left, right } in inches (default 0 — HTML handles its own spacing)
async function htmlToPdfBase64(html, options) {
    const tab = await new Promise((resolve, reject) => {
        chrome.tabs.create({ url: 'about:blank', active: false }, (t) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(t);
        });
    });
    const tabId = tab.id;
    let debuggerAttached = false;
    try {
        await new Promise((resolve, reject) => {
            chrome.debugger.attach({ tabId }, '1.3', () => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else { debuggerAttached = true; resolve(); }
            });
        });
        await new Promise(resolve => chrome.debugger.sendCommand({ tabId }, 'Page.enable', {}, resolve));
        // Enable lifecycle events so we can wait for networkIdle (all CSS + images loaded)
        await new Promise(resolve => chrome.debugger.sendCommand({ tabId }, 'Page.setLifecycleEventsEnabled', { enabled: true }, resolve));
        const frameTree = await new Promise(resolve => chrome.debugger.sendCommand({ tabId }, 'Page.getFrameTree', {}, resolve));
        const frameId = frameTree && frameTree.frameTree && frameTree.frameTree.frame && frameTree.frameTree.frame.id;

        // Wait for network idle (all external CSS + images fetched) rather than just load event.
        // This is critical for pull sheets that reference external stylesheets via relative URLs.
        const networkIdlePromise = new Promise(resolve => {
            let resolved = false;
            const handler = (source, method, params) => {
                if (source.tabId !== tabId) return;
                // networkIdle fires when there have been no network requests for 500ms
                if (method === 'Page.lifecycleEvent' && params && params.name === 'networkIdle' && !resolved) {
                    resolved = true;
                    chrome.debugger.onEvent.removeListener(handler);
                    resolve();
                }
            };
            chrome.debugger.onEvent.addListener(handler);
            // Safety fallback — resolve after 12 s regardless
            setTimeout(() => { if (!resolved) { resolved = true; resolve(); } }, 12000);
        });

        await new Promise((resolve, reject) => {
            chrome.debugger.sendCommand({ tabId }, 'Page.setDocumentContent', { frameId, html }, () => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve();
            });
        });
        await networkIdlePromise;
        await new Promise(resolve => setTimeout(resolve, 500)); // brief settle after network idle
        const m = (options && options.margins) || {};
        const pdfResult = await new Promise((resolve, reject) => {
            chrome.debugger.sendCommand({ tabId }, 'Page.printToPDF', {
                paperWidth: 8.2677, paperHeight: 11.6929,
                printBackground: true,
                marginTop:    m.top    != null ? m.top    : 0,
                marginBottom: m.bottom != null ? m.bottom : 0,
                marginLeft:   m.left   != null ? m.left   : 0,
                marginRight:  m.right  != null ? m.right  : 0
            }, (result) => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve(result);
            });
        });
        await new Promise(resolve => chrome.debugger.detach({ tabId }, () => { chrome.runtime.lastError; debuggerAttached = false; resolve(); }));
        return pdfResult.data; // base64 string
    } finally {
        if (debuggerAttached) {
            await new Promise(r => chrome.debugger.detach({ tabId }, () => { chrome.runtime.lastError; r(); }));
        }
        await new Promise(r => chrome.tabs.remove(tabId, () => { chrome.runtime.lastError; r(); }));
    }
}

// Legacy wrapper — kept for compatibility with any direct callers.
async function generatePdfFromHtml(html, filename, sitePlanDataUrls) {
    let pdfBase64 = await htmlToPdfBase64(html);
    if (sitePlanDataUrls && sitePlanDataUrls.length) {
        pdfBase64 = await mergeAllPdfs(pdfBase64, sitePlanDataUrls);
    }
    const dataUrl = 'data:application/pdf;base64,' + pdfBase64;
    await new Promise((resolve, reject) => {
        chrome.downloads.download({ url: dataUrl, filename: filename, saveAs: false }, (id) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(id);
        });
    });
}

// ── pdf-lib script cache ───────────────────────────────────────────────────────
// pdf-lib is a pure-JS PDF manipulation library (~900 KB). Used to append the
// site plan PDF pages to the generated event sheet PDF — no Web Workers needed,
// completes in a few seconds rather than the 90 s that PDF.js rendering needed.
// Cached in chrome.storage.local after the first download.
const PDFLIB_VERSION = '1.17.1';
let _pdflibMemCache = null;

async function getPdfLibScript() {
    if (_pdflibMemCache) return _pdflibMemCache;
    const stored = await new Promise(r =>
        chrome.storage.local.get(['_pdflib_ver', '_pdflib_main'], r));
    if (stored._pdflib_ver === PDFLIB_VERSION && stored._pdflib_main) {
        _pdflibMemCache = stored._pdflib_main;
        return _pdflibMemCache;
    }
    const code = await fetch('https://cdn.jsdelivr.net/npm/pdf-lib@' + PDFLIB_VERSION + '/dist/pdf-lib.min.js')
        .then(r => { if (!r.ok) throw new Error('pdf-lib HTTP ' + r.status); return r.text(); });
    _pdflibMemCache = code;
    chrome.storage.local.set({ _pdflib_ver: PDFLIB_VERSION, _pdflib_main: code });
    return _pdflibMemCache;
}

// Safe JSON-stringify for embedding inside a <script> block — escapes </ so the
// browser parser can't mistake it for a closing </script> tag.
function scriptJson(v) { return JSON.stringify(v).replace(/<\//g, '<\\/'); }

// ── PDF site-plan merge via CDP + pdf-lib ──────────────────────────────────────
// Appends pages from all site plan PDFs to the event sheet in a single CDP session.
// pdf-lib is pure JS with no Web Workers — runs in a throwaway about:blank tab.
async function mergeAllPdfs(eventSheetBase64, sitePlanDataUrls) {
    const pdflibCode = await getPdfLibScript();

    const tab = await new Promise((resolve, reject) => {
        chrome.tabs.create({ url: 'about:blank', active: false }, (t) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(t);
        });
    });
    const tabId = tab.id;
    let debuggerAttached = false;

    try {
        await new Promise((resolve, reject) => {
            chrome.debugger.attach({ tabId }, '1.3', () => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else { debuggerAttached = true; resolve(); }
            });
        });

        // Inject pdf-lib
        const ev1 = await new Promise((resolve, reject) =>
            chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
                expression: pdflibCode + ';\ntypeof window.PDFLib;',
                returnByValue: true
            }, (r) => { if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve(r); }));
        if (!ev1 || ev1.result.value !== 'object') {
            throw new Error('pdf-lib injection failed: type=' + (ev1 && ev1.result && ev1.result.value));
        }

        // Store event sheet base64
        await new Promise((resolve, reject) =>
            chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
                expression: 'window.__ep=' + scriptJson(eventSheetBase64) + ';1;',
                returnByValue: true
            }, (r) => { if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve(r); }));

        // Store each site plan data URL individually to keep expressions manageable
        for (let i = 0; i < sitePlanDataUrls.length; i++) {
            await new Promise((resolve, reject) =>
                chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
                    expression: 'window.__sp' + i + '=' + scriptJson(sitePlanDataUrls[i]) + ';1;',
                    returnByValue: true
                }, (r) => { if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve(r); }));
        }

        // Merge all site plans into the event sheet in one async pass
        const mergeExpr = [
            '(async function(){',
            '  try{',
            '    var PD=window.PDFLib.PDFDocument;',
            '    var eb=Uint8Array.from(atob(window.__ep),function(c){return c.charCodeAt(0);});',
            '    var ed=await PD.load(eb);',
            '    var count=' + sitePlanDataUrls.length + ';',
            '    for(var i=0;i<count;i++){',
            '      var sp=window["__sp"+i];',
            '      var sb64=sp.split(",")[1];',
            '      var sb=Uint8Array.from(atob(sb64),function(c){return c.charCodeAt(0);});',
            '      var sd=await PD.load(sb);',
            '      var n=sd.getPageCount();',
            '      var pgs=await ed.copyPages(sd,Array.from({length:n},function(_,j){return j;}));',
            '      pgs.forEach(function(p){ed.addPage(p);});',
            '    }',
            '    var out=await ed.save();',
            '    var s="",u=new Uint8Array(out);',
            '    for(var i=0;i<u.length;i+=8192)s+=String.fromCharCode.apply(null,u.subarray(i,i+8192));',
            '    return btoa(s);',
            '  }catch(e){throw new Error("merge: "+e.message);}',
            '})();'
        ].join('');

        const mergeResult = await new Promise((resolve, reject) => {
            const killTimer = setTimeout(() => reject(new Error('PDF merge timed out after 60 s')), 60000);
            chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
                expression: mergeExpr,
                returnByValue: true,
                awaitPromise: true
            }, (result) => {
                clearTimeout(killTimer);
                if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
                if (result && result.exceptionDetails) {
                    const ex = result.exceptionDetails;
                    reject(new Error((ex.exception && ex.exception.description) || ex.text || 'merge error'));
                    return;
                }
                resolve(result && result.result && result.result.value);
            });
        });

        if (!mergeResult) throw new Error('PDF merge returned empty result');
        return mergeResult;

    } finally {
        if (debuggerAttached) {
            try { await new Promise(r => chrome.debugger.detach({ tabId }, () => { chrome.runtime.lastError; r(); })); } catch (_) {}
        }
        try { await new Promise(r => chrome.tabs.remove(tabId, () => { chrome.runtime.lastError; r(); })); } catch (_) {}
    }
}
