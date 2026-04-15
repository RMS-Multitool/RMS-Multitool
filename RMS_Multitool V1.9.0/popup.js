// popup.js — RMS Multitool v1.7.0

const PURCHASE_URL = 'https://rmsmultitool.lemonsqueezy.com/checkout/buy/762542db-6f64-43d5-a2ad-2e69128cf927';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const subdomainInput        = document.getElementById('subdomain');
const apiKeyInput           = document.getElementById('apiKey');
const anthropicApiKeyInput  = document.getElementById('anthropicApiKey');
const saveBtn               = document.getElementById('saveBtn');
const testBtn               = document.getElementById('testBtn');
const refreshStoresBtn      = document.getElementById('refreshStoresBtn');
const statusBadge           = document.getElementById('statusBadge');
const statusText            = document.getElementById('statusText');
const storesSection         = document.getElementById('storesSection');
const dashboardBtn          = document.getElementById('dashboardBtn');
const crewDashboardBtn      = document.getElementById('crewDashboardBtn');
const warehouseDashboardBtn = document.getElementById('warehouseDashboardBtn');
const crewbaseBtn           = document.getElementById('crewbaseBtn');


// Logo fallback
const logoImg = document.getElementById('popupLogoImg');
if (logoImg) {
  logoImg.addEventListener('error', () => {
    const logo = document.getElementById('popupLogo');
    if (logo) {
      logo.classList.add('logo--fallback');
      logo.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 7H4C2.9 7 2 7.9 2 9v10c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zm-9 8H5v-2h6v2zm8 0h-2v-2h2v2zm0-4H5v-2h14v2zM15 5H9V3h6v2z"/></svg>';
    }
  });
}

let allStores = [];
let currentStockMode = 'simple';

// All features (for saving flags)
const ALL_FEATURES = ['quoteMute', 'deliverySheet', 'quoteDashboard', 'crewDashboard', 'warehouseDashboard'];

// ── Stock mode ────────────────────────────────────────────────────────────────
const stockModeDescs = {
    'off':        'Multi-store stock display is disabled.',
    'simple':     'Shows total held stock per enabled store.',
    'date-aware': 'Shows availability for the quote\'s date range — flags items reserved or booked on other jobs.'
};
document.querySelectorAll('.stock-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setStockMode(btn.dataset.mode));
});
function setStockMode(mode) {
    currentStockMode = mode;
    document.querySelectorAll('.stock-mode-btn').forEach(btn => {
        const on = btn.dataset.mode === mode;
        btn.style.borderColor = on ? 'var(--accent)' : 'var(--border)';
        btn.style.background  = on ? 'var(--accent-dim)' : 'var(--surface)';
        btn.style.color       = on ? 'var(--accent)' : 'var(--text-muted)';
        btn.style.fontWeight  = on ? '700' : '400';
        btn.classList.toggle('active', on);
    });
    document.getElementById('stockModeDesc').textContent = stockModeDescs[mode] || '';
}

// ── State ─────────────────────────────────────────────────────────────────────
let featureFlags = {};  // { quoteMute: true, deliverySheet: true, ... }

// ── Render feature section ────────────────────────────────────────────────────
function renderFeatures() {
    updateDashboardButtons();
}

function cap(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function isFeatureOn(feature) {
    return featureFlags[feature] !== false;
}

function updateDashboardButtons() {
    if (dashboardBtn)          dashboardBtn.style.display          = isFeatureOn('quoteDashboard')     ? 'flex' : 'none';
    if (crewDashboardBtn)      crewDashboardBtn.style.display      = isFeatureOn('crewDashboard')      ? 'flex' : 'none';
    if (warehouseDashboardBtn) warehouseDashboardBtn.style.display = isFeatureOn('warehouseDashboard') ? 'flex' : 'none';
}

// ── Load settings on open ─────────────────────────────────────────────────────
chrome.storage.sync.get(
    ['subdomain', 'apiKey', 'anthropicApiKey', 'storeConfig', 'stockMode', 'featureFlags'],
    (syncResult) => {
        if (syncResult.subdomain)       subdomainInput.value       = syncResult.subdomain;
        if (syncResult.apiKey)          apiKeyInput.value          = syncResult.apiKey;
        if (syncResult.anthropicApiKey) anthropicApiKeyInput.value = syncResult.anthropicApiKey;
        if (syncResult.stockMode)       setStockMode(syncResult.stockMode);

        featureFlags = syncResult.featureFlags || {};

        // Restore feature toggle states
        ALL_FEATURES.forEach(f => {
            const el = document.getElementById(`feat${cap(f)}`);
            if (el) el.checked = featureFlags[f] !== false;
        });

        renderFeatures();

        if (syncResult.subdomain && syncResult.apiKey) {
            setStatus('connected');
            fetchStores(syncResult.subdomain, syncResult.apiKey, syncResult.storeConfig || {});
        }
    }
);

// ── Dashboard button handlers ─────────────────────────────────────────────────
function openWithLicense(url) {
    chrome.runtime.sendMessage({ action: 'getLicenseStatus' }, (status) => {
        if (chrome.runtime.lastError) status = undefined;
        if (status && status.allowed) chrome.tabs.create({ url: chrome.runtime.getURL(url) });
    });
}
dashboardBtn         && dashboardBtn.addEventListener('click',          () => openWithLicense('dashboard.html'));
crewDashboardBtn     && crewDashboardBtn.addEventListener('click',      () => openWithLicense('services-dashboard.html'));
warehouseDashboardBtn && warehouseDashboardBtn.addEventListener('click',() => openWithLicense('warehouse-dashboard.html'));
crewbaseBtn           && crewbaseBtn.addEventListener('click', () => chrome.tabs.create({ url: 'https://web-production-82ad6.up.railway.app/admin' }));

// ── Stores ────────────────────────────────────────────────────────────────────
function fetchStores(subdomain, apiKey, savedConfig) {
    storesSection.innerHTML = `<div class="stores-loading"><span class="spinner"></span> Loading stores...</div>`;
    fetch(`https://api.current-rms.com/api/v1/stores?per_page=50`, {
        method: 'GET',
        headers: { 'X-SUBDOMAIN': subdomain, 'X-AUTH-TOKEN': apiKey, 'Content-Type': 'application/json' }
    })
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(data => {
        allStores = data.stores || [];
        if (!allStores.length) { storesSection.innerHTML = `<div class="stores-error">No stores found.</div>`; return; }
        allStores.sort((a, b) => a.id - b.id);
        buildStoreRows(savedConfig);
    })
    .catch(() => { storesSection.innerHTML = `<div class="stores-error">✗ Could not load stores — check credentials</div>`; });
}

function buildStoreRows(savedConfig) {
    storesSection.innerHTML = '';
    allStores.forEach((store, i) => {
        const cfg        = savedConfig[store.id] || {};
        const isEnabled  = cfg.enabled !== undefined ? cfg.enabled : false;
        const customName = cfg.name || store.name;
        const row = document.createElement('div');
        row.className = `store-row${isEnabled ? '' : ' disabled'}`;
        row.style.animationDelay = `${i * 30}ms`;
        row.dataset.storeId = store.id;
        row.innerHTML = `
            <input type="checkbox" class="store-toggle" ${isEnabled ? 'checked' : ''} title="Enable this store"/>
            <div class="store-id-badge">${store.id}</div>
            <input class="store-name-input" type="text" value="${escH(customName)}" placeholder="${escH(store.name)}" spellcheck="false"/>
        `;
        row.querySelector('.store-toggle').addEventListener('change', function() {
            row.classList.toggle('disabled', !this.checked);
        });
        storesSection.appendChild(row);
    });
}

function collectStoreConfig() {
    const cfg = {};
    document.querySelectorAll('.store-row').forEach(row => {
        const id      = parseInt(row.dataset.storeId);
        const enabled = row.querySelector('.store-toggle').checked;
        const name    = row.querySelector('.store-name-input').value.trim();
        const orig    = allStores.find(s => s.id === id);
        cfg[id] = { enabled, name: name || (orig ? orig.name : `Store ${id}`) };
    });
    return cfg;
}

// ── Save ──────────────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', () => {
    const subdomain       = subdomainInput.value.trim();
    const apiKey          = apiKeyInput.value.trim();
    const anthropicApiKey = anthropicApiKeyInput.value.trim();
    const storeConfig     = collectStoreConfig();

    if (!subdomain) subdomainInput.classList.add('error');
    if (!apiKey)    apiKeyInput.classList.add('error');
    if (!subdomain || !apiKey) { showToast('Please fill in all fields', 'error'); return; }

    // Collect feature flag states
    ALL_FEATURES.forEach(f => {
        const el = document.getElementById(`feat${cap(f)}`);
        if (el) featureFlags[f] = el.checked;
    });

    chrome.storage.sync.set({
        subdomain, apiKey, anthropicApiKey, storeConfig,
        stockMode: currentStockMode,
        featureFlags,
        quoteMuteEnabled: featureFlags.quoteMute !== false // backward compat
    }, () => {
        setStatus('connected');
        notifyTabs({ type: 'featureFlagsUpdated', flags: featureFlags });
        showToast('✓ Settings saved', 'success');
    });
});

// ── Refresh / Test ────────────────────────────────────────────────────────────
refreshStoresBtn.addEventListener('click', () => {
    const s = subdomainInput.value.trim(), k = apiKeyInput.value.trim();
    if (!s || !k) { showToast('Enter credentials first', 'error'); return; }
    chrome.storage.sync.get(['storeConfig'], r => fetchStores(s, k, r.storeConfig || {}));
});

testBtn.addEventListener('click', () => {
    const s = subdomainInput.value.trim(), k = apiKeyInput.value.trim();
    if (!s || !k) { showToast('Enter subdomain and API key first', 'error'); return; }
    testBtn.disabled = true;
    testBtn.innerHTML = '<span class="spinner"></span> Testing...';
    fetch(`https://api.current-rms.com/api/v1/stores?per_page=1`, {
        method: 'GET',
        headers: { 'X-SUBDOMAIN': s, 'X-AUTH-TOKEN': k, 'Content-Type': 'application/json' }
    })
    .then(r => { if (r.ok) return r.json(); throw new Error(`HTTP ${r.status}`); })
    .then(() => {
        setStatus('connected');
        showToast('✓ Connection successful', 'success');
        chrome.storage.sync.get(['storeConfig'], r => fetchStores(s, k, r.storeConfig || {}));
    })
    .catch(() => { setStatus('disconnected'); showToast('✗ Connection failed — check credentials', 'error'); })
    .finally(() => { testBtn.disabled = false; testBtn.textContent = 'Test Connection'; });
});

function tryAutoLoad() {
    const s = subdomainInput.value.trim(), k = apiKeyInput.value.trim();
    if (s && k && allStores.length === 0) chrome.storage.sync.get(['storeConfig'], r => fetchStores(s, k, r.storeConfig || {}));
}
subdomainInput.addEventListener('blur',  tryAutoLoad);
apiKeyInput.addEventListener('blur',     tryAutoLoad);
subdomainInput.addEventListener('input', () => subdomainInput.classList.remove('error'));
apiKeyInput.addEventListener('input',    () => apiKeyInput.classList.remove('error'));

// ── Helpers ───────────────────────────────────────────────────────────────────
function setStatus(state) {
    const on = state === 'connected';
    statusBadge.classList.toggle('connected', on);
    statusText.textContent = on ? 'Connected' : 'Not set';
}

function showToast(msg, type = '') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast ${type} show`;
    setTimeout(() => t.classList.remove('show'), 2500);
}

function escH(str) {
    return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function notifyTabs(msg) {
    chrome.tabs.query({ url: '*://*.current-rms.com/*' }, tabs => {
        tabs.forEach(tab => chrome.tabs.sendMessage(tab.id, msg).catch(() => {}));
    });
}

// ── Template Job / Group Import ───────────────────────────────────────────────
const templateJobIdInput = document.getElementById('templateJobId');
const loadGroupsBtn      = document.getElementById('loadGroupsBtn');
const tplStatus          = document.getElementById('tplStatus');
const tplSaveRow         = document.getElementById('tplSaveRow');
const saveGroupConfigBtn = document.getElementById('saveGroupConfigBtn');
const tplConfigRow       = document.getElementById('tplConfigRow');
const openGroupConfigBtn = document.getElementById('openGroupConfigBtn');

let templateGroupConfig = []; // [{ id, name, enabled, isHeading }]

function updateGroupSummary() {
    const total    = templateGroupConfig.filter(g => !g.isHeading).length;
    const enabled  = templateGroupConfig.filter(g => g.enabled && !g.isHeading).length;
    const headings = templateGroupConfig.filter(g => g.isHeading).length;
    if (total) {
        tplStatus.textContent = `${enabled} of ${total} groups selected` + (headings ? ` · ${headings} heading${headings !== 1 ? 's' : ''}` : '');
        tplStatus.className = 'tpl-status ok';
    }
    tplConfigRow.style.display = total ? 'block' : 'none';
}

// Load saved template config on open
chrome.storage.sync.get(['templateJobId'], (sr) => {
    if (sr.templateJobId) templateJobIdInput.value = sr.templateJobId;
});
chrome.storage.local.get(['templateGroupConfig'], (lr) => {
    if (lr.templateGroupConfig && lr.templateGroupConfig.length) {
        templateGroupConfig = lr.templateGroupConfig;
        updateGroupSummary();
        tplSaveRow.style.display = 'block';
    }
});

// Re-read config when popup regains focus (user may have saved in the config window)
window.addEventListener('focus', () => {
    chrome.storage.local.get(['templateGroupConfig'], (lr) => {
        if (lr.templateGroupConfig && lr.templateGroupConfig.length) {
            templateGroupConfig = lr.templateGroupConfig;
            updateGroupSummary();
        }
    });
});

loadGroupsBtn.addEventListener('click', () => {
    const jobId = templateJobIdInput.value.trim();
    if (!jobId) { tplStatus.textContent = 'Enter a job ID first'; tplStatus.className = 'tpl-status err'; return; }
    tplStatus.textContent = '⏳ Loading items from job ' + jobId + '…';
    tplStatus.className = 'tpl-status';

    chrome.runtime.sendMessage({ action: 'getTemplateGroups', oppId: jobId }, (res) => {
        if (!res || !res.success) {
            tplStatus.textContent = '✗ ' + (res && res.error ? res.error : 'Could not load items');
            tplStatus.className = 'tpl-status err';
            return;
        }
        const items = res.items || [];
        const named = items.filter(i => i.name && i.name.trim());
        if (!named.length) {
            tplStatus.textContent = 'No named items found in this job';
            tplStatus.className = 'tpl-status err';
            return;
        }
        // Merge with existing config to preserve enabled, isHeading and isMasterHeading state
        const existingMap = {};
        templateGroupConfig.forEach(g => { existingMap[g.id] = { enabled: g.enabled, isHeading: g.isHeading, isMasterHeading: g.isMasterHeading }; });
        templateGroupConfig = named.map(i => ({
            id:              i.id,
            name:            i.name.trim(),
            description:     (i.description || '').trim(),
            enabled:         existingMap[i.id] !== undefined ? existingMap[i.id].enabled         : false,
            isHeading:       existingMap[i.id] !== undefined ? existingMap[i.id].isHeading       : false,
            isMasterHeading: existingMap[i.id] !== undefined ? existingMap[i.id].isMasterHeading : false
        }));
        // Auto-save fresh list so Configure Groups window has it immediately
        chrome.storage.local.set({ templateGroupConfig }, () => {
            updateGroupSummary();
            tplSaveRow.style.display = 'block';
            showToast('✓ Groups loaded — click Configure Groups to set them up', 'success');
        });
    });
});

// Open the full Configure Groups window
openGroupConfigBtn.addEventListener('click', () => {
    chrome.windows.create({
        url: chrome.runtime.getURL('group-config.html'),
        type: 'popup',
        width: 900,
        height: 640
    });
});

saveGroupConfigBtn.addEventListener('click', () => {
    const jobId = templateJobIdInput.value.trim();
    if (!jobId) { tplStatus.textContent = 'Enter a job ID first'; tplStatus.className = 'tpl-status err'; return; }
    chrome.storage.sync.set({ templateJobId: jobId }, () => {
        notifyTabs({ type: 'templateConfigUpdated' });
        showToast('✓ Template job ID saved', 'success');
        updateGroupSummary();
    });
});

// ── Version & Update Checker ──────────────────────────────────────────────────
const CURRENT_VERSION = '1.8.0';
const GITHUB_OWNER    = 'RMS-Multitool';
const GITHUB_REPO     = 'RMS-Multitool';

document.getElementById('versionBadge').textContent = 'v' + CURRENT_VERSION;

function compareVersions(a, b) {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i]||0) - (pb[i]||0);
        if (d !== 0) return d;
    }
    return 0;
}

async function checkForUpdates() {
    const section = document.getElementById('updateSection');
    const content = document.getElementById('updateContent');
    const urls = [
        `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/version.json?t=${Date.now()}`,
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/version.json`
    ];
    let data = null;
    for (const url of urls) {
        if (data) break;
        try {
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) continue;
            data = url.includes('api.github.com')
                ? JSON.parse(atob((await res.json()).content.replace(/\n/g, '')))
                : await res.json();
        } catch(e) { /* network error — try next URL */ }
    }
    if (!data || !data.version) return;
    section.style.display = 'block';
    const latest = data.version;
    if (compareVersions(latest, CURRENT_VERSION) > 0) {
        section.style.borderColor = 'rgba(0,229,160,0.3)';
        const ZIP_URL      = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/refs/heads/main.zip`;
        const RELEASES_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
        content.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <div style="width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 8px var(--accent-glow);"></div>
                <span style="font-size:12px;font-weight:700;color:var(--accent);">Update Available — v${escH(latest)}</span>
            </div>
            ${data.changelog ? `<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;line-height:1.5;">${escH(data.changelog)}</div>` : ''}
            <div style="display:flex;gap:8px;">
                <a href="${ZIP_URL}" target="_blank" style="padding:7px 14px;background:var(--accent);color:var(--bg);font-family:'DM Mono',monospace;font-size:11px;font-weight:700;border-radius:6px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;">⬇ Download v${escH(latest)}</a>
                <a href="${RELEASES_URL}" target="_blank" style="padding:7px 14px;background:var(--surface2);color:var(--text-muted);font-family:'DM Mono',monospace;font-size:11px;border-radius:6px;text-decoration:none;border:1px solid var(--border);">Release Notes</a>
            </div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:8px;opacity:0.7;">Download, extract, replace files, then reload at chrome://extensions</div>`;
    } else {
        section.style.borderColor = 'var(--border)';
        content.innerHTML = `<div style="display:flex;align-items:center;gap:8px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><span style="font-size:11px;color:var(--text-muted);">You're on the latest version</span></div>`;
    }
}
checkForUpdates();
