// popup.js

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

// ── Load saved settings on open ──────────────────────────────────────────────
chrome.storage.sync.get(['subdomain', 'apiKey', 'storeConfig'], (result) => {
    if (result.subdomain) subdomainInput.value = result.subdomain;
    if (result.apiKey)    apiKeyInput.value    = result.apiKey;

    if (result.subdomain && result.apiKey) {
        setStatus('connected');
        fetchStores(result.subdomain, result.apiKey, result.storeConfig || {});
    }
});

// ── Launch Dashboard ─────────────────────────────────────────────────────────
dashboardBtn.addEventListener('click', () => {
    const dashboardUrl = chrome.runtime.getURL('dashboard.html');
    chrome.tabs.create({ url: dashboardUrl });
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

    chrome.storage.sync.set({ subdomain, apiKey, storeConfig }, () => {
        setStatus('connected');
        showToast('✓ Settings saved', 'success');
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
