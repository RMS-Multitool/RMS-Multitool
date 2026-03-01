// quote-mute.js — RMS Multitool: Quote Item Mute Toggle v1.0
// Injects eye icons on opportunity item/group rows to mute/unmute from client quote.
// Muted = [MUTED] tag appended to description (items) or name (groups) via API.
// Client Liquid template skips anything containing [MUTED].
(() => {
  'use strict';

  const MUTE_TAG = '[MUTED]';
  const HIDE_ONLY_TAG = '[HIDEONLY]'; // hide from client, keep totals
  let subdomain = '';
  let apiKey = '';
  let oppId = null;
  let debounceTimer = null;
  let processing = new Set(); // prevent double-clicks

  // ── Init — Mute/Hide only run when user has entered a trial or unlock code ─
  function init() {
    const m = window.location.pathname.match(/\/opportunities\/(\d+)/);
    if (!m) return;
    oppId = m[1];
    subdomain = window.location.hostname.split('.')[0];

    chrome.runtime.sendMessage({ action: 'getLicenseStatus' }, function (status) {
      if (chrome.runtime.lastError) status = undefined;
      if (!status || status.allowed !== true) return;

      chrome.storage.sync.get(['apiKey'], (result) => {
        apiKey = result.apiKey || '';
        if (!apiKey) {
          chrome.storage.local.get(['apiKey'], (r2) => {
            apiKey = r2.apiKey || '';
            if (apiKey) startObserving();
            else console.warn('[Quote Mute] No API key found. Configure in extension settings.');
          });
        } else {
          startObserving();
        }
      });
    });
  }

  // ── Inject styles ─────────────────────────────────────────
  function injectStyles() {
    if (document.querySelector('#rms-mute-style')) return;
    const s = document.createElement('style');
    s.id = 'rms-mute-style';
    s.textContent = `
      /* Right column: content left-aligned so toggles stay left of the column */
      td.edit-controls-column {
        width: 1%;
        white-space: nowrap;
        text-align: left;
        padding-left: 4px;
      }
      .rms-mute-toggles {
        display: inline-flex; align-items: center; gap: 2px;
        vertical-align: middle; flex-shrink: 0;
      }

      /* Toggle button — full mute (hide + adjust totals) */
      .mute-toggle {
        display: inline-flex; align-items: center; justify-content: center;
        width: 20px; height: 18px; border-radius: 3px; cursor: pointer;
        border: 1px solid rgba(107,184,255,0.3); transition: all 0.15s ease;
        opacity: 0.7; background: rgba(107,184,255,0.06); padding: 0;
        vertical-align: middle; position: relative; z-index: 10; flex-shrink: 0;
      }
      /* Off state: RMS Multitool accent lines, ON state: bright red lines. */
      .mute-toggle { color: #071317; }
      .mute-toggle.muted { color: #ff4d6a; }
      .mute-toggle:hover { opacity: 1; background: rgba(107,184,255,0.15); border-color: rgba(107,184,255,0.5); transform: scale(1.05); }
      .mute-toggle.muted { opacity: 1; background: rgba(255,77,106,0.12); border-color: rgba(255,77,106,0.4); }
      .mute-toggle.muted:hover { background: rgba(255,77,106,0.22); border-color: rgba(255,77,106,0.6); }
      .mute-toggle svg,
      .mute-toggle-hide svg { width: 11px; height: 11px; }
      .mute-toggle.busy { pointer-events: none; opacity: 0.3; }

      /* Hide-only toggle — hide from client, keep totals */
      .mute-toggle-hide {
        display: inline-flex; align-items: center; justify-content: center;
        width: 20px; height: 18px; border-radius: 3px; cursor: pointer;
        border: 1px solid rgba(0,229,160,0.35); transition: all 0.15s ease;
        opacity: 0.7; background: rgba(0,229,160,0.06); padding: 0;
        vertical-align: middle; position: relative; z-index: 10; flex-shrink: 0;
      }
      .mute-toggle-hide { color: #071317; }
      .mute-toggle-hide.active { color: #ff4d6a; }
      .mute-toggle-hide:hover { opacity: 1; background: rgba(0,229,160,0.16); border-color: rgba(0,229,160,0.55); transform: scale(1.05); }
      .mute-toggle-hide.active { opacity: 1; background: rgba(0,229,160,0.18); border-color: rgba(0,229,160,0.75); }
      .mute-toggle-hide.busy { pointer-events: none; opacity: 0.3; }

      /* Muted item row — red tint */
      li.grid-body-row.mute-dimmed > table {
        opacity: 0.5 !important;
        transition: opacity 0.2s ease;
      }
      li.grid-body-row.mute-dimmed > table td {
        background: rgba(255,77,106,0.06) !important;
        color: #cc3355 !important;
      }
      li.grid-body-row.mute-dimmed > table .mute-toggle { opacity: 1 !important; position: relative; z-index: 10; }
      li.grid-body-row.mute-dimmed > table td.dd-handle { opacity: 1 !important; }

      /* Muted group header — red tint */
      li.grid-body-row.mute-group-dimmed > table {
        opacity: 0.5 !important;
        transition: opacity 0.2s ease;
      }
      li.grid-body-row.mute-group-dimmed > table td {
        background: rgba(255,77,106,0.06) !important;
        color: #cc3355 !important;
      }
      li.grid-body-row.mute-group-dimmed > table .mute-toggle { opacity: 1 !important; position: relative; z-index: 10; }
      li.grid-body-row.mute-group-dimmed > table td.dd-handle { opacity: 1 !important; }
      /* All children inside a muted group — red tint */
      li.grid-body-row.mute-group-dimmed ol.cobra-grid li.grid-body-row > table {
        opacity: 0.45 !important;
      }
      li.grid-body-row.mute-group-dimmed ol.cobra-grid li.grid-body-row > table td {
        background: rgba(255,77,106,0.04) !important;
        color: #cc3355 !important;
      }

      /* MUTED badge next to item name */
      .mute-badge {
        display: inline-block; font-size: 8px; font-weight: 700;
        padding: 1px 5px; border-radius: 3px; margin-left: 6px;
        background: rgba(255,77,106,0.12); color: #ff4d6a;
        border: 1px solid rgba(255,77,106,0.2); vertical-align: middle;
        letter-spacing: 0.5px; text-transform: uppercase; line-height: 1.4;
      }

      /* Fixed summary bar at bottom of page */
      .mute-summary-bar {
        position: fixed; bottom: 0; left: 0; right: 0; z-index: 99999;
        background: linear-gradient(135deg, rgba(26,26,36,0.97), rgba(20,20,28,0.97));
        backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
        border-top: 1px solid rgba(255,77,106,0.2); padding: 8px 24px;
        display: none; align-items: center; gap: 20px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 12px; color: #e0e0e8;
        box-shadow: 0 -4px 20px rgba(0,0,0,0.3);
      }
      .mute-summary-bar.visible { display: flex; }
      .mute-summary-bar .ms-icon { font-size: 16px; }
      .mute-summary-bar .ms-label { color: #ff4d6a; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
      .mute-summary-bar .ms-divider { width: 1px; height: 20px; background: #2a2a35; }
      .mute-summary-bar .ms-count { color: #a0a0b0; font-size: 11px; }
      .mute-summary-bar .ms-unmute-all {
        margin-left: auto; padding: 4px 12px; border-radius: 4px; cursor: pointer;
        background: rgba(255,77,106,0.1); border: 1px solid rgba(255,77,106,0.25);
        color: #ff4d6a; font-size: 10px; font-weight: 600; text-transform: uppercase;
        letter-spacing: 0.5px; transition: all 0.15s;
      }
      .mute-summary-bar .ms-unmute-all:hover { background: rgba(255,77,106,0.2); }
    `;
    document.head.appendChild(s);
  }

  // ── SVG icons ─────────────────────────────────────────────
  // Full mute (OFF): money icon (no strike)
  const eyeOnSVG = `<svg class="icon-mute-money" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="9"></circle>
    <path d="M9 9.5c0-1.1.9-2 2.5-2h1c1.6 0 2.5.9 2.5 2 0 1.1-.9 2-2.3 2.3l-1.4.3c-1.4.3-2.3 1.2-2.3 2.3 0 1.1.9 2 2.5 2h1c1.6 0 2.5-.9 2.5-2"></path>
    <path d="M12 6v2"></path>
    <path d="M12 16v2"></path>
  </svg>`;

  // Full mute (ON): money icon with strike-through
  const eyeOffSVG = `<svg class="icon-mute-money-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="9"></circle>
    <path d="M9 9.5c0-1.1.9-2 2.5-2h1c1.6 0 2.5.9 2.5 2 0 1.1-.9 2-2.3 2.3l-1.4.3c-1.4.3-2.3 1.2-2.3 2.3 0 1.1.9 2 2.5 2h1c1.6 0 2.5-.9 2.5-2"></path>
    <path d="M12 6v2"></path>
    <path d="M12 16v2"></path>
    <path d="M6 6l12 12"></path>
  </svg>`;

  // Hide-only (OFF): normal eye
  const eyeHideOffSVG = `<svg class="eye-hide-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"></path>
    <circle cx="12" cy="12" r="2.5"></circle>
  </svg>`;

  // Hide-only (ON): eye with strike-through
  const eyeHideOnSVG = `<svg class="eye-hide-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"></path>
    <circle cx="12" cy="12" r="2.5"></circle>
    <path d="M4 4l16 16"></path>
  </svg>`;

  // ── Observe DOM for item rows ─────────────────────────────
  function startObserving() {
    injectStyles();
    createSummaryBar();

    // Initial injection (wait for CurrentRMS DOM to settle)
    setTimeout(() => injectToggles(), 1000);

    // Re-inject when items table changes (add/remove/reorder)
    // This also re-applies muted state from cache after CurrentRMS rebuilds DOM
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        injectToggles();
        // Also update totals if we have muted items (cache survives DOM rebuild)
        if (mutedIds.size > 0) {
          updatePageTotal();
        }
      }, 500);
    });

    const target = document.querySelector('#opportunity_items')
                || document.querySelector('#opportunity_items_scrollable')
                || document.body;
    observer.observe(target, { childList: true, subtree: true });
  }

  // ── Muted state cache (fetched from API, persists across re-injections) ────
  let mutedIds = new Set(); // Set of item IDs that are muted
  let mutedCharges = {}; // { itemId: { charge: number, tax: number } } for groups
  let hideOnlyIds = new Set(); // Set of item IDs that are hide-only (client hidden, totals unchanged)

  // ── Find and inject toggle buttons on each row ────────────
  function injectToggles() {
    const items = document.querySelectorAll('#opportunity_items_body li.grid-body-row');
    if (items.length === 0) return;

    items.forEach(li => {
      const itemId = li.dataset.id;
      const itemType = li.dataset.type; // 'group', 'item', 'accessory'
      if (!itemId) return;

      // Skip accessories — they follow their parent item
      if (itemType === 'accessory') return;

      const isGroup = itemType === 'group';

      // Always apply muted state from cache, regardless of toggle button
      if (mutedIds.has(itemId)) {
        applyMutedStyle(li, isGroup);
      }
      if (hideOnlyIds.has(itemId)) {
        applyHideOnlyStyle(li, isGroup);
      }

      // Right column: toggles left-aligned in edit-controls so column stays narrow
      const controlsCell = li.querySelector(':scope > table td.edit-controls-column');
      if (!controlsCell) return; // Can't inject toggle, but style was already applied above

      let wrapper = li.querySelector(':scope > table .rms-mute-toggles');
      if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.className = 'rms-mute-toggles';
        // Insert at start of cell so toggles stay left; dropdown (if any) follows
        const dropdown = controlsCell.querySelector('.dropdown, .action-menu');
        if (dropdown) {
          controlsCell.insertBefore(wrapper, dropdown);
        } else {
          controlsCell.prepend(wrapper);
        }
      }

      // Check if toggle already exists
      let btn = wrapper.querySelector('.mute-toggle');
      if (!btn) {
        btn = document.createElement('button');
        btn.className = 'mute-toggle';
        btn.innerHTML = eyeOnSVG;
        btn.title = 'Mute — hide from client quote and adjust totals';
        btn.dataset.itemId = itemId;
        btn.dataset.isGroup = isGroup ? '1' : '0';

        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          toggleMute(itemId, isGroup, btn, li);
        });

        wrapper.appendChild(btn);
      }

      // Also set toggle button state from cache
      if (mutedIds.has(itemId)) {
        btn.className = 'mute-toggle muted';
        btn.innerHTML = eyeOffSVG;
        btn.title = 'Unmute — show on client quote';
      }

      // Hide-only toggle button (client hidden, totals unchanged)
      let hideBtn = wrapper.querySelector('.mute-toggle-hide');
      if (!hideBtn) {
        hideBtn = document.createElement('button');
        hideBtn.className = 'mute-toggle-hide';
        hideBtn.innerHTML = eyeHideOffSVG;
        hideBtn.title = 'Hide only — hide from client quote, keep money';
        hideBtn.dataset.itemId = itemId;
        hideBtn.dataset.isGroup = isGroup ? '1' : '0';

        hideBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          toggleHideOnly(itemId, isGroup, hideBtn, li);
        });

        wrapper.appendChild(hideBtn);
      }

      if (hideOnlyIds.has(itemId)) {
        hideBtn.classList.add('active');
        hideBtn.innerHTML = eyeHideOnSVG;
        hideBtn.title = 'Unhide — show on client quote';
      }
    });

    updateSummaryBar();
  }

  // ── Toggle mute on/off ────────────────────────────────────
  async function toggleMute(itemId, isGroup, btn, li) {
    if (processing.has(itemId)) return;
    processing.add(itemId);
    btn.classList.add('busy');

    try {
      // Fetch current item from API to get current name/description
      const data = await apiFetch(
        `https://api.current-rms.com/api/v1/opportunities/${oppId}/opportunity_items/${itemId}`
      );
      const item = data.opportunity_item;
      if (!item) throw new Error('Item not found');

      const currentlyMuted = isGroup
        ? /\[MUTED/.test(item.name || '')
        : /\[MUTED/.test(item.description || '');

      const newMuted = !currentlyMuted;

      // Update the appropriate field via API
      if (isGroup) {
        let name = item.name || '';
        if (newMuted && !/\[MUTED/.test(name)) {
          // Get the group's charge total to embed in the tag for Liquid template
          const charge = parseFloat(item.charge_excluding_tax_total) || 0;
          const tax = parseFloat(item.tax_total) || 0;
          name = name.trim() + ` [MUTED:${charge.toFixed(2)}:${tax.toFixed(2)}]`;
        } else if (!newMuted) {
          name = name.replace(/ ?\[MUTED[:\d.]*\]/g, '').trim();
        }
        await apiFetch(
          `https://api.current-rms.com/api/v1/opportunities/${oppId}/opportunity_items/${itemId}`,
          { method: 'PUT', body: JSON.stringify({ opportunity_item: { name } }) }
        );
        // Update DOM name display
        const nameEl = li.querySelector(':scope > table .group-name, :scope > table .dd-content.editable');
        if (nameEl) {
          nameEl.dataset.value = name;
          // Show clean name without tag in visible text
          nameEl.textContent = name.replace(/ ?\[MUTED[:\d.]*\]/g, '').trim();
        }
      } else {
        let desc = item.description || '';
        if (newMuted && !/\[MUTED/.test(desc)) {
          const charge = parseFloat(item.charge_excluding_tax_total) || 0;
          const tax = parseFloat(item.tax_total) || 0;
          desc = (desc ? desc + '\n' : '') + `[MUTED:${charge.toFixed(2)}:${tax.toFixed(2)}]`;
        } else if (!newMuted) {
          desc = desc.replace(/\n?\[MUTED[:\d.]*\]/g, '').trim();
        }
        await apiFetch(
          `https://api.current-rms.com/api/v1/opportunities/${oppId}/opportunity_items/${itemId}`,
          { method: 'PUT', body: JSON.stringify({ opportunity_item: { description: desc } }) }
        );
      }

      // Update button appearance
      btn.className = 'mute-toggle' + (newMuted ? ' muted' : '');
      btn.innerHTML = newMuted ? eyeOffSVG : eyeOnSVG;
      btn.title = newMuted ? 'Unmute — show on client quote' : 'Mute — hide from client quote';

      // Update mutedIds cache
      if (newMuted) {
        mutedIds.add(String(itemId));
        // Store charge values for total override (both groups and items)
        const charge = parseFloat(item.charge_excluding_tax_total) || 0;
        const tax = parseFloat(item.tax_total) || 0;
        mutedCharges[String(itemId)] = { charge, tax, depth: item.depth || 0, isGroup };
      } else {
        mutedIds.delete(String(itemId));
        delete mutedCharges[String(itemId)];
      }

      // Update row styling
      if (newMuted) {
        applyMutedStyle(li, isGroup);
      } else {
        removeMutedStyle(li, isGroup);
      }

      // If group, visually cascade to all children (no API calls — only parent needs the tag)
      if (isGroup) {
        cascadeVisualState(li, newMuted);
        // On unmute, also clean [MUTED...] tags from children via API (background, non-blocking)
        if (!newMuted) {
          cleanChildrenTags(li);
        }
      }

      console.log(`[Quote Mute] ${isGroup ? 'Group' : 'Item'} ${itemId} → ${newMuted ? 'MUTED (full)' : 'UNMUTED'}`);

    } catch (err) {
      console.error(`[Quote Mute] Error toggling ${itemId}:`, err);
    } finally {
      processing.delete(itemId);
      btn.classList.remove('busy');
      updateSummaryBar();
    }
  }

  // ── Hide-only toggle (no totals change) ─────────────────────
  async function toggleHideOnly(itemId, isGroup, btn, li) {
    if (processing.has('hide:' + itemId)) return;
    processing.add('hide:' + itemId);
    btn.classList.add('busy');

    try {
      const data = await apiFetch(
        `https://api.current-rms.com/api/v1/opportunities/${oppId}/opportunity_items/${itemId}`
      );
      const item = data.opportunity_item;
      if (!item) throw new Error('Item not found');

      const sourceText = isGroup ? (item.name || '') : (item.description || '');
      const currentlyHidden = new RegExp('\\' + HIDE_ONLY_TAG).test(sourceText);
      const newHidden = !currentlyHidden;

      if (isGroup) {
        let name = item.name || '';
        if (newHidden && !name.includes(HIDE_ONLY_TAG)) {
          name = name.trim() + ' ' + HIDE_ONLY_TAG;
        } else if (!newHidden) {
          name = name.replace(new RegExp('\\s*\\' + HIDE_ONLY_TAG, 'g'), '').trim();
        }
        await apiFetch(
          `https://api.current-rms.com/api/v1/opportunities/${oppId}/opportunity_items/${itemId}`,
          { method: 'PUT', body: JSON.stringify({ opportunity_item: { name } }) }
        );
        const nameEl = li.querySelector(':scope > table .group-name, :scope > table .dd-content.editable');
        if (nameEl) {
          nameEl.dataset.value = name;
          nameEl.textContent = name.replace(new RegExp('\\s*\\' + HIDE_ONLY_TAG, 'g'), '').trim();
        }
      } else {
        let desc = item.description || '';
        if (newHidden && !desc.includes(HIDE_ONLY_TAG)) {
          desc = (desc ? desc + '\n' : '') + HIDE_ONLY_TAG;
        } else if (!newHidden) {
          desc = desc.replace(new RegExp('\\n?\\s*\\' + HIDE_ONLY_TAG, 'g'), '').trim();
        }
        await apiFetch(
          `https://api.current-rms.com/api/v1/opportunities/${oppId}/opportunity_items/${itemId}`,
          { method: 'PUT', body: JSON.stringify({ opportunity_item: { description: desc } }) }
        );
      }

      if (newHidden) {
        hideOnlyIds.add(String(itemId));
        // If something was fully muted before, keep that state (this is additive)
        applyHideOnlyStyle(li, isGroup);
      } else {
        hideOnlyIds.delete(String(itemId));
        removeHideOnlyStyle(li, isGroup);
      }

      btn.classList.toggle('active', newHidden);
      btn.innerHTML = newHidden ? eyeHideOnSVG : eyeHideOffSVG;
      btn.title = newHidden
        ? 'Unhide — show on client quote'
        : 'Hide only — hide from client quote, keep money';

      console.log(`[Quote Mute] ${isGroup ? 'Group' : 'Item'} ${itemId} → ${newHidden ? 'HIDE-ONLY' : 'VISIBLE'}`);
    } catch (err) {
      console.error(`[Quote Mute] Error toggling hide-only ${itemId}:`, err);
    } finally {
      processing.delete('hide:' + itemId);
      btn.classList.remove('busy');
    }
  }

  // ── Fast visual cascade (DOM only, no API calls) ────────
  function cascadeVisualState(groupLi, shouldMute) {
    const descendants = groupLi.querySelectorAll('ol.cobra-grid li.grid-body-row[data-type="item"], ol.cobra-grid li.grid-body-row[data-type="group"]');
    descendants.forEach(childLi => {
      const isChildGroup = childLi.dataset.type === 'group';
      const childId = childLi.dataset.id;
      if (shouldMute) {
        applyMutedStyle(childLi, isChildGroup);
      } else {
        removeMutedStyle(childLi, isChildGroup);
        // Also clear from cache
        if (childId) {
          mutedIds.delete(childId);
          delete mutedCharges[childId];
        }
      }
      // Update toggle button appearance
      const childBtn = childLi.querySelector(':scope > table .mute-toggle');
      if (childBtn) {
        childBtn.className = 'mute-toggle' + (shouldMute ? ' muted' : '');
        childBtn.innerHTML = shouldMute ? eyeOffSVG : eyeOnSVG;
        childBtn.title = shouldMute ? 'Unmute — show on client quote' : 'Mute — hide from client quote';
      }
    });
  }

  // ── Clean [MUTED...] tags from all children via API (runs in background) ────
  async function cleanChildrenTags(groupLi) {
    const descendants = groupLi.querySelectorAll('ol.cobra-grid li.grid-body-row[data-type="item"], ol.cobra-grid li.grid-body-row[data-type="group"]');
    if (!descendants.length) return;

    const items = Array.from(descendants);
    const batchSize = 3;

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      await Promise.all(batch.map(async childLi => {
        const childId = childLi.dataset.id;
        if (!childId) return;

        try {
          const data = await apiFetch(
            `https://api.current-rms.com/api/v1/opportunities/${oppId}/opportunity_items/${childId}`
          );
          const child = data.opportunity_item;
          if (!child) return;

          const isChildGroup = childLi.dataset.type === 'group';
          let needsUpdate = false;
          let updatePayload = {};

          if (isChildGroup) {
            const name = child.name || '';
            if (/\[MUTED/.test(name)) {
              updatePayload = { name: name.replace(/ ?\[MUTED[:\d.]*\]/g, '').trim() };
              needsUpdate = true;
            }
          } else {
            const desc = child.description || '';
            if (/\[MUTED/.test(desc)) {
              updatePayload = { description: desc.replace(/\n?\[MUTED[:\d.]*\]/g, '').trim() };
              needsUpdate = true;
            }
          }

          if (needsUpdate) {
            await apiFetch(
              `https://api.current-rms.com/api/v1/opportunities/${oppId}/opportunity_items/${childId}`,
              { method: 'PUT', body: JSON.stringify({ opportunity_item: updatePayload }) }
            );
            console.log(`[Quote Mute] Cleaned tag from child ${childId}`);
          }
        } catch (err) {
          console.error(`[Quote Mute] Clean child ${childId} error:`, err);
        }
      }));

      if (i + batchSize < items.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }
    console.log(`[Quote Mute] Finished cleaning ${items.length} children`);
  }

  // ── Cascade mute to all children via API (used by Unmute All) ───────────────
  async function muteGroupChildren(groupLi, shouldMute) {
    // Find ALL descendant items and groups at any nesting level
    const allDescendants = Array.from(
      groupLi.querySelectorAll('ol.cobra-grid li.grid-body-row[data-type="item"], ol.cobra-grid li.grid-body-row[data-type="group"]')
    );
    if (!allDescendants.length) return;

    // Process in small batches to avoid API rate limits
    const batchSize = 3;
    for (let i = 0; i < allDescendants.length; i += batchSize) {
      const batch = allDescendants.slice(i, i + batchSize);
      await Promise.all(batch.map(async childLi => {
        const childId = childLi.dataset.id;
        const childType = childLi.dataset.type;
        if (!childId) return;

        const isChildGroup = childType === 'group';

        try {
          const data = await apiFetch(
            `https://api.current-rms.com/api/v1/opportunities/${oppId}/opportunity_items/${childId}`
          );
          const child = data.opportunity_item;
          if (!child) return;

          if (isChildGroup) {
            let name = child.name || '';
            if (shouldMute && !/\[MUTED/.test(name)) {
              const charge = parseFloat(child.charge_excluding_tax_total) || 0;
              const tax = parseFloat(child.tax_total) || 0;
              name = name.trim() + ` [MUTED:${charge.toFixed(2)}:${tax.toFixed(2)}]`;
            } else if (!shouldMute) {
              name = name.replace(/ ?\[MUTED[:\d.]*\]/g, '').trim();
            }
            await apiFetch(
              `https://api.current-rms.com/api/v1/opportunities/${oppId}/opportunity_items/${childId}`,
              { method: 'PUT', body: JSON.stringify({ opportunity_item: { name } }) }
            );
            // Clean visible name in DOM
            const nameEl = childLi.querySelector(':scope > table .group-name')
                        || childLi.querySelector(':scope > table .dd-content.editable');
            if (nameEl) {
              nameEl.textContent = name.replace(/ ?\[MUTED[:\d.]*\]/g, '').trim();
            }
          } else {
            let desc = child.description || '';
            if (shouldMute && !/\[MUTED/.test(desc)) {
              const charge = parseFloat(child.charge_excluding_tax_total) || 0;
              const tax = parseFloat(child.tax_total) || 0;
              desc = (desc ? desc + '\n' : '') + `[MUTED:${charge.toFixed(2)}:${tax.toFixed(2)}]`;
            } else if (!shouldMute) {
              desc = desc.replace(/\n?\[MUTED[:\d.]*\]/g, '').trim();
            }
            await apiFetch(
              `https://api.current-rms.com/api/v1/opportunities/${oppId}/opportunity_items/${childId}`,
              { method: 'PUT', body: JSON.stringify({ opportunity_item: { description: desc } }) }
            );
          }

          // Update cache
          if (shouldMute) {
            mutedIds.add(String(childId));
          } else {
            mutedIds.delete(String(childId));
          }

          // Update toggle button
          const childBtn = childLi.querySelector(':scope > table .mute-toggle');
          if (childBtn) {
            childBtn.className = 'mute-toggle' + (shouldMute ? ' muted' : '');
            childBtn.innerHTML = shouldMute ? eyeOffSVG : eyeOnSVG;
            childBtn.title = shouldMute ? 'Unmute — show on client quote' : 'Mute — hide from client quote';
          }

          // Update row styling
          if (shouldMute) {
            applyMutedStyle(childLi, isChildGroup);
          } else {
            removeMutedStyle(childLi, isChildGroup);
          }
        } catch (err) {
          console.error(`[Quote Mute] Child ${childId} error:`, err);
        }
      }));

      // Pause between batches to avoid 429
      if (i + batchSize < allDescendants.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }
  }

  // ── Styling helpers ───────────────────────────────────────
  function applyMutedStyle(li, isGroup) {
    li.classList.add(isGroup ? 'mute-group-dimmed' : 'mute-dimmed');

    // Find appropriate cell for the badge
    const nameCell = li.querySelector(':scope > table td.dd-name')
                  || li.querySelector(':scope > table .dd-content.editable')
                  || li.querySelector(':scope > table .group-name');
    if (nameCell && !nameCell.querySelector('.mute-badge')) {
      const badge = document.createElement('span');
      badge.className = 'mute-badge';
      badge.textContent = 'MUTED';
      nameCell.appendChild(badge);
    }

    // Clean [MUTED:xxx:xxx] from visible group/item name text
    if (isGroup) {
      const nameEl = li.querySelector(':scope > table .group-name')
                  || li.querySelector(':scope > table .dd-content.editable');
      if (nameEl) {
        const raw = nameEl.textContent || '';
        const cleaned = raw.replace(/\s*\[MUTED[:\d.]*\]/g, '').trim();
        if (cleaned !== raw.trim()) {
          nameEl.textContent = cleaned;
        }
      }
    } else {
      // For items, clean [MUTED:xxx:xxx] from description display
      const descEl = li.querySelector(':scope > table .dd-description, :scope > table td.dd-description, :scope > table .item-description');
      if (descEl) {
        const raw = descEl.textContent || '';
        const cleaned = raw.replace(/\s*\[MUTED[:\d.]*\]/g, '').trim();
        if (cleaned !== raw.trim()) {
          descEl.textContent = cleaned;
        }
      }
    }
  }

  function removeMutedStyle(li, isGroup) {
    li.classList.remove('mute-group-dimmed', 'mute-dimmed');
    // Remove badge from any location
    li.querySelectorAll(':scope > table .mute-badge').forEach(b => b.remove());
    // Also clean up children if ungrouping
    if (isGroup) {
      const childOl = li.querySelector(':scope > ol.cobra-grid');
      if (childOl) {
        childOl.querySelectorAll('.mute-badge').forEach(b => b.remove());
        childOl.querySelectorAll('.mute-dimmed, .mute-group-dimmed').forEach(el => {
          el.classList.remove('mute-dimmed', 'mute-group-dimmed');
        });
      }
    }
  }

  function applyHideOnlyStyle(li, isGroup) {
    // Reuse muted visual styles but without affecting totals
    li.classList.add(isGroup ? 'mute-group-dimmed' : 'mute-dimmed');

    const nameCell = li.querySelector(':scope > table td.dd-name')
                  || li.querySelector(':scope > table .dd-content.editable')
                  || li.querySelector(':scope > table .group-name');
    if (nameCell && !nameCell.querySelector('.mute-badge')) {
      const badge = document.createElement('span');
      badge.className = 'mute-badge';
      badge.textContent = 'MUTED';
      nameCell.appendChild(badge);
    }
  }

  function removeHideOnlyStyle(li, isGroup) {
    // Only strip styles if the row is not fully muted
    const id = li.dataset.id;
    if (id && mutedIds.has(id)) return;
    li.classList.remove('mute-group-dimmed', 'mute-dimmed');
    li.querySelectorAll(':scope > table .mute-badge').forEach(b => b.remove());
  }

  // ── API helper ────────────────────────────────────────────
  async function apiFetch(url, options = {}) {
    const headers = {
      'X-SUBDOMAIN': subdomain,
      'X-AUTH-TOKEN': apiKey,
      'Content-Type': 'application/json',
      ...options.headers
    };
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
    return res.json();
  }

  // ── Summary bar ───────────────────────────────────────────
  let summaryBar = null;

  function createSummaryBar() {
    if (document.querySelector('.mute-summary-bar')) return;
    summaryBar = document.createElement('div');
    summaryBar.className = 'mute-summary-bar';
    summaryBar.innerHTML = `
      <span class="ms-icon">👁‍🗨</span>
      <span class="ms-label">Quote Mute</span>
      <div class="ms-divider"></div>
      <span class="ms-count" id="muteCountText">No items muted</span>
      <button class="ms-unmute-all" id="muteUnmuteAll" title="Unmute all items">Unmute All</button>
    `;
    document.body.appendChild(summaryBar);

    summaryBar.querySelector('#muteUnmuteAll').addEventListener('click', async () => {
      const mutedBtns = document.querySelectorAll('.mute-toggle.muted');
      // Unmute groups first (top-level), then items
      const groups = [];
      const items = [];
      mutedBtns.forEach(btn => {
        const li = btn.closest('li.grid-body-row');
        if (btn.dataset.isGroup === '1') groups.push({ btn, li });
        else items.push({ btn, li });
      });
      // Unmute groups first (will cascade to children)
      for (const { btn, li } of groups) {
        if (li && !processing.has(btn.dataset.itemId)) {
          await toggleMute(btn.dataset.itemId, true, btn, li);
        }
      }
      // Then any remaining individually muted items
      for (const { btn, li } of items) {
        if (li && btn.classList.contains('muted') && !processing.has(btn.dataset.itemId)) {
          await toggleMute(btn.dataset.itemId, false, btn, li);
        }
      }
    });
  }

  function updateSummaryBar() {
    if (!summaryBar) return;
    const mutedCount = mutedIds.size;
    const countText = summaryBar.querySelector('#muteCountText');

    if (mutedCount > 0) {
      summaryBar.classList.add('visible');
      countText.textContent = `${mutedCount} item${mutedCount !== 1 ? 's' : ''} muted from client quote`;
    } else {
      summaryBar.classList.remove('visible');
    }

    // Update the opportunity total on the page
    updatePageTotal();
  }

  // ── Override the page total to reflect muted items ─────────
  let originalTotal = null;

  function updatePageTotal() {
    // Sum muted charges, skipping nested children of already-counted parents
    const entries = Object.entries(mutedCharges).sort((a, b) => (a[1].depth || 0) - (b[1].depth || 0));
    const countedIds = new Set();
    let mutedChargeSum = 0;
    let mutedTaxSum = 0;

    for (const [id, info] of entries) {
      const li = document.querySelector(`#opportunity_items_body li.grid-body-row[data-id="${id}"]`);
      if (li) {
        let isNested = false;
        let parentLi = li.parentElement && li.parentElement.closest('li.grid-body-row[data-type="group"]');
        while (parentLi) {
          if (countedIds.has(parentLi.dataset.id)) {
            isNested = true;
            break;
          }
          parentLi = parentLi.parentElement && parentLi.parentElement.closest('li.grid-body-row[data-type="group"]');
        }
        if (isNested) continue;
      }

      mutedChargeSum += info.charge || 0;
      mutedTaxSum += info.tax || 0;
      countedIds.add(id);
    }

    // ── Update bottom total (Deal Price = charge ex tax) ─────
    const totalCell = document.querySelector('td.opportunity-total');
    if (totalCell) {
      const totalSpan = totalCell.querySelector('span');
      if (totalSpan) {
        if (originalTotal === null) {
          const raw = totalSpan.textContent.replace(/[^0-9.\-]/g, '');
          originalTotal = parseFloat(raw) || 0;
        }

        // Deal price is ex-tax, so only subtract muted charge (not tax)
        const activeTotal = originalTotal - mutedChargeSum;

        if (mutedChargeSum > 0) {
          totalSpan.textContent = fmtCur(activeTotal);
          let indicator = totalCell.querySelector('.mute-total-indicator');
          if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'mute-total-indicator';
            indicator.style.cssText = 'font-size:9px; color:#ff4d6a; font-weight:600; margin-top:2px;';
            totalCell.appendChild(indicator);
          }
          indicator.textContent = `was ${fmtCur(originalTotal)}`;
        } else {
          totalSpan.textContent = fmtCur(originalTotal);
          const indicator = totalCell.querySelector('.mute-total-indicator');
          if (indicator) indicator.remove();
        }
      }
    }

    // ── Update revenue panel (top right sidebar) ─────────────
    updateRevenuePanel(mutedChargeSum, mutedTaxSum);
  }

  // ── Revenue panel override ─────────────────────────────────
  const originalRevenue = {};

  function updateRevenuePanel(mutedCharge, mutedTax) {
    // CurrentRMS revenue panel uses div.stat elements with specific IDs
    const overrides = {
      'rental_charge_total':         mutedCharge,
      'charge_excluding_tax_total':  mutedCharge,
      'tax_total':                   mutedTax,
      'charge_including_tax_total':  mutedCharge + mutedTax,
    };

    for (const [id, subtract] of Object.entries(overrides)) {
      const el = document.getElementById(id);
      if (!el) continue;

      // Store original value on first run
      if (originalRevenue[id] === undefined) {
        const raw = el.textContent.replace(/[^0-9.\-]/g, '');
        originalRevenue[id] = parseFloat(raw) || 0;
      }

      if (subtract > 0) {
        const active = originalRevenue[id] - subtract;
        el.textContent = fmtCur(active);
        el.style.color = '#ff4d6a';

        // Add "was" indicator below
        let indicator = el.parentElement.querySelector('.mute-revenue-indicator');
        if (!indicator) {
          indicator = document.createElement('div');
          indicator.className = 'mute-revenue-indicator';
          indicator.style.cssText = 'font-size:9px; color:#ff4d6a; font-weight:600; opacity:0.7; margin-top:1px;';
          el.parentElement.insertBefore(indicator, el.nextSibling);
        }
        indicator.textContent = `was ${fmtCur(originalRevenue[id])}`;
      } else {
        el.textContent = fmtCur(originalRevenue[id]);
        el.style.color = '';
        const indicator = el.parentElement.querySelector('.mute-revenue-indicator');
        if (indicator) indicator.remove();
      }
    }
  }

  function fmtCur(amount) {
    const isNegative = amount < 0;
    const abs = Math.abs(amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return isNegative ? `-$${abs}` : `$${abs}`;
  }

  // ── Sync mute states from API on page load ────────────────
  // Fetches all items and populates mutedIds, then re-injects toggles
  async function syncMuteStates() {
    if (!apiKey || !oppId) return;
    try {
      let page = 1;
      let allItems = [];
      while (true) {
        const data = await apiFetch(
          `https://api.current-rms.com/api/v1/opportunities/${oppId}/opportunity_items?per_page=100&page=${page}`
        );
        const items = data.opportunity_items || [];
        allItems = allItems.concat(items);
        if (items.length < 100) break;
        page++;
      }

      // Build the mutedIds and hideOnlyIds sets from API data
      if (allItems.length > 0) {
        console.log('[Quote Mute] Sample API item fields:', Object.keys(allItems[0]));
        console.log('[Quote Mute] Sample API item:', JSON.stringify(allItems[0]).substring(0, 500));
        // Find item with MUTED in any field for debugging
        const anyMuted = allItems.find(i => JSON.stringify(i).includes('MUTED'));
        if (anyMuted) console.log('[Quote Mute] Found muted item in API:', JSON.stringify(anyMuted).substring(0, 500));
        else console.log('[Quote Mute] No item contains MUTED in any field!');
      }
      hideOnlyIds = new Set();
      for (const item of allItems) {
        // Groups have opportunity_item_type === 0 (Group), items have 1 (Principal) or 2 (Accessory)
        const isGroup = item.opportunity_item_type === 0 || item.opportunity_item_type_name === 'Group';
        const name = item.name || '';
        const desc = item.description || '';
        
        // Check both name and description for any item type
        const isMuted = /\[MUTED/.test(name) || /\[MUTED/.test(desc);
        const isHideOnly = name.includes(HIDE_ONLY_TAG) || desc.includes(HIDE_ONLY_TAG);

        if (isMuted) {
          mutedIds.add(String(item.id));
          // Extract charge values for total override
          // Check both name (groups) and description (items) for the tag
          const match = (name + ' ' + desc).match(/\[MUTED:([\d.]+):([\d.]+)\]/);
          if (match) {
            mutedCharges[String(item.id)] = {
              charge: parseFloat(match[1]) || 0,
              tax: parseFloat(match[2]) || 0,
              depth: item.depth || 0,
              isGroup: isGroup
            };
          } else {
            // Fallback — read charge from API fields
            const charge = parseFloat(item.charge_excluding_tax_total) || 0;
            const tax = parseFloat(item.tax_total) || 0;
            if (charge > 0 || tax > 0) {
              mutedCharges[String(item.id)] = {
                charge, tax,
                depth: item.depth || 0,
                isGroup: isGroup
              };
            }
          }
        }

        if (isHideOnly) {
          hideOnlyIds.add(String(item.id));
        }
      }

      console.log(`[Quote Mute] Synced ${mutedIds.size} muted items, ${Object.keys(mutedCharges).length} charge entries from API`);
      console.log('[Quote Mute] mutedIds:', [...mutedIds]);
      console.log('[Quote Mute] mutedCharges:', JSON.stringify(mutedCharges));
      
      // Log DOM IDs for comparison
      const domIds = [];
      document.querySelectorAll('#opportunity_items_body li.grid-body-row').forEach(li => {
        if (li.dataset.id) domIds.push({ id: li.dataset.id, type: li.dataset.type });
      });
      console.log('[Quote Mute] DOM item IDs:', JSON.stringify(domIds.slice(0, 20)));
      console.log('[Quote Mute] Match test:', [...mutedIds].map(id => ({
        id, inDOM: domIds.some(d => d.id === id)
      })));

      // Re-inject toggles — this will apply muted state from the cache
      injectToggles();

      // Explicitly update totals (don't rely on summary bar toggle count)
      updatePageTotal();

    } catch (err) {
      console.warn('[Quote Mute] Sync error:', err && err.message ? err.message : err, err);
      // Still try to apply any cached mute state from a previous successful sync
      if (mutedIds.size > 0) {
        try {
          injectToggles();
          updatePageTotal();
        } catch (e) { /* ignore */ }
      }
    }
  }

  // ── Enable/Disable the mute UI ──────────────────────────
  function enableMuteUI() {
    init();
    // Wait for DOM to settle, then sync. Retry multiple times in case items loaded late.
    setTimeout(() => syncMuteStates(), 2500);
    setTimeout(() => {
      // Re-apply in case DOM rebuilt after initial sync
      if (mutedIds.size > 0) {
        injectToggles();
        updatePageTotal();
      }
    }, 5000);
    setTimeout(() => {
      // Final pass for slow-loading pages
      if (mutedIds.size > 0) {
        injectToggles();
        updatePageTotal();
      }
    }, 10000);
  }

  function disableMuteUI() {
    // Remove all mute toggles
    document.querySelectorAll('.mute-toggle').forEach(btn => btn.remove());
    document.querySelectorAll('.mute-toggle-hide').forEach(btn => btn.remove());
    // Remove all muted styles
    document.querySelectorAll('.mute-dimmed, .mute-group-dimmed').forEach(el => {
      el.classList.remove('mute-dimmed', 'mute-group-dimmed');
    });
    // Remove badges
    document.querySelectorAll('.mute-badge').forEach(b => b.remove());
    // Remove summary bar
    const bar = document.querySelector('.mute-summary-bar');
    if (bar) bar.remove();
    summaryBar = null;
    // Remove injected styles
    const style = document.getElementById('rms-mute-style');
    if (style) style.remove();
    // Restore page total
    if (originalTotal !== null) {
      const totalSpan = document.querySelector('td.opportunity-total span');
      if (totalSpan) totalSpan.textContent = fmtCur(originalTotal);
      const indicator = document.querySelector('.mute-total-indicator');
      if (indicator) indicator.remove();
    }
    // Restore revenue panel
    for (const [id, val] of Object.entries(originalRevenue)) {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = fmtCur(val);
        el.style.color = '';
      }
    }
    document.querySelectorAll('.mute-revenue-indicator').forEach(i => i.remove());
    mutedIds = new Set();
    hideOnlyIds = new Set();
    console.log('[Quote Mute] Disabled');
  }

  // ── Listen for toggle messages from popup ──────────────────
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'quoteMuteToggle') {
        if (msg.enabled) {
          enableMuteUI();
        } else {
          disableMuteUI();
        }
      }
    });
  }

  // ── Entry point ───────────────────────────────────────────
  if (window.location.pathname.match(/\/opportunities\/\d+/)) {
    // Check if mute is enabled in settings (default: true)
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(['quoteMuteEnabled'], (result) => {
        if (result.quoteMuteEnabled !== false) {
          console.log('[Quote Mute] Initializing on opportunity', window.location.pathname);
          enableMuteUI();
        } else {
          console.log('[Quote Mute] Disabled in settings, skipping');
        }
      });
    } else {
      // Fallback if chrome.storage not available (shouldn't happen in extension)
      enableMuteUI();
    }
  }
})();
