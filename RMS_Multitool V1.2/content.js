// content.js

let storeNames = {};

// Load store names from saved config
chrome.storage.sync.get(['storeConfig'], (result) => {
    if (result.storeConfig) {
        Object.entries(result.storeConfig).forEach(([id, cfg]) => {
            if (cfg.name) storeNames[parseInt(id)] = cfg.name;
        });
    }
});

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

const observer = new MutationObserver(() => scanAndInject());
observer.observe(document.body, { childList: true, subtree: true });
scanAndInject();
