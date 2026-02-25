// background.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'fetchStock') {

        chrome.storage.sync.get(['subdomain', 'apiKey', 'storeConfig'], (settings) => {
            const API_KEY   = settings.apiKey;
            const SUBDOMAIN = settings.subdomain;
            const storeConfig = settings.storeConfig || {};

            if (!API_KEY || !SUBDOMAIN) {
                sendResponse({ success: false, error: 'not_configured' });
                return;
            }

            // Only query stores that are toggled ON
            const enabledStoreIds = Object.entries(storeConfig)
                .filter(([, cfg]) => cfg.enabled)
                .map(([id]) => parseInt(id));

            if (enabledStoreIds.length === 0) {
                sendResponse({ success: false, error: 'no_stores' });
                return;
            }

            const url = `https://api.current-rms.com/api/v1/stock_levels?q[item_id_eq]=${request.productId}&per_page=200`;

            fetch(url, {
                method: 'GET',
                headers: {
                    'X-SUBDOMAIN': SUBDOMAIN,
                    'X-AUTH-TOKEN': API_KEY,
                    'Content-Type': 'application/json'
                }
            })
            .then(res => res.json())
            .then(data => {
                const storeTotals = {};
                enabledStoreIds.forEach(id => storeTotals[id] = 0);

                if (data && data.stock_levels) {
                    data.stock_levels.forEach(level => {
                        // Only count real physical stock — exclude Non-Stock (10), Group Booking (30), Sub-Rent (40)
                        if (enabledStoreIds.includes(level.store_id) &&
                            level.stock_category !== 10 &&
                            level.stock_category !== 30 &&
                            level.stock_category !== 40) {
                            storeTotals[level.store_id] += parseFloat(level.quantity_held) || 0;
                        }
                    });
                }

                const results = enabledStoreIds.map(storeId => ({
                    store_id: storeId,
                    available: storeTotals[storeId]
                }));

                sendResponse({ success: true, stores: results });
            })
            .catch(err => {
                console.error('Fetch error:', err);
                sendResponse({ success: false, stores: [] });
            });
        });

        return true;
    }
});
