// public-holiday.js — RMS Multitool: Victorian Public Holiday Detector
// On opportunity pages: checks if the event start date is a VIC public holiday,
// shows a banner, and offers a one-click 25% surcharge applied to all service items.
(() => {
  'use strict';

  let oppId   = null;
  let apiKey  = '';

  // ── Entry point ───────────────────────────────────────────────────────────
  function init() {
    const m = window.location.pathname.match(/\/opportunities\/(\d+)/);
    if (!m) return;
    oppId = m[1];

    // Respect the same license gate as quote-mute
    chrome.runtime.sendMessage({ action: 'getLicenseStatus' }, (status) => {
      if (chrome.runtime.lastError || !status || status.allowed !== true) return;

      chrome.storage.sync.get(['apiKey'], (r1) => {
        apiKey = r1.apiKey || '';
        if (apiKey) { checkPublicHoliday(); return; }
        chrome.storage.local.get(['apiKey'], (r2) => {
          apiKey = r2.apiKey || '';
          if (apiKey) checkPublicHoliday();
        });
      });
    });
  }

  // ── Main check ────────────────────────────────────────────────────────────
  async function checkPublicHoliday() {
    // 1. Get the opportunity start date
    const opp = await new Promise(resolve =>
      chrome.runtime.sendMessage({ action: 'fetchOpportunity', opportunityId: oppId },
        resp => resolve(resp && resp.success ? resp.opportunity : null))
    );
    if (!opp || !opp.starts_at) return;

    const startDate = new Date(opp.starts_at);
    const dateStr   = startDate.toISOString().split('T')[0]; // YYYY-MM-DD
    const year      = startDate.getFullYear();

    // 2. Fetch Australian public holidays for that year (free, no auth)
    const phResp = await new Promise(resolve =>
      chrome.runtime.sendMessage(
        { action: 'genericFetch', url: `https://date.nager.at/api/v3/PublicHolidays/${year}/AU` },
        resolve
      )
    );
    if (!phResp || !phResp.success || !Array.isArray(phResp.data)) return;

    // 3. Filter for Victoria: global (no counties) or counties includes AU-VIC
    const vicHolidays = phResp.data.filter(h =>
      !h.counties || h.counties.includes('AU-VIC')
    );

    // 4. Check if start date matches a VIC holiday
    const holiday = vicHolidays.find(h => h.date === dateStr);
    if (!holiday) return;

    showBanner(holiday.localName || holiday.name);
  }

  // ── Banner UI ─────────────────────────────────────────────────────────────
  function showBanner(holidayName) {
    if (document.getElementById('rms-ph-banner')) return;

    if (!document.getElementById('rms-ph-style')) {
      const s = document.createElement('style');
      s.id = 'rms-ph-style';
      s.textContent = `
        /* Sticky top bar — sits just below the existing CurrentRMS navbar */
        #rms-ph-bar {
          position: fixed;
          left: 0;
          right: 0;
          z-index: 1039;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 14px;
          padding: 0 20px;
          height: 48px;
          background: linear-gradient(90deg, #c94400 0%, #f07000 50%, #c94400 100%);
          box-shadow: 0 3px 12px rgba(0,0,0,0.35);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 15px;
          font-weight: 700;
          color: #fff;
          letter-spacing: 0.2px;
          animation: rms-ph-slide 0.35s ease;
        }
        @keyframes rms-ph-slide {
          from { transform: translateY(-8px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }

        #rms-ph-bar .ph-label { font-size: 17px; letter-spacing: -0.2px; }
        #rms-ph-bar .ph-name  { font-size: 17px; font-weight: 800; }
        #rms-ph-bar .ph-sep   { opacity: 0.5; font-weight: 300; font-size: 18px; }
        #rms-ph-bar .ph-spacer { flex: 1; }

        #rms-ph-apply {
          flex-shrink: 0;
          padding: 7px 16px;
          background: rgba(255,255,255,0.18);
          border: 2px solid rgba(255,255,255,0.55);
          border-radius: 6px;
          color: #fff;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
          letter-spacing: 0.2px;
          transition: background 0.15s, border-color 0.15s;
          white-space: nowrap;
        }
        #rms-ph-apply:hover:not(:disabled) {
          background: rgba(255,255,255,0.30);
          border-color: rgba(255,255,255,0.80);
        }
        #rms-ph-apply:disabled { opacity: 0.55; cursor: not-allowed; }
        #rms-ph-apply.success  { background: rgba(0,220,120,0.30); border-color: rgba(0,220,120,0.70); }
        #rms-ph-apply.error    { background: rgba(220,50,50,0.30);  border-color: rgba(220,50,50,0.70); }

        /* Inline banner below header (secondary, less prominent) */
        #rms-ph-banner {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 8px 0 12px;
          padding: 12px 16px;
          border-radius: 6px;
          background: rgba(230,92,0,0.10);
          border: 1px solid rgba(230,92,0,0.40);
          color: #7a3000;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 13px;
          font-weight: 600;
        }
        #rms-ph-banner strong { font-weight: 800; }
      `;
      document.head.appendChild(s);
    }

    // ── Sticky top bar ──────────────────────────────────────────────────────
    const bar = document.createElement('div');
    bar.id = 'rms-ph-bar';
    bar.innerHTML =
      '<span style="font-size:20px;line-height:1">🇦🇺</span>' +
      '<span class="ph-label">VICTORIAN PUBLIC HOLIDAY</span>' +
      '<span class="ph-sep">|</span>' +
      '<span class="ph-name">' + holidayName + '</span>' +
      '<span class="ph-spacer"></span>' +
      '<button id="rms-ph-apply">Apply 25% Public Holiday Surcharge</button>';
    // Find the actual fixed/sticky navbar by checking computed styles,
    // so we sit below it regardless of what class CurrentRMS uses
    function getFixedNavHeight() {
      let maxBottom = 0;
      document.querySelectorAll('*').forEach(el => {
        try {
          const pos = getComputedStyle(el).position;
          if (pos !== 'fixed' && pos !== 'sticky') return;
          const r = el.getBoundingClientRect();
          if (r.top <= 4 && r.height > 10 && r.width > 100) {
            maxBottom = Math.max(maxBottom, r.bottom);
          }
        } catch (e) { /* ignore */ }
      });
      return maxBottom;
    }
    const navH = getFixedNavHeight() || 54; // 54px fallback for CurrentRMS default navbar
    bar.style.top = navH + 'px';
    document.body.style.paddingTop = (navH + 48) + 'px';
    document.body.appendChild(bar);

    // ── Inline banner (below page header) ──────────────────────────────────
    const banner = document.createElement('div');
    banner.id = 'rms-ph-banner';
    banner.innerHTML =
      '<span style="font-size:16px">🚨</span>' +
      '<span>Public Holiday — <strong>' + holidayName + '</strong> — surcharge may apply</span>';

    insertBanner(banner);

    document.getElementById('rms-ph-apply').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled    = true;
      btn.textContent = 'Applying…';
      try {
        const { count } = await applySurcharge();
        btn.textContent = `✓ Applied to ${count} service${count === 1 ? '' : 's'}`;
        btn.classList.add('success');
      } catch (err) {
        const msg = (err && err.message) ? err.message.substring(0, 80) : 'Unknown error';
        btn.textContent = '✗ ' + msg;
        btn.classList.add('error');
        btn.disabled = false;
        console.error('[RMS Public Holiday] Surcharge failed:', err);
        return;
      }
      // Reload so CurrentRMS re-renders the updated prices
      setTimeout(() => window.location.reload(), 1200);
    });
  }

  // ── Apply surcharge ───────────────────────────────────────────────────────
  async function applySurcharge() {
    // Fetch the full opportunity with items included — same approach as delivery-sheet.js.
    // The paginated /opportunity_items sub-endpoint only returns equipment (Principal/Accessory/Group);
    // service items only appear when fetched via ?include[]=opportunity_items on the opportunity itself.
    const data = await apiFetch(
      `https://api.current-rms.com/api/v1/opportunities/${oppId}?include[]=opportunity_items`
    );
    const opp      = data.opportunity || data;
    const allItems = opp.opportunity_items || [];

    // CurrentRMS identifies service items via transaction_type_name === 'Service'
    // (confirmed from Liquid syntax docs — is_service? maps to this field)
    const services = allItems.filter(item =>
      (item.transaction_type_name || '').toLowerCase() === 'service'
    );

    if (services.length === 0) {
      const txTypes = [...new Set(allItems.map(i => i.transaction_type_name || 'null'))].join(', ');
      throw new Error(`No service items found. Transaction types: ${txTypes}`);
    }

    // Use the same PATCH endpoint the CurrentRMS UI uses when editing inline.
    // Field is discount_percent (form-encoded), auth is session cookie + CSRF token.
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
    if (!csrfToken) throw new Error('Could not find CSRF token — try reloading the page');

    const errors = [];

    await Promise.all(services.map(async item => {
      try {
        const resp = await fetch(
          `https://alvgroup.current-rms.com/opportunity_items/${item.id}`,
          {
            method: 'PATCH',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'X-CSRF-Token': csrfToken,
              'X-Requested-With': 'XMLHttpRequest',
              'Accept': '*/*;q=0.5, text/javascript, application/javascript'
            },
            body: 'update_type=inline&opportunity_item%5Bdiscount_percent%5D=-25'
          }
        );
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      } catch (e) {
        errors.push(`${item.name}: ${e.message}`);
      }
    }));

    if (errors.length) throw new Error(errors.join(' | '));

    return { count: services.length, priceStuck: false };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function apiFetch(url, options = {}) {
    const method  = (options.method || 'GET').toUpperCase();
    const isWrite = method !== 'GET';
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        isWrite
          ? { action: 'currentRmsWrite', url, method, body: options.body }
          : { action: 'currentRmsFetch', url },
        response => {
          if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
          if (!response || !response.success) { reject(new Error((response && response.error) || 'Request failed')); return; }
          resolve(response.data);
        }
      );
    });
  }

  // Insert inline banner using same placement logic as quote-expired banner
  function insertBanner(banner) {
    let inserted = false;

    const readyWrap = document.getElementById('rms-multitool-ready-to-prep-wrap');
    if (readyWrap && readyWrap.parentElement) {
      readyWrap.parentElement.insertBefore(banner, readyWrap.nextSibling);
      return;
    }

    const headings = document.querySelectorAll('h2, h3, h4, dt, .panel-title, .section-title');
    for (const el of headings) {
      if (/\bAttributes\b/.test((el.textContent || '').trim())) {
        const section = el.closest('.panel, .card, section') || el.parentElement;
        if (section && section.parentElement) {
          section.parentElement.insertBefore(banner, section);
          inserted = true;
        }
        break;
      }
    }

    if (!inserted) {
      const target = document.querySelector('.page-header, .detail-header, #main, main')
        || document.querySelector('h1')?.parentElement
        || document.body;
      target.prepend(banner);
    }
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
