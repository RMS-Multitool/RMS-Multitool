// services-dashboard.js — RMS Multitool Crew & Vehicle Dashboard
(() => {
  'use strict';

  // ── State ────────────────────────────────────────────────
  let config = {
    pollInterval: 300,
    stages: ['draft', 'provisional_quotation', 'reserved_quotation', 'order'],
    departments: [],
    email: { serviceId: '', templateId: '', publicKey: '', to: '', thresholdSec: 0, repeatSec: 0 }
  };
  let apiKey = '';
  let subdomain = '';
  let pollTimer = null;
  let isPolling = false;
  let lastResults = [];
  let cachedServiceTypes = [];

  // Timer tracking
  let firstSeenMap = {};
  const FIRST_SEEN_KEY = 'rms_crew_dashboard_first_seen';
  let emailSentMap = {};
  const EMAIL_SENT_KEY = 'rms_crew_dashboard_email_sent';

  // ── DOM ──────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const board            = $('board');
  const statTotal        = $('statTotal');
  const statScanned      = $('statScanned');
  const pollStatus       = $('pollStatus');
  const pollDot          = $('pollDot');
  const settingsBtn      = $('settingsBtn');
  const settingsOverlay  = $('settingsOverlay');
  const settingsPanel    = $('settingsPanel');
  const cancelSettingsBtn  = $('cancelSettingsBtn');
  const applySettingsBtn   = $('applySettingsBtn');
  const addDeptBtn         = $('addDeptBtn');
  const deptRulesContainer = $('deptRulesContainer');
  const pollIntervalSelect = $('pollIntervalSelect');
  const stageFilter        = $('stageFilter');
  const loadingOverlay     = $('loadingOverlay');
  const loadingText        = $('loadingText');
  const clockEl = $('clock');
  const clockDateEl = $('clockDate');

  // Month navigation
  const monthNavEl = $('monthNav');
  const monthLabelEl = $('monthLabel');
  const monthPrevBtn = $('monthPrev');
  const monthNextBtn = $('monthNext');
  const monthTodayBtn = $('monthTodayBtn');
  const monthAllBtn = $('monthAllBtn');
  const monthInfoEl = $('monthInfo');
  let viewMonth = new Date().getMonth();
  let viewYear = new Date().getFullYear();
  let showAllMonths = true;
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  const emailServiceId   = $('emailServiceId');
  const emailTemplateId  = $('emailTemplateId');
  const emailPublicKey   = $('emailPublicKey');
  const emailTo          = $('emailTo');
  const emailThresholdValue = $('emailThresholdValue');
  const emailThresholdUnit  = $('emailThresholdUnit');
  const emailRepeatValue    = $('emailRepeatValue');
  const emailRepeatUnit     = $('emailRepeatUnit');
  const testEmailBtn     = $('testEmailBtn');
  const emailTestStatus  = $('emailTestStatus');

  const defaultColors = ['#a06cff','#ffb347','#6bb8ff','#ff4d6a','#00e5a0','#ff6bcc','#4dd9ff','#ff8a65'];

  // Calendar state
  const calendarView   = $('calendarView');
  const calGrid        = $('calGrid');
  const calMonthLabel  = $('calMonthLabel');
  const calPrev        = $('calPrev');
  const calNext        = $('calNext');
  const calToday       = $('calToday');
  const calDeptFilters = $('calDeptFilters');
  const viewToggle     = $('viewToggle');
  let currentView = 'kanban';
  let calMonth = new Date().getMonth();
  let calYear = new Date().getFullYear();
  let calActiveDepts = new Set(); // empty = all

  // ── Month Navigation Helpers ──────────────────────────────
  function jobInMonth(q) {
    const monthStart = new Date(viewYear, viewMonth, 1);
    const monthEnd = new Date(viewYear, viewMonth + 1, 0, 23, 59, 59);
    const qStart = q.starts ? new Date(q.starts) : null;
    const qEnd = q.ends ? new Date(q.ends) : qStart;
    // No date or invalid date — show in all months
    if (!qStart || isNaN(qStart.getTime())) return true;
    if (qEnd && isNaN(qEnd.getTime())) return true;
    const result = qStart <= monthEnd && (qEnd || qStart) >= monthStart;
    if (!result) console.log(`[MonthFilter] HIDDEN: "${q.name}" starts=${q.starts} ends=${q.ends} not in ${MONTH_NAMES[viewMonth]} ${viewYear}`);
    return result;
  }

  function updateMonthLabel() {
    if (!monthLabelEl) return;
    if (showAllMonths) {
      monthLabelEl.textContent = 'All Months';
      if (monthPrevBtn) { monthPrevBtn.style.opacity = '0.3'; monthPrevBtn.style.pointerEvents = 'none'; }
      if (monthNextBtn) { monthNextBtn.style.opacity = '0.3'; monthNextBtn.style.pointerEvents = 'none'; }
      if (monthTodayBtn) monthTodayBtn.style.display = 'none';
      if (monthAllBtn) { monthAllBtn.classList.add('active'); monthAllBtn.textContent = 'Month View'; }
    } else {
      monthLabelEl.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;
      if (monthPrevBtn) { monthPrevBtn.style.opacity = ''; monthPrevBtn.style.pointerEvents = ''; }
      if (monthNextBtn) { monthNextBtn.style.opacity = ''; monthNextBtn.style.pointerEvents = ''; }
      const now = new Date();
      const isCurrent = viewMonth === now.getMonth() && viewYear === now.getFullYear();
      if (monthTodayBtn) monthTodayBtn.style.display = isCurrent ? 'none' : '';
      if (monthAllBtn) { monthAllBtn.classList.remove('active'); monthAllBtn.textContent = 'All Months'; }
    }
  }

  // ── Init ─────────────────────────────────────────────────
  loadCredentials().then(async () => {
    loadConfig();
    loadFirstSeen();
    loadEmailSent();
    startClock();
    if (subdomain && apiKey) {
      loadingText.textContent = 'Loading service types...';
      await loadServiceTypes();
    }
    loadLogo();
    loadingOverlay.classList.add('hidden');
    renderBoard();
    startPolling();
    setInterval(tickTimers, 30000);
  });

  // ── Logo ─────────────────────────────────────────────────
  function loadLogo() {
    const logoMark = $('logoMark');
    const img = new Image();
    img.onload = () => { logoMark.innerHTML = ''; logoMark.appendChild(img); };
    img.onerror = () => {};
    img.src = 'https://raw.githubusercontent.com/danhawes/RMS-Multitool/main/icons/icon-128.png';
  }

  // ── First-seen tracking ──────────────────────────────────
  function loadFirstSeen() { try { const s = localStorage.getItem(FIRST_SEEN_KEY); if (s) firstSeenMap = JSON.parse(s); } catch { firstSeenMap = {}; } }
  function saveFirstSeen() { localStorage.setItem(FIRST_SEEN_KEY, JSON.stringify(firstSeenMap)); }
  function getFirstSeen(deptName, oppId) {
    const key = `${deptName}::${oppId}`;
    if (!firstSeenMap[key]) { firstSeenMap[key] = Date.now(); saveFirstSeen(); }
    return firstSeenMap[key];
  }
  function pruneFirstSeen(activeKeys) {
    const s = new Set(activeKeys); let c = false;
    for (const k of Object.keys(firstSeenMap)) { if (!s.has(k)) { delete firstSeenMap[k]; c = true; } }
    if (c) saveFirstSeen();
  }

  // ── Email sent tracking ──────────────────────────────────
  function loadEmailSent() { try { const s = localStorage.getItem(EMAIL_SENT_KEY); if (s) emailSentMap = JSON.parse(s); } catch { emailSentMap = {}; } }
  function saveEmailSent() { localStorage.setItem(EMAIL_SENT_KEY, JSON.stringify(emailSentMap)); }
  function getLastEmailed(d, id) { return emailSentMap[`${d}::${id}`] || 0; }
  function markEmailed(d, id) { emailSentMap[`${d}::${id}`] = Date.now(); saveEmailSent(); }
  function pruneEmailSent(activeKeys) {
    const s = new Set(activeKeys); let c = false;
    for (const k of Object.keys(emailSentMap)) { if (!s.has(k)) { delete emailSentMap[k]; c = true; } }
    if (c) saveEmailSent();
  }
  function wasAlerted(d, id) { return !!emailSentMap[`${d}::${id}`]; }

  // ── Timer helpers ────────────────────────────────────────
  function formatElapsed(ms) {
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return 'Just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60), m = min % 60;
    if (h < 24) return `${h}h ${m}m`;
    const d = Math.floor(h / 24), rh = h % 24;
    return d === 1 ? `1d ${rh}h` : `${d}d ${rh}h`;
  }
  function tickTimers() {
    const now = Date.now();
    document.querySelectorAll('[data-first-seen]').forEach(el => {
      const ts = parseInt(el.dataset.firstSeen);
      if (ts) el.textContent = formatElapsed(now - ts);
    });
  }

  // ── Credentials ──────────────────────────────────────────
  function loadCredentials() {
    return new Promise(resolve => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.get(['subdomain', 'apiKey'], r => { subdomain = r.subdomain || ''; apiKey = r.apiKey || ''; resolve(); });
      } else { subdomain = localStorage.getItem('rms_subdomain') || ''; apiKey = localStorage.getItem('rms_apiKey') || ''; resolve(); }
    });
  }

  // ── Config (separate from quote dashboard) ───────────────
  function loadConfig() {
    try {
      const s = localStorage.getItem('rms_crew_dashboard_config');
      if (s) { const p = JSON.parse(s); config = { ...config, ...p }; config.email = { ...config.email, ...(p.email || {}) }; }
    } catch {}
  }
  function saveConfig() { localStorage.setItem('rms_crew_dashboard_config', JSON.stringify(config)); }

  // ── Clock ────────────────────────────────────────────────
  function startClock() {
    function tick() {
      const now = new Date();
      clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      clockDateEl.textContent = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
    }
    tick(); setInterval(tick, 10000);
  }

  // ── API helper ───────────────────────────────────────────
  function buildApiUrl(endpoint, paramsArray) {
    const base = `https://api.current-rms.com/api/v1/${endpoint}`;
    if (!paramsArray || paramsArray.length === 0) return base;
    const qs = paramsArray.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    return `${base}?${qs}`;
  }
  function apiFetch(url) {
    return fetch(url, {
      method: 'GET',
      headers: { 'X-SUBDOMAIN': subdomain, 'X-AUTH-TOKEN': apiKey, 'Content-Type': 'application/json' }
    }).then(r => { if (!r.ok) throw new Error(`API ${r.status}`); return r.json(); });
  }

  // ── Load service types (used as keyword categories for matching) ──
  async function loadServiceTypes() {
    // These service types are used as keyword-matching categories
    // Since service_type_name is not available via the API, 
    // selecting a service type adds pattern-matching against service item names
    cachedServiceTypes = [
      { name: 'Crew' },
      { name: 'Loaders / General Labour' },
      { name: 'Transport' },
      { name: 'TTY Crew' }
    ];
    console.log('[Crew] Service types loaded:', cachedServiceTypes.length);
  }

  // ── Live search services ───────────────────────────────
  let productSearchAbort = null;
  async function searchProducts(query) {
    if (productSearchAbort) productSearchAbort.abort();
    if (!query || query.length < 2) return [];
    const controller = new AbortController();
    productSearchAbort = controller;
    try {
      const url = buildApiUrl('services', [['per_page', '30'], ['q[name_cont]', query], ['q[s][]', 'name asc']]);
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'X-SUBDOMAIN': subdomain, 'X-AUTH-TOKEN': apiKey, 'Content-Type': 'application/json' },
        signal: controller.signal
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.services || []).map(s => s.name);
    } catch { return []; }
  }

  // ── Fetch upcoming opportunities ─────────────────────────
  async function fetchUpcomingOpportunities() {
    const allOpps = [];
    let page = 1;
    const perPage = 20;
    // Start from 2 weeks ago to catch in-progress events
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const startFromISO = twoWeeksAgo.toISOString().split('T')[0];
    const stateMap = { draft: 1, provisional_quotation: 2, reserved_quotation: 3, order: 4 };
    const stateCodes = config.stages.map(s => stateMap[s]).filter(Boolean);
    let totalExpected = Infinity;
    while (true) {
      const params = [
        ['per_page', String(perPage)],
        ['page', String(page)],
        ['q[s][]', 'starts_at asc'],
        ['q[starts_at_gteq]', startFromISO]
      ];
      stateCodes.forEach(code => params.push(['q[state_in][]', String(code)]));
      const url = buildApiUrl('opportunities', params);
      const data = await apiFetch(url);
      const opps = data.opportunities || [];
      // Use meta to get total count if available
      if (data.meta && data.meta.total_row_count) {
        totalExpected = data.meta.total_row_count;
      }
      allOpps.push(...opps);
      console.log(`[Crew] Page ${page}: fetched ${opps.length} opps (total so far: ${allOpps.length}${totalExpected < Infinity ? ' of ' + totalExpected : ''})`);
      // Stop if: no results, or we've got everything, or safety limit
      if (opps.length === 0) break;
      if (allOpps.length >= totalExpected) break;
      if (page >= 100) break;
      page++;
    }
    console.log(`[Crew] Fetched ${allOpps.length} total opportunities across ${page} pages`);
    // Client-side: only filter out events that have already ended
    const now = new Date();
    const filtered = allOpps.filter(opp => {
      const endStr = opp.ends_at || '';
      if (!endStr) return true;
      const endDate = new Date(endStr);
      return isNaN(endDate.getTime()) || endDate >= now;
    });
    console.log(`[Crew] After filtering ended: ${filtered.length} opportunities remain`);
    return filtered;
  }

  // ── Fetch opp items ──────────────────────────────────────
  async function fetchOpportunityItems(oppId) {
    const allItems = [];
    let page = 1;
    while (true) {
      const url = buildApiUrl(`opportunities/${oppId}/opportunity_items`, [['per_page', '100'], ['page', String(page)]]);
      const data = await apiFetch(url);
      const items = data.opportunity_items || [];
      allItems.push(...items);
      if (items.length < 100 || page >= 10) break;
      page++;
    }
    return allItems;
  }

  // ── Check if item is a service ───────────────────────────
  function isServiceItem(item) {
    // Groups have opportunity_item_type=0, skip them
    if (item.opportunity_item_type === 0) return false;
    // Transaction type 3 = Service in CurrentRMS API
    if (item.transaction_type === 3) return true;
    // Fallback: check transaction_type_name
    const ttn = (item.transaction_type_name || '').toLowerCase();
    if (ttn === 'service') return true;
    return false;
  }

  // ── Match service item to department ─────────────────────
  function serviceMatchesDept(item, dept, oppSubject) {
    // Match by exact service product ID (item_id from opportunity_items)
    const pid = String(item.item_id || '');
    if (dept.productIds && dept.productIds.length > 0 && dept.productIds.includes(pid)) return true;

    const iN = (item.name || '').toLowerCase();
    // Also check cost_group_name from first asset's opportunity_cost if available
    const assets = item.item_assets || [];
    const costGroup = (assets.length > 0 && assets[0].opportunity_cost ? assets[0].opportunity_cost.cost_group_name || '' : '').toLowerCase();
    const oppS = (oppSubject || '').toLowerCase();

    // Match by service type category (these act as smart keyword groups)
    if (dept.serviceTypes && dept.serviceTypes.length > 0) {
      for (const st of dept.serviceTypes) {
        const stL = st.toLowerCase();
        if (stL === 'crew') {
          // Exclude TY venue services — those belong to TTY Crew dept only
          const isTTYVenue = (oppS.startsWith('ty -') || oppS.startsWith('ty ')) &&
              iN.includes('venue');
          if (isTTYVenue) continue; // skip, let TTY Crew handle these
          // Matches crew, rigger, operator, production manager, tech on duty, etc.
          if (iN.includes('crew') || iN.includes('rigger') || iN.includes('operator') || 
              iN.includes('production manager') || iN.includes('tech on duty') || iN.includes('tod') ||
              iN.includes('stage hand') || iN.includes('technician') || iN.includes('pica')) return true;
          // Also match by cost group
          if (costGroup === 'crew' || costGroup === 'show crew') return true;
        } else if (stL === 'loaders / general labour') {
          if (iN.includes('loader') || iN.includes('labour') || iN.includes('labor') || iN.includes('hourly labour')) return true;
          if (costGroup === 'agency labour hire') return true;
        } else if (stL === 'transport') {
          if (iN.includes('transport') || iN.includes('delivery') || iN.includes('pickup') || 
              iN.includes('vehicle') || iN.includes('driver') || iN.includes('float')) return true;
          if (costGroup.includes('transport')) return true;
        } else if (stL === 'tty crew') {
          // TTY Crew matches by TY- opportunity subject prefix AND venue service items only
          if ((oppS.startsWith('ty -') || oppS.startsWith('ty ')) &&
              iN.includes('venue')) return true;
        } else {
          // Generic: match service type name directly in item name
          if (iN.includes(stL)) return true;
        }
      }
    }

    // Match by custom keywords (exact substring match in name or description)
    const iD = (item.description || '').toLowerCase();
    if (dept.keywords && dept.keywords.length > 0) {
      for (const kw of dept.keywords) {
        const k = kw.toLowerCase();
        if (iN.includes(k) || iD.includes(k)) return true;
      }
    }

    return false;
  }

  // ── Classify service item (crew vs transport vs other) ───
  function classifyService(item) {
    const name = (item.name || '').toLowerCase();
    const assets = item.item_assets || [];
    const costGroup = (assets.length > 0 && assets[0].opportunity_cost ? assets[0].opportunity_cost.cost_group_name || '' : '').toLowerCase();
    
    if (name.includes('transport') || name.includes('vehicle') || name.includes('delivery') || name.includes('pickup') ||
        name.includes('driver') || name.includes('float') || costGroup.includes('transport')) {
      return 'transport';
    }
    if (name.includes('crew') || name.includes('labour') || name.includes('labor') || name.includes('operator') ||
        name.includes('rigger') || name.includes('loader') || name.includes('production manager') || 
        name.includes('tech on duty') || name.includes('tod') ||
        costGroup === 'crew' || costGroup === 'show crew' || costGroup === 'agency labour hire') {
      return 'crew';
    }
    return 'other';
  }

  // ── Email HTML builder ───────────────────────────────────
  function buildEmailHtml(quoteName, reference, deptName, customer, eventDates, timeOnBoard, serviceItemsStr, dashboardUrl) {
    const e = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0a0a0e;font-family:Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0e;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#131318;border:1px solid #2a2a35;border-radius:12px;overflow:hidden;max-width:560px;width:100%;">
<tr><td style="height:4px;background:linear-gradient(90deg,#6bb8ff,#a06cff);"></td></tr>
<tr><td style="padding:28px 32px 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="42"><div style="width:36px;height:36px;background-color:#6bb8ff;border-radius:9px;text-align:center;line-height:36px;font-size:18px;color:#0a0a0e;font-weight:bold;">&#128666;</div></td>
<td style="padding-left:12px;"><div style="font-size:18px;font-weight:800;color:#f0f0f5;letter-spacing:-0.3px;">Crew & Vehicle Alert</div>
<div style="font-size:11px;color:#6b6b80;letter-spacing:0.5px;text-transform:uppercase;margin-top:2px;">RMS Multitool &mdash; Resource Allocation</div></td>
</tr></table></td></tr>
<tr><td style="padding:0 32px;"><div style="height:1px;background-color:#2a2a35;"></div></td></tr>
<tr><td style="padding:20px 32px 16px;"><div style="background-color:#0f0a1f;border:1px solid #2a1540;border-radius:8px;padding:14px 16px;">
<div style="font-size:13px;color:#a06cff;font-weight:600;margin-bottom:4px;">&#9201; Sitting unattended for ${e(timeOnBoard)}</div>
<div style="font-size:12px;color:#6b6b80;">This job needs crew/vehicle allocation and has been on the dashboard past the alert threshold.</div>
</div></td></tr>
<tr><td style="padding:8px 32px 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#1a1a22;border:1px solid #2a2a35;border-radius:8px;overflow:hidden;">
<tr><td style="padding:16px 18px 12px;"><div style="font-size:9px;color:#6b6b80;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:4px;">Job</div>
<div style="font-size:16px;font-weight:700;color:#f0f0f5;">${e(quoteName)}</div>
<div style="font-size:12px;color:#6b6b80;margin-top:2px;">${e(reference)}</div></td></tr>
<tr><td style="padding:0 18px;"><div style="height:1px;background-color:#2a2a35;"></div></td></tr>
<tr><td style="padding:12px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="50%" style="vertical-align:top;padding-right:8px;"><div style="font-size:9px;color:#6b6b80;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:4px;">Department</div>
<div style="font-size:13px;color:#f0f0f5;font-weight:600;">${e(deptName)}</div></td>
<td width="50%" style="vertical-align:top;padding-left:8px;"><div style="font-size:9px;color:#6b6b80;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:4px;">Customer</div>
<div style="font-size:13px;color:#f0f0f5;">${e(customer)}</div></td>
</tr></table></td></tr>
<tr><td style="padding:0 18px;"><div style="height:1px;background-color:#2a2a35;"></div></td></tr>
<tr><td style="padding:12px 18px;"><div style="font-size:9px;color:#6b6b80;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:4px;">&#128197; Event Dates</div>
<div style="font-size:13px;color:#f0f0f5;">${e(eventDates)}</div></td></tr>
<tr><td style="padding:0 18px;"><div style="height:1px;background-color:#2a2a35;"></div></td></tr>
<tr><td style="padding:12px 18px 16px;"><div style="font-size:9px;color:#6b6b80;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;">&#128666; Services Needed</div>
<div style="font-size:12px;color:#a06cff;line-height:1.6;">${e(serviceItemsStr)}</div></td></tr>
</table></td></tr>
<tr><td style="padding:4px 32px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<a href="${e(dashboardUrl)}" target="_blank" style="display:inline-block;background-color:#6bb8ff;color:#0a0a0e;font-size:13px;font-weight:700;text-decoration:none;padding:12px 32px;border-radius:8px;">Open in CurrentRMS &rarr;</a>
</td></tr></table></td></tr>
<tr><td style="padding:0 32px;"><div style="height:1px;background-color:#2a2a35;"></div></td></tr>
<tr><td style="padding:16px 32px 20px;"><div style="font-size:10px;color:#6b6b80;text-align:center;line-height:1.5;">
Sent by RMS Multitool Crew & Vehicle Dashboard<br>Job unattended for <strong style="color:#a06cff;">${e(timeOnBoard)}</strong><br>
<span style="color:#4a4a5a;">To adjust alert settings, open the dashboard and click Settings.</span>
</div></td></tr>
</table></td></tr></table></body></html>`;
  }

  // ── EmailJS sending ──────────────────────────────────────
  async function sendAlertEmail(quote, deptName, timeOnBoard, serviceItems) {
    const e = config.email;
    if (!e.serviceId || !e.templateId || !e.publicKey || !e.to) return false;
    const startFull = quote.starts ? fmtDateFull(quote.starts) : '';
    const endFull = quote.ends ? fmtDateFull(quote.ends) : '';
    const dateStr = startFull ? `${startFull}${endFull ? ' → ' + endFull : ''}` : 'No dates set';
    const dashUrl = `https://${subdomain}.current-rms.com/opportunities/${quote.id}`;
    const itemsStr = serviceItems.map(si => `${si.name} ×${si.qty}`).join(', ');
    const htmlBody = buildEmailHtml(quote.name, quote.reference, deptName, quote.member || 'N/A', dateStr, timeOnBoard, itemsStr, dashUrl);
    try {
      const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_id: e.serviceId, template_id: e.templateId, user_id: e.publicKey,
          template_params: { to_email: e.to, subject: `🚛 Crew Alert: ${quote.name} — unattended for ${timeOnBoard}`, html_body: htmlBody } })
      });
      if (!res.ok) throw new Error(`EmailJS ${res.status}`);
      console.log(`[Crew] Alert sent for "${quote.name}" in ${deptName}`);
      return true;
    } catch (err) { console.error(`[Crew] Email failed:`, err); return false; }
  }

  // ── Check alerts ─────────────────────────────────────────
  async function checkAlerts(deptResults) {
    const e = config.email;
    if (!e.thresholdSec || e.thresholdSec <= 0 || !e.serviceId || !e.templateId || !e.publicKey || !e.to) return;
    const now = Date.now(), thMs = e.thresholdSec * 1000, repMs = e.repeatSec * 1000;
    for (const dr of deptResults) {
      for (const q of dr.quotes) {
        const fs = getFirstSeen(dr.dept.name, q.id);
        const elapsed = now - fs;
        if (elapsed < thMs) continue;
        const le = getLastEmailed(dr.dept.name, q.id);
        let send = false;
        if (le === 0) send = true;
        else if (repMs > 0 && (now - le) >= repMs) send = true;
        if (send) {
          const ok = await sendAlertEmail(q, dr.dept.name, formatElapsed(elapsed), q.serviceItems);
          if (ok) markEmailed(dr.dept.name, q.id);
          await sleep(500);
        }
      }
    }
  }

  // ── Poll ─────────────────────────────────────────────────
  async function pollOnce() {
    if (!subdomain || !apiKey) {
      pollStatus.textContent = 'No API credentials';
      pollDot.style.background = 'var(--error)'; pollDot.style.boxShadow = '0 0 6px var(--error)';
      showEmptyBoard('No API Credentials', 'Open the RMS Multitool extension popup to set your subdomain and API key.');
      return;
    }
    if (config.departments.length === 0) {
      showEmptyBoard('No Departments Configured', 'Click Settings to add departments and define which service types to track.');
      pollStatus.textContent = 'No rules set'; return;
    }
    if (isPolling) return;
    isPolling = true;
    pollStatus.textContent = 'Scanning...';
    console.log('[Crew] Polling with departments:', config.departments.map(d => ({ name: d.name, serviceTypes: d.serviceTypes, keywords: d.keywords, productIds: d.productIds })));
    pollDot.style.animation = 'none'; pollDot.style.background = 'var(--warning)'; pollDot.style.boxShadow = '0 0 6px var(--warning)';

    try {
      const opportunities = await fetchUpcomingOpportunities();
      statScanned.textContent = opportunities.length;
      const deptResults = config.departments.map(d => ({ dept: d, quotes: [] }));
      const batchSize = 10;

      // Progressive rendering: render columns immediately, add cards as they load
      lastResults = deptResults;
      renderBoard();
      pollStatus.textContent = `Loading 0/${opportunities.length}...`;

      for (let i = 0; i < opportunities.length; i += batchSize) {
        const batch = opportunities.slice(i, i + batchSize);
        await Promise.all(batch.map(async opp => {
          try {
            const items = await fetchOpportunityItems(opp.id);
            // Filter to service items only (transaction_type=3, not groups)
            const serviceItems = items.filter(isServiceItem);
            if (serviceItems.length === 0) return;
            console.log(`[Crew] Opp ${opp.id} "${opp.subject}" has ${serviceItems.length} service items:`, serviceItems.map(s => s.name));

            deptResults.forEach(dr => {
              const matches = serviceItems.filter(it => serviceMatchesDept(it, dr.dept, opp.subject));
              if (matches.length > 0) {
                // Check allocation: compare item quantity vs total quantity_allocated across assets
                const unallocated = matches.filter(it => {
                  const qty = parseFloat(it.quantity) || 1;
                  const assets = it.item_assets || [];
                  const totalAllocated = assets.reduce((sum, a) => sum + (parseFloat(a.quantity_allocated) || 0), 0);
                  const isFullyAllocated = totalAllocated >= qty;
                  if (isFullyAllocated) {
                    console.log(`[Crew]     "${it.name}" FULLY ALLOCATED (${totalAllocated}/${qty})`);
                  }
                  return !isFullyAllocated;
                });
                
                // If ALL matched services are fully allocated, skip this opp for this dept
                if (unallocated.length === 0) {
                  console.log(`[Crew]   → Dept "${dr.dept.name}" matched ${matches.length} but all fully allocated, hiding card`);
                  return;
                }
                console.log(`[Crew]   → Dept "${dr.dept.name}" matched ${matches.length} (${unallocated.length} need allocation):`, unallocated.map(m => m.name));
                
                // Build rich service item info (only unallocated)
                const richItems = unallocated.map(it => {
                  const qty = parseFloat(it.quantity) || 1;
                  const assets = it.item_assets || [];
                  const totalAllocated = assets.reduce((sum, a) => sum + (parseFloat(a.quantity_allocated) || 0), 0);
                  return {
                    name: it.name || 'Unknown',
                    qty: qty,
                    allocated: totalAllocated,
                    remaining: qty - totalAllocated,
                    type: classifyService(it),
                    serviceType: '',
                    starts: it.starts_at || opp.starts_at || '',
                    ends: it.ends_at || opp.ends_at || '',
                    status: it.status,
                    statusName: it.status_name || ''
                  };
                });

                const crewCount = richItems.filter(i => i.type === 'crew').reduce((s, i) => s + i.remaining, 0);
                const vehicleCount = richItems.filter(i => i.type === 'transport').reduce((s, i) => s + i.remaining, 0);
                const otherCount = richItems.filter(i => i.type === 'other').reduce((s, i) => s + i.remaining, 0);

                dr.quotes.push({
                  id: opp.id,
                  name: opp.subject || opp.name || `Opportunity #${opp.id}`,
                  reference: opp.number || opp.reference || '',
                  state: opp.state_name || opp.status || '',
                  stateRaw: opp.state,
                  starts: opp.starts_at || '',
                  ends: opp.ends_at || '',
                  member: opp.member_name || (opp.member ? opp.member.name : '') || '',
                  destination: opp.destination || opp.venue_name || '',
                  serviceItems: richItems,
                  crewCount,
                  vehicleCount,
                  otherCount
                });
              }
            });
          } catch (e) { console.warn(`Opp ${opp.id} fetch failed:`, e); }
        }));

        // Progressive render: sort and re-render after each batch
        deptResults.forEach(dr => {
          dr.quotes.sort((a, b) => {
            const da = a.starts ? new Date(a.starts).getTime() : Infinity;
            const db = b.starts ? new Date(b.starts).getTime() : Infinity;
            return da - db;
          });
        });
        lastResults = deptResults;
        renderBoard();
        const done = Math.min(i + batchSize, opportunities.length);
        pollStatus.textContent = `Loading ${done}/${opportunities.length}...`;
        statTotal.textContent = deptResults.reduce((s, dr) => s + dr.quotes.length, 0);
      }

      // Final pass: prune timers, check alerts
      const activeKeys = [];
      deptResults.forEach(dr => {
        dr.quotes.forEach(q => { const k = `${dr.dept.name}::${q.id}`; activeKeys.push(k); getFirstSeen(dr.dept.name, q.id); });
      });
      pruneFirstSeen(activeKeys);
      pruneEmailSent(activeKeys);

      lastResults = deptResults;
      renderBoard();
      await checkAlerts(deptResults);

      const total = deptResults.reduce((s, dr) => s + dr.quotes.length, 0);
      statTotal.textContent = total;
      const now = new Date();
      pollStatus.textContent = `Updated ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      pollDot.style.background = 'var(--accent)'; pollDot.style.boxShadow = '0 0 6px var(--accent)'; pollDot.style.animation = 'pulse 2s infinite';
    } catch (err) {
      console.error('Poll error:', err);
      pollStatus.textContent = 'Error — retrying...';
      pollDot.style.background = 'var(--error)'; pollDot.style.boxShadow = '0 0 6px var(--error)';
    } finally { isPolling = false; }
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollOnce();
    pollTimer = setInterval(pollOnce, config.pollInterval * 1000);
  }

  // ── Render kanban ────────────────────────────────────────
  function renderBoard() {
    if (currentView === 'calendar') { renderCalendar(); return; }
    board.innerHTML = '';
    if (config.departments.length === 0 || !lastResults.length) {
      showEmptyBoard('No Departments Configured', 'Click Settings to add departments and define which service types to track.');
      return;
    }

    // Filter by selected month (or show all)
    const filteredDepts = showAllMonths
      ? lastResults.map(dr => ({ dept: dr.dept, quotes: [...dr.quotes] }))
      : lastResults.map(dr => ({ dept: dr.dept, quotes: dr.quotes.filter(q => jobInMonth(q)) }));

    const active = filteredDepts.filter(dr => dr.quotes.length > 0);
    const totalInView = active.reduce((s, dr) => s + dr.quotes.length, 0);
    const totalAll = lastResults.reduce((s, dr) => s + dr.quotes.length, 0);
    statTotal.textContent = totalAll;
    if (monthInfoEl) {
      if (showAllMonths) {
        monthInfoEl.textContent = `${totalAll} total across all months`;
      } else {
        monthInfoEl.textContent = `${totalInView} in ${MONTH_NAMES[viewMonth]} · ${totalAll} total`;
      }
    }

    if (totalInView === 0) {
      if (showAllMonths) {
        showAllClearBoard();
      } else {
        showEmptyBoard(`No Jobs in ${MONTH_NAMES[viewMonth]} ${viewYear}`, 'Use the month navigation to browse other months, or click All Months.');
      }
      return;
    }

    active.forEach((dr, idx) => {
      const col = document.createElement('div');
      col.className = 'kanban-col';
      col.style.animationDelay = `${idx * 60}ms`;
      col.innerHTML = `
        <div class="col-header">
          <div style="position:absolute;top:0;left:0;right:0;height:3px;border-radius:12px 12px 0 0;background:${esc(dr.dept.color)};"></div>
          <div class="col-title">${esc(dr.dept.name)}<span class="col-count">${dr.quotes.length}</span></div>
        </div>
        <div class="col-body"></div>
      `;
      const body = col.querySelector('.col-body');
      dr.quotes.forEach((q, qi) => body.insertAdjacentHTML('beforeend', renderCard(q, dr.dept, qi)));
      board.appendChild(col);
    });
    tickTimers();
  }

  function renderCard(q, dept, idx) {
    const stageClass = { 1: 'stage-draft', 2: 'stage-quote', 3: 'stage-reserved', 4: 'stage-order' }[q.stateRaw] || 'stage-draft';
    const startFull = q.starts ? fmtDateFull(q.starts) : '';
    const endFull = q.ends ? fmtDateFull(q.ends) : '';
    const dateStr = startFull ? `${startFull}${endFull ? '  →  ' + endFull : ''}` : 'No dates set';
    const url = `https://${subdomain}.current-rms.com/opportunities/${q.id}`;

    const firstSeen = getFirstSeen(dept.name, q.id);
    const elapsed = formatElapsed(Date.now() - firstSeen);
    const elapsedMs = Date.now() - firstSeen;
    const isOverdue = config.email.thresholdSec > 0 && elapsedMs >= (config.email.thresholdSec * 1000);
    const alerted = wasAlerted(dept.name, q.id);

    // Summary chips (show remaining/needed counts)
    let summaryHtml = '<div class="service-summary">';
    if (q.crewCount > 0) summaryHtml += `<div class="summary-chip crew-chip">👤 ${q.crewCount} crew needed</div>`;
    if (q.vehicleCount > 0) summaryHtml += `<div class="summary-chip transport-chip">🚛 ${q.vehicleCount} vehicle${q.vehicleCount !== 1 ? 's' : ''} needed</div>`;
    if (q.otherCount > 0) summaryHtml += `<div class="summary-chip other-chip">📦 ${q.otherCount} other needed</div>`;
    summaryHtml += '</div>';

    // Service items (show max 4, rest in tooltip)
    const visible = q.serviceItems.slice(0, 4);
    const remaining = q.serviceItems.length - 4;
    let itemsHtml = '<div class="service-items">';
    visible.forEach(si => {
      const icon = si.type === 'transport' ? '🚛' : si.type === 'crew' ? '👤' : '📦';
      const cls = si.type === 'transport' ? 'transport' : si.type === 'crew' ? 'crew' : '';
      const siTimeStr = si.starts ? fmtTime(si.starts) + (si.ends ? ' → ' + fmtTime(si.ends) : '') : '';
      const allocStr = si.allocated > 0 ? `${Math.round(si.allocated)}/${Math.round(si.qty)}` : `×${Math.round(si.qty)}`;
      itemsHtml += `<div class="service-item ${cls}"><span class="si-icon">${icon}</span><span class="si-name">${esc(si.name)}</span><span class="si-qty">${allocStr}</span>${siTimeStr ? `<span class="si-dates">${siTimeStr}</span>` : ''}</div>`;
    });
    if (remaining > 0) itemsHtml += `<div class="service-more">+${remaining} more service${remaining !== 1 ? 's' : ''}</div>`;
    itemsHtml += '</div>';

    // Tooltip data
    const tooltipData = JSON.stringify(q.serviceItems.map(si => ({
      name: si.name, qty: si.qty, type: si.type, serviceType: si.serviceType,
      times: si.starts ? fmtTime(si.starts) + (si.ends ? ' → ' + fmtTime(si.ends) : '') : ''
    })));

    return `<div class="quote-card" style="animation-delay:${idx * 40}ms;" data-tooltip-items='${tooltipData.replace(/'/g, "&#39;")}'>
      ${alerted ? '<div class="card-alerted-banner"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>Email alert sent</div>' : ''}
      <div class="card-top">
        <div>
          <div class="card-name">${esc(q.name)}</div>
          <div class="card-ref">${esc(q.reference)}</div>
        </div>
        <div class="card-stage ${stageClass}">${esc(q.state)}</div>
      </div>
      <div class="card-date">📅 ${dateStr}</div>
      <div class="card-meta">
        ${q.member ? `<span>👤 ${esc(q.member)}</span>` : ''}
        ${q.destination ? `<span>📍 ${esc(q.destination)}</span>` : ''}
      </div>
      ${summaryHtml}
      ${itemsHtml}
      <div class="card-footer">
        <a class="card-link" href="${url}" target="_blank">Open in CurrentRMS →</a>
        <div class="card-timer${isOverdue ? ' alerted' : ''}" title="Time on dashboard">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span data-first-seen="${firstSeen}">${elapsed}</span>
        </div>
      </div>
    </div>`;
  }

  function fmtDateFull(d) {
    try { return new Date(d).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); } catch { return d; }
  }
  function fmtDateShort(d) {
    try { return new Date(d).toLocaleDateString([], { day: 'numeric', month: 'short' }); } catch { return d; }
  }
  function fmtTime(d) {
    try {
      const dt = new Date(d);
      return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch { return d; }
  }
  function showEmptyBoard(title, msg) {
    board.innerHTML = `<div class="board-empty">
      <div class="empty-icon"><svg viewBox="0 0 24 24"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg></div>
      <h2>${title}</h2><p>${msg}</p>
    </div>`;
  }
  function showAllClearBoard() {
    board.innerHTML = `<div class="board-empty">
      <div class="empty-icon"><svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
      <h2>All Clear</h2><p>No upcoming jobs need crew or vehicle allocation. Dashboard refreshes automatically.</p>
    </div>`;
  }
  function esc(s) { const d = document.createElement('div'); d.textContent = String(s || ''); return d.innerHTML; }

  // ── Tooltip ──────────────────────────────────────────────
  const tooltip = document.createElement('div');
  tooltip.className = 'card-tooltip';
  document.body.appendChild(tooltip);
  let tooltipCard = null;

  document.addEventListener('mouseover', e => {
    const card = e.target.closest('.quote-card');
    if (!card) return;
    if (tooltipCard === card) return;
    tooltipCard = card;
    const data = card.dataset.tooltipItems;
    if (!data) { tooltip.classList.remove('visible'); return; }
    const items = JSON.parse(data);
    if (items.length === 0) { tooltip.classList.remove('visible'); return; }

    tooltip.innerHTML = `<div class="card-tooltip-title">All Services (${items.length})</div>` +
      items.map(si => {
        const icon = si.type === 'transport' ? '🚛' : si.type === 'crew' ? '👤' : '📦';
        return `<div class="card-tooltip-item"><span class="tt-icon">${icon}</span><span class="tt-name">${esc(si.name)}</span><span class="tt-detail">×${si.qty}${si.times ? ' · ' + si.times : ''}</span></div>`;
      }).join('');

    const rect = card.getBoundingClientRect();
    let top = rect.bottom + 6, left = rect.left;
    tooltip.classList.add('visible');
    const tt = tooltip.getBoundingClientRect();
    if (top + tt.height > window.innerHeight - 10) top = rect.top - tt.height - 6;
    if (left + tt.width > window.innerWidth - 10) left = window.innerWidth - tt.width - 10;
    if (top < 10) top = 10; if (left < 10) left = 10;
    tooltip.style.top = top + 'px'; tooltip.style.left = left + 'px';
  });

  document.addEventListener('mouseout', e => {
    const card = e.target.closest('.quote-card');
    if (!card) return;
    const related = e.relatedTarget;
    if (related && card.contains(related)) return;
    if (tooltipCard === card) { tooltipCard = null; tooltip.classList.remove('visible'); }
  });

  // ── Time input helpers ───────────────────────────────────
  function setTimeInputs(totalSec, valueEl, unitEl) {
    if (!totalSec || totalSec <= 0) { valueEl.value = '0'; unitEl.value = '3600'; return; }
    if (totalSec % 86400 === 0) { valueEl.value = String(totalSec / 86400); unitEl.value = '86400'; }
    else if (totalSec % 3600 === 0) { valueEl.value = String(totalSec / 3600); unitEl.value = '3600'; }
    else { valueEl.value = String(Math.round(totalSec / 60)); unitEl.value = '60'; }
  }
  function getTimeInputSec(valueEl, unitEl) { return Math.round((parseFloat(valueEl.value) || 0) * (parseInt(unitEl.value) || 3600)); }

  // ── Settings panel ───────────────────────────────────────
  settingsBtn.addEventListener('click', openSettings);
  settingsOverlay.addEventListener('click', closeSettings);
  cancelSettingsBtn.addEventListener('click', closeSettings);
  applySettingsBtn.addEventListener('click', applySettings);
  addDeptBtn.addEventListener('click', () => addDeptBlock());
  stageFilter.addEventListener('click', e => { const c = e.target.closest('.stage-chip'); if (c) c.classList.toggle('active'); });
  testEmailBtn.addEventListener('click', sendTestEmail);

  document.addEventListener('click', e => {
    if (!e.target.closest('.multi-select-wrap')) {
      document.querySelectorAll('.ms-dropdown.open').forEach(dd => dd.classList.remove('open'));
      document.querySelectorAll('.multi-select-trigger.open').forEach(tr => tr.classList.remove('open'));
    }
  });

  function openSettings() {
    pollIntervalSelect.value = config.pollInterval;
    stageFilter.querySelectorAll('.stage-chip').forEach(c => c.classList.toggle('active', config.stages.includes(c.dataset.stage)));
    deptRulesContainer.innerHTML = '';
    if (config.departments.length === 0) addDeptBlock();
    else config.departments.forEach(d => addDeptBlock(d));
    emailServiceId.value = config.email.serviceId || '';
    emailTemplateId.value = config.email.templateId || '';
    emailPublicKey.value = config.email.publicKey || '';
    emailTo.value = config.email.to || '';
    setTimeInputs(config.email.thresholdSec || 0, emailThresholdValue, emailThresholdUnit);
    setTimeInputs(config.email.repeatSec || 0, emailRepeatValue, emailRepeatUnit);
    emailTestStatus.textContent = '';
    settingsOverlay.classList.add('open');
    settingsPanel.classList.add('open');
  }
  function closeSettings() { settingsOverlay.classList.remove('open'); settingsPanel.classList.remove('open'); }

  async function sendTestEmail() {
    const sId = emailServiceId.value.trim(), tId = emailTemplateId.value.trim(),
          pKey = emailPublicKey.value.trim(), to = emailTo.value.trim();
    if (!sId || !tId || !pKey || !to) { emailTestStatus.textContent = '⚠ Fill in all EmailJS fields first'; emailTestStatus.style.color = 'var(--error)'; return; }
    emailTestStatus.textContent = 'Sending...'; emailTestStatus.style.color = 'var(--text-muted)';
    testEmailBtn.disabled = true;
    const testHtml = buildEmailHtml('Test Job — Crew Alert', 'TEST-001', 'Test Department', 'Test Customer', 'Mon, 1 Jan 2026 → Wed, 3 Jan 2026', '2h 30m', 'Venue Setup Crew ×4, Transport - Delivery [L] ×1', window.location.href);
    try {
      const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_id: sId, template_id: tId, user_id: pKey, template_params: { to_email: to, subject: '🚛 Test Alert — Crew & Vehicle Dashboard', html_body: testHtml } })
      });
      if (!res.ok) throw new Error(`EmailJS ${res.status}: ${await res.text()}`);
      emailTestStatus.textContent = '✓ Test email sent!'; emailTestStatus.style.color = 'var(--accent)';
    } catch (err) {
      emailTestStatus.textContent = `✕ Failed: ${err.message || err}`; emailTestStatus.style.color = 'var(--error)';
    } finally { testEmailBtn.disabled = false; }
  }

  // ── Department block builder ─────────────────────────────
  function addDeptBlock(dept = null) {
    const idx = deptRulesContainer.children.length;
    const color = dept ? dept.color : defaultColors[idx % defaultColors.length];
    const block = document.createElement('div');
    block.className = 'dept-block';
    block.innerHTML = `
      <div class="dept-block-header">
        <input type="color" class="color-pick" value="${color}" />
        <input type="text" class="dept-name-input" placeholder="Department name (e.g. Crew, Transport)" value="${dept ? esc(dept.name) : ''}" />
        <button class="remove-dept-btn" title="Remove">✕</button>
      </div>
      <div class="rule-label">Product IDs (comma-separated)</div>
      <input class="rule-input product-ids" type="text" placeholder="e.g. 142, 305, 891" value="${dept && dept.productIds ? dept.productIds.join(', ') : ''}" />
      <div class="rule-hint">Exact service product IDs that trigger this department</div>
      <div class="rule-label">Service Types</div>
      <div class="multi-select-wrap service-type-select"></div>
      <div class="rule-hint">Select service types (e.g. Transport, TTY Crew)</div>
      <div class="rule-label">Keywords in Service Name</div>
      <div class="multi-select-wrap keyword-select"></div>
      <div class="rule-hint">Search services by name or add custom keywords</div>
    `;
    block.querySelector('.remove-dept-btn').addEventListener('click', () => block.remove());
    buildStaticMultiSelect(block.querySelector('.service-type-select'), cachedServiceTypes.map(s => s.name), dept ? dept.serviceTypes || [] : [], 'Search service types...');
    buildLiveSearchMultiSelect(block.querySelector('.keyword-select'), dept ? dept.keywords || [] : [], 'Type to search services...');
    deptRulesContainer.appendChild(block);
  }

  // ── Static multi-select ──────────────────────────────────
  function buildStaticMultiSelect(container, options, selected, placeholder) {
    const state = { selected: [...selected] };
    const trigger = document.createElement('div'); trigger.className = 'multi-select-trigger';
    const dropdown = document.createElement('div'); dropdown.className = 'ms-dropdown';
    const searchInput = document.createElement('input'); searchInput.className = 'ms-search'; searchInput.placeholder = placeholder;
    dropdown.appendChild(searchInput);
    const optionsList = document.createElement('div'); optionsList.className = 'ms-options-list'; dropdown.appendChild(optionsList);
    container.appendChild(trigger); container.appendChild(dropdown);
    function renderTrigger() {
      trigger.innerHTML = '';
      if (state.selected.length === 0) { trigger.innerHTML = `<span class="ms-placeholder">${placeholder}</span>`; return; }
      state.selected.forEach(val => { const chip = document.createElement('span'); chip.className = 'ms-chip'; chip.innerHTML = `${esc(val)}<span class="ms-chip-x" data-val="${esc(val)}">×</span>`; trigger.appendChild(chip); });
    }
    function renderOptions(filter = '') {
      optionsList.innerHTML = '';
      options.filter(o => o.toLowerCase().includes(filter.toLowerCase())).forEach(opt => {
        const el = document.createElement('div'); el.className = 'ms-option' + (state.selected.includes(opt) ? ' selected' : ''); el.textContent = opt;
        el.addEventListener('click', e => { e.stopPropagation(); if (state.selected.includes(opt)) state.selected = state.selected.filter(v => v !== opt); else state.selected.push(opt); renderTrigger(); renderOptions(searchInput.value); });
        optionsList.appendChild(el);
      });
    }
    trigger.addEventListener('click', e => {
      if (e.target.classList.contains('ms-chip-x')) { state.selected = state.selected.filter(v => v !== e.target.dataset.val); renderTrigger(); renderOptions(searchInput.value); return; }
      closeAllDropdowns(dropdown, trigger); const isOpen = dropdown.classList.toggle('open'); trigger.classList.toggle('open', isOpen);
      if (isOpen) { searchInput.value = ''; renderOptions(); setTimeout(() => searchInput.focus(), 50); }
    });
    searchInput.addEventListener('input', () => renderOptions(searchInput.value));
    searchInput.addEventListener('click', e => e.stopPropagation());
    container._getSelected = () => [...state.selected]; renderTrigger();
  }

  // ── Live-search multi-select ─────────────────────────────
  function buildLiveSearchMultiSelect(container, selected, placeholder) {
    const state = { selected: [...selected] };
    let debounceTimer = null;
    const trigger = document.createElement('div'); trigger.className = 'multi-select-trigger';
    const dropdown = document.createElement('div'); dropdown.className = 'ms-dropdown';
    const searchInput = document.createElement('input'); searchInput.className = 'ms-search'; searchInput.placeholder = placeholder;
    dropdown.appendChild(searchInput);
    const optionsList = document.createElement('div'); optionsList.className = 'ms-options-list'; dropdown.appendChild(optionsList);
    container.appendChild(trigger); container.appendChild(dropdown);
    function renderTrigger() {
      trigger.innerHTML = '';
      if (state.selected.length === 0) { trigger.innerHTML = `<span class="ms-placeholder">${placeholder}</span>`; return; }
      state.selected.forEach(val => { const chip = document.createElement('span'); chip.className = 'ms-chip'; chip.innerHTML = `${esc(val)}<span class="ms-chip-x" data-val="${esc(val)}">×</span>`; trigger.appendChild(chip); });
    }
    function renderResults(results, query) {
      optionsList.innerHTML = '';
      if (query && query.length >= 1) {
        const exact = results.some(r => r.toLowerCase() === query.toLowerCase());
        if (!exact) { const co = document.createElement('div'); co.className = 'ms-option'; co.style.color = 'var(--accent)'; co.textContent = `+ Add "${query}" as keyword`; co.addEventListener('click', e => { e.stopPropagation(); if (!state.selected.includes(query)) state.selected.push(query); renderTrigger(); searchInput.value = ''; optionsList.innerHTML = ''; }); optionsList.appendChild(co); }
      }
      if (results.length === 0 && (!query || query.length < 2)) { const h = document.createElement('div'); h.className = 'ms-option'; h.style.cssText = 'color:var(--text-muted);font-style:italic;cursor:default;'; h.textContent = 'Type at least 2 characters to search...'; optionsList.appendChild(h); return; }
      results.forEach(name => { const el = document.createElement('div'); el.className = 'ms-option' + (state.selected.includes(name) ? ' selected' : ''); el.textContent = name; el.addEventListener('click', e => { e.stopPropagation(); if (state.selected.includes(name)) state.selected = state.selected.filter(v => v !== name); else state.selected.push(name); renderTrigger(); renderResults(results, searchInput.value); }); optionsList.appendChild(el); });
    }
    trigger.addEventListener('click', e => {
      if (e.target.classList.contains('ms-chip-x')) { state.selected = state.selected.filter(v => v !== e.target.dataset.val); renderTrigger(); return; }
      closeAllDropdowns(dropdown, trigger); const isOpen = dropdown.classList.toggle('open'); trigger.classList.toggle('open', isOpen);
      if (isOpen) { searchInput.value = ''; renderResults([], ''); setTimeout(() => searchInput.focus(), 50); }
    });
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim(); clearTimeout(debounceTimer);
      if (q.length < 2) { renderResults([], q); return; }
      optionsList.innerHTML = '<div class="ms-option" style="color:var(--text-muted);font-style:italic;cursor:default;">Searching...</div>';
      debounceTimer = setTimeout(async () => { const r = await searchProducts(q); if (searchInput.value.trim() === q) renderResults(r, q); }, 350);
    });
    searchInput.addEventListener('click', e => e.stopPropagation());
    container._getSelected = () => [...state.selected]; renderTrigger();
  }

  function closeAllDropdowns(ex, et) {
    document.querySelectorAll('.ms-dropdown.open').forEach(d => { if (d !== ex) d.classList.remove('open'); });
    document.querySelectorAll('.multi-select-trigger.open').forEach(t => { if (t !== et) t.classList.remove('open'); });
  }

  // ── Apply settings ───────────────────────────────────────
  function applySettings() {
    config.pollInterval = parseInt(pollIntervalSelect.value) || 300;
    config.stages = [];
    stageFilter.querySelectorAll('.stage-chip.active').forEach(c => config.stages.push(c.dataset.stage));
    config.departments = [];
    deptRulesContainer.querySelectorAll('.dept-block').forEach(block => {
      const name = block.querySelector('.dept-name-input').value.trim();
      if (!name) return;
      const color = block.querySelector('.color-pick').value;
      const productIds = block.querySelector('.product-ids').value.split(',').map(s => s.trim()).filter(Boolean);
      const serviceTypes = block.querySelector('.service-type-select')._getSelected();
      const keywords = block.querySelector('.keyword-select')._getSelected();
      if (productIds.length > 0 || serviceTypes.length > 0 || keywords.length > 0)
        config.departments.push({ name, color, productIds, serviceTypes, keywords });
    });
    config.email = {
      serviceId: emailServiceId.value.trim(), templateId: emailTemplateId.value.trim(),
      publicKey: emailPublicKey.value.trim(), to: emailTo.value.trim(),
      thresholdSec: getTimeInputSec(emailThresholdValue, emailThresholdUnit),
      repeatSec: getTimeInputSec(emailRepeatValue, emailRepeatUnit)
    };
    saveConfig(); closeSettings(); lastResults = []; renderBoard(); startPolling();
  }

  // ── View Toggle ──────────────────────────────────────────
  // Month navigation listeners
  if (monthPrevBtn) monthPrevBtn.addEventListener('click', () => { showAllMonths = false; viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } updateMonthLabel(); renderBoard(); });
  if (monthNextBtn) monthNextBtn.addEventListener('click', () => { showAllMonths = false; viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } updateMonthLabel(); renderBoard(); });
  if (monthTodayBtn) monthTodayBtn.addEventListener('click', () => { showAllMonths = false; const now = new Date(); viewMonth = now.getMonth(); viewYear = now.getFullYear(); updateMonthLabel(); renderBoard(); });
  if (monthAllBtn) monthAllBtn.addEventListener('click', () => { showAllMonths = !showAllMonths; updateMonthLabel(); renderBoard(); });
  updateMonthLabel();

  viewToggle.addEventListener('click', e => {
    const btn = e.target.closest('.view-btn');
    if (!btn) return;
    const view = btn.dataset.view;
    if (view === currentView) return;
    currentView = view;
    viewToggle.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    if (view === 'kanban') {
      board.style.display = '';
      calendarView.style.display = 'none';
      if (monthNavEl) monthNavEl.style.display = '';
      renderBoard();
    } else {
      board.style.display = 'none';
      calendarView.style.display = '';
      if (monthNavEl) monthNavEl.style.display = 'none';
      renderCalendar();
    }
  });

  calPrev.addEventListener('click', () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); });
  calNext.addEventListener('click', () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); });
  calToday.addEventListener('click', () => { const now = new Date(); calMonth = now.getMonth(); calYear = now.getFullYear(); renderCalendar(); });

  // ── Calendar Rendering ───────────────────────────────────
  function renderCalendar() {
    if (!lastResults.length) {
      calGrid.innerHTML = '<div style="grid-column:1/-1;padding:40px;text-align:center;color:var(--text-muted);">No data yet. Waiting for first poll...</div>';
      calMonthLabel.textContent = '';
      return;
    }

    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    calMonthLabel.textContent = `${months[calMonth]} ${calYear}`;

    // Build dept filter chips
    calDeptFilters.innerHTML = '';
    lastResults.forEach(dr => {
      const chip = document.createElement('div');
      chip.className = 'cal-dept-chip' + (calActiveDepts.size === 0 || calActiveDepts.has(dr.dept.name) ? ' active' : '');
      chip.style.background = calActiveDepts.size === 0 || calActiveDepts.has(dr.dept.name) ? hexToRgba(dr.dept.color, 0.15) : 'transparent';
      chip.style.color = dr.dept.color;
      chip.style.borderColor = dr.dept.color;
      chip.textContent = dr.dept.name;
      chip.addEventListener('click', () => {
        if (calActiveDepts.has(dr.dept.name)) {
          calActiveDepts.delete(dr.dept.name);
        } else {
          calActiveDepts.add(dr.dept.name);
        }
        // If all are selected, clear to show all
        if (calActiveDepts.size === lastResults.length) calActiveDepts.clear();
        renderCalendar();
      });
      calDeptFilters.appendChild(chip);
    });

    // Build event map: dateKey -> [{ quote, dept, items }]
    const eventMap = {};
    lastResults.forEach(dr => {
      if (calActiveDepts.size > 0 && !calActiveDepts.has(dr.dept.name)) return;
      dr.quotes.forEach(q => {
        // Determine all dates this job spans
        const startDate = q.starts ? new Date(q.starts) : null;
        const endDate = q.ends ? new Date(q.ends) : startDate;
        if (!startDate) return;
        // Add event for each day in range
        const d = new Date(startDate);
        d.setHours(0,0,0,0);
        const end = new Date(endDate);
        end.setHours(23,59,59,999);
        while (d <= end) {
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          if (!eventMap[key]) eventMap[key] = [];
          eventMap[key].push({ quote: q, dept: dr.dept });
          d.setDate(d.getDate() + 1);
        }
      });
    });

    // Build calendar grid
    const firstDay = new Date(calYear, calMonth, 1);
    const lastDay = new Date(calYear, calMonth + 1, 0);
    const startDayOfWeek = firstDay.getDay(); // 0=Sun
    const daysInMonth = lastDay.getDate();
    const prevMonthLast = new Date(calYear, calMonth, 0).getDate();

    let html = '';
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    dayNames.forEach(d => { html += `<div class="cal-day-header">${d}</div>`; });

    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

    // Previous month fill
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const dayNum = prevMonthLast - i;
      const m = calMonth === 0 ? 12 : calMonth;
      const y = calMonth === 0 ? calYear - 1 : calYear;
      const key = `${y}-${String(m).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`;
      html += buildCalCell(dayNum, key, eventMap[key] || [], true, key === todayKey);
    }
    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      html += buildCalCell(d, key, eventMap[key] || [], false, key === todayKey);
    }
    // Next month fill
    const totalCells = startDayOfWeek + daysInMonth;
    const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let d = 1; d <= remaining; d++) {
      const m = calMonth === 11 ? 1 : calMonth + 2;
      const y = calMonth === 11 ? calYear + 1 : calYear;
      const key = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      html += buildCalCell(d, key, eventMap[key] || [], true, key === todayKey);
    }

    calGrid.innerHTML = html;

    // Wait for layout to settle before measuring overflow
    requestAnimationFrame(() => { requestAnimationFrame(() => {
      // Post-render: hide events that overflow the cell and show "+N more"
      calGrid.querySelectorAll('.cal-cell').forEach(cell => {
        const eventsContainer = cell.querySelector('.cal-events');
        if (!eventsContainer) return;
        const allEvents = Array.from(eventsContainer.querySelectorAll('.cal-event'));
        if (allEvents.length === 0) return;
        
        const containerBottom = eventsContainer.getBoundingClientRect().bottom;
        const moreHeight = 16; // space for "+N more"
        
        let hiddenCount = 0;
        for (let i = 0; i < allEvents.length; i++) {
          const ev = allEvents[i];
          const evBottom = ev.getBoundingClientRect().bottom;
          if (evBottom > containerBottom) {
            // This event and everything after it is overflowing
            for (let j = i; j < allEvents.length; j++) {
              allEvents[j].style.display = 'none';
              hiddenCount++;
            }
            break;
          }
        }

        // If we hid some, check if last visible needs to go to make room for "+more"
        if (hiddenCount > 0) {
          const visible = allEvents.filter(e => e.style.display !== 'none');
          if (visible.length > 0) {
            const lastVis = visible[visible.length - 1];
            if (lastVis.getBoundingClientRect().bottom + moreHeight > containerBottom) {
              lastVis.style.display = 'none';
              hiddenCount++;
            }
          }
          const moreEl = document.createElement('div');
          moreEl.className = 'cal-more';
          moreEl.textContent = `+${hiddenCount} more`;
          eventsContainer.appendChild(moreEl);
        }
      });

      // Calendar event tooltips (bind after overflow pass)
      calGrid.querySelectorAll('.cal-event').forEach(el => {
        if (el.style.display === 'none') return; // skip hidden
        el.addEventListener('mouseenter', e => {
          const data = JSON.parse(el.dataset.tooltip || '{}');
          if (!data.name) return;
          let tipHtml = `<div class="cal-tooltip-title">${esc(data.name)}</div>`;
          tipHtml += `<div class="cal-tooltip-ref">${esc(data.ref)} · ${esc(data.dept)}</div>`;
          (data.items || []).forEach(si => {
            const icon = si.type === 'transport' ? '🚛' : si.type === 'crew' ? '👤' : '📦';
            tipHtml += `<div class="cal-tooltip-svc">${icon} ${esc(si.name)} <span style="color:var(--accent);margin-left:auto;">×${Math.round(si.remaining)}</span></div>`;
          });
          calTip.innerHTML = tipHtml;
          calTip.classList.add('visible');
          const rect = el.getBoundingClientRect();
          calTip.style.left = Math.min(rect.left, window.innerWidth - 320) + 'px';
          calTip.style.top = (rect.bottom + 6) + 'px';
        });
        el.addEventListener('mouseleave', () => { calTip.classList.remove('visible'); });
        el.addEventListener('click', () => {
          const oppId = el.dataset.oppId;
          if (oppId) window.open(`https://${subdomain}.current-rms.com/opportunities/${oppId}`, '_blank');
        });
      });
    }); });
  }

  function buildCalCell(dayNum, dateKey, events, isOtherMonth, isToday) {
    const classes = ['cal-cell'];
    if (isOtherMonth) classes.push('other-month');
    if (isToday) classes.push('today');
    
    // Deduplicate events by opp ID + dept (same job may appear once per cell)
    const seen = new Set();
    const unique = [];
    events.forEach(ev => {
      const k = `${ev.quote.id}::${ev.dept.name}`;
      if (!seen.has(k)) { seen.add(k); unique.push(ev); }
    });

    let eventsHtml = '';
    unique.forEach(ev => {
      const totalNeeded = ev.quote.serviceItems.reduce((s, i) => s + i.remaining, 0);
      const tooltipData = JSON.stringify({
        name: ev.quote.name,
        ref: ev.quote.reference,
        dept: ev.dept.name,
        items: ev.quote.serviceItems
      }).replace(/"/g, '&quot;');
      eventsHtml += `<div class="cal-event" style="background:${hexToRgba(ev.dept.color, 0.12)};color:${ev.dept.color};border-left-color:${ev.dept.color};" data-tooltip="${tooltipData}" data-opp-id="${ev.quote.id}"><span class="cal-ev-count">${Math.round(totalNeeded)}</span> ${esc(truncate(ev.quote.name, 22))}</div>`;
    });

    return `<div class="${classes.join(' ')}" data-total-events="${unique.length}"><div class="cal-day-num">${dayNum}</div><div class="cal-events">${eventsHtml}</div></div>`;
  }

  function truncate(s, len) { return s && s.length > len ? s.substring(0, len) + '…' : s || ''; }
  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0,2), 16) || 0;
    const g = parseInt(h.substring(2,4), 16) || 0;
    const b = parseInt(h.substring(4,6), 16) || 0;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // Calendar tooltip element
  const calTip = document.createElement('div');
  calTip.className = 'cal-tooltip';
  document.body.appendChild(calTip);

  // Re-render calendar on resize so overflow recalculates
  let calResizeTimer;
  window.addEventListener('resize', () => {
    if (currentView !== 'calendar') return;
    clearTimeout(calResizeTimer);
    calResizeTimer = setTimeout(() => renderCalendar(), 150);
  });

})();
