let config = [];

function showToast(msg, type) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast ' + (type || '') + ' show';
    setTimeout(() => t.classList.remove('show'), 2500);
}

function updateFooter() {
    const enabled  = config.filter(function(g) { return g.enabled && !g.isHeading && !g.isMasterHeading; }).length;
    const subH     = config.filter(function(g) { return g.isHeading; }).length;
    const masterH  = config.filter(function(g) { return g.isMasterHeading; }).length;
    const total    = config.filter(function(g) { return !g.isHeading && !g.isMasterHeading; }).length;
    var parts = ['<strong>' + enabled + '</strong> of ' + total + ' groups selected'];
    if (masterH) parts.push('<strong>' + masterH + '</strong> master heading' + (masterH !== 1 ? 's' : ''));
    if (subH)    parts.push('<strong>' + subH    + '</strong> sub-heading'    + (subH    !== 1 ? 's' : ''));
    document.getElementById('footerInfo').innerHTML = parts.join(' &nbsp;·&nbsp; ');
}

function renderGrid(filter) {
    const grid = document.getElementById('gcGrid');
    grid.innerHTML = '';
    const q = (filter || '').toLowerCase().trim();

    if (!config.length) {
        grid.innerHTML = '<div class="gc-empty">No groups loaded. Close this window, enter a Template Job ID and click ↻ Load Groups first.</div>';
        return;
    }

    config.forEach(function (g, i) {
        var isAnyHeading = !!g.isHeading || !!g.isMasterHeading;

        var row = document.createElement('div');
        row.className = 'gc-row';
        if (g.isMasterHeading) row.classList.add('is-master');
        else if (g.isHeading)  row.classList.add('is-heading');
        if (q && !g.name.toLowerCase().includes(q)) row.classList.add('hidden-row');

        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!g.enabled;
        cb.disabled = isAnyHeading;
        cb.addEventListener('change', function () {
            config[i].enabled = cb.checked;
            updateFooter();
        });

        var labelWrap = document.createElement('div');
        labelWrap.style.flex = '1';
        labelWrap.style.minWidth = '0';

        var label = document.createElement('div');
        label.className = 'gc-row-name';
        label.textContent = g.name;
        labelWrap.appendChild(label);

        if (g.description) {
            var desc = document.createElement('div');
            desc.className = 'gc-row-desc';
            desc.textContent = g.description;
            labelWrap.appendChild(desc);
        }

        // M button — master heading toggle
        var mBtn = document.createElement('button');
        mBtn.className = 'btn-m' + (g.isMasterHeading ? ' active' : '');
        mBtn.textContent = g.isMasterHeading ? 'M ✓' : 'M';
        mBtn.title = g.isMasterHeading ? 'Master heading — click to turn off' : 'Mark as master heading';
        mBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            config[i].isMasterHeading = !config[i].isMasterHeading;
            if (config[i].isMasterHeading) { config[i].isHeading = false; config[i].enabled = false; }
            renderGrid(document.getElementById('searchInput').value);
            updateFooter();
        });

        // H button — sub-heading toggle
        var hBtn = document.createElement('button');
        hBtn.className = 'btn-h' + (g.isHeading ? ' active' : '');
        hBtn.textContent = g.isHeading ? 'H ✓' : 'H';
        hBtn.title = g.isHeading ? 'Sub-heading — click to turn off' : 'Mark as sub-heading';
        hBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            config[i].isHeading = !config[i].isHeading;
            if (config[i].isHeading) { config[i].isMasterHeading = false; config[i].enabled = false; }
            renderGrid(document.getElementById('searchInput').value);
            updateFooter();
        });

        row.addEventListener('click', function (e) {
            if (e.target === cb || e.target === hBtn || e.target === mBtn) return;
            if (!isAnyHeading) {
                cb.checked = !cb.checked;
                config[i].enabled = cb.checked;
                updateFooter();
            }
        });

        row.appendChild(cb);
        row.appendChild(labelWrap);
        row.appendChild(mBtn);
        row.appendChild(hBtn);
        grid.appendChild(row);
    });

    updateFooter();
}

// Load config from storage
chrome.storage.local.get(['templateGroupConfig'], function (lr) {
    config = lr.templateGroupConfig || [];
    const total   = config.filter(function (g) { return !g.isHeading; }).length;
    const enabled = config.filter(function (g) { return g.enabled; }).length;
    const statusEl = document.getElementById('gcStatus');
    statusEl.textContent = config.length
        ? total + ' group' + (total !== 1 ? 's' : '') + ' · ' + enabled + ' selected'
        : 'No groups loaded yet';
    statusEl.className = 'gc-status' + (config.length ? ' ok' : '');
    renderGrid();
});

// Search filter
document.getElementById('searchInput').addEventListener('input', function (e) {
    renderGrid(e.target.value);
});

// Select All
document.getElementById('selectAllBtn').addEventListener('click', function () {
    const q = document.getElementById('searchInput').value.toLowerCase().trim();
    config.forEach(function (g, i) {
        if (g.isHeading || g.isMasterHeading) return;
        if (!q || g.name.toLowerCase().includes(q)) config[i].enabled = true;
    });
    renderGrid(document.getElementById('searchInput').value);
});

// Deselect All
document.getElementById('deselectAllBtn').addEventListener('click', function () {
    const q = document.getElementById('searchInput').value.toLowerCase().trim();
    config.forEach(function (g, i) {
        if (g.isHeading || g.isMasterHeading) return;
        if (!q || g.name.toLowerCase().includes(q)) config[i].enabled = false;
    });
    renderGrid(document.getElementById('searchInput').value);
});

// Save
document.getElementById('saveBtn').addEventListener('click', function () {
    chrome.storage.local.set({ templateGroupConfig: config }, function () {
        // Notify any open CurrentRMS tabs so they pick up the new config immediately
        chrome.tabs.query({ url: '*://*.current-rms.com/*' }, function (tabs) {
            tabs.forEach(function (tab) {
                chrome.tabs.sendMessage(tab.id, { type: 'templateConfigUpdated' }).catch(function () {});
            });
        });
        showToast('✓ Group config saved', 'success');
        setTimeout(function () { window.close(); }, 900);
    });
});

// Cancel
document.getElementById('cancelBtn').addEventListener('click', function () {
    window.close();
});

// Export config as a JSON file
document.getElementById('exportConfigBtn').addEventListener('click', function () {
    chrome.storage.sync.get(['templateJobId'], function (sr) {
        var exportData = {
            _version: 1,
            _exported: new Date().toISOString(),
            templateJobId: sr.templateJobId || '',
            templateGroupConfig: config
        };
        var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'rms-group-config.json';
        a.click();
        URL.revokeObjectURL(url);
        showToast('✓ Config exported', 'success');
    });
});

// Import config from a JSON file
document.getElementById('importConfigBtn').addEventListener('click', function () {
    document.getElementById('importFileInput').click();
});

document.getElementById('importFileInput').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (ev) {
        try {
            var data = JSON.parse(ev.target.result);
            if (!data.templateGroupConfig || !Array.isArray(data.templateGroupConfig)) {
                showToast('✗ Invalid config file', '');
                return;
            }
            config = data.templateGroupConfig;
            // Optionally restore the template job ID too
            if (data.templateJobId) {
                chrome.storage.sync.set({ templateJobId: data.templateJobId });
            }
            renderGrid();
            updateFooter();
            showToast('✓ Config imported — click Save to apply', 'success');
        } catch (err) {
            showToast('✗ Could not read file', '');
        }
    };
    reader.readAsText(file);
    // Reset so the same file can be re-imported if needed
    e.target.value = '';
});
