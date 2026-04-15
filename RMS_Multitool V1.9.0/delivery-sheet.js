// delivery-sheet.js — RMS Multitool v1.6.0 (Event Sheet)

const oppId = new URLSearchParams(window.location.search).get('oppId');
let oppData = null;
// sitePlansData: array of { type: 'image'|'pdf', dataUrl, filename }
// PDF site plans are merged at download time — no pre-rendering needed.
let sitePlansData = [];
// additionalOpps: gear from other Current RMS opportunities combined into this event sheet
// each entry: { id, number, name, items }
let additionalOpps = [];
// apiHeaders: stored after init so addAdditionalOpp() can make API calls later
let apiHeaders = null;

// PDF site plans are embedded by background.js at download time using pdf-lib
// (page merging — no rendering needed). No client-side image conversion required.

// ── Helpers ──────────────────────────────────────────────
function fmt(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return d.toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }).replace(',', '');
}
function fmtDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// Bold "Label:" prefixes in setup details — e.g. "Stage size: 6x4m" → <strong>Stage size:</strong> 6x4m
// Skips lines that start with a time pattern (e.g. "07:00") so times aren't affected.
function fmtSetupDetails(raw) {
  if (!raw) return '';
  return raw.split('\n').map(function(line) {
    // Match "Some Text:" with optional trailing text — label contains at least one letter
    // Skip lines that look like times (e.g. "07:00" or "17:30 - 18:00")
    var m = line.match(/^([^:\r\n]+):(.*)$/);
    if (m && /[a-zA-Z]/.test(m[1]) && !/^\s*\d{1,2}:\d{2}/.test(line)) {
      return '<strong>' + esc(m[1].trimEnd()) + ':</strong>' + esc(m[2]);
    }
    return esc(line);
  }).join('\n');
}
function showToast(msg, type) {
  type = type || '';
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast ' + type + ' show';
  setTimeout(function() { t.classList.remove('show'); }, 2800);
}
function cf(key) {
  if (!oppData || !oppData.custom_fields) return '';
  const fields = oppData.custom_fields;
  if (fields[key] !== undefined) return fields[key] || '';
  const slug = key.toLowerCase().replace(/\s+/g, '_');
  if (fields[slug] !== undefined) return fields[slug] || '';
  const found = Object.entries(fields).find(function(e) { return e[0].toLowerCase().includes(key.toLowerCase()); });
  return found ? (found[1] || '') : '';
}

// ── Draft ────────────────────────────────────────────────
const DRAFT_KEY       = 'es_draft_' + oppId;
const DRIVE_FOLDER    = 'RMS Event Sheets';

// ── Google Drive helpers ──────────────────────────────────
function driveGetToken(interactive) {
  interactive = interactive !== false; // default true
  return new Promise(function(resolve, reject) {
    chrome.identity.getAuthToken({ interactive: interactive }, function(token) {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (!token) reject(new Error('No token returned'));
      else resolve(token);
    });
  });
}
async function driveFindFolder(token) {
  const q   = "name='" + DRIVE_FOLDER + "' and mimeType='application/vnd.google-apps.folder' and trashed=false";
  const url = 'https://www.googleapis.com/drive/v3/files'
            + '?q=' + encodeURIComponent(q)
            + '&fields=files(id,name)'
            + '&includeItemsFromAllDrives=true'
            + '&supportsAllDrives=true'
            + '&corpora=allDrives';
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('Drive folder search failed (' + r.status + ')');
  const d = await r.json();
  console.log('[Drive] Folder search results:', d.files);
  return (d.files && d.files.length) ? d.files[0].id : null;
}
async function driveCreateFolder(token) {
  const r = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DRIVE_FOLDER, mimeType: 'application/vnd.google-apps.folder' })
  });
  if (!r.ok) throw new Error('Drive folder create failed (' + r.status + ')');
  const d = await r.json();
  console.log('[Drive] Created folder:', d.id);
  return d.id;
}
async function driveGetOrCreateFolder(token) {
  const id = await driveFindFolder(token);
  return id || await driveCreateFolder(token);
}
async function driveFindFile(token, folderId, filename) {
  const q   = "name='" + filename + "' and '" + folderId + "' in parents and trashed=false";
  const url = 'https://www.googleapis.com/drive/v3/files'
            + '?q=' + encodeURIComponent(q)
            + '&fields=files(id,name)'
            + '&includeItemsFromAllDrives=true'
            + '&supportsAllDrives=true'
            + '&corpora=allDrives';
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('Drive file search failed (' + r.status + ')');
  const d = await r.json();
  return (d.files && d.files.length) ? d.files[0].id : null;
}
async function driveReadFile(token, fileId) {
  const r = await fetch('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media', {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (!r.ok) throw new Error('Drive file read failed (' + r.status + ')');
  return await r.json();
}
async function driveWriteFile(token, folderId, fileId, filename, dataObj) {
  const content  = JSON.stringify(dataObj);
  const boundary = 'rms_multitool_boundary_314159';
  if (fileId) {
    // Update existing file — simple media upload
    const r = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files/' + fileId + '?uploadType=media',
      { method: 'PATCH', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: content }
    );
    if (!r.ok) throw new Error('Drive file update failed (' + r.status + ')');
  } else {
    // Create new file — multipart upload includes metadata (name + parent folder)
    const meta = JSON.stringify({ name: filename, parents: [folderId] });
    const body = '--' + boundary + '\r\nContent-Type: application/json\r\n\r\n'
               + meta + '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n'
               + content + '\r\n--' + boundary + '--';
    const r = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'multipart/related; boundary=' + boundary }, body: body }
    );
    if (!r.ok) throw new Error('Drive file create failed (' + r.status + ')');
  }
}
async function driveSaveSitePlan(token, folderId, sitePlan, index) {
  // Extract MIME type and binary bytes from the data URL
  const mimeMatch = sitePlan.dataUrl.match(/^data:([^;]+);base64,/);
  const mimeType  = mimeMatch ? mimeMatch[1] : (sitePlan.type === 'pdf' ? 'application/pdf' : 'image/png');
  const base64    = sitePlan.dataUrl.split(',')[1];
  const binary    = atob(base64);
  const bytes     = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const spFilename = 'es_' + oppId + '_siteplan' + (index !== undefined ? '_' + index : '');
  const existingId = await driveFindFile(token, folderId, spFilename);
  const boundary   = 'rms_siteplan_boundary_271828';

  if (existingId) {
    // Update — send binary directly as media upload
    const r = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files/' + existingId + '?uploadType=media',
      { method: 'PATCH', headers: { Authorization: 'Bearer ' + token, 'Content-Type': mimeType }, body: bytes }
    );
    if (!r.ok) throw new Error('Drive site plan update failed (' + r.status + ')');
  } else {
    // Create — multipart upload combining JSON metadata and binary content
    const enc      = new TextEncoder();
    const metaPart = enc.encode(
      '--' + boundary + '\r\nContent-Type: application/json\r\n\r\n'
      + JSON.stringify({ name: spFilename, parents: [folderId] })
      + '\r\n--' + boundary + '\r\nContent-Type: ' + mimeType + '\r\n\r\n'
    );
    const closePart = enc.encode('\r\n--' + boundary + '--');
    const combined  = new Uint8Array(metaPart.length + bytes.length + closePart.length);
    combined.set(metaPart, 0);
    combined.set(bytes, metaPart.length);
    combined.set(closePart, metaPart.length + bytes.length);
    const r = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'multipart/related; boundary=' + boundary }, body: combined }
    );
    if (!r.ok) throw new Error('Drive site plan create failed (' + r.status + ')');
  }
  return spFilename;
}
async function driveLoadSitePlan(token, folderId, spFilename) {
  const fileId = await driveFindFile(token, folderId, spFilename);
  if (!fileId) return null;
  const r = await fetch('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media', {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (!r.ok) throw new Error('Drive site plan download failed (' + r.status + ')');
  const blob = await r.blob();
  return new Promise(function(resolve, reject) {
    const reader = new FileReader();
    reader.onload  = function(e) { resolve(e.target.result); };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ── Save / Load draft (Drive + localStorage, newest wins) ─
//
// Every save stamps _savedAt so both sources can be compared.
// On save  → writes to localStorage immediately, then Drive.
// On load  → reads both, applies whichever is newer, then
//            syncs the stale source to match.

async function saveDraft() {
  const data = collectFormData();
  data._savedAt = new Date().toISOString();

  // ── 1. Always write to localStorage first (instant, no auth needed) ──
  // Strip base64 dataUrls from site plans — they can be MB-sized and blow the
  // ~5 MB localStorage quota. Only metadata (filename, type) is stored locally;
  // the actual binary data lives in memory (sitePlansData) and on Drive.
  let localOk = false;
  try {
    const localData = Object.assign({}, data, {
      site_plans: (data.site_plans || []).map(function(sp) {
        return { type: sp.type, filename: sp.filename }; // no dataUrl
      })
    });
    localStorage.setItem(DRAFT_KEY, JSON.stringify(localData));
    localOk = true;
  } catch (e) {
    console.warn('[Draft] localStorage write failed:', e.message);
  }

  // ── 2. Write to Google Drive ─────────────────────────────────────────
  showToast('⏳ Saving…', '');
  try {
    const token    = await driveGetToken();
    const folderId = await driveGetOrCreateFolder(token);
    const filename = 'es_' + oppId + '.json';

    // Drive stores site plans as separate binary files; main JSON holds refs array
    const driveData = Object.assign({}, data, { site_plans: [], site_plan: null, site_plan_ref: null, site_plan_refs: [] });
    const plans = Array.isArray(data.site_plans) ? data.site_plans : [];
    if (plans.length) {
      try {
        showToast('⏳ Uploading site plan' + (plans.length > 1 ? 's' : '') + '…', '');
        const refs = [];
        for (let i = 0; i < plans.length; i++) {
          const sp = plans[i];
          if (!sp || !sp.dataUrl) continue;
          const spFilename = await driveSaveSitePlan(token, folderId, sp, i);
          refs.push({ filename: spFilename, original_filename: sp.filename, type: sp.type });
        }
        driveData.site_plan_refs = refs;
      } catch (spErr) {
        console.warn('[Drive] Site plan upload failed:', spErr.message);
        showToast('⚠ Site plan upload failed — text data still saved: ' + spErr.message, '');
      }
    }

    const fileId = await driveFindFile(token, folderId, filename);
    await driveWriteFile(token, folderId, fileId, filename, driveData);
    showToast('✓ Saved to Drive & locally', 'success');
  } catch (err) {
    console.warn('[Drive] Save failed:', err.message);
    showToast(localOk
      ? '⚠ Drive unavailable — saved locally only'
      : '✗ Save failed: ' + err.message,
      localOk ? '' : 'error');
  }
}

async function loadDraft() {
  // ── 1. Read localStorage (synchronous, always available) ─────────────
  let localData = null;
  try {
    const r = localStorage.getItem(DRAFT_KEY);
    if (r) localData = JSON.parse(r);
  } catch (e) { /* ignore */ }

  // ── 2. Try Drive (non-interactive — no forced sign-in popup on load) ──
  let driveData = null, driveToken = null, driveFolderId = null;
  try {
    driveToken    = await driveGetToken(false);
    driveFolderId = await driveFindFolder(driveToken);
    if (driveFolderId) {
      const filename = 'es_' + oppId + '.json';
      const fileId   = await driveFindFile(driveToken, driveFolderId, filename);
      if (fileId) driveData = await driveReadFile(driveToken, fileId);
    }
  } catch (err) {
    if (!err.message.includes('not approve') && !err.message.includes('No token')) {
      console.warn('[Drive] Load failed:', err.message);
    }
  }

  if (!driveData && !localData) return false;

  // ── 3. Newest wins ────────────────────────────────────────────────────
  const driveTime = driveData && driveData._savedAt ? new Date(driveData._savedAt).getTime() : 0;
  const localTime = localData && localData._savedAt ? new Date(localData._savedAt).getTime() : 0;
  const useDrive  = driveTime >= localTime && driveData;
  const winner    = useDrive ? driveData : localData;

  // ── 4. Resolve site plans for the winning source ─────────────────────
  if (useDrive) {
    // Support both old site_plan_ref (single) and new site_plan_refs (array)
    const refs = Array.isArray(winner.site_plan_refs) && winner.site_plan_refs.length
      ? winner.site_plan_refs
      : (winner.site_plan_ref && winner.site_plan_ref.filename ? [winner.site_plan_ref] : []);
    if (refs.length) {
      const loadedPlans = [];
      for (const ref of refs) {
        try {
          const spDataUrl = await driveLoadSitePlan(driveToken, driveFolderId, ref.filename);
          if (spDataUrl) loadedPlans.push({ type: ref.type, dataUrl: spDataUrl, filename: ref.original_filename });
        } catch (spErr) { console.warn('[Drive] Site plan load failed:', spErr.message); }
      }
      winner.site_plans = loadedPlans;
    }
    // Sync newer Drive data down to localStorage — strip dataUrls to avoid quota
    try {
      const localCopy = Object.assign({}, winner, {
        site_plans: (winner.site_plans || []).map(function(sp) {
          return { type: sp.type, filename: sp.filename }; // no dataUrl
        })
      });
      localStorage.setItem(DRAFT_KEY, JSON.stringify(localCopy));
    } catch (e) { console.warn('[Draft] localStorage sync from Drive failed:', e.message); }
  }

  // ── 5. If local won and Drive is reachable, sync local up to Drive ────
  if (!useDrive && driveToken && driveFolderId) {
    try {
      const plans = Array.isArray(winner.site_plans) ? winner.site_plans : [];
      const driveSync = Object.assign({}, winner, { site_plans: [], site_plan: null, site_plan_ref: null, site_plan_refs: [] });
      const refs = [];
      for (let i = 0; i < plans.length; i++) {
        const sp = plans[i];
        if (!sp || !sp.dataUrl) continue;
        const spFilename = await driveSaveSitePlan(driveToken, driveFolderId, sp, i);
        refs.push({ filename: spFilename, original_filename: sp.filename, type: sp.type });
      }
      driveSync.site_plan_refs = refs;
      const filename = 'es_' + oppId + '.json';
      const fileId   = await driveFindFile(driveToken, driveFolderId, filename);
      await driveWriteFile(driveToken, driveFolderId, fileId, filename, driveSync);
      console.log('[Drive] Synced newer local draft up to Drive');
    } catch (syncErr) { console.warn('[Drive] Could not sync local up to Drive:', syncErr.message); }
  }

  applyFormData(winner);
  return useDrive ? 'drive' : 'local';
}
function collectFormData() {
  const crew = [];
  document.querySelectorAll('.crew-row').forEach(function(row) {
    const inp = row.querySelectorAll('input');
    crew.push({ name: inp[0] ? inp[0].value : '', role: inp[1] ? inp[1].value : '' });
  });
  return {
    venue_manager_name:  document.getElementById('f-venue-manager-name').value,
    venue_manager_phone: document.getElementById('f-venue-manager-phone').value,
    client_onsite_name:  document.getElementById('f-client-onsite-name').value,
    client_onsite_phone: document.getElementById('f-client-onsite-phone').value,
    venue_access:        document.getElementById('f-venue-access').value,
    power:               document.getElementById('f-power').value,
    generator:           document.getElementById('f-generator').value,
    parking:             document.getElementById('f-parking').value,
    wifi_ssid:           document.getElementById('f-wifi-ssid').value,
    wifi_password:       document.getElementById('f-wifi-password').value,
    delivery_info:       document.getElementById('f-delivery-info').value,
    show_times:          collectShowTimes(),
    backline:            document.getElementById('f-backline').value,

    special_notes:       document.getElementById('f-special-notes').value,
    event_brief:         document.getElementById('f-event-brief').value,
    setup_locations:     collectSetupLocations(),
    external_links:      collectExternalLinks(),
    crew: crew,
    site_plans: sitePlansData.map(function(sp) { return { type: sp.type, dataUrl: sp.dataUrl, filename: sp.filename }; }),
    additional_opps: additionalOpps.map(function(ao) { return { id: ao.id, number: ao.number, name: ao.name, items: ao.items }; })
  };
}
function applyFormData(d) {
  if (!d) return;
  function set(id, val) { const el = document.getElementById(id); if (el && val) el.value = val; }
  set('f-venue-manager-name',  d.venue_manager_name);
  set('f-venue-manager-phone', d.venue_manager_phone);
  set('f-client-onsite-name',  d.client_onsite_name);
  set('f-client-onsite-phone', d.client_onsite_phone);
  set('f-venue-access',        d.venue_access);
  set('f-power',               d.power);
  set('f-generator',           d.generator);
  set('f-parking',             d.parking);
  set('f-wifi-ssid',           d.wifi_ssid);
  set('f-wifi-password',       d.wifi_password);
  set('f-delivery-info',       d.delivery_info);
  if (d.show_times && d.show_times.length) {
    document.getElementById('showTimeList').innerHTML = '';
    d.show_times.forEach(function(r) {
      if (r.type === 'day') addShowTimeDayHeader(r.label);
      else addShowTimeRow(r.time, r.activity, r.location, r.notes);
    });
  }
  set('f-backline',            d.backline);

  set('f-special-notes',       d.special_notes);
  set('f-event-brief',         d.event_brief);
  if (d.setup_locations && d.setup_locations.length) {
    document.getElementById('setupLocationList').innerHTML = '';
    d.setup_locations.forEach(function(loc) { addSetupLocation(loc.title, loc.details); });
  }
  if (d.external_links && d.external_links.length) {
    document.getElementById('externalLinkList').innerHTML = '';
    d.external_links.forEach(function(lnk) { addExternalLinkRow(lnk.name, lnk.url); });
  }
  if (d.crew && d.crew.length) {
    document.getElementById('crewList').innerHTML = '';
    d.crew.forEach(function(c) { addCrewRow(c.name, c.role); });
  }
  // Support both old single site_plan and new site_plans array.
  // Plans restored from localStorage will have no dataUrl (stripped to avoid quota).
  // Plans restored from Drive will have a full dataUrl.
  const restoredPlans = Array.isArray(d.site_plans) ? d.site_plans
    : (d.site_plan && d.site_plan.dataUrl ? [d.site_plan] : []);
  if (restoredPlans.length) {
    const withData    = restoredPlans.filter(function(sp) { return sp && sp.dataUrl; });
    const metaOnly    = restoredPlans.filter(function(sp) { return sp && !sp.dataUrl; });
    sitePlansData = withData;
    renderSitePlanPreview();
    if (metaOnly.length) {
      // Show a non-blocking notice for each plan that needs re-attaching
      const names = metaOnly.map(function(sp) { return '"' + sp.filename + '"'; }).join(', ');
      setSitePlanStatus('warning',
        '⚠ ' + metaOnly.length + ' site plan' + (metaOnly.length > 1 ? 's' : '') +
        ' (' + names + ') need to be re-attached — save to Drive to avoid this.');
    }
  }
  // Restore additional quotes
  if (d.additional_opps && d.additional_opps.length) {
    additionalOpps = d.additional_opps;
    renderAdditionalOppList();
  }
}

// ── Crew ─────────────────────────────────────────────────
function addCrewRow(name, role) {
  name = name || ''; role = role || '';
  const list = document.getElementById('crewList');
  const row = document.createElement('div'); row.className = 'crew-row';
  const n = document.createElement('input'); n.type = 'text'; n.placeholder = 'Name'; n.value = name;
  const r = document.createElement('input'); r.type = 'text'; r.placeholder = 'Role / Position'; r.value = role;
  const x = document.createElement('button'); x.className = 'crew-remove'; x.title = 'Remove'; x.textContent = '✕';
  x.addEventListener('click', function() { row.remove(); });
  row.appendChild(n); row.appendChild(r); row.appendChild(x);
  list.appendChild(row);
}
document.getElementById('btnAddCrew').addEventListener('click', function() { addCrewRow(); });
addCrewRow();

// ── Show Times ────────────────────────────────────────────
// ── Show-time drag-to-reorder ─────────────────────────────
let _dragSrc = null;
function _makeDraggable(row) {
  row.draggable = true;
  row.addEventListener('dragstart', function(e) {
    _dragSrc = row;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(function() { row.classList.add('dragging'); }, 0);
  });
  row.addEventListener('dragend', function() {
    row.classList.remove('dragging');
    document.querySelectorAll('#showTimeList .show-time-row, #showTimeList .show-time-day')
      .forEach(function(r) { r.classList.remove('drag-over-top', 'drag-over-bottom'); });
    _dragSrc = null;
  });
  row.addEventListener('dragover', function(e) {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    if (!_dragSrc || _dragSrc === row) return;
    const rect = row.getBoundingClientRect();
    const isTop = e.clientY < rect.top + rect.height / 2;
    row.classList.toggle('drag-over-top', isTop);
    row.classList.toggle('drag-over-bottom', !isTop);
  });
  row.addEventListener('dragleave', function() {
    row.classList.remove('drag-over-top', 'drag-over-bottom');
  });
  row.addEventListener('drop', function(e) {
    e.preventDefault();
    row.classList.remove('drag-over-top', 'drag-over-bottom');
    if (!_dragSrc || _dragSrc === row) return;
    const rect = row.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      row.parentNode.insertBefore(_dragSrc, row);
    } else {
      row.parentNode.insertBefore(_dragSrc, row.nextSibling);
    }
  });
}

function addShowTimeRow(time, activity, location, notes) {
  time = time || ''; activity = activity || ''; location = location || ''; notes = notes || '';
  const list = document.getElementById('showTimeList');
  const row = document.createElement('div'); row.className = 'show-time-row';
  const handle = document.createElement('span'); handle.className = 'drag-handle'; handle.textContent = '⠿'; handle.title = 'Drag to reorder';
  const t = document.createElement('input'); t.type = 'text'; t.placeholder = 'e.g. 18:00'; t.value = time;
  const a = document.createElement('input'); a.type = 'text'; a.placeholder = 'e.g. Doors Open'; a.value = activity;
  const l = document.createElement('input'); l.type = 'text'; l.placeholder = 'e.g. Main Stage'; l.value = location;
  const n = document.createElement('input'); n.type = 'text'; n.placeholder = 'Notes'; n.value = notes;
  const x = document.createElement('button'); x.className = 'crew-remove'; x.title = 'Remove row'; x.textContent = '✕';
  x.addEventListener('click', function() { row.remove(); });
  row.appendChild(handle); row.appendChild(t); row.appendChild(a); row.appendChild(l); row.appendChild(n); row.appendChild(x);
  _makeDraggable(row);
  list.appendChild(row);
}
function addShowTimeDayHeader(label) {
  label = label || '';
  const list = document.getElementById('showTimeList');
  const row = document.createElement('div'); row.className = 'show-time-day';
  const handle = document.createElement('span'); handle.className = 'drag-handle'; handle.textContent = '⠿'; handle.title = 'Drag to reorder';
  const inp = document.createElement('input'); inp.type = 'text';
  inp.placeholder = 'e.g. Friday 21 March 2025'; inp.value = label;
  const x = document.createElement('button'); x.className = 'crew-remove'; x.title = 'Remove day'; x.textContent = '✕';
  x.addEventListener('click', function() { row.remove(); });
  row.appendChild(handle); row.appendChild(inp); row.appendChild(x);
  _makeDraggable(row);
  list.appendChild(row);
}
function collectShowTimes() {
  var rows = [];
  document.querySelectorAll('#showTimeList .show-time-row, #showTimeList .show-time-day').forEach(function(el) {
    if (el.classList.contains('show-time-day')) {
      var label = el.querySelector('input').value.trim();
      if (label) rows.push({ type: 'day', label: label });
    } else {
      var inp = el.querySelectorAll('input');
      var r = { time: inp[0].value.trim(), activity: inp[1].value.trim(), location: inp[2].value.trim(), notes: inp[3].value.trim() };
      if (r.time || r.activity || r.location || r.notes) rows.push(r);
    }
  });
  return rows;
}
document.getElementById('btnAddShowTime').addEventListener('click', function() { addShowTimeRow(); });
document.getElementById('btnAddShowTimeDay').addEventListener('click', function() { addShowTimeDayHeader(); });

// ── External Links ────────────────────────────────────────
let _dragLinkSrc = null;
function _makeLinkRowDraggable(row) {
  row.draggable = true;
  row.addEventListener('dragstart', function(e) {
    _dragLinkSrc = row;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  row.addEventListener('dragend', function() {
    row.classList.remove('dragging');
    document.querySelectorAll('#externalLinkList .ext-link-row')
      .forEach(function(r) { r.classList.remove('drag-over-top', 'drag-over-bottom'); });
    _dragLinkSrc = null;
  });
  row.addEventListener('dragover', function(e) {
    if (!_dragLinkSrc || _dragLinkSrc === row) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = row.getBoundingClientRect();
    const mid  = rect.top + rect.height / 2;
    row.classList.toggle('drag-over-top',    e.clientY < mid);
    row.classList.toggle('drag-over-bottom', e.clientY >= mid);
  });
  row.addEventListener('dragleave', function() {
    row.classList.remove('drag-over-top', 'drag-over-bottom');
  });
  row.addEventListener('drop', function(e) {
    if (!_dragLinkSrc || _dragLinkSrc === row) return;
    e.preventDefault();
    row.classList.remove('drag-over-top', 'drag-over-bottom');
    const rect = row.getBoundingClientRect();
    const mid  = rect.top + rect.height / 2;
    const list = document.getElementById('externalLinkList');
    if (e.clientY < mid) list.insertBefore(_dragLinkSrc, row);
    else list.insertBefore(_dragLinkSrc, row.nextSibling);
  });
}
function addExternalLinkRow(name, url) {
  name = name || ''; url = url || '';
  const list = document.getElementById('externalLinkList');
  const row  = document.createElement('div'); row.className = 'ext-link-row';
  const handle = document.createElement('span'); handle.className = 'drag-handle'; handle.textContent = '⠿'; handle.title = 'Drag to reorder';
  const n = document.createElement('input'); n.type = 'text'; n.placeholder = 'Label (e.g. Production Folder)'; n.value = name; n.className = 'ext-link-name';
  const u = document.createElement('input'); u.type = 'url';  u.placeholder = 'https://…'; u.value = url; u.className = 'ext-link-url';
  const x = document.createElement('button'); x.className = 'crew-remove'; x.title = 'Remove'; x.textContent = '✕';
  x.addEventListener('click', function() { row.remove(); });
  row.appendChild(handle); row.appendChild(n); row.appendChild(u); row.appendChild(x);
  _makeLinkRowDraggable(row);
  list.appendChild(row);
}
function collectExternalLinks() {
  var links = [];
  document.querySelectorAll('#externalLinkList .ext-link-row').forEach(function(row) {
    var name = row.querySelector('.ext-link-name').value.trim();
    var url  = row.querySelector('.ext-link-url').value.trim();
    if (name || url) links.push({ name: name, url: url });
  });
  return links;
}
document.getElementById('btnAddExternalLink').addEventListener('click', function() { addExternalLinkRow(); });

// ── Event / Venue Setup location blocks ──────────────────
function addSetupLocation(title, details) {
  title = title || ''; details = details || '';
  const list = document.getElementById('setupLocationList');
  const block = document.createElement('div'); block.className = 'setup-block';

  const titleEl = document.createElement('input');
  titleEl.type = 'text'; titleEl.className = 'setup-block-title';
  titleEl.placeholder = 'Location / Area  (e.g. Woodstore & Yard)';
  titleEl.value = title;

  const detailEl = document.createElement('textarea');
  detailEl.className = 'setup-block-details';
  detailEl.placeholder = 'Audio:\n  BGM through ceiling speakers\n\nLighting:\n  Standard LED wash\n\nVision:\n  75" TV — client laptop';
  detailEl.value = details;

  const removeBtn = document.createElement('button');
  removeBtn.className = 'setup-block-remove'; removeBtn.title = 'Remove'; removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', function() { block.remove(); });

  block.appendChild(removeBtn);
  block.appendChild(titleEl);
  block.appendChild(detailEl);
  list.appendChild(block);
}
function collectSetupLocations() {
  var locs = [];
  document.querySelectorAll('#setupLocationList .setup-block').forEach(function(block) {
    var title   = (block.querySelector('.setup-block-title').value   || '').trim();
    var details = (block.querySelector('.setup-block-details').value || '').trim();
    if (title || details) locs.push({ title: title, details: details });
  });
  return locs;
}
document.getElementById('btnAddSetupLocation').addEventListener('click', function() { addSetupLocation(); });

// ── Load opportunity ──────────────────────────────────────
function loadOpportunity() {
  if (!oppId) {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorState').style.display = 'block';
    document.getElementById('errorMsg').textContent = 'No opportunity ID in URL.';
    return;
  }

  const msgs = ['Connecting to CurrentRMS…','Fetching opportunity data…','Loading items & schedule…','Almost ready…','Still loading — server may be slow…'];
  let msgIdx = 0;
  const msgEl = document.getElementById('loadingMsg');
  const msgTimer = setInterval(function() { msgIdx = Math.min(msgIdx + 1, msgs.length - 1); if (msgEl) msgEl.textContent = msgs[msgIdx]; }, 2500);

  chrome.storage.sync.get(['subdomain', 'apiKey'], async function(settings) {
    if (!settings.subdomain || !settings.apiKey) {
      clearInterval(msgTimer);
      document.getElementById('loadingState').style.display = 'none';
      document.getElementById('errorState').style.display = 'block';
      document.getElementById('errorMsg').textContent = 'No API credentials. Add your subdomain and API key in extension settings.';
      return;
    }

    try {
      const headers = { 'X-SUBDOMAIN': settings.subdomain, 'X-AUTH-TOKEN': settings.apiKey, 'Content-Type': 'application/json' };
      apiHeaders = headers; // stored for later use by addAdditionalOpp()

      const res = await fetch(
        'https://api.current-rms.com/api/v1/opportunities/' + oppId
        + '?include[]=opportunity_items&include[]=participants&include[]=member&include[]=venue',
        { headers: headers }
      );
      if (!res.ok) throw new Error('CurrentRMS HTTP ' + res.status);
      const json = await res.json();
      const opp  = json.opportunity || {};

      // Custom fields
      const rawCf = opp.custom_fields;
      const customFields = {};
      if (rawCf) {
        if (Array.isArray(rawCf)) {
          rawCf.forEach(function(f) {
            const key = (f.custom_field && (f.custom_field.document_layout_name || f.custom_field.name)) || f.name;
            if (key) customFields[key] = f.value;
          });
        } else if (typeof rawCf === 'object') {
          Object.keys(rawCf).forEach(function(k) {
            const v = rawCf[k];
            customFields[k] = (typeof v === 'object' && v !== null && v.value !== undefined) ? v.value : v;
          });
        }
      }

      // Participants
      const participants = opp.participants || [];
      const org     = participants.find(function(p) { return p.type === 'Organisation'; }) || null;
      const contact = participants.find(function(p) { return p.type === 'Contact'; }) || null;

      // ── Items with robust group/accessory detection ──────────────
      // CurrentRMS REST API may not return is_group as a boolean.
      // Fallback: if the NEXT item in the list is deeper, the current item is a group header.
      const rawItems = (opp.opportunity_items || []).filter(function(item) {
        return !(item.description || '').includes('[MUTED') && !(item.name || '').includes('*HIDE*');
      });

      // Log first few raw items so we can inspect real field names in the console
      if (rawItems.length) {
        console.log('[ES] Raw item sample:', rawItems.slice(0, 8).map(function(i) {
          return { name: i.name, type_name: i.opportunity_item_type_name, type_num: i.opportunity_item_type, depth: i.depth, is_group: i.is_group, is_accessory: i.is_accessory, is_subtotal: i.is_subtotal, parent_group_id: i.opportunity_item_group_id };
        }));
      }

      const items = rawItems.map(function(item, idx, arr) {
        const typeName  = (item.opportunity_item_type_name || '').toLowerCase();
        const typeNum   = item.opportunity_item_type;
        const curDepth  = item.depth == null ? 0 : item.depth;
        const nextDepth = arr[idx + 1] ? (arr[idx + 1].depth == null ? 0 : arr[idx + 1].depth) : -1;

        // Group: API boolean OR type name OR type num 0 OR next item is deeper (most reliable fallback)
        const isGroup = item.is_group === true
                     || typeName === 'group' || typeName === 'section'
                     || typeNum === 0
                     || (nextDepth > curDepth);

        // Accessory: API boolean OR type name OR type num 2
        const isAccessory = item.is_accessory === true
                         || typeName.includes('accessor')
                         || typeNum === 2;

        // Subtotal: API boolean OR type name OR type num 4
        const isSubtotal = item.is_subtotal === true
                        || typeName.includes('subtotal')
                        || typeNum === 4;

        return {
          id: item.id, name: item.name, quantity: item.quantity,
          product_group_name: item.product_group_name,
          opportunity_item_type_name: item.opportunity_item_type_name,
          is_group: isGroup, is_accessory: isAccessory, is_subtotal: isSubtotal,
          depth: curDepth,
          // Parent group ID — key for reliable parent/child detection
          parent_group_id: item.opportunity_item_group_id || item.parent_opportunity_item_id || null,
          description: (item.description || '').replace(/\[MUTED[^\]]*\]/g, '').replace(/\[HIDEONLY\]/g, '').trim()
        };
      });

      oppData = {
        id: opp.id, subject: opp.subject, number: opp.number, reference: opp.reference,
        starts_at: opp.starts_at, ends_at: opp.ends_at,
        charge_starts_at: opp.charge_starts_at, charge_ends_at: opp.charge_ends_at,
        delivery_address_name: opp.delivery_address_name,
        delivery_address: opp.delivery_address,
        delivery_instructions: opp.delivery_instructions,
        prep_starts_at: opp.prep_starts_at,         prep_ends_at: opp.prep_ends_at,
        load_starts_at: opp.load_starts_at,         load_ends_at: opp.load_ends_at,
        deliver_starts_at: opp.deliver_starts_at,   deliver_ends_at: opp.deliver_ends_at,
        setup_starts_at: opp.setup_starts_at,       setup_ends_at: opp.setup_ends_at,
        show_starts_at: opp.show_starts_at,         show_ends_at: opp.show_ends_at,
        takedown_starts_at: opp.takedown_starts_at, takedown_ends_at: opp.takedown_ends_at,
        collect_starts_at: opp.collect_starts_at,   collect_ends_at: opp.collect_ends_at,
        unload_starts_at: opp.unload_starts_at,     unload_ends_at: opp.unload_ends_at,
        deprep_starts_at: opp.deprep_starts_at,     deprep_ends_at: opp.deprep_ends_at,
        organisation_name: org     ? org.name    : (opp.member ? opp.member.name : ''),
        contact_name:      contact ? contact.name  : '',
        contact_phone:     contact ? (contact.telephone || '') : '',
        contact_email:     contact ? (contact.email || '') : '',
        venue_name: opp.venue ? opp.venue.name : (opp.delivery_address_name || ''),
        custom_fields: customFields,
        items: items,
        logoUrl: ''
      };

      // Fetch company logo — try /api/v1/company, check multiple field names
      // We store the URL directly (no base64 conversion) — extension pages can load any HTTPS img src
      try {
        const endpoints = [
          'https://api.current-rms.com/api/v1/company',
          'https://api.current-rms.com/api/v1/account'
        ];
        for (const ep of endpoints) {
          const compResp = await fetch(ep, { headers: headers });
          if (compResp.ok) {
            const compJson = await compResp.json();
            const comp = compJson.company || compJson.account || compJson;
            const iconUrl = comp.icon_url || comp.logo_url || comp.image_url || comp.avatar_url || '';
            console.log('[ES] Company logo from', ep, '→', iconUrl ? iconUrl.substring(0, 80) + '…' : 'not found');
            if (iconUrl) {
              // Convert to base64 so it embeds cleanly in the print window
              try {
                const imgResp = await fetch(iconUrl, { mode: 'cors' });
                if (imgResp.ok) {
                  const blob = await imgResp.blob();
                  oppData.logoUrl = await new Promise(function(resolve) {
                    const reader = new FileReader();
                    reader.onload = function(e) { resolve(e.target.result); };
                    reader.readAsDataURL(blob);
                  });
                  console.log('[ES] Logo converted to base64 ✓');
                } else {
                  oppData.logoUrl = iconUrl; // fallback: use URL directly
                }
              } catch (imgErr) {
                oppData.logoUrl = iconUrl; // fallback: use URL directly
                console.log('[ES] Image fetch failed, using URL directly:', imgErr.message);
              }
              break;
            }
          }
        }
      } catch (logoErr) { console.log('[ES] Logo fetch skipped:', logoErr.message); }

      clearInterval(msgTimer);
      document.getElementById('loadingState').style.display = 'none';
      populateEditor();
      document.getElementById('editorContent').style.display = 'block';
      loadDraft().then(function(source) {
        if (source === 'drive') showToast('✓ Draft restored from Drive', 'success');
        else if (source === 'local') showToast('✓ Draft restored locally', 'success');
      });

} catch (err) {
      clearInterval(msgTimer);
      document.getElementById('loadingState').style.display = 'none';
      document.getElementById('errorState').style.display = 'block';
      document.getElementById('errorMsg').textContent = 'Failed to load: ' + err.message;
    }
  });
}

// ── Populate editor ───────────────────────────────────────
function populateEditor() {
  const o = oppData;
  document.getElementById('topbarJobName').textContent = o.subject || ('Opportunity #' + o.id);
  setText('af-subject',    o.subject);
  setText('af-reference',  o.reference || o.number);
  setText('af-client',     o.organisation_name);
  setText('af-contact',    [o.contact_name, o.contact_phone, o.contact_email].filter(Boolean).join(' · '));
  setText('af-venue',      o.venue_name);
  setText('af-address',    o.delivery_address);
  setText('af-event-type', cf('event_type'));
  setText('af-audience',   cf('audience_size'));
  setText('af-event-areas',cf('event_areas'));

  const phases = [
    { label: 'Load',       start: o.load_starts_at,     end: o.load_ends_at },
    { label: 'Delivery',   start: o.deliver_starts_at,  end: o.deliver_ends_at },
    { label: 'Bump In',    start: o.setup_starts_at,    end: o.setup_ends_at },
    { label: 'Rehearsals', start: o.prep_starts_at,     end: o.prep_ends_at },
    { label: 'Show',       start: o.show_starts_at,     end: o.show_ends_at },
    { label: 'Bump Out',   start: o.takedown_starts_at, end: o.takedown_ends_at },
    { label: 'Pick Up',    start: o.collect_starts_at,  end: o.collect_ends_at },
    { label: 'Unload',     start: o.unload_starts_at,   end: o.unload_ends_at },
    { label: 'De-Prep',    start: o.deprep_starts_at,   end: o.deprep_ends_at }
  ];
  const grid = document.getElementById('scheduleGrid');
  let hasSchedule = false;
  phases.forEach(function(ph) {
    const hasData = ph.start || ph.end;
    if (hasData) hasSchedule = true;
    const div = document.createElement('div'); div.className = 'schedule-item' + (hasData ? ' has-data' : '');
    const pd = document.createElement('div'); pd.className = 'phase'; pd.textContent = ph.label;
    const td = document.createElement('div'); td.className = 'times';
    if (hasData) { td.textContent = (fmt(ph.start) || '—') + ' → ' + (fmt(ph.end) || '—'); }
    else { td.innerHTML = '<span style="color:var(--text-muted);font-size:11px;">Not set</span>'; }
    div.appendChild(pd); div.appendChild(td); grid.appendChild(div);
  });
  if (!hasSchedule) { document.getElementById('scheduleEmpty').style.display = 'block'; grid.style.display = 'none'; }

  const locs  = ['production_location1','production_location2','production_location3'];
  const heads = ['event_header1','event_header2','event_header3'];
  let hasProd = false;
  const prodBody = document.getElementById('prodReqBody');
  locs.forEach(function(loc, i) {
    const locVal = cf(loc); const headVal = cf(heads[i]);
    if (locVal || headVal) {
      hasProd = true;
      const div = document.createElement('div'); div.style.marginBottom = '14px';
      const lines = (headVal || '').split('\n').filter(function(l) { return l.trim(); });
      if (locVal) { const t = document.createElement('div'); t.style.cssText = 'font-weight:700;font-size:13px;margin-bottom:6px;color:var(--accent);'; t.textContent = locVal; div.appendChild(t); }
      const ul = document.createElement('ul'); ul.style.cssText = 'margin:0;padding-left:18px;';
      lines.forEach(function(l) { const li = document.createElement('li'); li.style.cssText = 'font-size:12px;margin-bottom:3px;color:var(--text);'; li.textContent = l.trim(); ul.appendChild(li); });
      div.appendChild(ul); prodBody.appendChild(div);
    }
  });
  if (hasProd) document.getElementById('prodReqSection').style.display = 'block';

  renderItems(o.items || []);

  const di = document.getElementById('f-delivery-info');
  if (o.delivery_instructions && di && !di.value) di.value = o.delivery_instructions;
}

function setText(id, val) {
  const el = document.getElementById(id); if (!el) return;
  if (val) { el.textContent = val; el.classList.remove('empty'); }
  else { el.textContent = 'Not set'; el.classList.add('empty'); }
}

// ── Item condensing ───────────────────────────────────────
function isTTYPackage(name)       { return /^TTY[-\s]/i.test(name || ''); }
function isLiveMusicPackage(name) { return /^live music \(/i.test(name || ''); }
function isAccessoryGroup(name)   { return /^(accessories|consumables?|cables?|power leads?|miscellaneous|misc\.?)/i.test((name || '').trim()); }
function isLabourGroup(name)      { return /^(labour|labor|crew|staff|personnel|services)/i.test((name || '').trim()); }

// ── Shared item helpers ───────────────────────────────────

// Normalises raw API opportunity_items into the same structure used by the main opp.
// Called for additional quotes so their items render identically.
function normaliseItems(rawItems) {
  return (rawItems || []).map(function(item, idx, arr) {
    const typeName  = (item.opportunity_item_type_name || '').toLowerCase();
    const typeNum   = item.opportunity_item_type;
    const curDepth  = item.depth == null ? 0 : item.depth;
    const nextDepth = arr[idx + 1] ? (arr[idx + 1].depth == null ? 0 : arr[idx + 1].depth) : -1;
    const isGroup   = item.is_group === true || typeName === 'group' || typeName === 'section'
                   || typeNum === 0 || (nextDepth > curDepth);
    const isAccessory = item.is_accessory === true || typeName.includes('accessor') || typeNum === 2;
    const isSubtotal  = item.is_subtotal  === true || typeName.includes('subtotal') || typeNum === 4;
    return {
      id: item.id, name: item.name, quantity: item.quantity,
      product_group_name: item.product_group_name,
      opportunity_item_type_name: item.opportunity_item_type_name,
      is_group: isGroup, is_accessory: isAccessory, is_subtotal: isSubtotal,
      depth: curDepth,
      parent_group_id: item.opportunity_item_group_id || item.parent_opportunity_item_id || null,
      description: (item.description || '').replace(/\[MUTED[^\]]*\]/g, '').replace(/\[HIDEONLY\]/g, '').trim()
    };
  });
}

// Renders a condensed items array into the equip-group/equip-table HTML used in the event sheet.
function buildEquipHtml(condensed) {
  let html = '';
  let tableOpen = false;
  function closeTable() { if (tableOpen) { html += '</table></div>'; tableOpen = false; } }
  condensed.forEach(function(item) {
    const name = item.name || '';
    if (item.is_group) {
      if (isTTYPackage(name) || isLiveMusicPackage(name)) {
        if (!tableOpen) { html += '<div class="equip-group"><table class="equip-table">'; tableOpen = true; }
        const desc = item.description ? '<span class="pkg-desc">' + esc(item.description) + '</span>' : '';
        html += '<tr class="pkg-row"><td colspan="3">' + (isLiveMusicPackage(name) ? '🎵 ' : '📦 ') + esc(name) + desc + '</td></tr>';
      } else {
        closeTable();
        html += '<div class="equip-group"><div class="equip-group-title">' + esc(name) + '</div><table class="equip-table">';
        tableOpen = true;
      }
    } else {
      if (!tableOpen) { html += '<div class="equip-group"><table class="equip-table">'; tableOpen = true; }
      html += '<tr><td>×' + (item.quantity || 1) + '</td><td>' + esc(name) + '</td><td>' + (item.description ? esc(item.description) : '') + '</td></tr>';
    }
  });
  closeTable();
  return html;
}

// condenseItemsAll — like condenseItems but shows all groups including cables/accessories.
// Used for additional quotes where the user explicitly wants to see everything.
function condenseItemsAll(items) {
  const result = [];
  items.forEach(function(item) {
    if (item.is_subtotal) return;
    if ((item.opportunity_item_type_name || '').toLowerCase() === 'service') return;
    // Collapse TTY / Live Music packages (show header, hide children via parent_group_id)
    result.push(item);
  });
  // Filter out children of TTY/LiveMusic collapsed packages
  const collapsedIds = new Set();
  result.forEach(function(item) {
    const name = item.name || '';
    if ((isTTYPackage(name) || isLiveMusicPackage(name)) && item.is_group) collapsedIds.add(item.id);
  });
  return result.filter(function(item) {
    if (!item.parent_group_id) return true;
    return !collapsedIds.has(item.parent_group_id);
  });
}

function condenseItems(items) {
  // ── Pass 1: Identify which group IDs should be hidden or collapsed ──────────
  // Uses opportunity_item_group_id (parent ID) for precise parent/child detection.
  // Falls back to depth, then to ordering when neither is available.

  const idToItem   = {};
  items.forEach(function(i) { if (i.id) idToItem[i.id] = i; });

  // Sets of item IDs: collapsed = show header only, hidden = don't show at all
  const collapsedIds = new Set(); // TTY/LiveMusic packages — show name, hide children
  const hiddenIds    = new Set(); // Accessories, Labour/crew — hide entirely

  items.forEach(function(item) {
    const name = item.name || '';
    if (!item.id) return;
    if (isTTYPackage(name) || isLiveMusicPackage(name)) collapsedIds.add(item.id);
    if (isAccessoryGroup(name) || isLabourGroup(name)) hiddenIds.add(item.id);
  });

  // Check if parent IDs are actually present in this dataset
  const hasParentIds = items.some(function(i) { return i.parent_group_id != null; });
  const hasRealDepth = items.some(function(i) { return i.depth != null && i.depth > 0; });

  // Propagate: if a group is collapsed/hidden, all its descendants should be too.
  // Method A — parent_group_id (most reliable)
  if (hasParentIds) {
    let changed = true;
    while (changed) {
      changed = false;
      items.forEach(function(item) {
        if (!item.id || !item.parent_group_id) return;
        const parentCollapsed = collapsedIds.has(item.parent_group_id);
        const parentHidden    = hiddenIds.has(item.parent_group_id);
        if (parentCollapsed && !collapsedIds.has(item.id) && !hiddenIds.has(item.id)) {
          hiddenIds.add(item.id); changed = true;   // child of collapsed group → hide
        }
        if (parentHidden && !hiddenIds.has(item.id)) {
          hiddenIds.add(item.id); changed = true;   // child of hidden group → hide
        }
      });
    }
  }

  // ── Pass 2: Build the visible list ──────────────────────────────────────────
  const result = [];

  // For the ordering-based fallback (no parent IDs, no depth), track collapse state
  let collapseMode  = null;
  let collapseDepth = -1;

  items.forEach(function(item) {
    const name = item.name || '';
    const depth = item.depth == null ? 0 : item.depth;

    // Never show accessories, subtotals, or service-type items
    if (item.is_accessory || item.is_subtotal) return;
    if ((item.opportunity_item_type_name || '').toLowerCase() === 'service') return;

    // ── parent_group_id available: use it directly ──
    if (hasParentIds) {
      if (hiddenIds.has(item.id))    return;           // hidden group or its descendant
      if (collapsedIds.has(item.id)) { result.push(item); return; } // show package header only
      if (item.parent_group_id && (collapsedIds.has(item.parent_group_id) || hiddenIds.has(item.parent_group_id))) return; // direct child of collapsed/hidden
      result.push(item);
      return;
    }

    // ── Depth available: use ordering + depth ──
    // (Also used when parent IDs are absent but depths vary)
    const typeName    = (item.opportunity_item_type_name || '').toLowerCase();
    const isKnown     = isTTYPackage(name) || isLiveMusicPackage(name) || isAccessoryGroup(name);
    const isGroupRow  = item.is_group === true || typeName === 'group' || typeName === 'section'
                     || item.opportunity_item_type === 0 || isKnown || item.quantity == null;

    if (isGroupRow) {
      const exits = collapseMode === null
                 || (hasRealDepth ? depth <= collapseDepth : isKnown);
      if (!exits) return;

      collapseMode = null;
      if (isTTYPackage(name) || isLiveMusicPackage(name)) {
        result.push(item); collapseMode = 'show'; collapseDepth = depth;
      } else if (isAccessoryGroup(name)) {
        collapseMode = 'hide'; collapseDepth = depth; // hide entirely
      } else {
        result.push(item);
      }
    } else {
      if (collapseMode !== null) return;
      result.push(item);
    }
  });

  return result;
}

function renderItems(items) {
  const container = document.getElementById('itemsPreview');
  const condensed = condenseItems(items);
  if (!condensed.length) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">No items on this opportunity.</div>';
    return;
  }
  container.innerHTML = '';
  condensed.forEach(function(item) {
    const name = item.name || '';
    if (item.is_group) {
      if (isTTYPackage(name) || isLiveMusicPackage(name)) {
        const row = document.createElement('div'); row.className = 'item-package-row';
        const icon = document.createElement('span'); icon.className = 'pkg-icon'; icon.textContent = isLiveMusicPackage(name) ? '🎵' : '📦';
        const ns = document.createElement('span'); ns.className = 'pkg-name'; ns.textContent = name;
        row.appendChild(icon); row.appendChild(ns);
        if (item.description) { const ds = document.createElement('span'); ds.className = 'pkg-desc'; ds.textContent = item.description; row.appendChild(ds); }
        container.appendChild(row);
      } else {
        const h = document.createElement('div'); h.className = 'item-group-header'; h.textContent = name; container.appendChild(h);
      }
    } else {
      const row = document.createElement('div'); row.className = 'item-row';
      const ns = document.createElement('span'); ns.className = 'item-name'; ns.textContent = name;
      const qs = document.createElement('span'); qs.className = 'item-qty'; qs.textContent = '\u00d7' + (item.quantity || 1);
      row.appendChild(ns); row.appendChild(qs); container.appendChild(row);
    }
  });
}

// ── File upload & Claude extraction ──────────────────────
const uploadZone   = document.getElementById('uploadZone');
const fileInput    = document.getElementById('fileInput');
const uploadStatus = document.getElementById('uploadStatus');

let fileQueue         = [];
let isProcessingQueue = false;

uploadZone.addEventListener('dragover', function(e) { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', function() { uploadZone.classList.remove('drag-over'); });
uploadZone.addEventListener('drop', function(e) {
    e.preventDefault(); uploadZone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files);
    if (files.length) enqueueFiles(files);
});
fileInput.addEventListener('change', function() {
    const files = Array.from(fileInput.files);
    if (files.length) enqueueFiles(files);
    fileInput.value = '';
});

function enqueueFiles(files) {
    fileQueue = fileQueue.concat(files);
    if (!isProcessingQueue) processQueue();
}

async function processQueue() {
    if (!fileQueue.length) { isProcessingQueue = false; return; }
    isProcessingQueue = true;
    const file = fileQueue.shift();

    // If there is already data in the form, ask how to apply
    let mode = 'swap';
    let heading = null;
    if (hasExistingFormData()) {
        const choice = await showMergeModal(file.name);
        if (!choice) { processQueue(); return; } // cancelled — skip to next
        mode    = choice.mode;
        heading = choice.heading;
    }

    await processFile(file, mode, heading);
    processQueue();
}

function hasExistingFormData() {
    const fields = ['f-venue-manager-name','f-venue-manager-phone','f-client-onsite-name',
                    'f-client-onsite-phone','f-venue-access','f-power','f-parking',
                    'f-wifi-ssid','f-wifi-password','f-event-brief'];
    if (fields.some(id => { const el = document.getElementById(id); return el && el.value.trim(); })) return true;
    const stRows = document.querySelectorAll('#showTimeList .show-time-row, #showTimeList .day-header-row');
    if (stRows.length > 0) return true;
    const locBlocks = document.querySelectorAll('#setupLocationList .setup-location-block');
    if (locBlocks.length > 0) return true;
    return false;
}

function showMergeModal(filename) {
    return new Promise(function(resolve) {
        const overlay      = document.getElementById('mergeModalOverlay');
        const fnLabel      = document.getElementById('mergeModalFilename');
        const headingStep  = document.getElementById('mergeHeadingStep');
        const headingInput = document.getElementById('mergeHeadingInput');
        const headingConfirm = document.getElementById('mergeHeadingConfirm');

        fnLabel.textContent = filename;
        headingStep.style.display = 'none';
        headingInput.value = '';
        overlay.classList.add('active');

        function close(result) {
            overlay.classList.remove('active');
            headingStep.style.display = 'none';
            cleanup();
            resolve(result);
        }

        function cleanup() {
            document.getElementById('mergeOptSwap').removeEventListener('click', onSwap);
            document.getElementById('mergeOptMerge').removeEventListener('click', onMerge);
            document.getElementById('mergeOptAdd').removeEventListener('click', onAdd);
            document.getElementById('mergeModalCancel').removeEventListener('click', onCancel);
            headingConfirm.removeEventListener('click', onHeadingConfirm);
            headingInput.removeEventListener('keydown', onHeadingKey);
        }

        function onSwap()  { close({ mode: 'swap',  heading: null }); }
        function onMerge() { close({ mode: 'merge', heading: null }); }

        function onAdd() {
            // Show step 2 — heading input
            document.getElementById('mergeOptSwap').style.display   = 'none';
            document.getElementById('mergeOptMerge').style.display  = 'none';
            document.getElementById('mergeOptAdd').style.display    = 'none';
            document.getElementById('mergeModalCancel').style.display = 'none';
            fnLabel.style.display = 'none';
            headingInput.value = filename.replace(/\.[^.]+$/, ''); // pre-fill with filename minus extension
            headingStep.style.display = 'block';
            setTimeout(function() { headingInput.select(); }, 40);
        }

        function onHeadingConfirm() {
            close({ mode: 'add', heading: headingInput.value.trim() || null });
            // Restore hidden elements for next time
            document.getElementById('mergeOptSwap').style.display   = '';
            document.getElementById('mergeOptMerge').style.display  = '';
            document.getElementById('mergeOptAdd').style.display    = '';
            document.getElementById('mergeModalCancel').style.display = '';
            fnLabel.style.display = '';
        }

        function onHeadingKey(e) { if (e.key === 'Enter') onHeadingConfirm(); }

        function onCancel() {
            // Restore hidden elements in case we were on step 2
            document.getElementById('mergeOptSwap').style.display   = '';
            document.getElementById('mergeOptMerge').style.display  = '';
            document.getElementById('mergeOptAdd').style.display    = '';
            fnLabel.style.display = '';
            close(null);
        }

        document.getElementById('mergeOptSwap').addEventListener('click', onSwap);
        document.getElementById('mergeOptMerge').addEventListener('click', onMerge);
        document.getElementById('mergeOptAdd').addEventListener('click', onAdd);
        document.getElementById('mergeModalCancel').addEventListener('click', onCancel);
        headingConfirm.addEventListener('click', onHeadingConfirm);
        headingInput.addEventListener('keydown', onHeadingKey);
    });
}

// Shared link (Google Drive/Docs, Dropbox, SharePoint)
document.getElementById('btnLoadLink').addEventListener('click', function() {
  const url = document.getElementById('sharedLinkInput').value.trim();
  if (url) processSharedLink(url);
});
document.getElementById('sharedLinkInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') { e.preventDefault(); const url = this.value.trim(); if (url) processSharedLink(url); }
});

async function processSharedLink(url) {
  setUploadStatus('loading', '⏳ Fetching document from shared link…');

  const settings = await new Promise(function(r) { chrome.storage.sync.get(['anthropicApiKey'], r); });
  if (!settings.anthropicApiKey) { setUploadStatus('error', '✗ No Anthropic API key. Add it in extension settings.'); return; }

  let fetchUrl = url;
  let label    = url;
  let contentItems;

  try {
    // ── Google Docs share link ──────────────────────────────
    // e.g. https://docs.google.com/document/d/DOC_ID/edit?usp=sharing
    const gdocMatch = url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (gdocMatch) {
      fetchUrl = 'https://docs.google.com/document/d/' + gdocMatch[1] + '/export?format=txt';
      label = 'Google Doc';
      const resp = await fetch(fetchUrl);
      if (!resp.ok) throw new Error(resp.status === 403 ? 'Doc is not publicly shared — set sharing to "Anyone with the link can view".' : 'Google Docs fetch failed (HTTP ' + resp.status + ').');
      const text = await resp.text();
      contentItems = [{ type: 'text', text: 'Google Doc content:\n\n' + text }];

    // ── Google Drive file link ──────────────────────────────
    // e.g. https://drive.google.com/file/d/FILE_ID/view?usp=sharing
    } else if (url.includes('drive.google.com')) {
      const driveMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (!driveMatch) throw new Error('Could not extract file ID from Google Drive URL.');
      const fileId = driveMatch[1];
      fetchUrl = 'https://drive.google.com/uc?export=download&id=' + fileId;
      label = 'Google Drive file';
      const resp = await fetch(fetchUrl);
      if (!resp.ok) throw new Error(resp.status === 403 ? 'File is not publicly shared — set sharing to "Anyone with the link can view".' : 'Google Drive fetch failed (HTTP ' + resp.status + ').');
      const ct = resp.headers.get('content-type') || '';
      if (ct.includes('pdf')) {
        const buf = await resp.arrayBuffer();
        const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        contentItems = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }];
      } else {
        const text = await resp.text();
        contentItems = [{ type: 'text', text: 'Google Drive file content:\n\n' + text }];
      }

    // ── Dropbox share link ──────────────────────────────────
    // e.g. https://www.dropbox.com/s/HASH/file.pdf?dl=0
    // or   https://www.dropbox.com/scl/fi/...
    } else if (url.includes('dropbox.com')) {
      fetchUrl = url.replace(/[?&]dl=0/, '').replace(/dropbox\.com/, 'dl.dropboxusercontent.com');
      if (!fetchUrl.includes('dl=1')) fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + 'dl=1';
      label = 'Dropbox file';
      const resp = await fetch(fetchUrl);
      if (!resp.ok) throw new Error('Dropbox fetch failed (HTTP ' + resp.status + '). Make sure the link is set to "Anyone with this link".');
      const ct  = resp.headers.get('content-type') || '';
      const buf = await resp.arrayBuffer();
      if (ct.includes('pdf')) {
        const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        contentItems = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }];
      } else if (ct.includes('word') || url.toLowerCase().includes('.docx')) {
        const text = await extractDocxText(buf);
        contentItems = [{ type: 'text', text: 'Dropbox document content:\n\n' + text }];
      } else {
        const text = new TextDecoder().decode(buf);
        contentItems = [{ type: 'text', text: 'Dropbox file content:\n\n' + text }];
      }

    // ── SharePoint / OneDrive link ──────────────────────────
    } else if (url.includes('sharepoint.com') || url.includes('1drv.ms') || url.includes('onedrive.live.com')) {
      label = 'SharePoint / OneDrive file';
      // Convert OneDrive short links to direct download where possible
      if (url.includes('1drv.ms')) {
        const b64url = btoa(url).replace(/=$/, '').replace(/==$/, '').replace(/\+/g, '-').replace(/\//g, '_');
        fetchUrl = 'https://api.onedrive.com/v1.0/shares/u!' + b64url + '/root/content';
      }
      const resp = await fetch(fetchUrl);
      if (!resp.ok) throw new Error('SharePoint/OneDrive fetch failed (HTTP ' + resp.status + '). The file must be shared publicly or you must be signed in to that account in Chrome.');
      const ct  = resp.headers.get('content-type') || '';
      const buf = await resp.arrayBuffer();
      if (ct.includes('pdf')) {
        const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        contentItems = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }];
      } else if (ct.includes('word') || url.toLowerCase().includes('.docx')) {
        const text = await extractDocxText(buf);
        contentItems = [{ type: 'text', text: 'SharePoint document content:\n\n' + text }];
      } else {
        const text = new TextDecoder().decode(buf);
        contentItems = [{ type: 'text', text: 'SharePoint file content:\n\n' + text }];
      }

    } else {
      throw new Error('Unrecognised link. Paste a Google Docs, Google Drive, Dropbox or SharePoint share URL.');
    }
  } catch (err) {
    setUploadStatus('error', '✗ ' + err.message);
    return;
  }

  setUploadStatus('loading', '⏳ Sending to Claude AI — this may take 15–30 seconds…');
  await runClaudeExtraction(contentItems, label, 'swap');
}

// ── Minimal DOCX text extractor (no external libraries needed) ───────────────
// A .docx file is a ZIP archive. We find word/document.xml, decompress it if
// needed using the browser's native DecompressionStream, then strip XML tags.
async function extractDocxText(arrayBuffer) {
  const data = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  let offset = 0;

  while (offset < data.length - 30) {
    // ZIP local file header signature: PK (0x504B0304)
    if (view.getUint32(offset, true) !== 0x04034b50) { offset++; continue; }

    const compression   = view.getUint16(offset + 8,  true);
    const compressedSz  = view.getUint32(offset + 18, true);
    const filenameSz    = view.getUint16(offset + 26, true);
    const extraSz       = view.getUint16(offset + 28, true);
    const filename      = new TextDecoder().decode(data.slice(offset + 30, offset + 30 + filenameSz));
    const dataStart     = offset + 30 + filenameSz + extraSz;

    if (filename === 'word/document.xml') {
      const raw = data.slice(dataStart, dataStart + compressedSz);
      let xmlText;

      if (compression === 0) {
        // Stored (no compression)
        xmlText = new TextDecoder('utf-8').decode(raw);
      } else if (compression === 8) {
        // Deflate — decompress using browser's native DecompressionStream
        const ds     = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        const reader = ds.readable.getReader();
        writer.write(raw);
        writer.close();
        const chunks = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        const total    = chunks.reduce(function(n, c) { return n + c.length; }, 0);
        const combined = new Uint8Array(total);
        let pos = 0;
        chunks.forEach(function(c) { combined.set(c, pos); pos += c.length; });
        xmlText = new TextDecoder('utf-8').decode(combined);
      } else {
        throw new Error('Unsupported ZIP compression method (' + compression + '). Try saving the .docx again in Word.');
      }

      // Extract readable text: paragraph breaks → newlines, strip XML tags, decode entities
      return xmlText
        .replace(/<w:p[ >]/g, '\n')
        .replace(/<w:br[^>]*>/g, '\n')
        .replace(/<w:tab[^>]*>/g, '\t')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&apos;/g, "'").replace(/&quot;/g, '"')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    offset = dataStart + compressedSz;
  }
  throw new Error('Could not find content in this file. Make sure it is a valid .docx.');
}

async function processFile(file, mode, heading) {
  mode = mode || 'swap';
  const fname    = (file.name || '').toLowerCase();
  const isPdf    = file.type === 'application/pdf';
  const isImage  = ['image/png','image/jpeg','image/webp'].includes(file.type);
  const isDocx   = fname.endsWith('.docx') || fname.endsWith('.doc')
                || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const isGdoc   = fname.endsWith('.gdoc');

  if (!isPdf && !isImage && !isDocx && !isGdoc) {
    setUploadStatus('error', '✗ Unsupported file type. Upload a PDF, Word doc (.docx), Google Doc (.gdoc) or image.');
    return;
  }

  setUploadStatus('loading', '⏳ Reading "' + file.name + '" with Claude AI — this may take 15–30 seconds…');

  const settings = await new Promise(function(r) { chrome.storage.sync.get(['anthropicApiKey'], r); });
  if (!settings.anthropicApiKey) { setUploadStatus('error', '✗ No Anthropic API key. Add it in extension settings.'); return; }

  let contentItems;

  try {
    if (isPdf) {
      const base64 = await fileToBase64(file);
      contentItems = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }];
    } else if (isImage) {
      const base64 = await fileToBase64(file);
      contentItems = [{ type: 'image', source: { type: 'base64', media_type: file.type, data: base64 } }];
    } else if (isGdoc) {
      // A .gdoc file is a JSON shortcut: { "url": "https://docs.google.com/document/d/DOC_ID/edit", ... }
      const json     = JSON.parse(await file.text());
      const docUrl   = json.url || json.resource_id || '';
      const idMatch  = docUrl.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
      if (!idMatch) throw new Error('Could not read the Google Doc ID from this .gdoc file.');
      const exportUrl = 'https://docs.google.com/document/d/' + idMatch[1] + '/export?format=txt';
      const resp = await fetch(exportUrl);
      if (!resp.ok) {
        if (resp.status === 403 || resp.status === 401) throw new Error('Google Doc is not publicly shared. Set sharing to "Anyone with the link can view" and try again.');
        throw new Error('Could not fetch Google Doc (HTTP ' + resp.status + ').');
      }
      const text = await resp.text();
      contentItems = [{ type: 'text', text: 'The following is the full text content of a Google Doc (' + file.name + '):\n\n' + text }];
    } else {
      // Word doc — extract text then send as plain text to Claude
      const buf  = await file.arrayBuffer();
      const text = await extractDocxText(buf);
      contentItems = [{ type: 'text', text: 'The following is the full text content extracted from a Word document (' + file.name + '):\n\n' + text }];
    }
  } catch (extractErr) {
    setUploadStatus('error', '✗ Could not read file: ' + extractErr.message);
    return;
  }

  setUploadStatus('loading', '⏳ Sending to Claude AI — this may take 15–30 seconds…');
  await runClaudeExtraction(contentItems, file.name, mode, heading);
}

async function runClaudeExtraction(contentItems, label, mode, heading) {
  mode = mode || 'swap';
  const settings = await new Promise(function(r) { chrome.storage.sync.get(['anthropicApiKey'], r); });
  if (!settings.anthropicApiKey) { setUploadStatus('error', '✗ No Anthropic API key. Add it in extension settings.'); return; }

  const prompt = [
    'You are extracting operational information from an event document for an AV/production company (Front of House Productions Australia).',
    'Return ONLY a single valid JSON object — no markdown, no explanation. Use null for missing scalar fields and [] for missing arrays.',
    '',
    'EXTRACTION RULES:',
    '1. show_times — Look for ANY running order, schedule, itinerary, program, or timeline. Extract EVERY individual line as its own row. Be generous: if something has a time next to an activity, it belongs here. Common headings: "Running Order", "Schedule", "Program", "Itinerary", "Run Sheet", "Timeline". Capture the time (e.g. "16:00", "4:00pm", "16:00–17:30"), the activity/description, the location if mentioned on that line, and any notes. IMPORTANT: if the schedule spans multiple days, insert a day separator row before each day\'s entries using { "type": "day", "label": "Friday 21 March 2025" }. Include the full date in the label if mentioned in the document. Regular time rows have no "type" field.',
    '2. setup_locations — Look for ANY section that describes how a specific area, room, stage, or zone is set up technically or operationally. Common patterns: a bold/heading location name followed by audio/lighting/vision/AV details, a technical rider broken into areas, a floor plan description by zone. Create one entry per distinct location. Put the location/area name as "title" and ALL related setup details as "details" (preserve line breaks and sub-categories like "Audio:", "Lighting:", "Vision:"). IMPORTANT: always watch for these specific venue area names used by this company, even if they appear mid-paragraph or without obvious formatting — treat each as its own location block: "Woodstore" (or "Wood Store"), "Workshop" (or "Work Shop"), "Yard", "Warehouse", "Expo Space", "Main Stage", "Green Room", "Bar", "Foyer", "Courtyard", "Loading Dock". If you see any of these words followed by technical or setup details, extract them as a setup_location.',
    '3. event_brief — A short paragraph summarising the event for the crew. Use the event description, overview, or brief if present.',
    '',
    'Return this exact structure:',
    '{',
    '  "venue_manager_name": "string or null",',
    '  "venue_manager_phone": "string or null",',
    '  "client_onsite_name": "string or null",',
    '  "client_onsite_phone": "string or null",',
    '  "event_brief": "string or null",',
    '  "venue_access_times": "string or null",',
    '  "power_requirements": "string or null",',
    '  "generator_required": "string or null",',
    '  "parking_access": "string or null",',
    '  "wifi_ssid": "string or null",',
    '  "wifi_password": "string or null",',
    '  "delivery_info": "string or null",',
    '  "tech_backline": "string or null",',
    '  "special_notes": "string or null",',
    '  "show_times": [',
    '    { "type": "day", "label": "Friday 21 March 2025" },',
    '    { "time": "16:00", "activity": "Load In", "location": "Stage Door", "notes": "" },',
    '    { "type": "day", "label": "Saturday 22 March 2025" },',
    '    { "time": "09:00", "activity": "Doors Open", "location": "Main Entrance", "notes": "" }',
    '  ],',
    '  "setup_locations": [',
    '    { "title": "Main Stage", "details": "Audio: L-Acoustics K2\\nLighting: 12x moving heads" }',
    '  ]',
    '}'
  ].join('\n');

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.anthropicApiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 4096,
        messages: [{ role: 'user', content: [...contentItems, { type: 'text', text: prompt }] }]
      })
    });
    if (!resp.ok) { const e = await resp.text(); throw new Error('Anthropic ' + resp.status + ': ' + e.slice(0, 200)); }
    const data = await resp.json();
    const text = (data.content && data.content[0] && data.content[0].text) ? data.content[0].text : '';
    let extracted;
    try { extracted = JSON.parse(text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()); }
    catch (e) { throw new Error('Could not parse AI response. Raw: ' + text.slice(0, 300)); }
    applyExtractedWithMode(extracted, mode, heading);
    const modeLabel = mode === 'merge' ? 'merged into' : mode === 'add' ? 'added from' : 'applied from';
    setUploadStatus('success', '✓ "' + label + '" ' + modeLabel + ' — review and edit fields below.');
    showToast('✓ Document ' + mode + 'ed', 'success');
  } catch (err) {
    setUploadStatus('error', '✗ Extraction failed: ' + err.message);
    showToast('✗ Extraction failed', 'error');
  }
}

function fileToBase64(file) {
  return new Promise(function(resolve, reject) {
    const reader = new FileReader();
    reader.onload  = function() { resolve(reader.result.split(',')[1]); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function fileToDataUrl(file) {
  return new Promise(function(resolve, reject) {
    const reader = new FileReader();
    reader.onload  = function() { resolve(reader.result); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
// Convert a data URL to a blob: URL (blob: URLs are allowed by object-src 'self' in extensions)
function dataUrlToBlobUrl(dataUrl, mimeType) {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

// ── Site Plan import ──────────────────────────────────────
async function processSitePlan(file) {
  const isPdf   = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isImage = ['image/png','image/jpeg','image/webp'].includes(file.type)
               || /\.(png|jpe?g|webp)$/i.test(file.name);
  if (!isPdf && !isImage) {
    setSitePlanStatus('error', '✗ Unsupported file type. Use a PDF or image (PNG, JPG, WebP).');
    return;
  }
  setSitePlanStatus('loading', '⏳ Loading…');
  try {
    const dataUrl = await fileToDataUrl(file);
    sitePlansData.push({ type: isPdf ? 'pdf' : 'image', dataUrl: dataUrl, filename: file.name });
    setSitePlanStatus('success', '✓ "' + file.name + '" added (' + sitePlansData.length + ' total)');
    renderSitePlanPreview();
  } catch (err) {
    console.error('[SitePlan] error:', err);
    setSitePlanStatus('error', '✗ ' + (err.message || 'Unknown error loading site plan'));
  }
}

function renderSitePlanPreview() {
  const preview = document.getElementById('sitePlanPreview');
  if (!preview) return;
  if (!sitePlansData.length) { preview.style.display = 'none'; preview.innerHTML = ''; return; }
  preview.style.display = 'block';
  preview.innerHTML = '';

  sitePlansData.forEach(function(sp, idx) {
    const card = document.createElement('div');
    card.style.cssText = 'margin-bottom:10px;position:relative;';

    if (sp.type === 'image') {
      card.innerHTML =
        '<div style="position:relative;display:inline-block;width:100%;">'
        + '<img src="' + sp.dataUrl + '" style="max-width:100%;display:block;border-radius:8px;border:1px solid #2a2a35;">'
        + '<button data-idx="' + idx + '" class="sp-remove-btn" style="position:absolute;top:8px;right:8px;background:#0f0f12;border:1px solid #2a2a35;color:#6b6b80;border-radius:5px;padding:5px 12px;font-family:inherit;font-size:11px;cursor:pointer;">✕ Remove</button>'
        + '</div>';
    } else {
      card.innerHTML =
        '<div style="padding:14px 18px;background:#1e1e26;border:1px solid #2a2a35;border-radius:10px;display:flex;align-items:center;gap:12px;">'
        + '<span style="font-size:22px;line-height:1;">📄</span>'
        + '<div style="flex:1;min-width:0;">'
        + '<div style="font-size:13px;font-weight:700;color:#f0f0f5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(sp.filename) + '</div>'
        + '<div style="font-size:11px;color:#6b6b80;margin-top:3px;">PDF — pages will be appended to the downloaded event sheet</div>'
        + '</div>'
        + '<button data-idx="' + idx + '" class="sp-remove-btn" style="background:#1a1a22;border:1px solid #2a2a35;color:#6b6b80;border-radius:5px;padding:5px 12px;font-family:inherit;font-size:11px;cursor:pointer;">✕ Remove</button>'
        + '</div>';
    }

    card.querySelector('.sp-remove-btn').addEventListener('click', function() {
      sitePlansData.splice(parseInt(this.getAttribute('data-idx')), 1);
      renderSitePlanPreview();
      if (!sitePlansData.length) setSitePlanStatus('', '');
      else setSitePlanStatus('success', sitePlansData.length + ' file' + (sitePlansData.length > 1 ? 's' : '') + ' attached');
    });

    preview.appendChild(card);
  });
}
function setSitePlanStatus(type, msg) {
  const el = document.getElementById('sitePlanStatus');
  if (!el) return;
  if (!type) { el.className = 'upload-status'; el.textContent = ''; return; }
  el.className = 'upload-status ' + type; el.textContent = msg;
}
function setUploadStatus(type, msg) { uploadStatus.className = 'upload-status ' + type; uploadStatus.textContent = msg; }

function applyExtractedWithMode(data, mode, heading) {
  if (mode === 'swap') {
    applyExtracted(data);
    return;
  }

  // Shared: normalise show_times and setup_locations from extracted data
  const stArray  = Array.isArray(data.show_times)     ? data.show_times.filter(function(r) { return r && (r.type === 'day' ? r.label : (r.time || r.activity)); }) : [];
  const locArray = Array.isArray(data.setup_locations) ? data.setup_locations.filter(function(l) { return l && (l.title || l.details); }) : [];

  if (mode === 'add') {
    // Only append running order and locations — leave all scalar fields alone
    if (stArray.length) {
      if (heading) addShowTimeDayHeader(heading); // user-named or filename separator
      stArray.forEach(function(r) {
        if (r.type === 'day') addShowTimeDayHeader(r.label || '');
        else addShowTimeRow(r.time || '', r.activity || '', r.location || '', r.notes || '');
      });
    }
    locArray.forEach(function(loc) { addSetupLocation(loc.title || '', loc.details || ''); });
    return;
  }

  if (mode === 'merge') {
    // Scalar fields: only fill if the current field is empty
    const map = {
      'f-venue-manager-name':  data.venue_manager_name,
      'f-venue-manager-phone': data.venue_manager_phone,
      'f-client-onsite-name':  data.client_onsite_name,
      'f-client-onsite-phone': data.client_onsite_phone,
      'f-venue-access':        data.venue_access_times,
      'f-power':               data.power_requirements,
      'f-generator':           data.generator_required,
      'f-parking':             data.parking_access,
      'f-wifi-ssid':           data.wifi_ssid,
      'f-wifi-password':       data.wifi_password,
      'f-delivery-info':       data.delivery_info,
      'f-backline':            data.tech_backline,
      'f-special-notes':       data.special_notes,
      'f-event-brief':         data.event_brief
    };
    Object.keys(map).forEach(function(id) {
      const val = map[id];
      if (val && val !== 'null' && val !== null) {
        const el = document.getElementById(id);
        if (el && !el.value.trim()) el.value = val;
      }
    });
    // Arrays: always append
    stArray.forEach(function(r) {
      if (r.type === 'day') addShowTimeDayHeader(r.label || '');
      else addShowTimeRow(r.time || '', r.activity || '', r.location || '', r.notes || '');
    });
    locArray.forEach(function(loc) { addSetupLocation(loc.title || '', loc.details || ''); });
    return;
  }
}

function applyExtracted(data) {
  // ── Scalar fields ────────────────────────────────────────
  const map = {
    'f-venue-manager-name':  { val: data.venue_manager_name,  fg: 'fg-venue-manager-name' },
    'f-venue-manager-phone': { val: data.venue_manager_phone, fg: 'fg-venue-manager-phone' },
    'f-client-onsite-name':  { val: data.client_onsite_name,  fg: 'fg-client-onsite-name' },
    'f-client-onsite-phone': { val: data.client_onsite_phone, fg: 'fg-client-onsite-phone' },
    'f-venue-access':        { val: data.venue_access_times,  fg: 'fg-venue-access' },
    'f-power':               { val: data.power_requirements,  fg: 'fg-power' },
    'f-generator':           { val: data.generator_required,  fg: 'fg-generator' },
    'f-parking':             { val: data.parking_access,      fg: 'fg-parking' },
    'f-wifi-ssid':           { val: data.wifi_ssid,           fg: 'fg-wifi-ssid' },
    'f-wifi-password':       { val: data.wifi_password,       fg: 'fg-wifi-password' },
    'f-delivery-info':       { val: data.delivery_info,       fg: 'fg-delivery-info' },
    'f-backline':            { val: data.tech_backline,        fg: 'fg-backline' },
    'f-special-notes':       { val: data.special_notes,       fg: 'fg-special-notes' },
    'f-event-brief':         { val: data.event_brief,          fg: null }
  };
  Object.keys(map).forEach(function(id) {
    const f = map[id];
    if (f.val && f.val !== 'null' && f.val !== null) {
      const el = document.getElementById(id); if (el) el.value = f.val;
      if (f.fg) { const fg = document.getElementById(f.fg); if (fg) fg.classList.add('was-extracted'); }
    }
  });

  // ── Show Times — prefer structured array, fall back to set_times string ──
  const stArray = Array.isArray(data.show_times) ? data.show_times.filter(function(r) { return r && (r.type === 'day' ? r.label : (r.time || r.activity)); }) : [];
  if (stArray.length) {
    document.getElementById('showTimeList').innerHTML = '';
    stArray.forEach(function(r) {
      if (r.type === 'day') addShowTimeDayHeader(r.label || '');
      else addShowTimeRow(r.time || '', r.activity || '', r.location || '', r.notes || '');
    });
    const fg = document.getElementById('fg-set-times'); if (fg) fg.classList.add('was-extracted');
  } else if (data.set_times && data.set_times !== 'null' && data.set_times !== null) {
    // Legacy fallback: parse a plain-text string
    document.getElementById('showTimeList').innerHTML = '';
    const rTime = /(\d{1,2}[:.]\d{2}(?:\s*[-–—]\s*\d{1,2}[:.]\d{2})?)/;
    String(data.set_times).split(/\s*\|\s*|[\n\r]+/).map(function(s) { return s.trim(); }).filter(Boolean)
      .forEach(function(entry) {
        const leading  = entry.match(new RegExp('^' + rTime.source + '\\s+(.+)'));
        const trailing = entry.match(new RegExp('^(.+?)\\s+' + rTime.source + '$'));
        var time = '', activity = entry;
        if (leading)       { time = leading[1];  activity = leading[2]; }
        else if (trailing) { activity = trailing[1]; time = trailing[2]; }
        addShowTimeRow(time.trim(), activity.trim(), '', '');
      });
    const fg = document.getElementById('fg-set-times'); if (fg) fg.classList.add('was-extracted');
  }

  // ── Event / Venue Setup location blocks ─────────────────
  const locArray = Array.isArray(data.setup_locations) ? data.setup_locations.filter(function(l) { return l && (l.title || l.details); }) : [];
  if (locArray.length) {
    document.getElementById('setupLocationList').innerHTML = '';
    locArray.forEach(function(loc) { addSetupLocation(loc.title || '', loc.details || ''); });
  }
}

// ── Preview & Print ───────────────────────────────────────
function showSitePlanPrintPage() {
  const page = document.getElementById('sitePlanPrintPage');
  if (!page) return;
  if (!sitePlansData.length) { page.style.display = 'none'; page.innerHTML = ''; return; }
  const title = '<div class="sp-title" style="-webkit-print-color-adjust:exact;print-color-adjust:exact;">Site Plan</div>';
  let inner = '';
  sitePlansData.forEach(function(sp) {
    if (sp.type === 'image') {
      inner += '<img src="' + sp.dataUrl + '" style="max-width:100%;height:auto;display:block;margin-bottom:12px;">';
    } else {
      inner += '<div style="padding:24px;background:#f5f5f5;border:2px dashed #ccc;border-radius:8px;text-align:center;color:#666;font-size:13px;margin-bottom:12px;">📄 ' + esc(sp.filename) + '<br><span style="font-size:11px;">PDF pages will be appended in the downloaded file.</span></div>';
    }
  });
  page.innerHTML = title + inner;
  page.style.display = 'block';
}

function getPrintCss() {
  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; font-size: 13px; }
    @page { margin: 22mm 18mm; size: A4; }
    .doc-page { max-width: 800px; margin: 0 auto; padding: 0; }
    .doc-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 3px solid #1a1a1a; }
    .doc-header-left h1 { font-size: 22px; font-weight: 900; letter-spacing: -0.5px; margin-bottom: 2px; }
    .doc-header-left .doc-type { font-size: 11px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #666; }
    .doc-header-right { text-align: right; font-size: 11px; color: #666; line-height: 1.7; }
    .doc-header-right strong { color: #1a1a1a; }
    .fohp-brand { font-size: 11px; font-weight: 700; color: #1a1a1a; }
    .doc-logo { max-height: 56px; max-width: 180px; object-fit: contain; display: block; margin-bottom: 6px; margin-left: auto; }
    .doc-banner { background: #1a1a1a; color: #fff; border-radius: 8px; padding: 14px 20px; margin-bottom: 20px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .doc-banner-item .label { font-size: 9px; letter-spacing: 1.5px; text-transform: uppercase; color: rgba(255,255,255,0.5); margin-bottom: 3px; }
    .doc-banner-item .val { font-size: 14px; font-weight: 700; color: #fff; }
    .doc-banner-item .val.accent { color: #00e5a0; }
    .doc-section { margin-bottom: 22px; page-break-inside: avoid; }
    .doc-section-title { font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #fff; background: #1a1a1a; padding: 6px 12px; border-radius: 4px; margin-bottom: 10px; display: inline-block; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .contacts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .contact-card { border: 1px solid #ddd; border-radius: 6px; padding: 12px 14px; }
    .contact-card .role { font-size: 9px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #888; margin-bottom: 4px; }
    .contact-card .name { font-size: 14px; font-weight: 700; margin-bottom: 2px; }
    .contact-card .detail { font-size: 12px; color: #444; line-height: 1.5; }
    .schedule-table { width: 100%; border-collapse: collapse; }
    .schedule-table th { background: #f0f0f0; font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; padding: 8px 12px; text-align: left; color: #444; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .schedule-table td { padding: 8px 12px; border-bottom: 1px solid #eee; font-size: 13px; }
    .schedule-table .phase-cell { font-weight: 700; width: 140px; }
    .schedule-table tr.highlight td { background: #f9fffe; }
    .info-table { width: 100%; border-collapse: collapse; }
    .info-table td { padding: 8px 12px; border-bottom: 1px solid #eee; font-size: 13px; vertical-align: top; }
    .info-table td:first-child { font-weight: 700; width: 180px; color: #444; white-space: nowrap; }
    .prod-area { margin-bottom: 14px; }
    .prod-area-title { font-weight: 700; font-size: 13px; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin-bottom: 6px; }
    .prod-area ul { margin: 0; padding-left: 18px; }
    .prod-area ul li { font-size: 12px; color: #333; margin-bottom: 3px; }
    .equip-group { margin-bottom: 14px; }
    .equip-group-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #888; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin-bottom: 6px; }
    .equip-table { width: 100%; border-collapse: collapse; }
    .equip-table td { padding: 5px 8px; font-size: 12px; vertical-align: top; border-bottom: 1px solid #f0f0f0; }
    .equip-table tr.pkg-row td { background: #f7f7f9; font-weight: 600; border-bottom: 1px solid #e8e8ec; padding: 6px 8px; }
    .equip-table tr.pkg-row .pkg-desc { font-weight: 400; color: #666; font-style: italic; font-size: 11px; margin-left: 6px; }
    .equip-table td:first-child { width: 50px; font-weight: 700; color: #00a868; }
    .crew-table { width: 100%; border-collapse: collapse; }
    .crew-table th { background: #f0f0f0; font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; padding: 7px 12px; text-align: left; color: #444; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .crew-table td { padding: 8px 12px; border-bottom: 1px solid #eee; font-size: 13px; }
    .power-block { background: #fff8e7; border: 1px solid #f59e0b; border-radius: 6px; padding: 12px 14px; margin-bottom: 10px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .power-block .pw-title { font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #b45309; margin-bottom: 6px; }
    .power-block pre { font-size: 12px; color: #333; white-space: pre-wrap; font-family: inherit; line-height: 1.6; margin: 0; }
    .notes-block { background: #f5f5f5; border-radius: 6px; padding: 12px 14px; font-size: 12px; color: #333; line-height: 1.6; white-space: pre-wrap; }
    .doc-footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #ddd; display: flex; justify-content: space-between; font-size: 10px; color: #999; }
    embed { display: block; }
  `;
}

async function showPreview() {
  const f = collectFormData();
  const o = oppData || {};
  const docHtml = buildDocHtml(f);

  // Site plan appendix for screen preview and PDF generation
  const sitePlanAppendixItems = []; // one HTML string per plan → each gets its own preview page
  const sitePlanPdfUrls = [];
  let sitePlanHtmlForPdf = '';
  const spCss = 'font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#fff;background:#1a1a1a;padding:6px 12px;border-radius:4px;margin-bottom:14px;display:inline-block;';

  sitePlansData.forEach(function(sp) {
    if (sp.type === 'image') {
      sitePlanAppendixItems.push(
        '<div style="' + spCss + '">Site Plan</div>'
        + '<img src="' + sp.dataUrl + '" style="max-width:100%;height:auto;display:block;border:1px solid #ddd;border-radius:4px;">'
      );
      sitePlanHtmlForPdf += '<div style="page-break-before:always;padding:22mm 18mm 18mm;">'
        + '<div style="' + spCss + '">Site Plan</div>'
        + '<img src="' + sp.dataUrl + '" style="max-width:100%;height:auto;display:block;border:1px solid #ddd;border-radius:4px;">'
        + '</div>';
    } else {
      sitePlanPdfUrls.push(sp.dataUrl);
      sitePlanAppendixItems.push(
        '<div style="' + spCss + '">Site Plan</div>'
        + '<div style="padding:24px;background:#f5f5f5;border:2px dashed #ccc;border-radius:8px;text-align:center;color:#666;font-size:13px;">📄 '
        + esc(sp.filename || 'site-plan.pdf')
        + '<br><span style="font-size:11px;">PDF pages will be appended in the downloaded file.</span></div>'
      );
    }
  });

  const fullHtml = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + esc(o.subject || 'Event Sheet') + '</title>'
    + '<style>' + getPrintCss() + '</style></head>'
    + '<body><div class="doc-page">' + docHtml + '</div>' + sitePlanHtmlForPdf + '</body></html>';

  const filename = (o.subject || 'Event-Sheet').replace(/[^a-z0-9\-_ ]/gi, '').trim() + '_Event Sheet.pdf';

  // Cache large PDF data in background.js memory (avoids chrome.storage.local 5 MB quota)
  // Pass pullSheetHtml separately — background.js renders it in its own tab and merges the PDFs.
  chrome.runtime.sendMessage({ action: 'cachePdfData', html: fullHtml, filename: filename, sitePlanDataUrls: sitePlanPdfUrls }, function() {
    // Store only small display data in chrome.storage.local
    chrome.storage.local.set({
      eventSheetPreview: {
        title: o.subject || 'Event Sheet',
        docHtml: docHtml,
        sitePlanAppendixItems: sitePlanAppendixItems,
        filename: filename,
        printCss: getPrintCss()
      }
    }, function () {
      chrome.tabs.create({ url: chrome.runtime.getURL('event-sheet-preview.html') });
    });
  });
}

function buildDocHtml(f) {
  const o = oppData || {};
  const now = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });

  const phases = [
    { label: 'Load',       start: o.load_starts_at,     end: o.load_ends_at,      highlight: false },
    { label: 'Delivery',   start: o.deliver_starts_at,  end: o.deliver_ends_at,   highlight: false },
    { label: 'Bump In',    start: o.setup_starts_at,    end: o.setup_ends_at,     highlight: false },
    { label: 'Rehearsals', start: o.prep_starts_at,     end: o.prep_ends_at,      highlight: false },
    { label: 'Show',       start: o.show_starts_at,     end: o.show_ends_at,      highlight: true  },
    { label: 'Bump Out',   start: o.takedown_starts_at, end: o.takedown_ends_at,  highlight: false },
    { label: 'Pick Up',    start: o.collect_starts_at,  end: o.collect_ends_at,   highlight: false },
    { label: 'Unload',     start: o.unload_starts_at,   end: o.unload_ends_at,    highlight: false },
    { label: 'De-Prep',    start: o.deprep_starts_at,   end: o.deprep_ends_at,    highlight: false }
  ].filter(function(p) { return p.start || p.end; });

  const scheduleRows = phases.map(function(p) {
    return '<tr' + (p.highlight ? ' class="highlight"' : '') + '>'
      + '<td class="phase-cell">' + esc(p.label) + '</td>'
      + '<td>' + esc(fmt(p.start) || '—') + '</td>'
      + '<td>' + esc(fmt(p.end) || '—') + '</td></tr>';
  }).join('');

  // Equipment
  const condensed = condenseItems(o.items || []);
  const itemsHtml = buildEquipHtml(condensed);

  // Production requirements
  let prodHtml = '';
  ['production_location1','production_location2','production_location3'].forEach(function(loc, i) {
    const locVal = cf(loc); const headVal = cf('event_header' + (i + 1));
    if (locVal || headVal) {
      const lines = (headVal || '').split('\n').filter(function(l) { return l.trim(); });
      prodHtml += '<div class="prod-area">'
        + (locVal ? '<div class="prod-area-title">' + esc(locVal) + '</div>' : '')
        + '<ul>' + lines.map(function(l) { return '<li>' + esc(l.trim()) + '</li>'; }).join('') + '</ul></div>';
    }
  });

  // Crew
  const crewRows = f.crew.filter(function(c) { return c.name || c.role; }).map(function(c) {
    return '<tr><td>' + esc(c.name) + '</td><td>' + esc(c.role) + '</td></tr>';
  }).join('');

  // Contacts
  const contacts = [];
  if (o.contact_name || o.contact_phone) contacts.push({ role: 'Client Contact', name: o.contact_name, detail: [o.contact_phone, o.contact_email].filter(Boolean).join('<br>') });
  if (f.venue_manager_name || f.venue_manager_phone) contacts.push({ role: 'Venue Site Manager', name: f.venue_manager_name, detail: f.venue_manager_phone });
  if (f.client_onsite_name || f.client_onsite_phone) contacts.push({ role: 'Client Onsite', name: f.client_onsite_name, detail: f.client_onsite_phone });
  const contactsHtml = contacts.map(function(c) {
    return '<div class="contact-card"><div class="role">' + esc(c.role) + '</div><div class="name">' + esc(c.name || '—') + '</div><div class="detail">' + (c.detail || '') + '</div></div>';
  }).join('');

  const showSetTimes  = false; // replaced by f.show_times table
  const showBackline  = f.backline     && f.backline.trim();
  const showPower     = f.power        && f.power.trim();
  const showParking   = f.parking      && f.parking.trim();
  const showWifi      = f.wifi_ssid    || f.wifi_password;
  const showDelivery  = f.delivery_info && f.delivery_info.trim();
  const showGenerator = f.generator    && f.generator.trim();
  const showAccess    = f.venue_access  && f.venue_access.trim();

  const showNotes     = f.special_notes && f.special_notes.trim();

  const logoUrl = o.logoUrl || '';

  const parts = [];

  // Header
  parts.push(
    '<div class="doc-header">'
    + '<div class="doc-header-left"><div class="doc-type">Event Sheet</div><h1>' + esc(o.subject || 'Event Sheet') + '</h1></div>'
    + '<div class="doc-header-right">'
    + (logoUrl ? '<img class="doc-logo" src="' + logoUrl + '" alt="FOHP">' : '')
    + '<div class="fohp-brand">Front of House Productions Australia</div>'
    + '35 Chelmsford St, Williamstown North VIC 3016<br>info@fohp.com.au · (03) 9034 4882<br><strong>Generated: ' + now + '</strong>'
    + '</div></div>'
  );

  // Banner
  parts.push(
    '<div class="doc-banner">'
    + '<div class="doc-banner-item"><div class="label">TTY Job #</div><div class="val accent">' + esc(o.reference || o.number || '—') + '</div></div>'
    + '<div class="doc-banner-item"><div class="label">Venue</div><div class="val">' + esc(o.venue_name || o.delivery_address_name || '—') + '</div></div>'
    + '<div class="doc-banner-item"><div class="label">Event Dates</div><div class="val">' + esc(o.starts_at ? fmtDate(o.starts_at) : '—') + '</div></div>'
    + '</div>'
  );

  if (f.event_brief && f.event_brief.trim()) parts.push('<div class="doc-section"><div class="doc-section-title">Event Brief</div><div class="notes-block">' + esc(f.event_brief) + '</div></div>');
  if (contacts.length)    parts.push('<div class="doc-section"><div class="doc-section-title">Key Contacts</div><div class="contacts-grid">' + contactsHtml + '</div></div>');
  if (scheduleRows)       parts.push('<div class="doc-section"><div class="doc-section-title">Internal Schedule</div><table class="schedule-table"><thead><tr><th>Phase</th><th>From</th><th>Until</th></tr></thead><tbody>' + scheduleRows + '</tbody></table></div>');
  if (f.show_times && f.show_times.length) {
    const stRows = f.show_times.map(function(r) {
      if (r.type === 'day') {
        return '<tr><td colspan="4" style="font-size:15px;font-weight:800;color:#1a1a1a;padding:20px 12px 10px 12px;border-top:2px solid #bbb;border-bottom:2px solid #bbb;background:#fff;font-family:Arial,Helvetica,sans-serif;letter-spacing:0px;">' + esc(r.label || '') + '</td></tr>';
      }
      return '<tr><td>' + esc(r.time || '') + '</td><td>' + esc(r.activity || '') + '</td><td>' + esc(r.location || '') + '</td><td>' + esc(r.notes || '') + '</td></tr>';
    }).join('');
    parts.push('<div class="doc-section"><div class="doc-section-title">Set / Show Times</div><table class="schedule-table"><thead><tr><th>Time</th><th>Activity</th><th>Location</th><th>Notes</th></tr></thead><tbody>' + stRows + '</tbody></table></div>');
  }

  if (cf('event_type') || cf('audience_size') || cf('event_areas')) {
    parts.push('<div class="doc-section"><div class="doc-section-title">Event Overview</div><table class="info-table">'
      + (cf('event_type')    ? '<tr><td>Event Type</td><td>'    + esc(cf('event_type'))    + '</td></tr>' : '')
      + (cf('audience_size') ? '<tr><td>Audience Size</td><td>' + esc(cf('audience_size')) + '</td></tr>' : '')
      + (cf('event_areas')   ? '<tr><td>Event Areas</td><td>'   + esc(cf('event_areas'))   + '</td></tr>' : '')
      + (cf('event_times')   ? '<tr><td>Event Times</td><td style="white-space:pre-line">' + esc(cf('event_times')) + '</td></tr>' : '')
      + '</table></div>');
  }

  if (prodHtml)           parts.push('<div class="doc-section"><div class="doc-section-title">Production Requirements</div>' + prodHtml + '</div>');
  if (condensed.length)   parts.push('<div class="doc-section"><div class="doc-section-title">Equipment</div>' + itemsHtml + '</div>');

  // Additional quotes — each gets its own Equipment section with the source job in the heading.
  // Uses condenseItemsAll so cables/accessories groups are not hidden.
  additionalOpps.forEach(function(ao) {
    const aoCond = condenseItemsAll(ao.items || []);
    if (!aoCond.length) return;
    parts.push('<div class="doc-section">'
      + '<div class="doc-section-title">Equipment &mdash; #' + esc(String(ao.number)) + ' ' + esc(ao.name) + '</div>'
      + buildEquipHtml(aoCond)
      + '</div>');
  });

  if (showBackline)       parts.push('<div class="doc-section"><div class="doc-section-title">Tech / Backline</div><div class="notes-block">' + esc(f.backline) + '</div></div>');

  if (showAccess || showGenerator || showParking || showWifi || showDelivery) {
    parts.push('<div class="doc-section"><div class="doc-section-title">Onsite Information</div><table class="info-table">'
      + (showAccess    ? '<tr><td>Venue Access</td><td style="white-space:pre-line">' + esc(f.venue_access) + '</td></tr>' : '')
      + (showGenerator ? '<tr><td>Generator</td><td>' + esc(f.generator) + '</td></tr>' : '')
      + (showParking   ? '<tr><td>Parking / Access</td><td>' + esc(f.parking) + '</td></tr>' : '')
      + (showWifi      ? '<tr><td>WiFi</td><td>' + esc(f.wifi_ssid || '') + (f.wifi_password ? ' · PW: ' + esc(f.wifi_password) : '') + '</td></tr>' : '')
      + (showDelivery  ? '<tr><td>Delivery</td><td style="white-space:pre-line">' + esc(f.delivery_info) + '</td></tr>' : '')
      + '</table></div>');
  }

  if (showPower)    parts.push('<div class="doc-section"><div class="doc-section-title">Power Requirements</div><div class="power-block"><div class="pw-title">⚡ Power by Location</div><pre>' + esc(f.power) + '</pre></div></div>');
  if (crewRows)     parts.push('<div class="doc-section"><div class="doc-section-title">Crew</div><table class="crew-table"><thead><tr><th>Name</th><th>Role</th></tr></thead><tbody>' + crewRows + '</tbody></table></div>');

  if (showNotes)    parts.push('<div class="doc-section"><div class="doc-section-title">Special Notes</div><div class="notes-block">' + esc(f.special_notes) + '</div></div>');

  // Event / Venue Setup — two-column table matching Onsite Information style
  const setupLocs = (f.setup_locations || []).filter(function(l) { return l.title || l.details; });
  if (setupLocs.length) {
    const setupRows = setupLocs.map(function(loc) {
      return '<tr>'
        + '<td style="font-weight:700;width:180px;color:#1a1a1a;white-space:nowrap;vertical-align:top;padding:10px 12px;border-bottom:1px solid #eee;font-size:13px;">' + esc(loc.title || '') + '</td>'
        + '<td style="vertical-align:top;padding:10px 12px;border-bottom:1px solid #eee;font-size:13px;white-space:pre-wrap;color:#333;line-height:1.65;">' + fmtSetupDetails(loc.details || '') + '</td>'
        + '</tr>';
    }).join('');
    parts.push('<div class="doc-section"><div class="doc-section-title">Event / Venue Setup</div>'
      + '<table style="width:100%;border-collapse:collapse;"><tbody>' + setupRows + '</tbody></table>'
      + '</div>');
  }

  // External Links — label is a clickable hyperlink; raw URL is not shown
  const validLinks = (f.external_links || []).filter(function(lnk) { return lnk.name && lnk.url; });
  if (validLinks.length) {
    const linkItems = validLinks.map(function(lnk) {
      return '<tr>'
        + '<td style="font-weight:600;white-space:nowrap;padding:9px 12px;border-bottom:1px solid #eee;font-size:13px;color:#1a1a1a;width:200px;">' + esc(lnk.name) + '</td>'
        + '<td style="padding:9px 12px;border-bottom:1px solid #eee;font-size:13px;">'
        + '<a href="' + esc(lnk.url) + '" style="color:#00a868;text-decoration:underline;word-break:break-all;">Open ↗</a>'
        + '</td>'
        + '</tr>';
    }).join('');
    parts.push('<div class="doc-section"><div class="doc-section-title">External Links</div>'
      + '<table style="width:100%;border-collapse:collapse;"><tbody>' + linkItems + '</tbody></table>'
      + '</div>');
  }

  parts.push('<div class="doc-footer"><span>FOHP Event Sheet — ' + esc(o.subject || '') + ' — ' + now + '</span><span>Confidential — Internal Use Only</span></div>');

  return parts.join('\n');
}

// ── PDF download — uses Chrome debugger API for real PDF (no dialog) ──
async function downloadPdf() {
  const f = collectFormData();
  const docHtml = buildDocHtml(f);
  const o = oppData || {};

  // Site plan appendix — image plans embedded in HTML, PDF plans merged by background.js via pdf-lib.
  let sitePlanAppendix = '';
  const sitePlanPdfUrls = [];
  const spCss = 'font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#fff;background:#1a1a1a;padding:6px 12px;border-radius:4px;margin-bottom:14px;display:inline-block;-webkit-print-color-adjust:exact;print-color-adjust:exact;';
  sitePlansData.forEach(function(sp) {
    if (sp.type === 'image') {
      sitePlanAppendix += '<div style="page-break-before:always;padding:22mm 18mm 18mm;">'
        + '<div style="' + spCss + '">Site Plan</div>'
        + '<img src="' + sp.dataUrl + '" style="max-width:100%;height:auto;display:block;border:1px solid #ddd;border-radius:4px;">'
        + '</div>';
    } else {
      sitePlanPdfUrls.push(sp.dataUrl);
    }
  });

  // Embed all print CSS inline so the new window is self-contained
  const printCss = getPrintCss();

  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + esc(o.subject || 'Event Sheet') + '</title>'
    + '<style>' + printCss + '</style></head>'
    + '<body><div class="doc-page">' + docHtml + '</div>' + sitePlanAppendix + '</body></html>';

  const filename = (o.subject || 'Event-Sheet').replace(/[^a-z0-9\-_ ]/gi, '').trim() + '_Event Sheet.pdf';

  const btn = document.getElementById('btnDownloadPdf');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating PDF…'; }
  showToast(sitePlanPdfUrls.length > 0 ? '⏳ Generating PDF — merging attachments…' : '⏳ Generating PDF — this takes a few seconds…', '');

  chrome.runtime.sendMessage({ action: 'generatePdf', html: html, filename: filename, sitePlanDataUrls: sitePlanPdfUrls }, function(resp) {
    if (btn) { btn.disabled = false; btn.innerHTML = '📥 Download PDF'; }
    if (resp && resp.success) {
      showToast('✓ PDF saved to Downloads', 'success');
    } else {
      showToast('✗ PDF failed: ' + (resp ? resp.error : 'No response'), 'error');
    }
  });
}

// ── Site plan zone listeners ──────────────────────────────
const sitePlanZone  = document.getElementById('sitePlanZone');
const sitePlanInput = document.getElementById('sitePlanInput');
sitePlanZone.addEventListener('dragover',  function(e) { e.preventDefault(); sitePlanZone.classList.add('drag-over'); });
sitePlanZone.addEventListener('dragleave', function()  { sitePlanZone.classList.remove('drag-over'); });
sitePlanZone.addEventListener('drop', function(e) {
  e.preventDefault(); sitePlanZone.classList.remove('drag-over');
  Array.from(e.dataTransfer.files).forEach(function(f) { processSitePlan(f); });
});
sitePlanInput.addEventListener('change', function() {
  Array.from(sitePlanInput.files).forEach(function(f) { processSitePlan(f); });
  sitePlanInput.value = '';
});

document.getElementById('btnLoadSitePlanLink').addEventListener('click', function() {
  const url = document.getElementById('sitePlanLinkInput').value.trim();
  if (url) processSitePlanLink(url);
});
document.getElementById('sitePlanLinkInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') { e.preventDefault(); const url = this.value.trim(); if (url) processSitePlanLink(url); }
});

async function processSitePlanLink(url) {
  setSitePlanStatus('loading', '⏳ Fetching site plan from shared link…');
  let fetchUrl = url;
  let filename = 'site-plan';
  let fetchHeaders = {};

  try {
    // ── Google Drive file ───────────────────────────────────
    if (url.includes('drive.google.com')) {
      const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (!m) throw new Error('Could not extract file ID from Google Drive URL.');
      const fileId = m[1];

      // Try Drive API v3 with OAuth token first — works for owned + shared files
      // and avoids the drive.usercontent.google.com CORS redirect entirely.
      let token = null;
      try { token = await driveGetToken(false); } catch (_) { /* not signed in */ }

      if (token) {
        // Get filename from metadata, then download with auth header
        try {
          const meta = await fetch(
            'https://www.googleapis.com/drive/v3/files/' + fileId + '?fields=name',
            { headers: { Authorization: 'Bearer ' + token } }
          );
          if (meta.ok) { const j = await meta.json(); if (j.name) filename = j.name; }
        } catch (_) { /* ignore, keep default filename */ }
        fetchUrl = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media';
        fetchHeaders = { Authorization: 'Bearer ' + token };
      } else {
        // Fallback: public file via direct download URL
        fetchUrl = 'https://drive.google.com/uc?export=download&id=' + fileId;
        filename = 'site-plan-drive';
      }

    // ── Dropbox ─────────────────────────────────────────────
    } else if (url.includes('dropbox.com')) {
      fetchUrl = url.replace(/[?&]dl=0/, '').replace(/dropbox\.com/, 'dl.dropboxusercontent.com');
      if (!fetchUrl.includes('dl=1')) fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + 'dl=1';
      const namePart = url.split('/').pop().split('?')[0];
      if (namePart) filename = decodeURIComponent(namePart);

    // ── SharePoint / OneDrive ───────────────────────────────
    } else if (url.includes('sharepoint.com') || url.includes('1drv.ms') || url.includes('onedrive.live.com')) {
      if (url.includes('1drv.ms')) {
        const b64url = btoa(url).replace(/=$/, '').replace(/==$/, '').replace(/\+/g, '-').replace(/\//g, '_');
        fetchUrl = 'https://api.onedrive.com/v1.0/shares/u!' + b64url + '/root/content';
      }
      const namePart = url.split('/').pop().split('?')[0];
      if (namePart) filename = decodeURIComponent(namePart);

    } else {
      // Unknown service — attempt direct fetch anyway
      const namePart = url.split('/').pop().split('?')[0];
      if (namePart) filename = decodeURIComponent(namePart);
    }

    const resp = await fetch(fetchUrl, Object.keys(fetchHeaders).length ? { headers: fetchHeaders } : undefined);
    if (!resp.ok) {
      const hint = (resp.status === 403 || resp.status === 401)
        ? ' — make sure the file is shared with your Google account or set to "Anyone with the link".' : '.';
      throw new Error('Fetch failed (HTTP ' + resp.status + ')' + hint);
    }

    const ct  = resp.headers.get('content-type') || '';
    const buf = await resp.arrayBuffer();

    // Detect type from Content-Type or filename
    const isPdf   = ct.includes('pdf')   || /\.pdf$/i.test(filename);
    const isImage = ct.includes('image') || /\.(png|jpe?g|webp)$/i.test(filename);
    if (!isPdf && !isImage) throw new Error('Link does not point to a PDF or image file (got: ' + (ct || 'unknown type') + ').');

    // Convert ArrayBuffer → data URL
    const bytes  = new Uint8Array(buf);
    const mime   = isPdf ? 'application/pdf' : (ct.includes('image') ? ct.split(';')[0].trim() : 'image/jpeg');
    let binary   = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const dataUrl = 'data:' + mime + ';base64,' + btoa(binary);

    sitePlansData.push({ type: isPdf ? 'pdf' : 'image', dataUrl: dataUrl, filename: filename });
    setSitePlanStatus('success', '✓ "' + filename + '" added (' + sitePlansData.length + ' total)');
    renderSitePlanPreview();

  } catch (err) {
    setSitePlanStatus('error', '✗ ' + err.message);
  }
}

// ── Pull Sheet helpers ────────────────────────────────────

// Extracts <style> blocks and <body> innerHTML from a full rendered HTML string.
// Returns an object { styles: string, body: string } safe to embed as an appendix page.
function extractPullSheetContent(fullHtml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(fullHtml, 'text/html');

  // Collect all <style> tags
  let styles = '';
  doc.querySelectorAll('style').forEach(function(s) { styles += s.textContent + '\n'; });

  // Body inner HTML
  const body = doc.body ? doc.body.innerHTML : fullHtml;
  return { styles: styles, body: body };
}


// ── Event listeners ───────────────────────────────────────
document.getElementById('btnPreview').addEventListener('click', showPreview);
document.getElementById('btnPreview2').addEventListener('click', showPreview);
document.getElementById('btnSaveDraft').addEventListener('click', saveDraft);
document.getElementById('btnBackEdit').addEventListener('click', function() { document.getElementById('printView').classList.remove('active'); });
document.getElementById('btnDoPrint').addEventListener('click', function() { window.print(); });
document.getElementById('btnDownloadPdf').addEventListener('click', downloadPdf);
setInterval(saveDraft, 60000);

// ── Comma → newline in all textareas ─────────────────────
// Typing a comma in any textarea inserts a newline instead,
// turning comma-separated input into a tidy line-per-item list.
document.addEventListener('keydown', function(e) {
  if (e.key !== ',' || e.target.tagName !== 'TEXTAREA') return;
  e.preventDefault();
  var ta = e.target;
  var start = ta.selectionStart;
  var end   = ta.selectionEnd;
  ta.value  = ta.value.slice(0, start) + '\n' + ta.value.slice(end);
  ta.selectionStart = ta.selectionEnd = start + 1;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});

document.addEventListener('paste', function(e) {
  if (e.target.tagName !== 'TEXTAREA') return;
  var text = (e.clipboardData || window.clipboardData).getData('text');
  if (!text.includes(',')) return;
  e.preventDefault();
  var ta    = e.target;
  var start = ta.selectionStart;
  var end   = ta.selectionEnd;
  var insert = text.replace(/,\s*/g, '\n');
  ta.value  = ta.value.slice(0, start) + insert + ta.value.slice(end);
  ta.selectionStart = ta.selectionEnd = start + insert.length;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});

// ── API Help modal ────────────────────────────────────────
document.getElementById('btnApiHelp').addEventListener('click', function () {
  document.getElementById('apiHelpOverlay').classList.add('active');
});
document.getElementById('btnApiHelpClose').addEventListener('click', function () {
  document.getElementById('apiHelpOverlay').classList.remove('active');
});
document.getElementById('apiHelpOverlay').addEventListener('click', function (e) {
  if (e.target === this) this.classList.remove('active');
});

// ── Additional Quotes ────────────────────────────────────────────────────────
// Fetch another opportunity by number and add its gear list to this event sheet.
async function addAdditionalOpp() {
  if (!apiHeaders) { showToast('Still loading — try again in a moment', 'error'); return; }
  const input = document.getElementById('additionalOppInput');
  let raw = (input.value || '').trim();
  // Accept full Current RMS URLs — extract the numeric ID from the path
  const urlMatch = raw.match(/\/opportunities\/(\d+)/i) || raw.match(/[?&]id=(\d+)/i) || raw.match(/(\d{4,})/);
  const val = urlMatch ? urlMatch[1] : raw;
  if (!val) { showToast('Enter an opportunity number or paste a URL', 'error'); return; }

  const btn = document.getElementById('btnAddAdditionalOpp');
  const origText = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ Loading…';

  try {
    const h = Object.assign({}, apiHeaders); delete h['Content-Type'];

    let foundOpp = null;

    // Strategy 1: fetch directly by ID (in Current RMS the URL id and display number are usually the same)
    const rDirect = await fetch('https://api.current-rms.com/api/v1/opportunities/' + encodeURIComponent(val), { headers: h });
    if (rDirect.ok) {
      const jDirect = await rDirect.json();
      foundOpp = jDirect.opportunity || null;
    }

    // Strategy 2: if not found by ID, search the list and match exactly on the number field
    if (!foundOpp) {
      const rSearch = await fetch(
        'https://api.current-rms.com/api/v1/opportunities?filter[number]=' + encodeURIComponent(val) + '&per_page=20',
        { headers: h }
      );
      if (rSearch.ok) {
        const jSearch = await rSearch.json();
        foundOpp = (jSearch.opportunities || []).find(function(o) { return String(o.number) === String(val); }) || null;
      }
    }

    if (!foundOpp) throw new Error('Opportunity #' + val + ' not found');
    const opp = foundOpp;

    if (String(opp.id) === String(oppId)) { showToast('That\'s the current opportunity', 'error'); return; }
    if (additionalOpps.find(function(o) { return String(o.id) === String(opp.id); })) { showToast('Already added', 'error'); return; }

    // Fetch full opportunity with items
    const r2 = await fetch(
      'https://api.current-rms.com/api/v1/opportunities/' + opp.id
      + '?include[]=opportunity_items&include[]=participants&include[]=member&include[]=venue',
      { headers: h }
    );
    if (!r2.ok) throw new Error('Could not load items (API ' + r2.status + ')');
    const j2 = await r2.json();
    const fullOpp = j2.opportunity || opp;
    const rawItems = fullOpp.opportunity_items || opp.opportunity_items || [];
    const items = normaliseItems(rawItems);

    const oppName = fullOpp.subject || opp.subject || fullOpp.name || opp.name || '(No name)';
    additionalOpps.push({ id: opp.id, number: opp.number, name: oppName, items: items });
    renderAdditionalOppList();
    input.value = '';
    showToast('✓ Added: #' + opp.number + ' ' + oppName, 'success');
  } catch (err) {
    showToast('✗ ' + err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = origText;
  }
}

function removeAdditionalOpp(i) {
  additionalOpps.splice(i, 1);
  renderAdditionalOppList();
}

// Sync additionalOpps order from current DOM row order (called after drag-drop)
function _syncAOOrderFromDOM() {
  const el = document.getElementById('additionalOppList');
  if (!el) return;
  const newOrder = [];
  el.querySelectorAll('.ao-row').forEach(function(row) {
    const id = row.getAttribute('data-ao-id');
    const found = additionalOpps.find(function(o) { return String(o.id) === id; });
    if (found) newOrder.push(found);
  });
  additionalOpps = newOrder;
}

let _dragAOSrc = null;
function _makeAODraggable(row) {
  row.draggable = true;
  row.addEventListener('dragstart', function(e) {
    _dragAOSrc = row;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(function() { row.classList.add('dragging'); }, 0);
  });
  row.addEventListener('dragend', function() {
    row.classList.remove('dragging');
    document.querySelectorAll('#additionalOppList .ao-row')
      .forEach(function(r) { r.classList.remove('drag-over-top', 'drag-over-bottom'); });
    _syncAOOrderFromDOM();
    _dragAOSrc = null;
  });
  row.addEventListener('dragover', function(e) {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    if (!_dragAOSrc || _dragAOSrc === row) return;
    const rect = row.getBoundingClientRect();
    const isTop = e.clientY < rect.top + rect.height / 2;
    row.classList.toggle('drag-over-top', isTop);
    row.classList.toggle('drag-over-bottom', !isTop);
  });
  row.addEventListener('dragleave', function() {
    row.classList.remove('drag-over-top', 'drag-over-bottom');
  });
  row.addEventListener('drop', function(e) {
    e.preventDefault();
    row.classList.remove('drag-over-top', 'drag-over-bottom');
    if (!_dragAOSrc || _dragAOSrc === row) return;
    const rect = row.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      row.parentNode.insertBefore(_dragAOSrc, row);
    } else {
      row.parentNode.insertBefore(_dragAOSrc, row.nextSibling);
    }
  });
}

function renderAdditionalOppList() {
  const el = document.getElementById('additionalOppList');
  if (!el) return;
  el.innerHTML = '';
  additionalOpps.forEach(function(ao) {
    const itemCount = condenseItemsAll(ao.items || []).length;
    const displayName = ao.name || ao.subject || '(No name)';

    const row = document.createElement('div');
    row.className = 'ao-row';
    row.setAttribute('data-ao-id', String(ao.id));

    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.textContent = '⠿';
    handle.title = 'Drag to reorder';

    const label = document.createElement('span');
    label.style.cssText = 'font-size:12px;font-family:var(--mono);color:var(--text);';
    label.innerHTML = '<strong style="color:var(--accent);">#' + esc(String(ao.number)) + '</strong>'
      + ' <span style="color:var(--text-muted);">—</span> ' + esc(displayName)
      + ' <span style="color:var(--text-muted);font-size:11px;">(' + itemCount + ' item' + (itemCount !== 1 ? 's' : '') + ')</span>';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'crew-remove';
    removeBtn.title = 'Remove';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', function() {
      const id = row.getAttribute('data-ao-id');
      additionalOpps = additionalOpps.filter(function(o) { return String(o.id) !== id; });
      renderAdditionalOppList();
    });

    row.appendChild(handle);
    row.appendChild(label);
    row.appendChild(removeBtn);
    _makeAODraggable(row);
    el.appendChild(row);
  });
}

document.getElementById('btnAddAdditionalOpp').addEventListener('click', addAdditionalOpp);
document.getElementById('additionalOppInput').addEventListener('keydown', function(e) { if (e.key === 'Enter') addAdditionalOpp(); });

loadOpportunity();
