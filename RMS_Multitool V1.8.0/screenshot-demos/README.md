# Screenshot demos for Chrome Web Store

These HTML files are **static mockups** of RMS Multitool features. They use **fake data only** — no connection to Current RMS or your real data. Use them to take store listing screenshots without exposing private information.

## Demo files

| File | What it shows |
|------|----------------|
| `popup-demo.html` | **Extension menu** — settings popup: API, Stock Display Mode, License, Quote Mute, Stores, dashboard buttons |
| `stock-display-demo.html` | **Multi-store stock** — product rows with Simple mode (📦 store totals) and Date-Aware mode (coloured tags + tooltip showing which quotes hold stock) |
| `mute-demo.html` | **Quote Mute** — opportunity item table with $ and eye toggles; muted row shown dimmed |
| `quote-dashboard-demo.html` | Quote Dashboard — Draft · Prov. quote · Reserved kanban |
| `crew-dashboard-demo.html` | Crew & Vehicle Dashboard — crew/transport by stage |
| `warehouse-demo.html` | Warehouse Dashboard — Ready to prep · In prep · Ready to load |

## How to use

1. **Open in Chrome**  
   Double-click an HTML file, or drag it into a Chrome window, or use **File → Open file** and choose the demo you want.

2. **Take screenshots**  
   - Resize the window to the size you want (e.g. **1280×800** for Chrome Web Store screenshots).
   - Use your OS screenshot tool (e.g. Cmd+Shift+4 on Mac) or a browser extension.
   - The small “Screenshot demo — fake data only” badge in the bottom-right can be cropped out or left in.
   - For **Extension menu**: the popup is centered on a dark background; capture the whole window or crop to the panel.
   - For **Stock display**: the second product row shows the tooltip already visible for the "FOHP Aus" tag.

3. **Do not include this folder in the extension ZIP**  
   These files are for your use only. Exclude the `screenshot-demos` folder when you zip the extension for the Chrome Web Store.

## Other options (if you prefer)

- **Blur/redact:** Take screenshots of the real extension or Current RMS, then blur names, refs, and dates in an image editor.
- **Current RMS sandbox:** If you have a test/sandbox instance, add fake opportunities there and screenshot that.
