// dashboard.js — RMS Multitool Quote Dashboard (Kanban + Email Alerts)
(() => {
  'use strict';

  // ── State ────────────────────────────────────────────────
  let config = {
    pollInterval: 300,
    stages: ['draft', 'provisional_quotation', 'reserved_quotation'],
    departments: [],
    email: {
      serviceId: '',
      templateId: '',
      publicKey: '',
      to: '',
      thresholdSec: 0,   // 0 = disabled
      repeatSec: 0        // 0 = don't repeat
    }
  };
  let apiKey = '';
  let subdomain = '';
  let pollTimer = null;
  let isPolling = false;
  let lastResults = [];
  let cachedProductGroups = [];

  // First-seen tracking: { "dept::oppId": timestampMs }
  let firstSeenMap = {};
  const FIRST_SEEN_KEY = 'rms_dashboard_first_seen';

  // Email sent tracking: { "dept::oppId": lastEmailTimestampMs }
  let emailSentMap = {};
  const EMAIL_SENT_KEY = 'rms_dashboard_email_sent';

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
  const monthLabel = $('monthLabel');
  const monthPrev = $('monthPrev');
  const monthNext = $('monthNext');
  const monthToday = $('monthToday');
  const monthInfo = $('monthInfo');
  const monthAll = $('monthAll');
  let viewMonth = new Date().getMonth();
  let viewYear = new Date().getFullYear();
  let showAllMonths = true;
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  function updateMonthLabel() {
    if (!monthLabel) return;
    if (showAllMonths) {
      monthLabel.textContent = 'All Months';
      if (monthPrev) monthPrev.style.opacity = '0.3';
      if (monthNext) monthNext.style.opacity = '0.3';
      if (monthPrev) monthPrev.style.pointerEvents = 'none';
      if (monthNext) monthNext.style.pointerEvents = 'none';
      if (monthToday) monthToday.style.display = 'none';
      if (monthAll) { monthAll.classList.add('active'); monthAll.textContent = 'Month View'; }
    } else {
      monthLabel.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;
      if (monthPrev) { monthPrev.style.opacity = ''; monthPrev.style.pointerEvents = ''; }
      if (monthNext) { monthNext.style.opacity = ''; monthNext.style.pointerEvents = ''; }
      const now = new Date();
      const isCurrent = viewMonth === now.getMonth() && viewYear === now.getFullYear();
      if (monthToday) monthToday.style.display = isCurrent ? 'none' : '';
      if (monthAll) { monthAll.classList.remove('active'); monthAll.textContent = 'All Months'; }
    }
  }

  // Email settings DOM
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

  const defaultColors = ['#ff4d6a','#ffb347','#4d9fff','#a06cff','#00e5a0','#ff6bcc','#4dd9ff','#ff8a65'];

  // ── Init ─────────────────────────────────────────────────
  loadCredentials().then(async () => {
    loadConfig();
    loadFirstSeen();
    loadEmailSent();
    startClock();
    if (subdomain && apiKey) {
      loadingText.textContent = 'Loading product groups from CurrentRMS...';
      await loadProductGroups();
    }
    loadingOverlay.classList.add('hidden');
    renderBoard();
    startPolling();
    setInterval(tickTimers, 30000);
  });

  // ── First-seen tracking ──────────────────────────────────
  function loadFirstSeen() {
    try { const s = localStorage.getItem(FIRST_SEEN_KEY); if (s) firstSeenMap = JSON.parse(s); } catch { firstSeenMap = {}; }
  }
  function saveFirstSeen() { localStorage.setItem(FIRST_SEEN_KEY, JSON.stringify(firstSeenMap)); }
  function getFirstSeen(deptName, oppId) {
    const key = `${deptName}::${oppId}`;
    if (!firstSeenMap[key]) { firstSeenMap[key] = Date.now(); saveFirstSeen(); }
    return firstSeenMap[key];
  }
  function pruneFirstSeen(activeKeys) {
    const activeSet = new Set(activeKeys);
    let changed = false;
    for (const key of Object.keys(firstSeenMap)) {
      if (!activeSet.has(key)) { delete firstSeenMap[key]; changed = true; }
    }
    if (changed) saveFirstSeen();
  }

  // ── Email sent tracking ──────────────────────────────────
  function loadEmailSent() {
    try { const s = localStorage.getItem(EMAIL_SENT_KEY); if (s) emailSentMap = JSON.parse(s); } catch { emailSentMap = {}; }
  }
  function saveEmailSent() { localStorage.setItem(EMAIL_SENT_KEY, JSON.stringify(emailSentMap)); }
  function getLastEmailed(deptName, oppId) {
    return emailSentMap[`${deptName}::${oppId}`] || 0;
  }
  function markEmailed(deptName, oppId) {
    emailSentMap[`${deptName}::${oppId}`] = Date.now();
    saveEmailSent();
  }
  function pruneEmailSent(activeKeys) {
    const activeSet = new Set(activeKeys);
    let changed = false;
    for (const key of Object.keys(emailSentMap)) {
      if (!activeSet.has(key)) { delete emailSentMap[key]; changed = true; }
    }
    if (changed) saveEmailSent();
  }
  function wasAlerted(deptName, oppId) {
    return !!emailSentMap[`${deptName}::${oppId}`];
  }

  // ── Timer helpers ────────────────────────────────────────
  function formatElapsed(ms) {
    const totalSec = Math.floor(ms / 1000);
    if (totalSec < 60) return 'Just now';
    const totalMin = Math.floor(totalSec / 60);
    if (totalMin < 60) return `${totalMin}m`;
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    if (hours < 24) return `${hours}h ${mins}m`;
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    if (days === 1) return `1d ${remHours}h`;
    return `${days}d ${remHours}h`;
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
        chrome.storage.sync.get(['subdomain', 'apiKey'], r => {
          subdomain = r.subdomain || '';
          apiKey = r.apiKey || '';
          resolve();
        });
      } else {
        subdomain = localStorage.getItem('rms_subdomain') || '';
        apiKey = localStorage.getItem('rms_apiKey') || '';
        resolve();
      }
    });
  }

  // ── Config ───────────────────────────────────────────────
  function loadConfig() {
    try {
      const s = localStorage.getItem('rms_dashboard_config');
      if (s) {
        const parsed = JSON.parse(s);
        config = { ...config, ...parsed };
        // Ensure email sub-object is merged properly
        config.email = { ...config.email, ...(parsed.email || {}) };
      }
    } catch {}
  }
  function saveConfig() { localStorage.setItem('rms_dashboard_config', JSON.stringify(config)); }

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
  async function apiFetch(url, retries = 3) {
    for (let attempt = 0; attempt < retries; attempt++) {
      const r = await fetch(url, {
        method: 'GET',
        headers: { 'X-SUBDOMAIN': subdomain, 'X-AUTH-TOKEN': apiKey, 'Content-Type': 'application/json' }
      });
      if (r.status === 429) {
        // Rate limited — wait and retry
        const wait = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
        console.warn(`[Dashboard] Rate limited (429), waiting ${wait}ms before retry ${attempt + 1}/${retries}`);
        await sleep(wait);
        continue;
      }
      if (!r.ok) throw new Error(`API ${r.status}`);
      return r.json();
    }
    throw new Error('API 429: rate limited after retries');
  }

  // ── Load product groups ──────────────────────────────────
  async function loadProductGroups() {
    try {
      const url = buildApiUrl('product_groups', [['per_page', '100']]);
      const pgData = await apiFetch(url);
      cachedProductGroups = (pgData.product_groups || []).map(g => ({ id: g.id, name: g.name }));
      cachedProductGroups.sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) { console.warn('Could not load product groups:', e); }
  }

  // ── Live search products ─────────────────────────────────
  let productSearchAbort = null;
  async function searchProducts(query) {
    if (productSearchAbort) productSearchAbort.abort();
    if (!query || query.length < 2) return [];
    const controller = new AbortController();
    productSearchAbort = controller;
    try {
      const url = buildApiUrl('products', [['per_page', '30'], ['q[name_cont]', query], ['q[s][]', 'name asc']]);
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'X-SUBDOMAIN': subdomain, 'X-AUTH-TOKEN': apiKey, 'Content-Type': 'application/json' },
        signal: controller.signal
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.products || []).map(p => p.name);
    } catch (e) { if (e.name === 'AbortError') return []; return []; }
  }

  // ── Fetch upcoming opportunities ─────────────────────────
  async function fetchUpcomingOpportunities() {
    const allOpps = [];
    let page = 1;
    const perPage = 100;
    const nowISO = new Date().toISOString();
    const stateMap = { draft: 1, provisional_quotation: 2, reserved_quotation: 3, order: 4 };
    const stateCodes = config.stages.map(s => stateMap[s]).filter(Boolean);
    while (true) {
      const params = [['per_page', String(perPage)], ['page', String(page)], ['q[s][]', 'starts_at asc'], ['q[ends_at_gteq]', nowISO]];
      stateCodes.forEach(code => params.push(['q[state_in][]', String(code)]));
      const url = buildApiUrl('opportunities', params);
      console.log(`[Dashboard] Fetching page ${page}: ${url}`);
      const data = await apiFetch(url);
      const opps = data.opportunities || [];
      allOpps.push(...opps);
      console.log(`[Dashboard] Page ${page}: got ${opps.length} (total: ${allOpps.length})`);
      if (opps.length < perPage) break;
      page++;
      if (page > 50) break;
    }
    const now = new Date();
    const filtered = allOpps.filter(opp => {
      const endStr = opp.ends_at || opp.end_date || opp.starts_at || opp.start_date || '';
      if (!endStr) return true;
      const endDate = new Date(endStr);
      return isNaN(endDate.getTime()) || endDate >= now;
    });
    console.log(`[Dashboard] After date filter: ${filtered.length} upcoming (removed ${allOpps.length - filtered.length} past)`);
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

  // ── Match logic ──────────────────────────────────────────
  function itemMatchesDept(item, dept) {
    const pid = String(item.item_id || item.product_id || '');
    if (dept.productIds && dept.productIds.length > 0 && dept.productIds.includes(pid)) return true;
    const gn = (item.product_group_name || item.item_group_name || '').toLowerCase();
    if (dept.groupNames && dept.groupNames.length > 0 && dept.groupNames.some(g => gn === g.toLowerCase())) return true;
    const iN = (item.name || item.item_name || '').toLowerCase();
    const iD = (item.description || '').toLowerCase();
    if (dept.keywords && dept.keywords.length > 0 && dept.keywords.some(kw => { const k = kw.toLowerCase(); return iN.includes(k) || iD.includes(k); })) return true;
    return false;
  }

  // ── Email HTML builder (embedded template) ───────────────
  function buildEmailHtml(quoteName, reference, deptName, customer, eventDates, timeOnBoard, triggerItemsStr, dashboardUrl) {
    // Escape for safe HTML embedding
    const e = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0a0a0e;font-family:Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0e;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#131318;border:1px solid #2a2a35;border-radius:12px;overflow:hidden;max-width:560px;width:100%;">
<tr><td style="height:4px;background:linear-gradient(90deg,#00e5a0,#00b880);"></td></tr>
<tr><td style="padding:28px 32px 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="42"><div style="width:36px;height:36px;background-color:#00e5a0;border-radius:9px;text-align:center;line-height:36px;font-size:18px;color:#0a0a0e;font-weight:bold;">&#9889;</div></td>
<td style="padding-left:12px;"><div style="font-size:18px;font-weight:800;color:#f0f0f5;letter-spacing:-0.3px;">Quote Dashboard Alert</div>
<div style="font-size:11px;color:#6b6b80;letter-spacing:0.5px;text-transform:uppercase;margin-top:2px;">RMS Multitool &mdash; Unattended Quote</div></td>
</tr></table></td></tr>
<tr><td style="padding:0 32px;"><div style="height:1px;background-color:#2a2a35;"></div></td></tr>
<tr><td style="padding:20px 32px 16px;"><div style="background-color:#1f0a10;border:1px solid #3d1520;border-radius:8px;padding:14px 16px;">
<div style="font-size:13px;color:#ff4d6a;font-weight:600;margin-bottom:4px;">&#9201; Sitting unattended for ${e(timeOnBoard)}</div>
<div style="font-size:12px;color:#6b6b80;">This quote has been on the dashboard past the alert threshold without being actioned.</div>
</div></td></tr>
<tr><td style="padding:8px 32px 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#1a1a22;border:1px solid #2a2a35;border-radius:8px;overflow:hidden;">
<tr><td style="padding:16px 18px 12px;"><div style="font-size:9px;color:#6b6b80;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:4px;">Quote</div>
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
<tr><td style="padding:12px 18px 16px;"><div style="font-size:9px;color:#6b6b80;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;">&#128308; Flagged Items</div>
<div style="font-size:12px;color:#ff4d6a;line-height:1.6;">${e(triggerItemsStr)}</div></td></tr>
</table></td></tr>
<tr><td style="padding:4px 32px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<a href="${e(dashboardUrl)}" target="_blank" style="display:inline-block;background-color:#00e5a0;color:#0a0a0e;font-size:13px;font-weight:700;text-decoration:none;padding:12px 32px;border-radius:8px;">Open in CurrentRMS &rarr;</a>
</td></tr></table></td></tr>
<tr><td style="padding:0 32px;"><div style="height:1px;background-color:#2a2a35;"></div></td></tr>
<tr><td style="padding:16px 32px 20px;"><div style="font-size:10px;color:#6b6b80;text-align:center;line-height:1.5;">
Sent by RMS Multitool Quote Dashboard<br>Quote unattended for <strong style="color:#ff4d6a;">${e(timeOnBoard)}</strong><br>
<span style="color:#4a4a5a;">To adjust alert settings, open the dashboard and click Settings.</span>
</div></td></tr>
</table></td></tr></table></body></html>`;
  }

  // ── EmailJS sending ──────────────────────────────────────
  async function sendAlertEmail(quote, deptName, timeOnBoard, triggerItems) {
    const e = config.email;
    if (!e.serviceId || !e.templateId || !e.publicKey || !e.to) return false;

    const startFull = quote.starts ? fmtDateFull(quote.starts) : '';
    const endFull = quote.ends ? fmtDateFull(quote.ends) : '';
    const dateStr = startFull ? `${startFull}${endFull ? ' → ' + endFull : ''}` : 'No dates set';
    const dashUrl = `https://${subdomain}.current-rms.com/opportunities/${quote.id}`;

    const htmlBody = buildEmailHtml(
      quote.name, quote.reference, deptName,
      quote.member || 'N/A', dateStr, timeOnBoard,
      triggerItems.join(', '), dashUrl
    );

    try {
      const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: e.serviceId,
          template_id: e.templateId,
          user_id: e.publicKey,
          template_params: {
            to_email: e.to,
            subject: `⚡ Quote Alert: ${quote.name} — unattended for ${timeOnBoard}`,
            html_body: htmlBody
          }
        })
      });
      if (!res.ok) throw new Error(`EmailJS API ${res.status}: ${await res.text()}`);
      console.log(`[Dashboard] Alert email sent for "${quote.name}" in ${deptName}`);
      return true;
    } catch (err) {
      console.error(`[Dashboard] Email failed for "${quote.name}":`, err);
      return false;
    }
  }

  // ── Check and send overdue alerts ────────────────────────
  async function checkAlerts(deptResults) {
    const e = config.email;
    if (!e.thresholdSec || e.thresholdSec <= 0) return; // alerts disabled
    if (!e.serviceId || !e.templateId || !e.publicKey || !e.to) return; // not configured

    const now = Date.now();
    const thresholdMs = e.thresholdSec * 1000;
    const repeatMs = e.repeatSec * 1000;

    for (const dr of deptResults) {
      for (const q of dr.quotes) {
        const firstSeen = getFirstSeen(dr.dept.name, q.id);
        const elapsed = now - firstSeen;

        if (elapsed < thresholdMs) continue; // not overdue yet

        const lastEmailed = getLastEmailed(dr.dept.name, q.id);

        // Should we send?
        let shouldSend = false;
        if (lastEmailed === 0) {
          // Never emailed — send first alert
          shouldSend = true;
        } else if (repeatMs > 0 && (now - lastEmailed) >= repeatMs) {
          // Repeat interval passed — send again
          shouldSend = true;
        }

        if (shouldSend) {
          const timeStr = formatElapsed(elapsed);
          const success = await sendAlertEmail(q, dr.dept.name, timeStr, q.triggerItems);
          if (success) markEmailed(dr.dept.name, q.id);
          // Small delay between emails to avoid rate limits
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
      showEmptyBoard('No Departments Configured', 'Click the Settings button above to add departments and trigger rules.');
      pollStatus.textContent = 'No rules set'; return;
    }
    if (isPolling) return;
    isPolling = true;
    pollStatus.textContent = 'Scanning...';
    pollDot.style.animation = 'none'; pollDot.style.background = 'var(--warning)'; pollDot.style.boxShadow = '0 0 6px var(--warning)';

    try {
      const opportunities = await fetchUpcomingOpportunities();
      statScanned.textContent = opportunities.length;
      const deptResults = config.departments.map(d => ({ dept: d, quotes: [] }));
      const batchSize = 5;

      // Progressive rendering: render columns immediately, add cards as they load
      lastResults = deptResults;
      renderBoard();
      pollStatus.textContent = `Loading 0/${opportunities.length}...`;

      for (let i = 0; i < opportunities.length; i += batchSize) {
        const batch = opportunities.slice(i, i + batchSize);
        await Promise.all(batch.map(async opp => {
          try {
            const items = await fetchOpportunityItems(opp.id);
            deptResults.forEach(dr => {
              const matches = items.filter(it => itemMatchesDept(it, dr.dept));
              if (matches.length > 0) {
                dr.quotes.push({
                  id: opp.id,
                  name: opp.subject || opp.name || `Opportunity #${opp.id}`,
                  reference: opp.number || opp.reference || '',
                  state: opp.state_name || opp.status || '',
                  stateRaw: opp.state,
                  starts: opp.starts_at || opp.start_date || '',
                  ends: opp.ends_at || opp.end_date || '',
                  member: opp.member_name || (opp.member ? opp.member.name : ''),
                  destination: opp.destination || '',
                  triggerItems: matches.map(it => it.name || it.item_name || 'Unknown')
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

        // Throttle to avoid API rate limits (429)
        if (i + batchSize < opportunities.length) await sleep(500);
      }

      // Final pass: prune timers, check alerts
      const activeKeys = [];
      deptResults.forEach(dr => {
        dr.quotes.forEach(q => {
          const key = `${dr.dept.name}::${q.id}`;
          activeKeys.push(key);
          getFirstSeen(dr.dept.name, q.id);
        });
      });
      pruneFirstSeen(activeKeys);
      pruneEmailSent(activeKeys);

      lastResults = deptResults;
      renderBoard();

      // Check for overdue alerts and send emails
      await checkAlerts(deptResults);

      const totalQuotes = deptResults.reduce((s, dr) => s + dr.quotes.length, 0);
      statTotal.textContent = totalQuotes;
      const now = new Date();
      pollStatus.textContent = `Updated ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      pollDot.style.background = 'var(--accent)'; pollDot.style.boxShadow = '0 0 6px var(--accent)'; pollDot.style.animation = 'pulse 2s infinite';
      console.log(`[Dashboard] Done. ${totalQuotes} quotes flagged.`);
    } catch (err) {
      console.error('Poll error:', err);
      pollStatus.textContent = `Error: ${err.message || err}`;
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
  function quoteInMonth(q) {
    // Check if a quote overlaps with the selected month
    const monthStart = new Date(viewYear, viewMonth, 1);
    const monthEnd = new Date(viewYear, viewMonth + 1, 0, 23, 59, 59);
    const qStart = q.starts ? new Date(q.starts) : null;
    const qEnd = q.ends ? new Date(q.ends) : qStart;
    if (!qStart) return true; // no date = show in all months
    // Quote overlaps month if it starts before month ends AND ends after month starts
    return qStart <= monthEnd && (qEnd || qStart) >= monthStart;
  }

  function renderBoard() {
    board.innerHTML = '';
    if (config.departments.length === 0 || !lastResults.length) {
      showEmptyBoard('No Departments Configured', 'Click Settings to add departments and define which products trigger alerts.');
      return;
    }

    // Filter quotes by selected month (or show all)
    const filteredDepts = showAllMonths
      ? lastResults.map(dr => ({ dept: dr.dept, quotes: [...dr.quotes] }))
      : lastResults.map(dr => ({ dept: dr.dept, quotes: dr.quotes.filter(q => quoteInMonth(q)) }));

    const activeDepts = filteredDepts.filter(dr => dr.quotes.length > 0);
    const totalInView = activeDepts.reduce((s, dr) => s + dr.quotes.length, 0);
    const totalAll = lastResults.reduce((s, dr) => s + dr.quotes.length, 0);
    statTotal.textContent = totalAll;
    if (monthInfo) {
      if (showAllMonths) {
        monthInfo.textContent = `${totalAll} total across all months`;
      } else {
        monthInfo.textContent = `${totalInView} in ${MONTH_NAMES[viewMonth]} · ${totalAll} total`;
      }
    }

    if (totalInView === 0) {
      if (showAllMonths) {
        showEmptyBoard('No Quotes Found', 'No upcoming quotes need attention. Dashboard refreshes automatically.');
      } else {
        showEmptyBoard(`No Quotes in ${MONTH_NAMES[viewMonth]} ${viewYear}`, 'Use the month navigation to browse other months, or click All Months.');
      }
      return;
    }

    activeDepts.forEach((dr, idx) => {
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

    const allTriggers = [...new Set(q.triggerItems)];
    const visibleChips = allTriggers.slice(0, 3);
    const remaining = allTriggers.length - 3;
    const url = `https://${subdomain}.current-rms.com/opportunities/${q.id}`;

    const firstSeen = getFirstSeen(dept.name, q.id);
    const elapsed = formatElapsed(Date.now() - firstSeen);
    const elapsedMs = Date.now() - firstSeen;
    const isOverdue = config.email.thresholdSec > 0 && elapsedMs >= (config.email.thresholdSec * 1000);
    const alerted = wasAlerted(dept.name, q.id);

    const tooltipItems = allTriggers.map(t => `<div class="card-tooltip-item">${esc(t)}</div>`).join('');
    const tooltipData = JSON.stringify(allTriggers);

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
      <div class="card-triggers">
        ${visibleChips.map(t => `<div class="trigger-chip">${esc(t)}</div>`).join('')}
        ${remaining > 0 ? `<div class="trigger-more">+${remaining} more</div>` : ''}
      </div>
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
  function showEmptyBoard(title, msg) {
    board.innerHTML = `<div class="board-empty">
      <div class="empty-icon"><svg viewBox="0 0 24 24"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg></div>
      <h2>${title}</h2><p>${msg}</p>
    </div>`;
  }
  function showAllClearBoard() {
    board.innerHTML = `<div class="board-empty">
      <div class="empty-icon"><svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
      <h2>All Clear</h2><p>No upcoming quotes need attention right now. Dashboard refreshes automatically.</p>
    </div>`;
  }
  function esc(s) { const d = document.createElement('div'); d.textContent = String(s || ''); return d.innerHTML; }

  // ── Global tooltip ───────────────────────────────────────
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

    tooltip.innerHTML =
      `<div class="card-tooltip-title">Flagged Items (${items.length})</div>` +
      items.map(t => `<div class="card-tooltip-item">${esc(t)}</div>`).join('');

    // Position: below the card, aligned left, but keep on screen
    const rect = card.getBoundingClientRect();
    let top = rect.bottom + 6;
    let left = rect.left;

    // Show first to measure
    tooltip.classList.add('visible');
    const ttRect = tooltip.getBoundingClientRect();

    // If it goes off the bottom, show above the card
    if (top + ttRect.height > window.innerHeight - 10) {
      top = rect.top - ttRect.height - 6;
    }
    // If it goes off the right
    if (left + ttRect.width > window.innerWidth - 10) {
      left = window.innerWidth - ttRect.width - 10;
    }
    // Clamp
    if (top < 10) top = 10;
    if (left < 10) left = 10;

    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
  });

  document.addEventListener('mouseout', e => {
    const card = e.target.closest('.quote-card');
    if (!card) return;
    // Check if we're leaving the card entirely
    const related = e.relatedTarget;
    if (related && card.contains(related)) return;
    if (tooltipCard === card) {
      tooltipCard = null;
      tooltip.classList.remove('visible');
    }
  });

  // ── Time input helpers ─────────────────────────────────────
  function setTimeInputs(totalSec, valueEl, unitEl) {
    if (!totalSec || totalSec <= 0) {
      valueEl.value = '0';
      unitEl.value = '3600';
      return;
    }
    if (totalSec % 86400 === 0) {
      valueEl.value = String(totalSec / 86400);
      unitEl.value = '86400';
    } else if (totalSec % 3600 === 0) {
      valueEl.value = String(totalSec / 3600);
      unitEl.value = '3600';
    } else {
      valueEl.value = String(Math.round(totalSec / 60));
      unitEl.value = '60';
    }
  }

  function getTimeInputSec(valueEl, unitEl) {
    const v = parseFloat(valueEl.value) || 0;
    const u = parseInt(unitEl.value) || 3600;
    return Math.round(v * u);
  }

  // ── Settings panel ───────────────────────────────────────
  settingsBtn.addEventListener('click', openSettings);
  settingsOverlay.addEventListener('click', closeSettings);
  cancelSettingsBtn.addEventListener('click', closeSettings);
  applySettingsBtn.addEventListener('click', applySettings);
  addDeptBtn.addEventListener('click', () => addDeptBlock());
  stageFilter.addEventListener('click', e => { const c = e.target.closest('.stage-chip'); if (c) c.classList.toggle('active'); });
  testEmailBtn.addEventListener('click', sendTestEmail);

  // Month navigation listeners
  if (monthPrev) monthPrev.addEventListener('click', () => { showAllMonths = false; viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } updateMonthLabel(); renderBoard(); });
  if (monthNext) monthNext.addEventListener('click', () => { showAllMonths = false; viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } updateMonthLabel(); renderBoard(); });
  if (monthToday) monthToday.addEventListener('click', () => { showAllMonths = false; const now = new Date(); viewMonth = now.getMonth(); viewYear = now.getFullYear(); updateMonthLabel(); renderBoard(); });
  if (monthAll) monthAll.addEventListener('click', () => { showAllMonths = !showAllMonths; updateMonthLabel(); renderBoard(); });
  updateMonthLabel();

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

    // Populate email fields
    emailServiceId.value = config.email.serviceId || '';
    emailTemplateId.value = config.email.templateId || '';
    emailPublicKey.value = config.email.publicKey || '';
    emailTo.value = config.email.to || '';

    // Decompose thresholdSec into value+unit
    setTimeInputs(config.email.thresholdSec || 0, emailThresholdValue, emailThresholdUnit);
    setTimeInputs(config.email.repeatSec || 0, emailRepeatValue, emailRepeatUnit);
    emailTestStatus.textContent = '';

    settingsOverlay.classList.add('open');
    settingsPanel.classList.add('open');
  }
  function closeSettings() {
    settingsOverlay.classList.remove('open');
    settingsPanel.classList.remove('open');
  }

  async function sendTestEmail() {
    const sId = emailServiceId.value.trim();
    const tId = emailTemplateId.value.trim();
    const pKey = emailPublicKey.value.trim();
    const to = emailTo.value.trim();

    if (!sId || !tId || !pKey || !to) {
      emailTestStatus.textContent = '⚠ Fill in all EmailJS fields first';
      emailTestStatus.style.color = 'var(--error)';
      return;
    }

    emailTestStatus.textContent = 'Sending...';
    emailTestStatus.style.color = 'var(--text-muted)';
    testEmailBtn.disabled = true;

    const testHtml = buildEmailHtml(
      'Test Quote — Dashboard Alert', 'TEST-001', 'Test Department',
      'Test Customer Ltd', 'Mon, 1 Jan 2026 → Wed, 3 Jan 2026',
      '2h 30m', 'Test Speaker, Test Microphone, Test Lighting Rig',
      window.location.href
    );

    try {
      const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: sId,
          template_id: tId,
          user_id: pKey,
          template_params: {
            to_email: to,
            subject: '⚡ Test Alert — RMS Multitool Dashboard',
            html_body: testHtml
          }
        })
      });
      if (!res.ok) throw new Error(`EmailJS API ${res.status}: ${await res.text()}`);
      emailTestStatus.textContent = '✓ Test email sent!';
      emailTestStatus.style.color = 'var(--accent)';
    } catch (err) {
      emailTestStatus.textContent = `✕ Failed: ${err.text || err.message || err}`;
      emailTestStatus.style.color = 'var(--error)';
      console.error('Test email error:', err);
    } finally {
      testEmailBtn.disabled = false;
    }
  }

  function addDeptBlock(dept = null) {
    const idx = deptRulesContainer.children.length;
    const color = dept ? dept.color : defaultColors[idx % defaultColors.length];
    const block = document.createElement('div');
    block.className = 'dept-block';
    block.innerHTML = `
      <div class="dept-block-header">
        <input type="color" class="color-pick" value="${color}" />
        <input type="text" class="dept-name-input" placeholder="Department name (e.g. Audio)" value="${dept ? esc(dept.name) : ''}" />
        <button class="remove-dept-btn" title="Remove">✕</button>
      </div>
      <div class="rule-label">Product IDs (comma-separated)</div>
      <input class="rule-input product-ids" type="text" placeholder="e.g. 142, 305, 891" value="${dept && dept.productIds ? dept.productIds.join(', ') : ''}" />
      <div class="rule-hint">Exact product IDs that trigger this department</div>
      <div class="rule-label">Product Groups</div>
      <div class="multi-select-wrap group-select"></div>
      <div class="rule-hint">Select from your CurrentRMS product groups</div>
      <div class="rule-label">Keywords in Product Name</div>
      <div class="multi-select-wrap keyword-select"></div>
      <div class="rule-hint">Search your products by name or add custom keywords</div>
    `;
    block.querySelector('.remove-dept-btn').addEventListener('click', () => block.remove());
    buildStaticMultiSelect(block.querySelector('.group-select'), cachedProductGroups.map(g => g.name), dept ? dept.groupNames || [] : [], 'Search product groups...');
    buildLiveSearchMultiSelect(block.querySelector('.keyword-select'), dept ? dept.keywords || [] : [], 'Type to search products...');
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
      if (results.length === 0 && (!query || query.length < 2)) { const h = document.createElement('div'); h.className = 'ms-option'; h.style.cssText = 'color:var(--text-muted);font-style:italic;cursor:default;'; h.textContent = 'Type at least 2 characters to search products...'; optionsList.appendChild(h); return; }
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
      const groupNames = block.querySelector('.group-select')._getSelected();
      const keywords = block.querySelector('.keyword-select')._getSelected();
      if (productIds.length > 0 || groupNames.length > 0 || keywords.length > 0)
        config.departments.push({ name, color, productIds, groupNames, keywords });
    });

    // Save email config
    config.email = {
      serviceId: emailServiceId.value.trim(),
      templateId: emailTemplateId.value.trim(),
      publicKey: emailPublicKey.value.trim(),
      to: emailTo.value.trim(),
      thresholdSec: getTimeInputSec(emailThresholdValue, emailThresholdUnit),
      repeatSec: getTimeInputSec(emailRepeatValue, emailRepeatUnit)
    };

    saveConfig(); closeSettings(); lastResults = []; renderBoard(); startPolling();
  }

})();
