// warehouse-dashboard.js — RMS Multitool Warehouse Dashboard (Ready to prep · In prep · Ready to load)
//
// Test checklist: (1) License/trial active + subdomain + API key in popup. (2) Open from popup → Warehouse Dashboard.
// (3) Expect: orders (state 4) + reserved quotes (state 3), ends_at >= today; jobs with "ready for prep" date appear in columns.
// (4) Ready to prep = has date, no items in prep/booked. In prep = has date, some progress. Ready to load = all items booked out.
// (5) Click card opens opportunity in Current RMS. Refresh reloads. Errors show in red banner with Retry.
(() => {
  'use strict';

  chrome.runtime.sendMessage({ action: 'getLicenseStatus' }, function (s) {
    if (chrome.runtime.lastError) s = undefined;
    if (!s || s.allowed !== true) {
      var pw = document.getElementById('licensePaywall');
      if (pw) pw.style.display = 'flex';
      return;
    }
    run();
  });

  function run() {
    let subdomain = '';
    let apiKey = '';
    let storeNames = {};
    let fieldKey = null;
    const $ = id => document.getElementById(id);
    const loadingOverlay = $('loadingOverlay');
    const loadingText = $('loadingText');
    const board = $('board');
    const statTotal = $('statTotal');
    const refreshBtn = $('refreshBtn');
    const bodyReady = $('bodyReady');
    const bodyPrep = $('bodyPrep');
    const bodyLoad = $('bodyLoad');
    const countReady = $('countReady');
    const countPrep = $('countPrep');
    const countLoad = $('countLoad');
    const bodyOther = $('bodyOther');
    const countOther = $('countOther');
    const toggleOtherBtn = $('toggleOtherBtn');
    const refreshIntervalSel = $('refreshInterval');
    let currentMarkAsLoadedHandler = null;
    const errorBanner = $('errorBanner');
    const errorBannerMsg = $('errorBannerMsg');
    const errorBannerRetry = $('errorBannerRetry');

    function showError(msg) {
      if (errorBannerMsg) errorBannerMsg.textContent = msg || 'Something went wrong.';
      if (errorBanner) { errorBanner.classList.add('visible'); if (board) board.classList.add('has-error'); }
    }

    function hideError() {
      if (errorBanner) errorBanner.classList.remove('visible');
      if (board) board.classList.remove('has-error');
    }

    function buildApiUrl(endpoint, paramsArray) {
      const base = `https://api.current-rms.com/api/v1/${endpoint}`;
      if (!paramsArray || paramsArray.length === 0) return base;
      const qs = paramsArray.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      return `${base}?${qs}`;
    }

    function apiFetch(url, retries) {
      retries = retries == null ? 2 : retries;
      return fetch(url, {
        method: 'GET',
        headers: { 'X-SUBDOMAIN': subdomain, 'X-AUTH-TOKEN': apiKey, 'Content-Type': 'application/json' }
      }).then(function (r) {
        if (r.ok) return r.json();
        if (r.status === 429 && retries > 0) {
          return new Promise(function (resolve) { setTimeout(resolve, 1500); }).then(function () { return apiFetch(url, retries - 1); });
        }
        throw new Error(r.status === 429 ? 'API 429 — Too many requests. The dashboard is loading fewer jobs now; try refreshing in a moment.' : 'API ' + r.status);
      });
    }

    function setLoading(msg) {
      const text = msg || 'Loading...';
      if (loadingText) loadingText.textContent = text;
      if (statTotal) statTotal.textContent = text;
      // Keep overlay hidden so the board stays visible; tiles refresh in place
    }

    function setLoaded() {
      if (loadingOverlay) loadingOverlay.classList.add('hidden');
    }

    function esc(s) {
      if (s == null) return '';
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function formatDate(str) {
      if (!str) return '—';
      const d = new Date(str);
      return isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    }

    function openOpp(oppId) {
      if (subdomain && oppId) window.open(`https://${subdomain}.current-rms.com/opportunities/${oppId}`, '_blank');
    }

    // Exclude subhired / sub-rent from prep counts.
    function isSubhiredAsset(asset) {
      if (!asset) return false;
      const st = (asset.stock_type_name || asset.allocation_type_name || asset.stock_allocation_type_name || asset.type_name || '').toLowerCase();
      const assetNum = (asset.asset_number || '').toLowerCase();
      const name = (asset.name || '').toLowerCase();
      const combined = st + ' ' + assetNum + ' ' + name;
      if (combined.indexOf('subhire') !== -1 || combined.indexOf('sub-hire') !== -1 || combined.indexOf('subrent') !== -1) return true;
      if (combined.indexOf('sub') !== -1 && (combined.indexOf('rent') !== -1 || combined.indexOf('hire') !== -1)) return true;
      if (asset.stock_type === 2) return true;
      if (asset.supplier_id != null || asset.supplier_member_id != null || asset.member_organisation_id != null) return true;
      return false;
    }

    function isXHiredItem(item) {
      if (!item) return false;
      const typeName = (item.opportunity_item_type_name || item.transaction_type_name || '').toLowerCase();
      const name = (item.name || '').toLowerCase();
      const haystack = typeName + ' ' + name;
      return haystack.indexOf('subhire') !== -1 || haystack.indexOf('sub-hire') !== -1 ||
             haystack.indexOf('sub-rent') !== -1 || haystack.indexOf('sub rent') !== -1 ||
             haystack.indexOf('x-hire') !== -1 || haystack.indexOf('cross hire') !== -1;
    }

    function isLabourOrCrewItem(item) {
      if (!item) return false;
      const name = (item.name || '').toLowerCase();
      const typeName = (item.opportunity_item_type_name || item.transaction_type_name || '').toLowerCase();
      const groupName = (item.product_group_name || item.item_group_name || (item.product_group && item.product_group.name) || '').toLowerCase();
      const haystack = name + ' ' + typeName + ' ' + groupName;
      return haystack.indexOf('labour') !== -1 || haystack.indexOf('tty crew') !== -1 || haystack.indexOf('crew') !== -1;
    }

    function isStatusBooked(st, state, statusId) {
      if (state === 4 || (statusId != null && Number(statusId) === 4)) return true;
      return st.indexOf('book') !== -1 || st === 'booked_out';
    }
    function isStatusPrepared(st, state, statusId) {
      const sid = statusId != null ? Number(statusId) : null;
      if (state === 3 || sid === 3) return true;
      if ((state != null && state >= 3 && state !== 4) || (sid != null && sid >= 3 && sid !== 4)) return true;
      const s = st.trim();
      return s.indexOf('prep') !== -1 || s.indexOf('prepared') !== -1 || s.indexOf('in preparation') !== -1 ||
             s.indexOf('allocated') !== -1 || s === 'ready';
    }
    function isStatusNotReady(st) {
      const s = st.trim();
      return s === 'reserved' || s === 'provisional' || s === 'draft' || s === 'quote' ||
             s.indexOf('reserved') === 0 || s.indexOf('provisional') === 0;
    }

    function getProgress(opp) {
      const items = opp.opportunity_items || [];
      const xHiredItemIds = new Set(items.filter(isXHiredItem).map(it => it.id));
      const labourCrewItemIds = new Set(items.filter(isLabourOrCrewItem).map(it => it.id));
      const supplierAssets = opp.supplier_item_assets || [];
      const supplierAssetIds = new Set(supplierAssets.map(a => a.id));

      const flatAssets = opp.item_assets || [];
      const hasNestedAssets = items.some(it => (it.item_assets || []).length > 0);
      const assets = flatAssets.length > 0 ? flatAssets : [];

      if (assets.length > 0) {
        let prepared = 0, bookedOut = 0;
        let total = 0;
        assets.forEach(a => {
          if (supplierAssetIds.has(a.id)) return;
          if (a.opportunity_item_id != null && xHiredItemIds.has(a.opportunity_item_id)) return;
          if (a.opportunity_item_id != null && labourCrewItemIds.has(a.opportunity_item_id)) return;
          if (isSubhiredAsset(a)) return;
          const qty = parseFloat(a.quantity_allocated || a.quantity || 1) || 1;
          total += qty;
          const st = (a.status_name || a.status || '').toLowerCase();
          const state = a.state != null ? Number(a.state) : null;
          const statusId = a.status_id != null ? Number(a.status_id) : null;
          if (isStatusBooked(st, state, statusId)) bookedOut += qty;
          else if (isStatusPrepared(st, state, statusId) || !isStatusNotReady(st)) prepared += qty;
        });
        const workedHere = prepared + bookedOut;
        if (total > 0 && workedHere < total - 0.01 && !window._whStatusDebug) {
          window._whStatusDebug = true;
          const uncounted = assets.filter(a => {
            if (supplierAssetIds.has(a.id) || (a.opportunity_item_id != null && xHiredItemIds.has(a.opportunity_item_id)) || (a.opportunity_item_id != null && labourCrewItemIds.has(a.opportunity_item_id)) || isSubhiredAsset(a)) return false;
            const st2 = (a.status_name || a.status || '').toLowerCase();
            const state2 = a.state != null ? Number(a.state) : null;
            const statusId2 = a.status_id != null ? Number(a.status_id) : null;
            return !isStatusBooked(st2, state2, statusId2) && !isStatusPrepared(st2, state2, statusId2) && isStatusNotReady(st2);
          });
          if (uncounted.length) console.log('[Warehouse] Uncounted assets (status not prepared):', uncounted.slice(0, 3).map(a => ({ status_name: a.status_name, status: a.status, state: a.state, status_id: a.status_id })));
        }
        const pct = total ? Math.round((bookedOut / total) * 100) : 0;
        return { total, prepared, bookedOut, pct };
      }

      if (hasNestedAssets) {
        let prepared = 0, bookedOut = 0, total = 0;
        items.forEach(it => {
          if (isLabourOrCrewItem(it)) return;
          const itemAssets = it.item_assets || [];
          itemAssets.forEach(a => {
            if (isSubhiredAsset(a)) return;
            const qty = parseFloat(a.quantity_allocated || a.quantity || 1) || 1;
            total += qty;
            const st = (a.status_name || a.status || '').toLowerCase();
            const state = a.state != null ? Number(a.state) : null;
            const statusId = a.status_id != null ? Number(a.status_id) : null;
            if (isStatusBooked(st, state, statusId)) bookedOut += qty;
            else if (isStatusPrepared(st, state, statusId) || !isStatusNotReady(st)) prepared += qty;
          });
        });
        const pct = total ? Math.round((bookedOut / total) * 100) : 0;
        return { total, prepared, bookedOut, pct };
      }

      if (items.length === 0) return { total: 0, prepared: 0, bookedOut: 0, pct: 0 };
      let prepared = 0, bookedOut = 0, total = 0;
      items.forEach(it => {
        if (isXHiredItem(it)) return;
        if (isLabourOrCrewItem(it)) return;
        const st = (it.status_name || it.status || it.allocation_status_name || '').toLowerCase();
        const state = it.state != null ? Number(it.state) : null;
        const statusId = it.status_id != null ? Number(it.status_id) : null;
        const qty = parseFloat(it.quantity) || 1;
        total += qty;
        if (isStatusBooked(st, state, statusId)) bookedOut += qty;
        else if (isStatusPrepared(st, state, statusId) || !isStatusNotReady(st)) prepared += qty;
      });
      const pct = total ? Math.round((bookedOut / total) * 100) : 0;
      return { total, prepared, bookedOut, pct };
    }

    function renderCard(opp, progress, stage) {
      const name = esc(opp.subject || 'Unnamed');
      const clientName = opp.member_name != null ? esc(String(opp.member_name)) : (opp.member && opp.member.name ? esc(opp.member.name) : '—');
      const owner = (opp.owner && opp.owner.name) ? esc(opp.owner.name) : '—';
      const showDate = formatDate(opp.show_starts_at || opp.starts_at);
      const cfCard = opp.custom_fields || {};
      const readyDateVal = fieldKey && (cfCard[fieldKey] ?? cfCard[fieldKey.replace(/_/g, '-')] ?? cfCard[fieldKey.replace(/-/g, '_')]);
      const readyDate = readyDateVal ? formatDate(readyDateVal) : '—';
      const worked = (progress.prepared || 0) + (progress.bookedOut || 0);
      const rawPct = progress.total > 0 ? Math.round((worked / progress.total) * 100) : 0;
      const effectivelyComplete = progress.total > 0 && (worked >= progress.total - 0.01 || worked >= progress.total - 1 || rawPct >= 97);
      const isAllComplete = effectivelyComplete;
      const isBookedOut = progress.total > 0 && progress.bookedOut >= progress.total;
      const showAsComplete = isBookedOut || isAllComplete;
      const pct = progress.total > 0 ? (isAllComplete ? 100 : Math.min(100, rawPct)) : 0;
      const showProgress = stage === 'inPrep' && progress.total > 0;
      const progressLabel = showProgress
        ? (showAsComplete ? `Booked out (${pct}%)` : `In prep: ${worked}/${progress.total} (${pct}%)`)
        : (showAsComplete ? 'Booked out' : '—');
      const progressPct = showProgress ? `${pct}%` : '';
      const statusHtml = showAsComplete ? '<span class="wh-card-status booked">Booked out</span>' : '';
      const progressHtml = showProgress
        ? `
          <div class="wh-progress-wrap">
            <div class="wh-progress-label">${progressLabel}</div>
            <div class="wh-progress-row">
              <div class="wh-progress-bar"><div class="wh-progress-fill" style="width:${pct}%"></div></div>
              <div class="wh-progress-pct">${progressPct}</div>
            </div>
          </div>`
        : `
          <div class="wh-progress-wrap">
            <div class="wh-progress-label">${progressLabel}</div>
          </div>`;
      const loadedBtn = stage === 'load'
        ? '<div class="wh-card-actions"><button type="button" class="wh-btn-loaded">Loaded & Ready for Delivery</button></div>'
        : '';
      const jobNumber = opp.number != null ? esc(String(opp.number)) : (opp.reference != null ? esc(String(opp.reference)) : '');
      const rightBlock = (jobNumber || owner !== '—') ? `<div class="wh-card-top-right"><div class="wh-card-number">${jobNumber || '—'}</div><div class="wh-card-owner">${owner}</div></div>` : '';
      return `
        <div class="wh-card" data-opp-id="${opp.id}" role="button" tabindex="0">
          <div class="wh-card-top">
            <div class="wh-card-name">${name}</div>
            ${rightBlock}
          </div>
          <div class="wh-card-meta">${clientName}</div>
          <div class="wh-card-date">Show: ${showDate}</div>
          <div class="wh-card-ready-date">Ready for prep: ${readyDate}</div>
          ${progressHtml}
          ${statusHtml}
          ${loadedBtn}
        </div>`;
    }

    function renderColumn(container, list, emptyMsg, onLoadedClick) {
      if (!container) return;
      if (!list || list.length === 0) {
        container.innerHTML = '<div class="wh-empty">' + (emptyMsg || 'None') + '</div>';
        return;
      }
      container.innerHTML = list.map(item => item.html).join('');
      container.querySelectorAll('.wh-card').forEach(el => {
        const id = el.getAttribute('data-opp-id');
        el.addEventListener('click', (e) => {
          if (e.target.closest('.wh-btn-loaded')) return;
          openOpp(id);
        });
        el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openOpp(id); } });
      });
      if (container === bodyLoad && typeof onLoadedClick === 'function') {
        currentMarkAsLoadedHandler = onLoadedClick;
        container.querySelectorAll('.wh-btn-loaded').forEach(btn => {
          const card = btn.closest('.wh-card');
          const oppId = card && card.getAttribute('data-opp-id');
          if (oppId) {
            btn.addEventListener('click', function (e) {
              e.preventDefault();
              e.stopPropagation();
              onLoadedClick(oppId, card);
            });
          }
        });
      }
    }

    async function loadData() {
      hideError();
      setLoading('Checking custom field...');
      let keyRes;
      try {
        keyRes = await new Promise(r => chrome.runtime.sendMessage({ action: 'getReadyToPrepFieldKey' }, r));
      } catch (e) {
        setLoaded();
        showError('Could not get ready-for-prep field: ' + (e.message || 'unknown'));
        return;
      }
      if (!keyRes || !keyRes.success || !keyRes.fieldKey) {
        console.warn('[Warehouse] No ready-for-prep field key:', keyRes && keyRes.error);
        fieldKey = 'ready_for_prep_date';
      } else {
        fieldKey = keyRes.fieldKey;
      }

      setLoading('Loading opportunities...');
      const now = new Date();
      const pastIso = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const LIST_PAGE_SIZE = 50;
      let allOpps = [];
      try {
        const params = [
          ['per_page', String(LIST_PAGE_SIZE)],
          ['page', '1'],
          ['q[ends_at_gteq]', pastIso],
          ['q[s][]', 'starts_at asc'],
          ['include[]', 'custom_fields']
        ];
        [2, 3, 4].forEach(function (stateCode) { params.push(['q[state_in][]', String(stateCode)]); });
        const listUrl = buildApiUrl('opportunities', params);
        const data = await apiFetch(listUrl);
        const opps = data.opportunities || [];
        allOpps = opps.slice(0, LIST_PAGE_SIZE);
      } catch (e) {
        setLoaded();
        const msg = (e && e.message) || String(e);
        const is429 = msg.indexOf('429') !== -1;
        showError(is429 ? msg : (msg.indexOf('API') !== -1 ? msg + ' — Check subdomain and API key in the popup.' : msg));
        return;
      }
      var focusId = null;
      try {
        var qs = new URLSearchParams(window.location.search || '');
        var f = qs.get('focus');
        if (f && /^\d+$/.test(f)) focusId = f;
      } catch (_) {}
      if (!focusId) {
        try {
          var stored = await new Promise(function (r) { chrome.storage.local.get(['wh_last_opp_id'], r); });
          var sid = stored && stored.wh_last_opp_id;
          if (sid && /^\d+$/.test(String(sid))) focusId = String(sid);
        } catch (_) {}
      }
      if (focusId && !allOpps.some(function (o) { return String(o.id) === String(focusId); })) {
        try {
          setLoading('Loading job ' + focusId + '...');
          var focusUrl = buildApiUrl('opportunities/' + focusId, [['include[]', 'owner'], ['include[]', 'member'], ['include[]', 'custom_fields'], ['include[]', 'item_assets'], ['include[]', 'opportunity_items'], ['include[]', 'opportunity_items.item_assets'], ['include[]', 'supplier_item_assets']]);
          var focusData = await apiFetch(focusUrl);
          var focusOpp = focusData.opportunity;
          if (focusOpp && focusOpp.id) allOpps.unshift(focusOpp);
        } catch (err) { if (typeof console !== 'undefined' && console.warn) console.warn('[Warehouse] Could not load focus job ' + focusId, err); }
      }

      setLoading('Loading prep status (' + allOpps.length + ' jobs)...');
      const BATCH = 5;
      const BATCH_DELAY_MS = 350;
      try {
        for (let i = 0; i < allOpps.length; i += BATCH) {
          if (i > 0) await new Promise(function (r) { setTimeout(r, BATCH_DELAY_MS); });
          const batch = allOpps.slice(i, i + BATCH);
          await Promise.all(batch.map(async (opp) => {
            try {
              const url = buildApiUrl('opportunities/' + opp.id, [['include[]', 'owner'], ['include[]', 'member'], ['include[]', 'custom_fields'], ['include[]', 'item_assets'], ['include[]', 'opportunity_items'], ['include[]', 'opportunity_items.item_assets'], ['include[]', 'supplier_item_assets']]);
              const data = await apiFetch(url);
              const full = data.opportunity || {};
              let cf = {};
              if (opp.custom_fields && typeof opp.custom_fields === 'object' && !Array.isArray(opp.custom_fields)) {
                var listKeys = Object.keys(opp.custom_fields);
                if (listKeys.length && listKeys.some(function (k) { return isNaN(Number(k)); })) cf = { ...opp.custom_fields };
              }
              function normalizeCfKey(s) {
                if (s == null || typeof s !== 'string') return s;
                return s.toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_').trim();
              }
              function addCfItem(v) {
                if (!v) return;
                const sub = v.custom_field;
                const rawK = v.document_layout_name || v.custom_field_key || v.key ||
                  (sub && (sub.document_layout_name || sub.custom_field_key || sub.key));
                const displayK = v.name || v.field_name || (sub && (sub.name || sub.field_name));
                const k = rawK != null ? rawK : (displayK != null ? normalizeCfKey(displayK) : null);
                const hasKey = k != null;
                const val = v.value != null ? v.value
                  : (hasKey || sub ? undefined : (typeof v === 'string' || typeof v === 'number' ? v : undefined));
                if (hasKey && val !== undefined) cf[k] = val;
                else if (fieldKey && keyRes && keyRes.customFieldId != null && v.custom_field_id != null && Number(v.custom_field_id) === Number(keyRes.customFieldId) && v.value !== undefined) cf[fieldKey] = v.value;
              }
              const rawCf = full.custom_fields;
              const rawCfv = full.custom_field_values;
              function isArrayLikeObject(obj) {
                if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
                const values = Object.values(obj);
                return values.length > 0 && values.every(function (v) { return typeof v === 'object' && v !== null && (v.value !== undefined || v.custom_field_id !== undefined || v.document_layout_name !== undefined || v.custom_field != null); });
              }
              function iterateCfItems(arrOrObj, label) {
                const list = Array.isArray(arrOrObj) ? arrOrObj : (isArrayLikeObject(arrOrObj) ? Object.values(arrOrObj) : null);
                if (list && list.length) {
                  if (opp.id && typeof console !== 'undefined' && console.log) {
                    const first = list.find(function (x) { return x && (x.value != null || x.custom_field_id != null); });
                    if (first && !window._whCfSampleLogged) { window._whCfSampleLogged = true; console.log('[Warehouse] custom_fields ' + label + ' sample (opp ' + opp.id + '):', JSON.stringify(first).slice(0, 220)); }
                  }
                  list.forEach(addCfItem);
                  return true;
                }
                return false;
              }
              if (!iterateCfItems(rawCf, 'array/object')) {
                if (rawCf && typeof rawCf === 'object') cf = { ...rawCf };
              }
              if (!iterateCfItems(rawCfv, 'custom_field_values')) {
                if (rawCfv && typeof rawCfv === 'object' && !Array.isArray(rawCfv) && !isArrayLikeObject(rawCfv)) Object.assign(cf, rawCfv);
              }
              if (fieldKey && keyRes && keyRes.customFieldId != null && (cf[fieldKey] == null || cf[fieldKey] === '')) {
                var listForId = Array.isArray(rawCf) ? rawCf : (rawCf && typeof rawCf === 'object' ? Object.values(rawCf) : []);
                var listCfv = Array.isArray(rawCfv) ? rawCfv : (rawCfv && typeof rawCfv === 'object' ? Object.values(rawCfv) : []);
                [].concat(listForId, listCfv).forEach(function (v) {
                  if (v && Number(v.custom_field_id) === Number(keyRes.customFieldId) && v.value != null) cf[fieldKey] = v.value;
                });
              }
              if (fieldKey && (cf[fieldKey] == null || cf[fieldKey] === '')) {
                var fromFull = full[fieldKey] ?? full[fieldKey.replace(/_/g, '-')] ?? full['ready-for-prep-date'];
                if (fromFull != null && fromFull !== '') cf[fieldKey] = fromFull;
                else if (typeof full === 'object') {
                  Object.keys(full).forEach(function (k) {
                    if (k && normalizeCfKey(k) === fieldKey && full[k] != null && full[k] !== '') cf[fieldKey] = full[k];
                  });
                }
              }
              if (opp.custom_fields && typeof opp.custom_fields === 'object' && !Array.isArray(opp.custom_fields) && fieldKey && (cf[fieldKey] == null || cf[fieldKey] === '')) {
                var fromList = opp.custom_fields[fieldKey] ?? opp.custom_fields[fieldKey.replace(/_/g, '-')];
                if (fromList != null && fromList !== '') cf[fieldKey] = fromList;
              }
              if (fieldKey && keyRes && keyRes.customFieldId != null && (cf[fieldKey] == null || cf[fieldKey] === '')) {
                var byId = cf[String(keyRes.customFieldId)] ?? cf[keyRes.customFieldId];
                if (byId != null && byId !== '') cf[fieldKey] = byId;
              }
              Object.assign(opp, {
                owner: full.owner,
                member: full.member,
                member_name: full.member_name,
                custom_fields: cf,
                item_assets: full.item_assets || [],
                opportunity_items: full.opportunity_items || [],
                supplier_item_assets: full.supplier_item_assets || []
              });
            } catch (err) {
              opp.owner = null;
              opp.member = null;
              opp.member_name = null;
              opp.custom_fields = {};
              opp.item_assets = [];
              opp.opportunity_items = [];
              opp.supplier_item_assets = [];
            }
          }));
          const prog = 'Loading prep status (' + Math.min(i + BATCH, allOpps.length) + '/' + allOpps.length + ')...';
          if (loadingText) loadingText.textContent = prog;
          if (statTotal) statTotal.textContent = prog;
        }
      } catch (e) {
        setLoaded();
        showError((e && e.message) || 'Failed to load prep status.');
        return;
      }

      const readyToPrep = [];
      const inPrep = [];
      const readyToLoad = [];
      const notInWorkflow = [];

      if (typeof window !== 'undefined' && !window._rmsWhDebugLogged) {
        const sample = allOpps.find(o => (o.item_assets && o.item_assets.length) || (o.opportunity_items && o.opportunity_items.some(it => (it.item_assets || []).length)));
        if (sample) {
          window._rmsWhDebugLogged = true;
          const a = (sample.item_assets && sample.item_assets[0]) || (sample.opportunity_items && sample.opportunity_items[0] && (sample.opportunity_items[0].item_assets || [])[0]);
          const it = sample.opportunity_items && sample.opportunity_items[0];
          console.log('[RMS WH] Sample opportunity id:', sample.id, 'item_assets count:', (sample.item_assets || []).length, 'supplier_item_assets count:', (sample.supplier_item_assets || []).length);
          if (a) console.log('[RMS WH] First asset keys:', Object.keys(a), 'sample:', { asset_number: a.asset_number, name: a.name, stock_type: a.stock_type, stock_type_name: a.stock_type_name, allocation_type_name: a.allocation_type_name });
          if (it) console.log('[RMS WH] First item keys:', Object.keys(it), 'sample:', { name: it.name, transaction_type_name: it.transaction_type_name, item_assets_count: (it.item_assets || []).length });
        }
      }

      let loadedIds = new Set();
      try {
        const st = await new Promise(r => chrome.storage.local.get(['whLoadedIds'], r));
        loadedIds = new Set((st.whLoadedIds || []).map(Number));
      } catch (_) {}

      allOpps.forEach(opp => {
        // Once marked "Loaded", remove from the board completely (don't show in any column)
        if (loadedIds.has(Number(opp.id))) return;

        const progress = getProgress(opp);
        const cf = opp.custom_fields || {};
        const readyVal = fieldKey && (cf[fieldKey] ?? cf[fieldKey.replace(/_/g, '-')] ?? cf[fieldKey.replace(/-/g, '_')]);
        const hasReadyDate = fieldKey && (readyVal != null && readyVal !== '');
        const worked = (progress.prepared || 0) + (progress.bookedOut || 0);
        const rawPct = progress.total > 0 ? Math.round((worked / progress.total) * 100) : 0;
        const allComplete = progress.total > 0 && (worked >= progress.total - 0.01 || worked >= progress.total - 1 || rawPct >= 97);
        const allBooked = progress.total > 0 && progress.bookedOut >= progress.total;
        let html, item;

        if ((allComplete || allBooked) && hasReadyDate) {
          html = renderCard(opp, progress, 'load');
          item = { opp, progress, html };
          readyToLoad.push(item);
        } else if (hasReadyDate) {
          if (progress.total === 0) {
            // No asset records yet – treat as Ready to prep.
            html = renderCard(opp, progress, 'ready');
            item = { opp, progress, html };
            readyToPrep.push(item);
          } else if (progress.bookedOut > 0 || progress.prepared > 0) {
            html = renderCard(opp, progress, 'inPrep');
            item = { opp, progress, html };
            inPrep.push(item);
          } else {
            html = renderCard(opp, progress, 'ready');
            item = { opp, progress, html };
            readyToPrep.push(item);
          }
        } else {
          html = renderCard(opp, progress, 'other');
          item = { opp, progress, html };
          notInWorkflow.push(item);
        }
      });

      if (typeof console !== 'undefined' && console.log) {
        var withReady = allOpps.filter(function (o) {
          var c = o.custom_fields || {};
          var r = fieldKey && (c[fieldKey] ?? c[fieldKey.replace(/_/g, '-')] ?? c[fieldKey.replace(/-/g, '_')]);
          return r != null && r !== '';
        });
        console.log('[Warehouse] fieldKey:', fieldKey, 'customFieldId:', keyRes && keyRes.customFieldId, '| jobs:', allOpps.length, '| with ready date:', withReady.length, withReady.length ? 'ids: ' + withReady.map(function (o) { return o.id; }).join(', ') : '');
        allOpps.slice(0, 5).forEach(function (o) {
          var cf = o.custom_fields || {};
          console.log('[Warehouse]', o.id, o.subject, 'state=' + o.state, 'custom_fields keys:', Object.keys(cf).slice(0, 10), 'readyDate:', cf[fieldKey] != null ? cf[fieldKey] : '(none)');
        });
      }
      // Column logic: Ready to load = all item_assets booked out; else if has ready-for-prep date → In prep (some progress) or Ready to prep (none)

      if (statTotal) statTotal.textContent = allOpps.length + ' job' + (allOpps.length !== 1 ? 's' : '');
      if (countReady) countReady.textContent = readyToPrep.length;
      if (countPrep) countPrep.textContent = inPrep.length;
      if (countLoad) countLoad.textContent = readyToLoad.length;
      if (countOther) countOther.textContent = notInWorkflow.length;

      function markAsLoaded(oppId, cardEl) {
        const id = Number(oppId);
        // Remove tile immediately so the UI updates instantly
        if (cardEl && cardEl.parentNode) cardEl.remove();
        if (countLoad && bodyLoad) countLoad.textContent = bodyLoad.querySelectorAll('.wh-card').length;
        // Persist so the job stays off the board after refresh
        chrome.storage.local.get(['whLoadedIds'], (st) => {
          const ids = (st.whLoadedIds || []).slice().map(Number);
          if (!ids.some(function (x) { return x === id; })) ids.push(id);
          chrome.storage.local.set({ whLoadedIds: ids });
        });
      }

      renderColumn(bodyReady, readyToPrep, 'No jobs here. Open the quote in Current RMS and click Mark ready to prep.');
      renderColumn(bodyPrep, inPrep, 'None in prep');
      renderColumn(bodyLoad, readyToLoad, 'None ready to load', markAsLoaded);
      renderColumn(bodyOther, notInWorkflow, 'Jobs without a "Ready for prep" date. Click "Mark ready to prep" on the quote to add it and move the job to Ready to prep.');
      setLoaded();
    }

    refreshBtn.addEventListener('click', () => loadData());
    if (errorBannerRetry) errorBannerRetry.addEventListener('click', () => loadData());

    // Toggle visibility of "Not in workflow" column using a button styled like Refresh
    if (toggleOtherBtn && bodyOther && bodyOther.parentElement) {
      let otherVisible = false;
      bodyOther.parentElement.style.display = 'none';
      toggleOtherBtn.textContent = 'Show "Loaded"';
      toggleOtherBtn.addEventListener('click', function () {
        otherVisible = !otherVisible;
        bodyOther.parentElement.style.display = otherVisible ? 'flex' : 'none';
        toggleOtherBtn.textContent = otherVisible ? 'Hide "Loaded"' : 'Show "Loaded"';
      });
    }

    // Auto-refresh interval selector (seconds)
    let autoTimer = null;
    function scheduleAutoRefresh(sec) {
      if (autoTimer) {
        clearInterval(autoTimer);
        autoTimer = null;
      }
      if (!sec || sec <= 0) return;
      autoTimer = setInterval(() => {
        loadData();
      }, sec * 1000);
    }

    if (refreshIntervalSel) {
      chrome.storage.local.get(['whRefreshInterval'], (st) => {
        const initial = typeof st.whRefreshInterval === 'number' ? st.whRefreshInterval : 60;
        refreshIntervalSel.value = String(initial);
        scheduleAutoRefresh(initial);
      });
      refreshIntervalSel.addEventListener('change', function () {
        const v = parseInt(refreshIntervalSel.value, 10) || 0;
        chrome.storage.local.set({ whRefreshInterval: v });
        scheduleAutoRefresh(v);
      });
    }

    chrome.storage.sync.get(['subdomain', 'apiKey', 'storeConfig'], (st) => {
      subdomain = st.subdomain || '';
      apiKey = st.apiKey || '';
      if (st.storeConfig) {
        Object.entries(st.storeConfig).forEach(([id, cfg]) => {
          if (cfg && cfg.name) storeNames[parseInt(id, 10)] = cfg.name;
        });
      }
      if (!subdomain || !apiKey) {
        setLoaded();
        showError('Set subdomain and API key in the extension popup.');
        return;
      }
      loadData();
    });
  }
})();
