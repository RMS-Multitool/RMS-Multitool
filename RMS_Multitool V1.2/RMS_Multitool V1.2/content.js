// content.js — RMS Multitool (stock checker + dashboard nav tab)

let storeNames = {};

// Load store names from saved config
chrome.storage.sync.get(['storeConfig'], (result) => {
    if (result.storeConfig) {
        Object.entries(result.storeConfig).forEach(([id, cfg]) => {
            if (cfg.name) storeNames[parseInt(id)] = cfg.name;
        });
    }
});

// ── Multi-store stock checker ──────────────────────────────
function scanAndInject() {
    const itemInputs = document.querySelectorAll('input[id$="item_id"]:not([id*="parent"])');
    
    itemInputs.forEach(idInput => {
        const rowElement = idInput.closest('tr');
        if (!rowElement) return;

        let targetCell = rowElement.querySelector('.item-shortage, .item-available, .label')?.parentElement;
        
        if (!targetCell) {
            const tds = rowElement.querySelectorAll('td.optional-01');
            targetCell = tds.length > 1 ? tds[1] : null;
        }

        if (!targetCell || targetCell.querySelector('.multi-store-stock')) return; 
        
        const productId = idInput.value;

        if (productId) {
            const stockDiv = document.createElement('div');
            stockDiv.className = 'multi-store-stock';
            stockDiv.style.cssText = 'font-size: 0.85em; color: #0056b3; margin-top: 6px; font-weight: bold; line-height: 1.2;';
            stockDiv.innerHTML = `<em>Checking stores...</em>`; 
            targetCell.appendChild(stockDiv);

            chrome.runtime.sendMessage({ action: 'fetchStock', productId }, response => {
                if (!response) {
                    stockDiv.innerHTML = `❌ No response`;
                    return;
                }
                if (response.error === 'not_configured') {
                    stockDiv.style.color = '#e67e22';
                    stockDiv.innerHTML = `⚙️ Click extension icon to configure`;
                    return;
                }
                if (response.error === 'no_stores') {
                    stockDiv.style.color = '#e67e22';
                    stockDiv.innerHTML = `⚙️ No stores enabled — check settings`;
                    return;
                }
                if (response.success && response.stores) {
                    const availableStores = response.stores.filter(s => s.available > 0);
                    if (availableStores.length > 0) {
                        const storeStrings = availableStores.map(s => {
                            const name = storeNames[s.store_id] || `Store ${s.store_id}`;
                            return `${name}: ${s.available}`;
                        });
                        stockDiv.innerHTML = `📦 ` + storeStrings.join(' | ');
                    } else {
                        stockDiv.innerHTML = `📦 No available stock`;
                    }
                } else {
                    stockDiv.innerHTML = `❌ No Data`;
                }
            });
        }
    });
}

// ── Dashboard tab in CurrentRMS navigation ─────────────────
let dashboardTabInjected = false;

function getDashboardUrl() {
    return chrome.runtime.getURL('dashboard.html');
}

function injectDashboardTab() {
    if (dashboardTabInjected) return;

    // CurrentRMS uses a top nav bar — try multiple selectors to find it
    // The main nav typically contains links like "Opportunities", "Products", etc.
    const navSelectors = [
        // CurrentRMS specific selectors (Rails app patterns)
        'nav .navbar-nav',
        '.navbar-nav',
        'nav ul.nav',
        '.nav.navbar-nav',
        '#main-nav ul',
        '.top-nav ul',
        'header nav ul',
        'nav.navbar ul',
        // Generic top nav bar patterns
        '.navbar ul:not(.dropdown-menu)',
        'nav:first-of-type ul:first-of-type'
    ];

    let navList = null;
    for (const selector of navSelectors) {
        const candidates = document.querySelectorAll(selector);
        for (const el of candidates) {
            // Verify this looks like a real nav (has <li> children with <a> links)
            const links = el.querySelectorAll(':scope > li > a');
            if (links.length >= 2) {
                navList = el;
                break;
            }
        }
        if (navList) break;
    }

    if (!navList) return; // Nav not found yet — observer will retry

    // Check if we already added it
    if (navList.querySelector('.rms-multitool-dashboard-tab')) return;

    // Clone styling from an existing tab to perfectly match
    const existingTab = navList.querySelector(':scope > li');
    const li = document.createElement('li');
    li.className = 'rms-multitool-dashboard-tab';

    // Copy the existing li's classes and computed styles if available
    if (existingTab) {
      // Copy all classes from the existing tab's <li>
      for (const cls of existingTab.classList) {
        if (cls !== 'active' && cls !== 'current') li.classList.add(cls);
      }
    }

    // Apply the green top border and remove any unwanted borders/outlines
    li.style.borderTop = '3px solid #00e5a0';
    li.style.borderBottom = 'none';
    li.style.borderLeft = 'none';
    li.style.borderRight = 'none';

    const a = document.createElement('a');
    a.href = getDashboardUrl();
    a.target = '_blank';
    a.textContent = 'Quote Dashboard';
    a.title = 'RMS Multitool — Quote Dashboard';

    // Copy classes from an existing tab's <a> to inherit font/padding/color
    const existingLink = existingTab ? existingTab.querySelector(':scope > a') : null;
    if (existingLink) {
      for (const cls of existingLink.classList) {
        a.classList.add(cls);
      }
      // Also grab computed styles as fallback
      const cs = window.getComputedStyle(existingLink);
      a.style.cssText = `
        font-size: ${cs.fontSize} !important;
        font-family: ${cs.fontFamily} !important;
        font-weight: ${cs.fontWeight} !important;
        color: ${cs.color} !important;
        padding: ${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft} !important;
        line-height: ${cs.lineHeight} !important;
        text-decoration: none !important;
        display: ${cs.display} !important;
        text-transform: ${cs.textTransform} !important;
        letter-spacing: ${cs.letterSpacing} !important;
        outline: none !important;
        border: none !important;
        box-shadow: none !important;
      `;
    }

    // Inject a style tag to kill visited/focus purple on our link
    if (!document.querySelector('#rms-multitool-nav-style')) {
      const style = document.createElement('style');
      style.id = 'rms-multitool-nav-style';
      style.textContent = `
        .rms-multitool-dashboard-tab,
        .rms-multitool-dashboard-tab a,
        .rms-multitool-dashboard-tab a:visited,
        .rms-multitool-dashboard-tab a:focus,
        .rms-multitool-dashboard-tab a:active,
        .rms-multitool-dashboard-tab a:hover {
          text-decoration: none !important;
          outline: none !important;
          box-shadow: none !important;
          border-bottom: none !important;
          border-left: none !important;
          border-right: none !important;
        }
      `;
      document.head.appendChild(style);
    }

    li.appendChild(a);
    navList.appendChild(li);
    dashboardTabInjected = true;
    console.log('[RMS Multitool] Dashboard tab injected into navigation bar');
}

// ── Run on page load and watch for dynamic changes ─────────
const observer = new MutationObserver(() => {
    scanAndInject();
    if (!dashboardTabInjected) injectDashboardTab();
});
observer.observe(document.body, { childList: true, subtree: true });
scanAndInject();
injectDashboardTab();
