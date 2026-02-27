// content.js — RMS Multitool v1.3.0 (speed-optimized)

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
        let rows = '';
        store.jobs.forEach(j => {
            const cls = j.state === 'booked' ? 'booked' : j.state === 'reserved' ? 'reserved' : 'quoted';
            const lbl = j.state === 'booked' ? '⬤ Booked' : j.state === 'reserved' ? '◉ Reserved' : '○ Quoted';
            rows += `<div class="tt-row ${cls}"><span class="tt-job-name">${esc(j.name)}</span><span>×${j.qty} ${lbl}</span></div>`;
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

// ── Dashboard tab ────────────────────────────────────────────
let dashTabDone = false;
function injectDashboardTab() {
    if (dashTabDone) return;
    const sels = ['nav .navbar-nav','.navbar-nav','nav ul.nav','.nav.navbar-nav','#main-nav ul','.top-nav ul','header nav ul','nav.navbar ul','.navbar ul:not(.dropdown-menu)','nav:first-of-type ul:first-of-type'];
    let nav = null;
    for (const s of sels) { const cs = document.querySelectorAll(s); for (const el of cs) { if (el.querySelectorAll(':scope > li > a').length >= 2) { nav = el; break; } } if (nav) break; }
    if (!nav || nav.querySelector('.rms-multitool-dashboard-tab')) return;

    const ref = nav.querySelector(':scope > li');
    const li = document.createElement('li');
    li.className = 'rms-multitool-dashboard-tab';
    if (ref) for (const c of ref.classList) { if (c !== 'active' && c !== 'current') li.classList.add(c); }
    li.style.cssText = 'border-top:3px solid #00e5a0;border-bottom:none;border-left:none;border-right:none;';

    const a = document.createElement('a');
    a.href = chrome.runtime.getURL('dashboard.html');
    a.target = '_blank'; a.textContent = 'Quote Dashboard'; a.title = 'RMS Multitool — Quote Dashboard';
    const refA = ref ? ref.querySelector(':scope > a') : null;
    if (refA) {
        for (const c of refA.classList) a.classList.add(c);
        const cs = window.getComputedStyle(refA);
        a.style.cssText = `font-size:${cs.fontSize}!important;font-family:${cs.fontFamily}!important;font-weight:${cs.fontWeight}!important;color:${cs.color}!important;padding:${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}!important;line-height:${cs.lineHeight}!important;text-decoration:none!important;display:${cs.display}!important;text-transform:${cs.textTransform}!important;letter-spacing:${cs.letterSpacing}!important;outline:none!important;border:none!important;box-shadow:none!important;`;
    }
    if (!document.querySelector('#rms-multitool-nav-style')) {
        const st = document.createElement('style'); st.id = 'rms-multitool-nav-style';
        st.textContent = `.rms-multitool-dashboard-tab,.rms-multitool-dashboard-tab a,.rms-multitool-dashboard-tab a:visited,.rms-multitool-dashboard-tab a:focus,.rms-multitool-dashboard-tab a:active,.rms-multitool-dashboard-tab a:hover,.rms-multitool-crew-tab,.rms-multitool-crew-tab a,.rms-multitool-crew-tab a:visited,.rms-multitool-crew-tab a:focus,.rms-multitool-crew-tab a:active,.rms-multitool-crew-tab a:hover{text-decoration:none!important;outline:none!important;box-shadow:none!important;border-bottom:none!important;border-left:none!important;border-right:none!important;}`;
        document.head.appendChild(st);
    }
    li.appendChild(a); nav.appendChild(li);

    // ── Crew & Vehicle Dashboard tab ─────────────────────────
    if (!nav.querySelector('.rms-multitool-crew-tab')) {
        const li2 = document.createElement('li');
        li2.className = 'rms-multitool-crew-tab';
        if (ref) for (const c of ref.classList) { if (c !== 'active' && c !== 'current') li2.classList.add(c); }
        li2.style.cssText = 'border-top:3px solid #6bb8ff;border-bottom:none;border-left:none;border-right:none;';
        const a2 = document.createElement('a');
        a2.href = chrome.runtime.getURL('services-dashboard.html');
        a2.target = '_blank'; a2.textContent = 'Crew & Vehicles'; a2.title = 'RMS Multitool — Crew & Vehicle Dashboard';
        if (refA) {
            for (const c of refA.classList) a2.classList.add(c);
            const cs2 = window.getComputedStyle(refA);
            a2.style.cssText = `font-size:${cs2.fontSize}!important;font-family:${cs2.fontFamily}!important;font-weight:${cs2.fontWeight}!important;color:${cs2.color}!important;padding:${cs2.paddingTop} ${cs2.paddingRight} ${cs2.paddingBottom} ${cs2.paddingLeft}!important;line-height:${cs2.lineHeight}!important;text-decoration:none!important;display:${cs2.display}!important;text-transform:${cs2.textTransform}!important;letter-spacing:${cs2.letterSpacing}!important;outline:none!important;border:none!important;box-shadow:none!important;`;
        }
        li2.appendChild(a2); nav.appendChild(li2);
    }
    dashTabDone = true;
}

const observer = new MutationObserver(() => { scanAndInject(); if (!dashTabDone) injectDashboardTab(); });
observer.observe(document.body, { childList: true, subtree: true });
scanAndInject();
injectDashboardTab();
