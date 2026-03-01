// content.js — RMS Multitool v1.5.0

let storeNames = {};
let stockMode = 'simple';
let cachedOppData = null;
let prewarmStarted = false;

chrome.storage.sync.get(['storeConfig', 'stockMode'], (result) => {
    if (result.storeConfig) {
        Object.entries(result.storeConfig).forEach(([id, cfg]) => {
            if (cfg.name) storeNames[parseInt(id)] = cfg.name;
        });
    }
    if (result.stockMode) stockMode = result.stockMode;
    // Pre-warm cache as soon as we know the mode
    if (stockMode === 'date-aware') tryPrewarm();
});

chrome.storage.onChanged.addListener((changes) => {
    if (changes.stockMode) {
        stockMode = changes.stockMode.newValue || 'simple';
        document.querySelectorAll('.multi-store-stock').forEach(el => el.remove());
        cachedOppData = null;
        prewarmStarted = false;
        chrome.runtime.sendMessage({ action: 'clearCache' });
        scanAndInject();
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
    chrome.runtime.sendMessage({ action: 'fetchOpportunity', opportunityId: oppId }, (resp) => {
        if (resp && resp.success && resp.opportunity) {
            cachedOppData = resp.opportunity;
            if (cachedOppData.starts_at && cachedOppData.ends_at) {
                chrome.runtime.sendMessage({
                    action: 'prewarmCache',
                    startDate: cachedOppData.starts_at,
                    endDate: cachedOppData.ends_at,
                    currentOpportunityId: cachedOppData.id
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

function getOpportunityData(callback) {
    if (cachedOppData) { callback(cachedOppData); return; }
    const oppId = getOpportunityIdFromUrl();
    if (!oppId) { callback(null); return; }
    chrome.runtime.sendMessage({ action: 'fetchOpportunity', opportunityId: oppId }, (resp) => {
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
            const lbl = j.state === 'booked' ? '⬤ Booked' : j.state === 'reserved' ? '◉ Allocated' : '○ Provisional';
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
    chrome.runtime.sendMessage({ action: 'fetchStock', productId }, resp => {
        if (!resp) { div.innerHTML = '❌ No response'; return; }
        if (resp.error === 'not_configured') { div.style.color = '#e67e22'; div.innerHTML = '⚙️ Configure extension'; return; }
        if (resp.error === 'no_stores') { div.style.color = '#e67e22'; div.innerHTML = '⚙️ No stores enabled'; return; }
        if (resp.success && resp.stores) {
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
        if (!oppData || !oppData.starts_at || !oppData.ends_at) { div.innerHTML = ''; renderSimple(div, productId); return; }

        chrome.runtime.sendMessage({
            action: 'fetchAvailability', productId,
            startDate: oppData.starts_at, endDate: oppData.ends_at,
            currentOpportunityId: oppData.id || getOpportunityIdFromUrl(),
            currentStoreId: oppData.store_id || null, currentStoreAvail: domAvail
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
                const hasConflicts = store.booked > 0 || store.reserved > 0;

                if (heldNum <= 0 || avail <= 0) {
                    tag.classList.add('red');
                    tag.textContent = `${name}: ${avail}`;
                } else if (hasConflicts) {
                    tag.classList.add('orange');
                    tag.textContent = `${name}: ${avail}/${heldNum}`;
                } else if (store.quoted > 0) {
                    tag.classList.add('blue');
                    tag.textContent = `${name}: ${avail} (${store.quoted}q)`;
                } else {
                    tag.classList.add('green');
                    tag.textContent = `${name}: ${avail}`;
                }

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
    chrome.runtime.sendMessage({ action: 'getLicenseStatus' }, function (status) {
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
        { label: 'Warehouse Dashboard', url: 'warehouse-dashboard.html', title: 'RMS Multitool — Warehouse Dashboard' }
    ];
    items.forEach(function (it) {
        const mLi = document.createElement('li');
        const mA = document.createElement('a');
        mA.href = chrome.runtime.getURL(it.url);
        mA.target = '_blank'; mA.textContent = it.label; mA.title = it.title;
        if (dropdownFont.family) { mA.style.fontFamily = dropdownFont.family; mA.style.fontSize = dropdownFont.size; mA.style.fontWeight = dropdownFont.weight; }
        mA.addEventListener('click', function (e) {
            e.preventDefault();
            var url = it.url ? chrome.runtime.getURL(it.url) : '';
            if (url && it.url && it.url.indexOf('warehouse-dashboard') !== -1) {
              var focusId = getOpportunityIdFromUrl();
              if (focusId) url = url + (url.indexOf('?') !== -1 ? '&' : '?') + 'focus=' + encodeURIComponent(focusId);
            }
            if (url) chrome.runtime.sendMessage({ action: 'openTab', url: url });
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
    if (!isOpportunityPrimaryPage()) return;
    const oppId = getOpportunityIdFromUrl();
    if (oppId) try { chrome.storage.local.set({ wh_last_opp_id: oppId }); } catch (_) {}
    if (!oppId || readyToPrepButtonInjected || document.getElementById('rms-multitool-ready-to-prep-wrap')) return;

    chrome.runtime.sendMessage({ action: 'getLicenseStatus' }, function (status) {
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
            chrome.runtime.sendMessage({ action: 'updateOpportunityReadyToPrep', opportunityId: oppId }, function (res) {
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

        wrap.appendChild(btn);

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
            chrome.runtime.sendMessage({ action: 'getOpportunityReadyToPrepState', opportunityId: oppId }, function (res) {
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

const observer = new MutationObserver(() => { scanAndInject(); if (!dashTabDone) injectDashboardTab(); if (isOpportunityPrimaryPage()) injectReadyToPrepButton(); });
observer.observe(document.body, { childList: true, subtree: true });
scanAndInject();
injectDashboardTab();
injectReadyToPrepButton();
