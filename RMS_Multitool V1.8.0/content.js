// content.js — RMS Multitool v1.8.0

// ── Safe message helper ──────────────────────────────────────────────────────
// Wraps chrome.runtime.sendMessage so that if the extension context becomes
// invalid (e.g. after an update), calls fail silently instead of throwing.
function safeSendMessage(msg, callback) {
    try {
        chrome.runtime.sendMessage(msg, function (response) {
            if (chrome.runtime.lastError) {
                // Context invalidated or no listener — call back with null
                if (callback) callback(null);
                return;
            }
            if (callback) callback(response);
        });
    } catch (e) {
        if (callback) callback(null);
    }
}

let storeNames = {};
let stockMode = 'simple';
let cachedOppData = null;
let prewarmStarted = false;
let dateAwareInUseOnly = false;
let featureFlags = { deliverySheet: true, quoteDashboard: true, crewDashboard: true, warehouseDashboard: true, quoteMute: true };

function isFeatureOn(feature) {
    return featureFlags[feature] !== false;
}

chrome.storage.sync.get(['storeConfig', 'stockMode', 'dateAwareInUseOnly', 'featureFlags'], (result) => {
    if (result.storeConfig) {
        Object.entries(result.storeConfig).forEach(([id, cfg]) => {
            if (cfg.name) storeNames[parseInt(id)] = cfg.name;
        });
    }
    if (result.stockMode) stockMode = result.stockMode;
    if (typeof result.dateAwareInUseOnly === 'boolean') dateAwareInUseOnly = result.dateAwareInUseOnly;
    if (result.featureFlags) featureFlags = Object.assign(featureFlags, result.featureFlags);

    refreshFeatureVisibility();
    if (stockMode === 'date-aware') tryPrewarm();
});

// Listen for live updates from popup
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'featureFlagsUpdated') {
        if (msg.flags) featureFlags = Object.assign(featureFlags, msg.flags);
        refreshFeatureVisibility();
    }
    if (msg.type === 'templateConfigUpdated') {
        // Refresh visibility of import buttons on the page
        chrome.storage.local.get(['templateGroupConfig'], function (r) {
            const hasGroups = r.templateGroupConfig && r.templateGroupConfig.some(g => g.enabled);
            document.querySelectorAll('.rms-import-groups-btn').forEach(btn => {
                btn.style.display = hasGroups ? '' : 'none';
            });
        });
    }
});

function refreshFeatureVisibility() {
    document.querySelectorAll('.rms-multitool-delivery-sheet-btn').forEach(btn => {
        btn.style.display = isFeatureOn('deliverySheet') ? '' : 'none';
    });
}

chrome.storage.onChanged.addListener((changes) => {
    if (changes.stockMode) {
        stockMode = changes.stockMode.newValue || 'simple';
        document.querySelectorAll('.multi-store-stock').forEach(el => el.remove());
        cachedOppData = null;
        prewarmStarted = false;
        safeSendMessage({ action: 'clearCache' });
        scanAndInject();
    }
    if (changes.dateAwareInUseOnly) {
        dateAwareInUseOnly = !!changes.dateAwareInUseOnly.newValue;
        cachedOppData = null;
        prewarmStarted = false;
        safeSendMessage({ action: 'clearCache' });
        if (stockMode === 'date-aware') scanAndInject();
    }
    if (changes.storeConfig && changes.storeConfig.newValue) {
        storeNames = {};
        Object.entries(changes.storeConfig.newValue).forEach(([id, cfg]) => {
            if (cfg.name) storeNames[parseInt(id)] = cfg.name;
        });
    }
});

// ── Pre-warm: start building commitment cache on page load ───
function tryPrewarm() {
    if (prewarmStarted || stockMode !== 'date-aware') return;
    const oppId = getOpportunityIdFromUrl();
    if (!oppId) return;

    prewarmStarted = true;
    try { chrome.storage.local.set({ wh_last_opp_id: oppId }); } catch (_) {}
    // Fetch opp data and immediately start cache build
    safeSendMessage({ action: 'fetchOpportunity', opportunityId: oppId }, (resp) => {
        if (resp && resp.success && resp.opportunity) {
            cachedOppData = resp.opportunity;
            const useCharge = !!dateAwareInUseOnly;
            const start = useCharge && cachedOppData.charge_starts_at ? cachedOppData.charge_starts_at : cachedOppData.starts_at;
            const end   = useCharge && cachedOppData.charge_ends_at ? cachedOppData.charge_ends_at : cachedOppData.ends_at;
            if (start && end) {
                safeSendMessage({
                    action: 'prewarmCache',
                    startDate: start,
                    endDate: end,
                    currentOpportunityId: cachedOppData.id,
                    useChargeDates: useCharge
                });
            }
        }
    });
}

function getOpportunityIdFromUrl() {
    const m = window.location.pathname.match(/\/opportunities\/(\d+)/);
    return m ? m[1] : null;
}

function isOpportunityPrimaryPage() {
    // Avoid injecting UI into print/PDF/document pages that also contain /opportunities/<id> in the path
    const p = window.location.pathname;
    return /^\/opportunities\/\d+\/?$/.test(p) || /^\/opportunities\/\d+\/edit\/?$/.test(p);
}

function isOpportunityViewPage() {
    // View page only — excludes the edit form
    return /^\/opportunities\/\d+\/?$/.test(window.location.pathname);
}

function getOpportunityData(callback) {
    if (cachedOppData) { callback(cachedOppData); return; }
    const oppId = getOpportunityIdFromUrl();
    if (!oppId) { callback(null); return; }
    safeSendMessage({ action: 'fetchOpportunity', opportunityId: oppId }, (resp) => {
        if (resp && resp.success && resp.opportunity) cachedOppData = resp.opportunity;
        callback(cachedOppData);
    });
}

function readDomAvailability(rowElement) {
    const span = rowElement.querySelector('.item-available') || rowElement.querySelector('.item-shortage');
    if (span) { const v = parseFloat(span.textContent.trim()); if (!isNaN(v)) return v; }
    return null;
}

function injectStyles() {
    if (document.querySelector('#rms-multitool-avail-style')) return;
    const s = document.createElement('style');
    s.id = 'rms-multitool-avail-style';
    s.textContent = `
        .rms-avail-tooltip{display:none;position:fixed;z-index:99999;background:#1a1a24;border:1px solid #2a2a35;border-radius:8px;padding:10px 12px;min-width:220px;max-width:340px;box-shadow:0 8px 24px rgba(0,0,0,0.5);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11px;color:#e0e0e8;pointer-events:none}
        .rms-avail-tooltip.show{display:block}
        .rms-avail-tooltip .tt-title{font-weight:700;font-size:11px;color:#00e5a0;margin-bottom:6px;border-bottom:1px solid #2a2a35;padding-bottom:5px}
        .rms-avail-tooltip .tt-row{display:flex;justify-content:space-between;padding:2px 0;color:#a0a0b0;gap:12px}
        .rms-avail-tooltip .tt-row.booked{color:#ff4d6a} .rms-avail-tooltip .tt-row.reserved{color:#ffaa2a} .rms-avail-tooltip .tt-row.quoted{color:#6bb8ff}
        .rms-avail-tooltip .tt-job-name{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .multi-store-stock{font-size:0.85em;margin-top:6px;font-weight:bold;line-height:1.4}
        .avail-tag{display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;margin:1px 2px 1px 0;cursor:default;line-height:1.6}
        .avail-tag.green{background:rgba(0,200,100,0.13);color:#00c864;border:1px solid rgba(0,200,100,0.25)}
        .avail-tag.orange{background:rgba(255,170,42,0.13);color:#ffaa2a;border:1px solid rgba(255,170,42,0.25)}
        .avail-tag.red{background:rgba(255,77,106,0.13);color:#ff4d6a;border:1px solid rgba(255,77,106,0.25)}
        .avail-tag.blue{background:rgba(107,184,255,0.13);color:#6bb8ff;border:1px solid rgba(107,184,255,0.25)}
        .avail-tag.grey{background:rgba(160,160,176,0.1);color:#a0a0b0;border:1px solid rgba(160,160,176,0.2)}
    `;
    document.head.appendChild(s);
}

let tooltipEl = null;
function ensureTooltip() {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'rms-avail-tooltip';
    document.body.appendChild(tooltipEl);
    return tooltipEl;
}

function attachTooltip(tagEl, store) {
    if (!store.jobs || store.jobs.length === 0) return;
    tagEl.style.cursor = 'pointer';
    tagEl.addEventListener('mouseenter', () => {
        const tip = ensureTooltip();
        const name = storeNames[store.store_id] || `Store ${store.store_id}`;
        // Group by quote (oppId or name) and sum quantities
        const byQuote = {};
        store.jobs.forEach(j => {
            const key = j.oppId != null ? String(j.oppId) : (j.name || '');
            if (!byQuote[key]) byQuote[key] = { name: j.name || 'Unknown', qty: 0, state: j.state };
            byQuote[key].qty += parseFloat(j.qty) || 0;
            if (j.state === 'booked' || (j.state === 'reserved' && byQuote[key].state !== 'booked') || (j.state === 'quoted' && byQuote[key].state !== 'booked' && byQuote[key].state !== 'reserved'))
                byQuote[key].state = j.state;
        });
        const grouped = Object.values(byQuote);
        let rows = '';
        grouped.forEach(j => {
            const cls = j.state === 'booked' ? 'booked' : j.state === 'reserved' ? 'reserved' : 'quoted';
            const lbl = j.state === 'booked' ? '⬤ Booked' : j.state === 'reserved' ? '◉ Reserved' : '○ Provisional';
            rows += `<div class="tt-row ${cls}"><span class="tt-job-name">${esc(j.name)}</span><span>×${Math.round(j.qty)} ${lbl}</span></div>`;
        });
        tip.innerHTML = `
            <div class="tt-title">${esc(name)} — ${store.held} held</div>
            ${rows}
            <div class="tt-row" style="margin-top:4px;border-top:1px solid #2a2a35;padding-top:4px;color:#e0e0e8;font-weight:600;">
                <span>Net available</span><span>${store.available}${store.fromDom ? ' ✓' : ''}</span>
            </div>
            ${store.fromDom ? '<div style="font-size:9px;color:#666;margin-top:2px;">✓ from CurrentRMS (exact)</div>' : ''}
        `;
        const rect = tagEl.getBoundingClientRect();
        let top = rect.bottom + 6, left = rect.left;
        if (top + 220 > window.innerHeight) top = rect.top - 220;
        if (left + 320 > window.innerWidth) left = window.innerWidth - 330;
        tip.style.top = top + 'px'; tip.style.left = left + 'px';
        tip.classList.add('show');
    });
    tagEl.addEventListener('mouseleave', () => { if (tooltipEl) tooltipEl.classList.remove('show'); });
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Main scan ────────────────────────────────────────────────
function scanAndInject() {
    if (stockMode === 'off') return;
    injectStyles();

    const itemInputs = document.querySelectorAll('input[id$="item_id"]:not([id*="parent"])');
    itemInputs.forEach(idInput => {
        const row = idInput.closest('tr');
        if (!row) return;
        let cell = row.querySelector('.item-shortage, .item-available, .label')?.parentElement;
        if (!cell) { const tds = row.querySelectorAll('td.optional-01'); cell = tds.length > 1 ? tds[1] : null; }
        if (!cell || cell.querySelector('.multi-store-stock')) return;

        const productId = idInput.value;
        if (!productId) return;

        const div = document.createElement('div');
        div.className = 'multi-store-stock';
        div.innerHTML = '<em style="color:#888;font-weight:normal;">Checking stores...</em>';
        cell.appendChild(div);

        if (stockMode === 'simple') renderSimple(div, productId);
        else if (stockMode === 'date-aware') renderDateAware(div, productId, readDomAvailability(row));
    });
}

function renderSimple(div, productId) {
    safeSendMessage({ action: 'fetchStock', productId }, resp => {
        if (!resp) { div.innerHTML = '❌ No response'; return; }
        if (resp.error === 'not_configured') { div.style.color = '#e67e22'; div.innerHTML = '⚙️ Configure extension'; return; }
        if (resp.error === 'no_stores') { div.style.color = '#e67e22'; div.innerHTML = '⚙️ No stores enabled'; return; }
        if (resp.success === true && Array.isArray(resp.stores) && resp.stores.length > 0) {
            div.style.color = '#0056b3';
            div.innerHTML = '📦 ' + resp.stores.map(s => {
                const name = storeNames[s.store_id] || 'Store ' + s.store_id;
                return s.available <= 0 ? `<span style="color:#ff4d6a;">${name}: ${s.available}</span>` : `${name}: ${s.available}`;
            }).join(' | ');
        } else div.innerHTML = '❌ No Data';
    });
}

function renderDateAware(div, productId, domAvail) {
    getOpportunityData(oppData => {
        if (!oppData) { div.innerHTML = ''; renderSimple(div, productId); return; }

        const useCharge = !!dateAwareInUseOnly;
        const start = useCharge && oppData.charge_starts_at ? oppData.charge_starts_at : oppData.starts_at;
        const end   = useCharge && oppData.charge_ends_at ? oppData.charge_ends_at : oppData.ends_at;
        if (!start || !end) { div.innerHTML = ''; renderSimple(div, productId); return; }

        safeSendMessage({
            action: 'fetchAvailability', productId,
            startDate: start, endDate: end,
            currentOpportunityId: oppData.id || getOpportunityIdFromUrl(),
            currentStoreId: oppData.store_id || null, currentStoreAvail: domAvail,
            useChargeDates: useCharge
        }, resp => {
            if (!resp) { div.innerHTML = '❌ No response'; return; }
            if (resp.error === 'not_configured') { div.style.color = '#e67e22'; div.innerHTML = '⚙️ Configure extension'; return; }
            if (resp.error === 'no_stores') { div.style.color = '#e67e22'; div.innerHTML = '⚙️ No stores enabled'; return; }
            if (!resp.success || !resp.stores) { div.innerHTML = '❌ ' + (resp.error || 'Failed'); return; }

            div.innerHTML = '';
            resp.stores.forEach(store => {
                const name = storeNames[store.store_id] || `Store ${store.store_id}`;
                const tag = document.createElement('span');
                tag.className = 'avail-tag';

                const avail = parseFloat(store.available) || 0;
                const heldNum = parseFloat(store.held) || 0;
                const bookedNum   = store.booked   || 0;
                const reservedNum = store.reserved || 0;
                const hasConflicts = bookedNum > 0 || reservedNum > 0;

                // Always show avail/held so both numbers are visible at a glance
                const availStr = heldNum > 0 ? `${avail}/${heldNum}` : `${avail}`;

                // Short commitment suffix e.g. (23bkd 4res)
                let commitStr = '';
                if (bookedNum > 0 && reservedNum > 0) commitStr = ` (${bookedNum}bkd ${reservedNum}res)`;
                else if (bookedNum > 0)               commitStr = ` (${bookedNum}bkd)`;
                else if (reservedNum > 0)             commitStr = ` (${reservedNum}res)`;

                if (avail <= 0) {
                    tag.classList.add('red');
                } else if (hasConflicts) {
                    tag.classList.add('orange');
                } else {
                    tag.classList.add('green');
                }

                tag.textContent = `${name}: ${availStr}${commitStr}`;

                div.appendChild(tag);
                attachTooltip(tag, store);
            });
        });
    });
}

// ── RMS Multitool nav dropdown — only shown when user has entered a trial or unlock code ─
let dashTabDone = false;
let dashTabPending = false;
function injectDashboardTab() {
    if (dashTabDone || dashTabPending) return;
    const sels = ['nav .navbar-nav','.navbar-nav','nav ul.nav','.nav.navbar-nav','#main-nav ul','.top-nav ul','header nav ul','nav.navbar ul','.navbar ul:not(.dropdown-menu)','nav:first-of-type ul:first-of-type'];
    let nav = null;
    for (const s of sels) { const cs = document.querySelectorAll(s); for (const el of cs) { if (el.querySelectorAll(':scope > li > a').length >= 2) { nav = el; break; } } if (nav) break; }
    if (!nav || nav.querySelector('.rms-multitool-dashboard-tab')) return;

    dashTabPending = true;
    safeSendMessage({ action: 'getLicenseStatus' }, function (status) {
        if (chrome.runtime.lastError) status = undefined;
        dashTabPending = false;
        if (!status || status.allowed !== true) return;
        if (dashTabDone || nav.querySelector('.rms-multitool-dashboard-tab')) return;

    const ref = nav.querySelector(':scope > li:not(.active):not(.current)') || nav.querySelector(':scope > li');
    const refA = ref ? ref.querySelector(':scope > a') : null;
    const refLiStyle = ref ? window.getComputedStyle(ref) : null;

    const li = document.createElement('li');
    li.id = 'rms-multitool-nav-wrap';
    li.className = 'rms-multitool-dashboard-tab rms-multitool-nav-dropdown-wrap';
    if (ref) for (const c of ref.classList) { if (c !== 'active' && c !== 'current') li.classList.add(c); }
    if (refLiStyle) {
        li.style.marginTop = refLiStyle.marginTop;
        li.style.marginRight = refLiStyle.marginRight;
        li.style.marginBottom = refLiStyle.marginBottom;
        li.style.marginLeft = refLiStyle.marginLeft;
        li.style.paddingTop = refLiStyle.paddingTop;
        li.style.paddingRight = refLiStyle.paddingRight;
        li.style.paddingBottom = refLiStyle.paddingBottom;
        li.style.paddingLeft = refLiStyle.paddingLeft;
        li.style.height = refLiStyle.height;
        li.style.minHeight = refLiStyle.minHeight;
        li.style.display = refLiStyle.display;
        li.style.alignItems = refLiStyle.alignItems;
        li.style.borderTopWidth = refLiStyle.borderTopWidth;
        li.style.borderTopStyle = refLiStyle.borderTopStyle;
        li.style.borderTopColor = '#00e5a0';
        li.style.borderBottom = refLiStyle.borderBottom;
        li.style.borderLeft = refLiStyle.borderLeft;
        li.style.borderRight = refLiStyle.borderRight;
        li.style.position = 'relative';
    } else {
        li.style.cssText = 'border-top:3px solid transparent;border-bottom:none;border-left:none;border-right:none;position:relative;';
    }

    const trigger = document.createElement('a');
    trigger.href = '#'; trigger.classList.add('rms-multitool-nav-trigger');
    trigger.textContent = 'RMS Multitool ';
    trigger.title = 'RMS Multitool — Dashboards & tools';
    const caret = document.createElement('span');
    caret.className = 'rms-multitool-nav-caret'; caret.style.cssText = 'margin-left:4px;opacity:0.8;font-size:0.75em;';
    caret.textContent = '\u25BC';
    trigger.appendChild(caret);
    if (refA) {
        for (const c of refA.classList) if (c && c.indexOf('dropdown') === -1) trigger.classList.add(c);
        const cs = window.getComputedStyle(refA);
        trigger.style.cssText = `font-size:${cs.fontSize}!important;font-family:${cs.fontFamily}!important;font-weight:${cs.fontWeight}!important;padding:${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}!important;line-height:${cs.lineHeight}!important;text-decoration:none!important;display:${cs.display}!important;text-transform:${cs.textTransform}!important;letter-spacing:${cs.letterSpacing}!important;outline:none!important;border:none!important;box-shadow:none!important;cursor:pointer;vertical-align:${cs.verticalAlign}!important;`;
    }

    var dropdownFont = { family: '', size: '', weight: '' };
    var dropRef = document.querySelector('.dropdown-menu a') || document.querySelector('[class*="dropdown-menu"] a') || document.querySelector('nav .dropdown a') || (refA ? refA : null);
    if (dropRef) {
        var ds = window.getComputedStyle(dropRef);
        dropdownFont = { family: ds.fontFamily, size: ds.fontSize, weight: ds.fontWeight };
    }

    const menu = document.createElement('ul');
    menu.className = 'rms-multitool-nav-dropdown';
    const items = [
        { label: 'Quote Dashboard', url: 'dashboard.html', title: 'RMS Multitool — Quote Dashboard' },
        { label: 'Crew & Vehicles', url: 'services-dashboard.html', title: 'RMS Multitool — Crew & Vehicle Dashboard' },
        { label: 'Warehouse Dashboard', url: 'warehouse-dashboard.html', title: 'RMS Multitool — Warehouse Dashboard' },
        { label: 'CrewBase', url: 'https://web-production-82ad6.up.railway.app/admin', title: 'CrewBase', external: true }
    ];
    items.forEach(function (it) {
        const mLi = document.createElement('li');
        const mA = document.createElement('a');
        mA.href = it.external ? it.url : chrome.runtime.getURL(it.url);
        mA.target = '_blank'; mA.textContent = it.label; mA.title = it.title;
        if (dropdownFont.family) { mA.style.fontFamily = dropdownFont.family; mA.style.fontSize = dropdownFont.size; mA.style.fontWeight = dropdownFont.weight; }
        mA.addEventListener('click', function (e) {
            e.preventDefault();
            if (it.external) { safeSendMessage({ action: 'openTab', url: it.url }); return; }
            var url = it.url ? chrome.runtime.getURL(it.url) : '';
            if (url && it.url && it.url.indexOf('warehouse-dashboard') !== -1) {
              var focusId = getOpportunityIdFromUrl();
              if (focusId) url = url + (url.indexOf('?') !== -1 ? '&' : '?') + 'focus=' + encodeURIComponent(focusId);
            }
            if (url) safeSendMessage({ action: 'openTab', url: url });
        });
        mLi.appendChild(mA); menu.appendChild(mLi);
    });

    trigger.addEventListener('click', function (e) {
        e.preventDefault();
        li.classList.toggle('rms-multitool-nav-open');
    });
    document.addEventListener('click', function closeDropdown(e) {
        if (!li.contains(e.target)) { li.classList.remove('rms-multitool-nav-open'); }
    });

    if (!document.querySelector('#rms-multitool-nav-style')) {
        const st = document.createElement('style'); st.id = 'rms-multitool-nav-style';
        st.textContent = [
            '#rms-multitool-nav-wrap{border-top:3px solid #00e5a0!important;}',
            '#rms-multitool-nav-wrap,#rms-multitool-nav-wrap a,#rms-multitool-nav-wrap a:visited,#rms-multitool-nav-wrap a:focus,#rms-multitool-nav-wrap a:active,#rms-multitool-nav-wrap a:hover{text-decoration:none!important;outline:none!important;box-shadow:none!important;border-bottom:none!important;border-left:none!important;border-right:none!important;}',
            '#rms-multitool-nav-wrap .rms-multitool-nav-trigger{color:#a0a0ac!important;}',
            '#rms-multitool-nav-wrap:hover,#rms-multitool-nav-wrap.rms-multitool-nav-open{background:#00e5a0!important;border-top-color:#00e5a0!important;}',
            '#rms-multitool-nav-wrap:hover .rms-multitool-nav-trigger,#rms-multitool-nav-wrap.rms-multitool-nav-open .rms-multitool-nav-trigger{color:#0a0a0e!important;background:transparent!important;}',
            '#rms-multitool-nav-wrap .rms-multitool-nav-trigger:hover,#rms-multitool-nav-wrap .rms-multitool-nav-trigger:focus{color:#0a0a0e!important;background:transparent!important;}',
            '.rms-multitool-nav-dropdown-wrap{position:relative;}',
            '.rms-multitool-nav-dropdown{display:none;position:absolute;top:100%;left:0;min-width:100%;margin:0;padding:6px 0;list-style:none;background:#fff;border:1px solid #e0e0e0;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.15);z-index:9999;}',
            '.rms-multitool-nav-dropdown-wrap.rms-multitool-nav-open .rms-multitool-nav-dropdown{display:block;}',
            '.rms-multitool-nav-dropdown li{margin:0;border:none!important;border-top:none!important;}',
            '.rms-multitool-nav-dropdown a{display:block;padding:8px 14px;color:#1a1a1a!important;white-space:nowrap;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:14px;font-weight:400;border:none!important;border-top:none!important;border-bottom:none!important;box-shadow:none!important;}',
            '#rms-multitool-nav-wrap .rms-multitool-nav-dropdown a:hover,#rms-multitool-nav-wrap .rms-multitool-nav-dropdown a:focus{background:#00e5a0!important;color:#0a0a0e!important;}'
        ].join('\n');
        document.head.appendChild(st);
    }
    li.appendChild(trigger); li.appendChild(menu); nav.appendChild(li);
    dashTabDone = true;
    });
}

// ── "Mark ready to prep" button on opportunity (quote) page — updates custom field in background ─
let readyToPrepButtonInjected = false;
function injectReadyToPrepButton() {
    if (!isOpportunityViewPage()) return;
    const oppId = getOpportunityIdFromUrl();
    if (oppId) try { chrome.storage.local.set({ wh_last_opp_id: oppId }); } catch (_) {}
    if (!oppId || readyToPrepButtonInjected || document.getElementById('rms-multitool-ready-to-prep-wrap')) return;

    safeSendMessage({ action: 'getLicenseStatus' }, function (status) {
        if (chrome.runtime.lastError) status = undefined;
        if (!status || status.allowed !== true) return;
        if (readyToPrepButtonInjected || document.getElementById('rms-multitool-ready-to-prep-wrap')) return;

        const wrap = document.createElement('div');
        wrap.id = 'rms-multitool-ready-to-prep-wrap';
        wrap.className = 'rms-multitool-ready-to-prep';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rms-multitool-ready-to-prep-btn';
        btn.textContent = 'Mark ready to prep';
        btn.title = 'Set today\'s date as "Ready for prep" on this job (updates custom field in Current RMS)';

        if (!document.getElementById('rms-multitool-ready-to-prep-style')) {
            const style = document.createElement('style');
            style.id = 'rms-multitool-ready-to-prep-style';
            style.textContent = `
                .rms-multitool-ready-to-prep{margin:8px 0 12px 0;}
                .rms-multitool-ready-to-prep.in-sidebar{margin-bottom:16px;}
                .rms-multitool-ready-to-prep-btn{
                    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
                    font-size:13px;font-weight:600;
                    padding:8px 14px;border-radius:6px;cursor:pointer;
                    background:#00e5a0;color:#0a0a0e;border:none;
                    box-shadow:0 1px 3px rgba(0,0,0,0.15);
                }
                .rms-multitool-ready-to-prep-btn:hover{background:#00cc88;transform:translateY(-1px);}
                .rms-multitool-ready-to-prep-btn:active{transform:translateY(0);}
                .rms-multitool-ready-to-prep-btn:disabled{opacity:0.6;cursor:not-allowed;transform:none;}
                .rms-multitool-ready-to-prep-btn.done{background:#0a0a0e;color:#00e5a0;}
                .rms-multitool-ready-to-prep-btn.loaded{background:#ff4d6a;color:#fff;}
            `;
            document.head.appendChild(style);
        }

        btn.addEventListener('click', function () {
            if (btn.disabled) return;
            btn.disabled = true;
            btn.textContent = 'Updating…';
            safeSendMessage({ action: 'updateOpportunityReadyToPrep', opportunityId: oppId }, function (res) {
                if (res && res.success) {
                    btn.textContent = 'Ready to prep set';
                    btn.classList.add('done');
                } else {
                    btn.disabled = false;
                    btn.textContent = 'Mark ready to prep';
                    alert(res && res.error ? res.error : 'Failed to update. Check API key and custom field.');
                }
            });
        });

        // Add delivery sheet button style
        if (!document.getElementById('rms-delivery-sheet-btn-style')) {
            const ds = document.createElement('style');
            ds.id = 'rms-delivery-sheet-btn-style';
            ds.textContent = `
                .rms-multitool-ready-to-prep { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
                .rms-multitool-delivery-sheet-btn {
                    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
                    font-size:13px; font-weight:600;
                    padding:8px 14px; border-radius:6px; cursor:pointer;
                    background:#1e1e26; color:#00e5a0;
                    border:1px solid #00e5a0;
                    box-shadow:0 1px 3px rgba(0,0,0,0.15);
                    transition: all 0.2s;
                }
                .rms-multitool-delivery-sheet-btn:hover { background:#00e5a0; color:#0a0a0e; transform:translateY(-1px); }
                .rms-multitool-delivery-sheet-btn:active { transform:translateY(0); }
            `;
            document.head.appendChild(ds);
        }

        // Ready to prep button first
        wrap.appendChild(btn);

        // ── Delivery Sheet button (only if feature enabled) ────────────────
        const deliveryBtn = document.createElement('button');
        deliveryBtn.type = 'button';
        deliveryBtn.className = 'rms-multitool-delivery-sheet-btn';
        deliveryBtn.textContent = '📋 Event Sheet';
        deliveryBtn.title = 'Generate an event sheet for this job';
        if (!isFeatureOn('deliverySheet')) deliveryBtn.style.display = 'none';
        deliveryBtn.addEventListener('click', function () {
            // Toggle — close if already open
            const existing = document.getElementById('rms-event-sheet-modal');
            if (existing) { existing.remove(); document.getElementById('rms-event-sheet-backdrop').remove(); return; }

            // Inject modal styles once
            if (!document.getElementById('rms-event-sheet-modal-style')) {
                const ms = document.createElement('style');
                ms.id = 'rms-event-sheet-modal-style';
                ms.textContent = `
                    #rms-event-sheet-backdrop {
                        position: fixed; inset: 0; z-index: 99998;
                        background: rgba(0,0,0,0.7); backdrop-filter: blur(3px);
                        animation: rmsEsBackdropIn 0.2s ease;
                    }
                    @keyframes rmsEsBackdropIn { from { opacity:0; } to { opacity:1; } }
                    #rms-event-sheet-modal {
                        position: fixed; top: 50%; left: 50%;
                        transform: translate(-50%, -50%);
                        z-index: 99999;
                        width: min(1280px, 96vw); height: 96vh;
                        background: #17171d; border: 1px solid #2a2a35;
                        border-radius: 16px; box-shadow: 0 24px 64px rgba(0,0,0,0.7);
                        display: flex; flex-direction: column; overflow: hidden;
                        animation: rmsEsModalIn 0.22s cubic-bezier(0.34,1.2,0.64,1);
                    }
                    @keyframes rmsEsModalIn {
                        from { opacity:0; transform: translate(-50%,-52%) scale(0.97); }
                        to   { opacity:1; transform: translate(-50%,-50%) scale(1); }
                    }
                    #rms-event-sheet-modal-bar {
                        display: flex; align-items: center; justify-content: space-between;
                        padding: 12px 18px; background: #1e1e26;
                        border-bottom: 1px solid #2a2a35; flex-shrink: 0;
                    }
                    #rms-event-sheet-modal-bar span {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                        font-size: 13px; font-weight: 700; color: #f0f0f5;
                    }
                    #rms-event-sheet-modal-close {
                        background: none; border: none; color: #6b6b80; cursor: pointer;
                        font-size: 18px; line-height: 1; padding: 4px 8px;
                        border-radius: 6px; transition: color 0.15s;
                    }
                    #rms-event-sheet-modal-close:hover { color: #f0f0f5; }
                    #rms-event-sheet-iframe {
                        flex: 1; border: none; width: 100%; height: 100%;
                    }
                `;
                document.head.appendChild(ms);
            }

            const backdrop = document.createElement('div');
            backdrop.id = 'rms-event-sheet-backdrop';
            backdrop.addEventListener('click', function () {
                backdrop.remove();
                document.getElementById('rms-event-sheet-modal').remove();
            });
            document.body.appendChild(backdrop);

            const modal = document.createElement('div');
            modal.id = 'rms-event-sheet-modal';

            const bar = document.createElement('div');
            bar.id = 'rms-event-sheet-modal-bar';
            bar.innerHTML = '<span>📋 Event Sheet</span>';
            const closeBtn = document.createElement('button');
            closeBtn.id = 'rms-event-sheet-modal-close';
            closeBtn.textContent = '✕';
            closeBtn.addEventListener('click', function () {
                modal.remove(); backdrop.remove();
            });
            bar.appendChild(closeBtn);
            modal.appendChild(bar);

            const iframe = document.createElement('iframe');
            iframe.id = 'rms-event-sheet-iframe';
            iframe.src = chrome.runtime.getURL(`delivery-sheet.html?oppId=${oppId}`);
            modal.appendChild(iframe);

            document.body.appendChild(modal);
        });
        wrap.appendChild(deliveryBtn);

        // ── Import Groups button ───────────────────────────────────────────────
        const importBtn = document.createElement('button');
        importBtn.type = 'button';
        importBtn.className = 'rms-multitool-delivery-sheet-btn rms-import-groups-btn';
        importBtn.textContent = '📦 Import Groups';
        importBtn.title = 'Import template groups into this job';
        importBtn.style.display = 'none'; // hidden until config confirmed
        importBtn.addEventListener('click', function () {
            try { openImportGroupsPanel(oppId); }
            catch (e) {
                if (e.message && e.message.includes('Extension context invalidated')) {
                    alert('The extension was updated — please refresh the page first.');
                } else { throw e; }
            }
        });
        wrap.appendChild(importBtn);
        // Only reveal once we confirm enabled groups exist in config
        chrome.storage.local.get(['templateGroupConfig'], function (r) {
            const hasGroups = r.templateGroupConfig && r.templateGroupConfig.some(g => g.enabled);
            if (hasGroups) importBtn.style.display = '';
        });

        // If this job was marked "Loaded & Ready for Delivery" on the warehouse dashboard, show "Loaded for Delivery" and disable.
        chrome.storage.local.get(['whLoadedIds'], function (st) {
            const loadedIds = (st && st.whLoadedIds) ? st.whLoadedIds.map(Number) : [];
            const idNum = parseInt(oppId, 10);
            if (loadedIds.indexOf(idNum) !== -1) {
                btn.textContent = 'Loaded for Delivery';
                btn.title = 'Marked as loaded on the Warehouse Dashboard.';
                btn.disabled = true;
                btn.classList.add('loaded');
                return;
            }
            // Otherwise check if this opportunity already has a ready-for-prep date set via the API.
            safeSendMessage({ action: 'getOpportunityReadyToPrepState', opportunityId: oppId }, function (res) {
                if (chrome.runtime.lastError) return;
                if (res && res.success && res.hasReady) {
                    btn.textContent = 'Ready to prep set';
                    btn.classList.add('done');
                }
            });
        });

        function findAttributesSection() {
            const all = document.querySelectorAll('h2, h3, h4, [class*="title"], [class*="heading"], dt, .panel-title, .section-title, label, th');
            for (const el of all) {
                const t = (el.textContent || '').trim();
                if (t === 'Attributes') return el;
                if (t.length < 60 && /\bAttributes\b/.test(t)) return el;
            }
            return null;
        }
        const attributesLabel = findAttributesSection();
        let inserted = false;
        if (attributesLabel) {
            const section = attributesLabel.closest('.panel, .card, section, [class*="sidebar"] div, [class*="column"] div, [class*="attribute"]') || attributesLabel.parentElement;
            if (section && section.parentElement) {
                wrap.classList.add('in-sidebar');
                section.parentElement.insertBefore(wrap, section);
                inserted = true;
            }
        }
        if (!inserted) {
            const hubLabel = document.querySelector('h2, h3, h4, [class*="title"]');
            const hubSection = hubLabel && (hubLabel.textContent || '').trim() === 'Hub' ? hubLabel.closest('.panel, .card, section') || hubLabel.parentElement : null;
            if (hubSection && hubSection.parentElement) {
                wrap.classList.add('in-sidebar');
                hubSection.parentElement.insertBefore(wrap, hubSection);
                inserted = true;
            }
        }
        if (!inserted) {
            const insertTarget = document.querySelector('.page-header, .detail-header, [class*="opportunity"] .container, .container-fluid .row:first-child, .container, #main, main')
                || document.querySelector('h1')?.parentElement
                || document.body;
            if (insertTarget) {
                if (insertTarget.querySelector('h1')) {
                    const h1 = insertTarget.querySelector('h1');
                    if (h1.nextElementSibling) h1.parentElement.insertBefore(wrap, h1.nextElementSibling);
                    else h1.parentElement.appendChild(wrap);
                } else {
                    insertTarget.insertBefore(wrap, insertTarget.firstChild);
                }
            } else {
                document.body.insertBefore(wrap, document.body.firstChild);
            }
        }
        readyToPrepButtonInjected = true;
    });
}

// ── Quote expired banner — shown on quote page if document date is 15+ days old ─
let quoteExpiredBannerInjected = false;
function injectQuoteExpiredBanner() {
    if (!isOpportunityViewPage()) return;
    if (quoteExpiredBannerInjected || document.getElementById('rms-multitool-quote-expired-banner')) return;

    getOpportunityData(function (opp) {
        if (!opp) return;
        if (quoteExpiredBannerInjected || document.getElementById('rms-multitool-quote-expired-banner')) return;

        // Try to read Document Date directly from the sidebar DOM first (most accurate source)
        let docDate = null;
        const sidebar = document.getElementById('sidebar_content');
        if (sidebar) {
            const spans = sidebar.querySelectorAll('span');
            for (let i = 0; i < spans.length - 1; i++) {
                if (spans[i].textContent.trim() === 'Document Date:') {
                    const raw = spans[i + 1].textContent.trim();
                    // CurrentRMS format: DD/MM/YYYY HH:MM
                    const m = raw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                    if (m) docDate = new Date(`${m[3]}-${m[2]}-${m[1]}`);
                    break;
                }
            }
        }
        // Fall back to API fields if DOM scrape failed
        if (!docDate || isNaN(docDate.getTime())) {
            const fallback = opp.document_date || opp.created_at || '';
            if (!fallback) { quoteExpiredBannerInjected = true; return; }
            docDate = new Date(fallback);
        }
        if (isNaN(docDate.getTime())) { quoteExpiredBannerInjected = true; return; }

        const formattedDate = docDate.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

        const daysDiff = Math.floor((Date.now() - docDate.getTime()) / (24 * 60 * 60 * 1000));
        const isExpired = daysDiff >= 15;
        const daysRemaining = 15 - daysDiff;

        if (!document.getElementById('rms-multitool-quote-expired-style')) {
            const style = document.createElement('style');
            style.id = 'rms-multitool-quote-expired-style';
            style.textContent = `
                #rms-multitool-quote-expired-banner {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin: 8px 0 12px 0;
                    padding: 10px 14px;
                    border-radius: 6px;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                    font-size: 13px;
                    font-weight: 500;
                    line-height: 1.4;
                }
                #rms-multitool-quote-expired-banner.expired {
                    background: rgba(255, 152, 0, 0.1);
                    color: #b36000;
                    border: 1px solid rgba(255, 152, 0, 0.35);
                }
                #rms-multitool-quote-expired-banner.valid {
                    background: rgba(0, 180, 100, 0.1);
                    color: #0a6e3f;
                    border: 1px solid rgba(0, 180, 100, 0.35);
                }
                #rms-multitool-quote-expired-banner svg { flex-shrink: 0; }
            `;
            document.head.appendChild(style);
        }

        const banner = document.createElement('div');
        banner.id = 'rms-multitool-quote-expired-banner';
        banner.classList.add(isExpired ? 'expired' : 'valid');

        if (isExpired) {
            banner.innerHTML = `
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <span>Outside validation period — document dated <strong>${formattedDate}</strong> (${daysDiff} days ago)</span>
            `;
        } else {
            banner.innerHTML = `
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                <span>Within validation period — document dated <strong>${formattedDate}</strong> (${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining)</span>
            `;
        }

        // Prefer inserting below the ready-to-prep button if it's already on the page
        let inserted = false;
        const readyToPrepWrap = document.getElementById('rms-multitool-ready-to-prep-wrap');
        if (readyToPrepWrap && readyToPrepWrap.parentElement) {
            readyToPrepWrap.parentElement.insertBefore(banner, readyToPrepWrap.nextSibling);
            inserted = true;
        }

        // Otherwise insert before the Attributes section in the sidebar
        if (!inserted) {
            const all = document.querySelectorAll('h2, h3, h4, [class*="title"], [class*="heading"], dt, .panel-title, .section-title, label, th');
            for (const el of all) {
                const t = (el.textContent || '').trim();
                if (t === 'Attributes' || (t.length < 60 && /\bAttributes\b/.test(t))) {
                    const section = el.closest('.panel, .card, section, [class*="sidebar"] div, [class*="column"] div, [class*="attribute"]') || el.parentElement;
                    if (section && section.parentElement) {
                        section.parentElement.insertBefore(banner, section);
                        inserted = true;
                    }
                    break;
                }
            }
        }

        // Final fallback: top of the page
        if (!inserted) {
            const insertTarget = document.querySelector('.page-header, .detail-header, .container, #main, main')
                || document.querySelector('h1')?.parentElement
                || document.body;
            insertTarget.insertBefore(banner, insertTarget.firstChild);
        }

        quoteExpiredBannerInjected = true;
    });
}

const observer = new MutationObserver(() => { scanAndInject(); if (!dashTabDone) injectDashboardTab(); if (isOpportunityViewPage()) { injectReadyToPrepButton(); injectQuoteExpiredBanner(); } });
observer.observe(document.body, { childList: true, subtree: true });
scanAndInject();
injectDashboardTab();
injectReadyToPrepButton();
injectQuoteExpiredBanner();

// ── Import Groups panel ───────────────────────────────────────────────────────

function openImportGroupsPanel(oppId) {
    // Check extension context is still valid before doing anything
    if (!chrome.runtime?.id) {
        alert('The extension was updated — please refresh the page first.');
        return;
    }

    // Remove any existing panel + backdrop
    const old = document.getElementById('rms-import-panel');
    if (old) {
        old.remove();
        const oldBd = document.getElementById('rms-import-backdrop');
        if (oldBd) oldBd.remove();
        return;
    }

    // Inject styles once
    if (!document.getElementById('rms-import-panel-style')) {
        const s = document.createElement('style');
        s.id = 'rms-import-panel-style';
        s.textContent = `
            #rms-import-backdrop {
                position: fixed; inset: 0; z-index: 99998;
                background: rgba(0,0,0,0.65); backdrop-filter: blur(3px);
                animation: rmsBackdropIn 0.2s ease;
            }
            @keyframes rmsBackdropIn { from { opacity:0; } to { opacity:1; } }
            #rms-import-panel {
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                z-index: 99999; width: min(780px, 92vw); max-height: 82vh;
                background: #17171d; border: 1px solid #2a2a35;
                border-radius: 16px; box-shadow: 0 24px 64px rgba(0,0,0,0.7);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                display: flex; flex-direction: column;
                animation: rmsModalIn 0.22s cubic-bezier(0.34,1.2,0.64,1);
            }
            @keyframes rmsModalIn { from { opacity:0; transform: translate(-50%,-52%) scale(0.96); } to { opacity:1; transform: translate(-50%,-50%) scale(1); } }
            #rms-import-panel .imp-header {
                display: flex; align-items: center; justify-content: space-between;
                padding: 18px 22px; background: #1e1e26; border-bottom: 1px solid #2a2a35;
                border-radius: 16px 16px 0 0; flex-shrink: 0;
            }
            #rms-import-panel .imp-title { font-size: 15px; font-weight: 700; color: #f0f0f5; }
            #rms-import-panel .imp-subtitle { font-size: 11px; color: #6b6b80; margin-top: 2px; }
            #rms-import-panel .imp-header-left { display: flex; flex-direction: column; gap: 2px; }
            #rms-import-panel .imp-header-right { display: flex; align-items: center; gap: 10px; }
            #rms-import-panel .imp-select-all {
                background: none; border: 1px solid #2a2a35; border-radius: 6px;
                color: #6b6b80; font-size: 11px; padding: 4px 10px; cursor: pointer;
                font-family: inherit; transition: all 0.15s;
            }
            #rms-import-panel .imp-select-all:hover { border-color: #00e5a0; color: #00e5a0; }
            #rms-import-panel .imp-close {
                background: none; border: none; color: #6b6b80; cursor: pointer;
                font-size: 18px; line-height: 1; padding: 4px 8px; border-radius: 6px;
                transition: color 0.15s;
            }
            #rms-import-panel .imp-close:hover { color: #f0f0f5; }
            #rms-import-panel .imp-body {
                padding: 18px 22px; overflow-y: auto; flex: 1;
            }
            #rms-import-panel .imp-body::-webkit-scrollbar { width: 5px; }
            #rms-import-panel .imp-body::-webkit-scrollbar-thumb { background: #2a2a35; border-radius: 4px; }
            #rms-import-panel .imp-grid {
                display: flex; flex-direction: column; gap: 2px;
            }
            #rms-import-panel .imp-group-row {
                display: flex; align-items: center; gap: 10px;
                padding: 9px 12px; border-radius: 8px; cursor: pointer;
                transition: background 0.15s; border: 1px solid transparent;
            }
            #rms-import-panel .imp-group-row:hover { background: #1e1e26; border-color: #2a2a35; }
            #rms-import-panel .imp-group-row.selected { background: #0d2b22; border-color: #00e5a030; }
            #rms-import-panel .imp-group-row input[type=checkbox] {
                appearance: none; width: 16px; height: 16px; border: 1px solid #2a2a35;
                border-radius: 4px; background: #0f0f12; cursor: pointer; flex-shrink: 0;
                transition: all 0.15s; position: relative;
            }
            #rms-import-panel .imp-group-row input[type=checkbox]:checked {
                background: #00e5a0; border-color: #00e5a0;
            }
            #rms-import-panel .imp-group-row input[type=checkbox]:checked::after {
                content: ''; position: absolute; top: 2px; left: 5px;
                width: 4px; height: 8px; border: 2px solid #0f0f12;
                border-top: none; border-left: none; transform: rotate(45deg);
            }
            #rms-import-panel .imp-group-label { flex: 1; min-width: 0; }
            #rms-import-panel .imp-group-name { font-size: 12px; color: #f0f0f5; line-height: 1.3; }
            #rms-import-panel .imp-group-desc { font-size: 10px; color: #6b6b80; margin-top: 2px; line-height: 1.4; }
            #rms-import-panel .imp-group-row.done .imp-group-name { color: #00e5a0; }
            #rms-import-panel .imp-group-row.error .imp-group-name { color: #ff4d6a; }
            #rms-import-panel .imp-group-row.working .imp-group-name { color: #6b6b80; }
            #rms-import-panel .imp-footer {
                padding: 14px 22px; border-top: 1px solid #2a2a35;
                display: flex; gap: 10px; align-items: center; flex-shrink: 0;
                border-radius: 0 0 16px 16px;
            }
            #rms-import-panel .imp-footer-left { font-size: 11px; color: #6b6b80; flex: 1; }
            #rms-import-panel .imp-btn {
                padding: 10px 24px; border: none; border-radius: 8px;
                font-family: inherit; font-size: 13px; font-weight: 700; cursor: pointer;
                transition: all 0.2s;
            }
            #rms-import-panel .imp-btn-primary { background: #00e5a0; color: #0f0f12; }
            #rms-import-panel .imp-btn-primary:hover { box-shadow: 0 0 18px rgba(0,229,160,0.4); }
            #rms-import-panel .imp-btn-primary:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; }
            #rms-import-panel .imp-status { font-size: 11px; color: #6b6b80; }
            #rms-import-panel .imp-empty { font-size: 13px; color: #6b6b80; font-style: italic; padding: 20px 4px; text-align: center; }
            #rms-import-panel .imp-master-heading {
                display: flex; align-items: center; gap: 10px;
                padding: 18px 12px 8px; color: #f0f0f5; font-size: 13px;
                font-weight: 800; letter-spacing: 0.03em; text-transform: uppercase;
            }
            #rms-import-panel .imp-master-heading::before {
                content: ''; width: 3px; height: 16px; background: #00e5a0;
                border-radius: 2px; flex-shrink: 0;
            }
            #rms-import-panel .imp-master-heading::after {
                content: ''; flex: 1; height: 2px;
                background: linear-gradient(90deg, #2a2a35, transparent);
            }
            #rms-import-panel .imp-section-heading {
                display: flex; align-items: center; gap: 10px;
                padding: 12px 12px 4px; color: #00e5a0; font-size: 10px;
                font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
                opacity: 0.8;
            }
            #rms-import-panel .imp-section-heading::after {
                content: ''; flex: 1; height: 1px; background: #2a2a35;
            }
        `;
        document.head.appendChild(s);
    }

    // Backdrop
    const backdrop = document.createElement('div');
    backdrop.id = 'rms-import-backdrop';
    backdrop.addEventListener('click', () => { backdrop.remove(); panel.remove(); });
    document.body.appendChild(backdrop);

    // Build panel
    const panel = document.createElement('div');
    panel.id = 'rms-import-panel';

    // Header
    const header = document.createElement('div');
    header.className = 'imp-header';
    const headerLeft = document.createElement('div');
    headerLeft.className = 'imp-header-left';
    headerLeft.innerHTML = '<div class="imp-title">📦 Import Groups</div><div class="imp-subtitle">Select the groups you want to import into this job</div>';
    const headerRight = document.createElement('div');
    headerRight.className = 'imp-header-right';
    const selectAllBtn = document.createElement('button');
    selectAllBtn.className = 'imp-select-all';
    selectAllBtn.textContent = 'Select All';
    headerRight.appendChild(selectAllBtn);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'imp-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => { backdrop.remove(); panel.remove(); });
    headerRight.appendChild(closeBtn);
    header.appendChild(headerLeft);
    header.appendChild(headerRight);
    panel.appendChild(header);

    const body = document.createElement('div');
    body.className = 'imp-body';
    body.innerHTML = '<div class="imp-empty">Loading…</div>';
    panel.appendChild(body);

    const footer = document.createElement('div');
    footer.className = 'imp-footer';
    const footerLeft = document.createElement('div');
    footerLeft.className = 'imp-footer-left';
    footer.appendChild(footerLeft);
    const importAllBtn = document.createElement('button');
    importAllBtn.className = 'imp-btn imp-btn-primary';
    importAllBtn.textContent = 'Import Selected';
    importAllBtn.disabled = true;
    footer.appendChild(importAllBtn);
    panel.appendChild(footer);

    const statusEl = document.createElement('div');
    statusEl.className = 'imp-status';
    footer.appendChild(statusEl);

    document.body.appendChild(panel);

    // Load enabled groups from config
    try {
    chrome.storage.local.get(['templateGroupConfig'], function (lr) {
    chrome.storage.sync.get(['templateJobId', 'subdomain'], function (r) {
        const allConfig = lr.templateGroupConfig || [];
        // Items to show: master headings, sub-headings, and enabled groups
        const displayItems = allConfig.filter(g => g.isMasterHeading || g.isHeading || g.enabled);
        const groups = allConfig.filter(g => g.enabled && !g.isHeading && !g.isMasterHeading); // importable only
        const templateJobId = r.templateJobId;
        const subdomain = r.subdomain;

        if (!groups.length) {
            body.innerHTML = '<div class="imp-empty">No groups configured — set them up in the extension popup.</div>';
            return;
        }
        if (!templateJobId) {
            body.innerHTML = '<div class="imp-empty">No template job set — add one in the extension popup.</div>';
            return;
        }

        body.innerHTML = '';
        const grid = document.createElement('div');
        grid.className = 'imp-grid';
        body.appendChild(grid);
        const checkboxes = [];

        displayItems.forEach(g => {
            if (g.isMasterHeading) {
                const heading = document.createElement('div');
                heading.className = 'imp-master-heading';
                heading.textContent = g.name;
                grid.appendChild(heading);
            } else if (g.isHeading) {
                const heading = document.createElement('div');
                heading.className = 'imp-section-heading';
                heading.textContent = g.name;
                grid.appendChild(heading);
            } else {
                const row = document.createElement('div');
                row.className = 'imp-group-row';
                row.dataset.groupId = g.id;

                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = false;
                cb.addEventListener('change', () => {
                    row.classList.toggle('selected', cb.checked);
                    updateImportBtn();
                });
                checkboxes.push(cb);

                const labelWrap = document.createElement('div');
                labelWrap.className = 'imp-group-label';

                const label = document.createElement('div');
                label.className = 'imp-group-name';
                label.textContent = g.name;
                labelWrap.appendChild(label);

                if (g.description) {
                    const desc = document.createElement('div');
                    desc.className = 'imp-group-desc';
                    desc.textContent = g.description;
                    labelWrap.appendChild(desc);
                }

                row.addEventListener('click', (e) => {
                    if (e.target !== cb) { cb.checked = !cb.checked; row.classList.toggle('selected', cb.checked); }
                    updateImportBtn();
                });
                row.appendChild(cb);
                row.appendChild(labelWrap);
                grid.appendChild(row);
            }
        });

        function updateImportBtn() {
            const n = checkboxes.filter(cb => cb.checked).length;
            importAllBtn.disabled = n === 0;
            importAllBtn.textContent = n > 0 ? `Import ${n} Group${n !== 1 ? 's' : ''}` : 'Import Selected';
            footerLeft.textContent = n > 0 ? `${n} of ${checkboxes.length} selected` : `${checkboxes.length} group${checkboxes.length !== 1 ? 's' : ''} available`;
        }
        updateImportBtn();

        // Select All / Deselect All toggle
        let allSelected = false;
        selectAllBtn.addEventListener('click', () => {
            allSelected = !allSelected;
            checkboxes.forEach(cb => {
                cb.checked = allSelected;
                cb.closest('.imp-group-row').classList.toggle('selected', allSelected);
            });
            selectAllBtn.textContent = allSelected ? 'Deselect All' : 'Select All';
            updateImportBtn();
        });

        importAllBtn.addEventListener('click', async function () {
            const selected = [];
            grid.querySelectorAll('.imp-group-row').forEach(row => {
                const cb = row.querySelector('input[type=checkbox]');
                if (cb && cb.checked) selected.push({ id: row.dataset.groupId, row });
            });
            if (!selected.length) return;

            importAllBtn.disabled = true;
            importAllBtn.textContent = 'Importing…';
            statusEl.textContent = '';

            const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
            const fetchHeaders = {
                'accept': '*/*;q=0.5, text/javascript, application/javascript, application/ecmascript, application/x-ecmascript',
                'x-csrf-token': csrfToken,
                'x-requested-with': 'XMLHttpRequest'
            };

            let doneCount = 0;
            let failCount = 0;

            for (const { id, row } of selected) {
                const nameEl = row.querySelector('.imp-group-name');
                row.classList.add('working');
                nameEl.textContent = '⏳ ' + nameEl.textContent.replace(/^[⏳✓✗] /, '');

                try {
                    const base = `https://${subdomain}.current-rms.com`;
                    const copyUrl  = `${base}/opportunity_items/${id}/copy?source_id=${templateJobId}&source_type=Opportunity`;
                    const pasteUrl = `${base}/opportunity_items/${id}/paste?destination_id=${oppId}&rp=%2Fopportunities%2F${oppId}`;

                    const copyRes = await fetch(copyUrl, { headers: fetchHeaders, credentials: 'include' });
                    const copyText = await copyRes.text();
                    if (!copyRes.ok) throw new Error(`Copy failed (${copyRes.status}): ${copyText.slice(0, 100)}`);

                    // Wait for server to register the clipboard
                    await new Promise(res => setTimeout(res, 800));

                    const pasteRes = await fetch(pasteUrl, { headers: fetchHeaders, credentials: 'include' });
                    const pasteText = await pasteRes.text();
                    if (!pasteRes.ok) throw new Error(`Paste failed (${pasteRes.status}): ${pasteText.slice(0, 100)}`);

                    row.classList.remove('working');
                    row.classList.add('done');
                    nameEl.textContent = '✓ ' + nameEl.textContent.replace(/^[⏳✓✗] /, '');
                    doneCount++;
                } catch (err) {
                    row.classList.remove('working');
                    row.classList.add('error');
                    nameEl.textContent = '✗ ' + nameEl.textContent.replace(/^[⏳✓✗] /, '');
                    failCount++;
                }

                // Gap between each group to avoid hammering the server
                await new Promise(res => setTimeout(res, 600));
            }

            statusEl.textContent = doneCount + ' group' + (doneCount !== 1 ? 's' : '') + ' imported' + (failCount ? ', ' + failCount + ' failed' : '') + ' — refreshing…';
            await new Promise(res => setTimeout(res, 800));
            window.location.reload();
        });
    }); // sync.get
    }); // local.get
    } catch (e) {
        // Extension was reloaded — old content script context is invalid
        body.innerHTML = '<div class="imp-empty">⚠ Extension was reloaded — please refresh the page and try again.</div>';
    }
}
