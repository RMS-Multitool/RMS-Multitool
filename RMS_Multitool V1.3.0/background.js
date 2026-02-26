// background.js — RMS Multitool v1.3.0 (speed-optimized)

function getHeaders(subdomain, apiKey) {
    return { 'X-SUBDOMAIN': subdomain, 'X-AUTH-TOKEN': apiKey, 'Content-Type': 'application/json' };
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
    const allOpps = await fetchAllPages(oppsUrl, headers, 'opportunities', 10);

    const firmOpps = allOpps.filter(o => {
        if (currentOppId && String(o.id) === String(currentOppId)) return false;
        return o.state === 2 || (o.state === 3 && parseInt(o.status) === 60);
    });
    const softOpps = allOpps.filter(o => {
        if (currentOppId && String(o.id) === String(currentOppId)) return false;
        if (o.state === 3) { const s = parseInt(o.status); return s === 0 || s === 20; }
        return false;
    });

    console.log(`[BG] Opps: ${firmOpps.length} firm, ${softOpps.length} soft (${Date.now() - t0}ms)`);

    const productStoreMap = {};
    const rangeStart = new Date(startDate), rangeEnd = new Date(endDate);

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
            processItems(data.opportunity?.opportunity_items || [], opp, opp.state === 2 ? 'booked' : 'reserved');
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
});
