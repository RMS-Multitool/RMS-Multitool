// popup.js

// Lemon Squeezy checkout URL — "Purchase full version" link shows when no license
const PURCHASE_URL = 'https://rmsmultitool.lemonsqueezy.com/checkout/buy/762542db-6f64-43d5-a2ad-2e69128cf927';

const subdomainInput  = document.getElementById('subdomain');
const apiKeyInput     = document.getElementById('apiKey');
const saveBtn         = document.getElementById('saveBtn');
const testBtn         = document.getElementById('testBtn');
const refreshStoresBtn = document.getElementById('refreshStoresBtn');
const statusBadge     = document.getElementById('statusBadge');
const statusText      = document.getElementById('statusText');
const storesSection   = document.getElementById('storesSection');
const dashboardBtn    = document.getElementById('dashboardBtn');

let allStores = []; // full list fetched from API
let currentStockMode = 'simple'; // default

const stockModeDescs = {
    'off': 'Multi-store stock display is disabled.',
    'simple': 'Shows total held stock per enabled store.',
    'date-aware': 'Shows availability for the quote\'s date range — flags items booked or reserved on other jobs across all stores.'
};

// ── Stock mode toggle ────────────────────────────────────────────────────────
const stockModeBtns = document.querySelectorAll('.stock-mode-btn');
const stockModeDesc = document.getElementById('stockModeDesc');

function setStockMode(mode) {
    currentStockMode = mode;
    stockModeBtns.forEach(btn => {
        const isActive = btn.dataset.mode === mode;
        btn.style.borderColor = isActive ? 'var(--accent)' : 'var(--border)';
        btn.style.background = isActive ? 'var(--accent-dim)' : 'var(--surface)';
        btn.style.color = isActive ? 'var(--accent)' : 'var(--text-muted)';
        btn.style.fontWeight = isActive ? '700' : '400';
        if (isActive) btn.classList.add('active');
        else btn.classList.remove('active');
    });
    stockModeDesc.textContent = stockModeDescs[mode] || '';
}

stockModeBtns.forEach(btn => {
    btn.addEventListener('click', () => setStockMode(btn.dataset.mode));
});

// ── License: features are disabled until user enters a trial or unlock code ───
function refreshLicenseUI() {
    var statusEl = document.getElementById('licenseStatus');
    var purchaseBlock = document.getElementById('purchaseBlock');
    var purchaseLink = document.getElementById('purchaseLink');
    var muteBlock = document.getElementById('quoteMuteBlock');
    var dashBtn = document.getElementById('dashboardBtn');
    var crewDashBtn = document.getElementById('crewDashboardBtn');
    var whDashBtn = document.getElementById('warehouseDashboardBtn');
    if (muteBlock) muteBlock.style.display = 'none';
    if (dashBtn) dashBtn.style.display = 'none';
    if (crewDashBtn) crewDashBtn.style.display = 'none';
    if (whDashBtn) whDashBtn.style.display = 'none';
    if (purchaseBlock) purchaseBlock.style.display = 'none';
    if (statusEl) { statusEl.textContent = 'Checking…'; statusEl.style.color = 'var(--text-muted)'; }

    try {
        chrome.runtime.sendMessage({ action: 'getLicenseStatus' }, function (status) {
            if (chrome.runtime.lastError) status = undefined;
            if (!statusEl) return;
            if (!status || status.allowed !== true) {
                statusEl.textContent = 'Enter a license code to unlock. New installs get a 7-day free trial.';
                statusEl.style.color = 'var(--text-muted)';
                if (purchaseBlock && purchaseLink && typeof PURCHASE_URL === 'string' && PURCHASE_URL && PURCHASE_URL.startsWith('http')) {
                    purchaseLink.href = PURCHASE_URL;
                    purchaseBlock.style.display = 'block';
                }
                if (muteBlock) muteBlock.style.display = 'none';
                if (dashBtn) dashBtn.style.display = 'none';
                if (crewDashBtn) crewDashBtn.style.display = 'none';
                if (whDashBtn) whDashBtn.style.display = 'none';
                return;
            }
            statusEl.textContent = status.unlocked ? 'Unlocked' : 'Trial: ' + (status.trialDaysLeft || 0) + ' days left';
            statusEl.style.color = 'var(--accent)';
            if (purchaseBlock) purchaseBlock.style.display = 'none';
            if (muteBlock) muteBlock.style.display = 'block';
            if (dashBtn) dashBtn.style.display = 'flex';
            if (crewDashBtn) crewDashBtn.style.display = 'flex';
            if (whDashBtn) whDashBtn.style.display = 'flex';
        });
    } catch (e) {
        if (statusEl) {
            statusEl.textContent = 'Enter a license code to unlock. New installs get a 7-day free trial.';
            statusEl.style.color = 'var(--text-muted)';
        }
        if (purchaseBlock) purchaseBlock.style.display = 'block';
        if (muteBlock) muteBlock.style.display = 'none';
        if (dashBtn) dashBtn.style.display = 'none';
        if (crewDashBtn) crewDashBtn.style.display = 'none';
        if (whDashBtn) whDashBtn.style.display = 'none';
    }
}
document.getElementById('licenseCodeBtn').addEventListener('click', function () {
    var input = document.getElementById('licenseCodeInput');
    var code = (input && input.value) ? input.value.trim() : '';
    if (!code) { showToast('Enter a code', 'error'); return; }
    chrome.runtime.sendMessage({ action: 'validateLicenseCode', code: code }, function (res) {
        if (res && res.success) {
            showToast(res.type === 'unlock' ? 'Unlocked' : 'Trial started — 7 days', 'success');
            input.value = '';
            refreshLicenseUI();
        } else {
            showToast(res && res.error ? res.error : 'Invalid code', 'error');
        }
    });
});
refreshLicenseUI();

// ── Load saved settings on open ──────────────────────────────────────────────
chrome.storage.sync.get(['subdomain', 'apiKey', 'storeConfig', 'stockMode', 'quoteMuteEnabled'], (result) => {
    if (result.subdomain) subdomainInput.value = result.subdomain;
    if (result.apiKey)    apiKeyInput.value    = result.apiKey;
    if (result.stockMode) setStockMode(result.stockMode);

    // Quote Mute toggle (default: enabled)
    const muteToggle = document.getElementById('quoteMuteToggle');
    if (muteToggle) {
      muteToggle.checked = result.quoteMuteEnabled !== false;
    }

    if (result.subdomain && result.apiKey) {
        setStatus('connected');
        fetchStores(result.subdomain, result.apiKey, result.storeConfig || {});
    }
});

// ── Launch Dashboard (only visible when licensed) ────────────────────────────
dashboardBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'getLicenseStatus' }, function (status) {
        if (chrome.runtime.lastError) status = undefined;
        if (status && status.allowed) chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
    });
});
var crewDashboardBtn = document.getElementById('crewDashboardBtn');
if (crewDashboardBtn) crewDashboardBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'getLicenseStatus' }, function (status) {
        if (chrome.runtime.lastError) status = undefined;
        if (status && status.allowed) chrome.tabs.create({ url: chrome.runtime.getURL('services-dashboard.html') });
    });
});
var warehouseDashboardBtn = document.getElementById('warehouseDashboardBtn');
if (warehouseDashboardBtn) warehouseDashboardBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'getLicenseStatus' }, function (status) {
        if (chrome.runtime.lastError) status = undefined;
        if (status && status.allowed) chrome.tabs.create({ url: chrome.runtime.getURL('warehouse-dashboard.html') });
    });
});

// ── Fetch stores from CurrentRMS API ─────────────────────────────────────────
function fetchStores(subdomain, apiKey, savedConfig) {
    storesSection.innerHTML = `<div class="stores-loading"><span class="spinner"></span> Loading stores from CurrentRMS...</div>`;

    fetch(`https://api.current-rms.com/api/v1/stores?per_page=50`, {
        method: 'GET',
        headers: {
            'X-SUBDOMAIN': subdomain,
            'X-AUTH-TOKEN': apiKey,
            'Content-Type': 'application/json'
        }
    })
    .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    })
    .then(data => {
        allStores = data.stores || [];
        if (allStores.length === 0) {
            storesSection.innerHTML = `<div class="stores-error">No stores found.</div>`;
            return;
        }
        // Sort by ID for consistent ordering
        allStores.sort((a, b) => a.id - b.id);
        buildStoreRows(savedConfig);
    })
    .catch(() => {
        storesSection.innerHTML = `<div class="stores-error">✗ Could not load stores — check credentials</div>`;
    });
}

// ── Build store rows from fetched store list ──────────────────────────────────
function buildStoreRows(savedConfig) {
    storesSection.innerHTML = '';

    allStores.forEach((store, index) => {
        const config     = savedConfig[store.id] || {};
        const isEnabled  = config.enabled !== undefined ? config.enabled : false;
        const customName = config.name || store.name;

        const row = document.createElement('div');
        row.className = `store-row${isEnabled ? '' : ' disabled'}`;
        row.style.animationDelay = `${index * 30}ms`;
        row.dataset.storeId = store.id;

        row.innerHTML = `
            <input type="checkbox" class="store-toggle" ${isEnabled ? 'checked' : ''} title="Enable this store"/>
            <div class="store-id-badge">${store.id}</div>
            <input 
                class="store-name-input" 
                type="text" 
                value="${escapeHtml(customName)}" 
                placeholder="${escapeHtml(store.name)}"
                spellcheck="false"
            />
        `;

        // Toggle enabled/disabled state
        const toggle = row.querySelector('.store-toggle');
        toggle.addEventListener('change', () => {
            row.classList.toggle('disabled', !toggle.checked);
        });

        storesSection.appendChild(row);
    });
}

// ── Collect store config from current UI state ────────────────────────────────
function collectStoreConfig() {
    const config = {};
    document.querySelectorAll('.store-row').forEach(row => {
        const storeId  = parseInt(row.dataset.storeId);
        const enabled  = row.querySelector('.store-toggle').checked;
        const name     = row.querySelector('.store-name-input').value.trim();
        const original = allStores.find(s => s.id === storeId);
        config[storeId] = {
            enabled,
            name: name || (original ? original.name : `Store ${storeId}`)
        };
    });
    return config;
}

// ── Save all settings ─────────────────────────────────────────────────────────
saveBtn.addEventListener('click', () => {
    const subdomain   = subdomainInput.value.trim();
    const apiKey      = apiKeyInput.value.trim();
    const storeConfig = collectStoreConfig();

    if (!subdomain) subdomainInput.classList.add('error');
    if (!apiKey)    apiKeyInput.classList.add('error');
    if (!subdomain || !apiKey) {
        showToast('Please fill in all fields', 'error');
        return;
    }

    const quoteMuteEnabled = document.getElementById('quoteMuteToggle')?.checked !== false;

    chrome.storage.sync.set({ subdomain, apiKey, storeConfig, stockMode: currentStockMode, quoteMuteEnabled }, () => {
        setStatus('connected');
        showToast('✓ Settings saved', 'success');
    });
});

// ── Quote Mute toggle — save immediately on change ───────────────────────────
document.getElementById('quoteMuteToggle')?.addEventListener('change', (e) => {
    chrome.storage.sync.set({ quoteMuteEnabled: e.target.checked }, () => {
        showToast(e.target.checked ? '✓ Quote Mute enabled' : '✗ Quote Mute disabled', e.target.checked ? 'success' : 'error');
        // Notify any open opportunity tabs to show/hide mute UI
        chrome.tabs.query({ url: '*://*.current-rms.com/*' }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { type: 'quoteMuteToggle', enabled: e.target.checked }).catch(() => {});
            });
        });
    });
});

// ── Refresh store list ────────────────────────────────────────────────────────
refreshStoresBtn.addEventListener('click', () => {
    const subdomain = subdomainInput.value.trim();
    const apiKey    = apiKeyInput.value.trim();
    if (!subdomain || !apiKey) {
        showToast('Enter credentials first', 'error');
        return;
    }
    chrome.storage.sync.get(['storeConfig'], (result) => {
        fetchStores(subdomain, apiKey, result.storeConfig || {});
    });
});

// ── Test connection ───────────────────────────────────────────────────────────
testBtn.addEventListener('click', () => {
    const subdomain = subdomainInput.value.trim();
    const apiKey    = apiKeyInput.value.trim();

    if (!subdomain || !apiKey) {
        showToast('Enter subdomain and API key first', 'error');
        return;
    }

    testBtn.disabled = true;
    testBtn.innerHTML = '<span class="spinner"></span> Testing...';

    fetch(`https://api.current-rms.com/api/v1/stores?per_page=1`, {
        method: 'GET',
        headers: {
            'X-SUBDOMAIN': subdomain,
            'X-AUTH-TOKEN': apiKey,
            'Content-Type': 'application/json'
        }
    })
    .then(res => {
        if (res.ok) return res.json();
        throw new Error(`HTTP ${res.status}`);
    })
    .then(() => {
        setStatus('connected');
        showToast('✓ Connection successful', 'success');
        // Auto-load stores on successful test
        chrome.storage.sync.get(['storeConfig'], (result) => {
            fetchStores(subdomain, apiKey, result.storeConfig || {});
        });
    })
    .catch(() => {
        setStatus('disconnected');
        showToast('✗ Connection failed — check credentials', 'error');
    })
    .finally(() => {
        testBtn.disabled = false;
        testBtn.textContent = 'Test Connection';
    });
});

// ── Clear error state on input ────────────────────────────────────────────────
subdomainInput.addEventListener('input', () => subdomainInput.classList.remove('error'));
apiKeyInput.addEventListener('input',    () => apiKeyInput.classList.remove('error'));

// ── Auto-load stores when both fields filled ──────────────────────────────────
function tryAutoLoad() {
    const subdomain = subdomainInput.value.trim();
    const apiKey    = apiKeyInput.value.trim();
    if (subdomain && apiKey && allStores.length === 0) {
        chrome.storage.sync.get(['storeConfig'], (result) => {
            fetchStores(subdomain, apiKey, result.storeConfig || {});
        });
    }
}
subdomainInput.addEventListener('blur', tryAutoLoad);
apiKeyInput.addEventListener('blur',    tryAutoLoad);

// ── Helpers ───────────────────────────────────────────────────────────────────
function setStatus(state) {
    if (state === 'connected') {
        statusBadge.classList.add('connected');
        statusText.textContent = 'Connected';
    } else {
        statusBadge.classList.remove('connected');
        statusText.textContent = 'Not set';
    }
}

function showToast(message, type = '') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    setTimeout(() => toast.classList.remove('show'), 2500);
}

function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Version & Update Checker ─────────────────────────────────────────────────
const CURRENT_VERSION = '1.5.0';
const GITHUB_OWNER = 'RMS-Multitool';
const GITHUB_REPO  = 'RMS-Multitool';
const RELEASES_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const ZIP_URL      = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/refs/heads/main.zip`;

document.getElementById('versionBadge').textContent = 'v' + CURRENT_VERSION;

function compareVersions(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = pa[i] || 0;
        const nb = pb[i] || 0;
        if (na > nb) return 1;
        if (na < nb) return -1;
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

    for (let i = 0; i < urls.length; i++) {
        if (data) break;
        const url = urls[i];
        try {
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) continue;

            if (url.includes('api.github.com')) {
                const apiData = await res.json();
                const decoded = atob(apiData.content.replace(/\n/g, ''));
                data = JSON.parse(decoded);
            } else {
                data = await res.json();
            }
        } catch (e) {
            console.warn('[Popup] Update check failed:', e.message);
        }
    }

    if (data && data.version) {
        const latest = data.version;
        if (compareVersions(latest, CURRENT_VERSION) > 0) {
            section.style.display = 'block';
            section.style.borderColor = 'rgba(0,229,160,0.3)';
            content.innerHTML = `
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                    <div style="width:8px; height:8px; border-radius:50%; background:var(--accent); box-shadow:0 0 8px var(--accent-glow);"></div>
                    <span style="font-size:12px; font-weight:700; color:var(--accent);">Update Available — v${escapeHtml(latest)}</span>
                </div>
                ${data.changelog ? `<div style="font-size:11px; color:var(--text-muted); margin-bottom:10px; line-height:1.5;">${escapeHtml(data.changelog)}</div>` : ''}
                <div style="display:flex; gap:8px;">
                    <a href="${ZIP_URL}" target="_blank" style="padding:7px 14px; background:var(--accent); color:var(--bg); font-family:'DM Mono',monospace; font-size:11px; font-weight:700; border-radius:6px; text-decoration:none; display:inline-flex; align-items:center; gap:4px;">
                        ⬇ Download v${escapeHtml(latest)}
                    </a>
                    <a href="${RELEASES_URL}" target="_blank" style="padding:7px 14px; background:var(--surface2); color:var(--text-muted); font-family:'DM Mono',monospace; font-size:11px; border-radius:6px; text-decoration:none; border:1px solid var(--border);">
                        Release Notes
                    </a>
                </div>
                <div style="font-size:10px; color:var(--text-muted); margin-top:8px; opacity:0.7;">
                    Download, extract, replace files in your extension folder, then reload at chrome://extensions
                </div>
            `;
        } else {
            section.style.display = 'block';
            section.style.borderColor = 'var(--border)';
            content.innerHTML = `
                <div style="display:flex; align-items:center; gap:8px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    <span style="font-size:11px; color:var(--text-muted);">You're on the latest version</span>
                </div>
            `;
        }
    }
    // If both fail, just don't show anything — keeps the popup clean
}

// Check for updates when popup opens
checkForUpdates();
