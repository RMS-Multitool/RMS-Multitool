// ── RMS Multitool — Event Sheet Preview Page ─────────────────────────────────
// Full chrome API access — print and PDF work natively here.

// A4 content height in CSS px at 96 dpi, minus 22mm top + 22mm bottom margin
const A4_CONTENT_H = 957; // 1123px page - 83px top - 83px bottom

let previewData = null;

// ── Load preview data from storage ───────────────────────────────────────────
chrome.storage.local.get('eventSheetPreview', function (result) {
  previewData = result.eventSheetPreview;

  if (!previewData || !previewData.docHtml) {
    document.getElementById('loading').textContent = 'No preview data found. Please reopen from the Event Sheet.';
    return;
  }

  // Set page title and toolbar title
  const title = previewData.title || 'Event Sheet';
  document.title = title + ' — Preview';
  document.getElementById('tb-title').textContent = title;

  // Inject print CSS into <head>
  const style = document.createElement('style');
  style.textContent = previewData.printCss || '';
  document.head.appendChild(style);

  // Build pages
  buildPages(previewData.docHtml, previewData.sitePlanAppendixHtml || '');
});

// ── Page builder ─────────────────────────────────────────────────────────────
function buildPages(docHtml, sitePlanHtml) {
  const sandbox = document.getElementById('measure-sandbox');
  const scrollArea = document.getElementById('scroll-area');

  // Render doc into sandbox for measurement
  sandbox.innerHTML = docHtml;

  // Walk top-level children and group into A4-height pages
  const children = Array.from(sandbox.children);
  const pages = [];
  let currentPageEls = [];
  let currentH = 0;

  children.forEach(function (el) {
    const h = el.getBoundingClientRect().height + parseFloat(getComputedStyle(el).marginBottom || 0);

    // If this element alone is taller than a page, it gets its own page
    if (h >= A4_CONTENT_H) {
      if (currentPageEls.length) { pages.push(currentPageEls); currentPageEls = []; currentH = 0; }
      pages.push([el]);
      return;
    }

    // If adding this element would overflow the page, start a new page
    if (currentH + h > A4_CONTENT_H && currentPageEls.length) {
      pages.push(currentPageEls);
      currentPageEls = [];
      currentH = 0;
    }

    currentPageEls.push(el);
    currentH += h;
  });
  if (currentPageEls.length) pages.push(currentPageEls);

  // Clear scroll area and render each page as a card
  scrollArea.innerHTML = '';

  pages.forEach(function (els, idx) {
    const pageDiv = document.createElement('div');
    pageDiv.className = 'preview-page';
    pageDiv.setAttribute('data-page', idx + 1);

    els.forEach(function (el) {
      pageDiv.appendChild(el.cloneNode(true));
    });

    scrollArea.appendChild(pageDiv);
  });

  // Site plan appendix — one preview page per attachment so nothing gets clipped
  const appendixItems = previewData.sitePlanAppendixItems
    || (previewData.sitePlanAppendixHtml ? [previewData.sitePlanAppendixHtml] : []);
  appendixItems.forEach(function(itemHtml) {
    if (!itemHtml) return;
    const spDiv = document.createElement('div');
    spDiv.className = 'preview-page';
    spDiv.innerHTML = itemHtml;
    scrollArea.appendChild(spDiv);
  });

  sandbox.innerHTML = '';
}

// ── Print ─────────────────────────────────────────────────────────────────────
document.getElementById('btn-print').addEventListener('click', function () {
  window.print();
});

// ── Download PDF ──────────────────────────────────────────────────────────────
document.getElementById('btn-pdf').addEventListener('click', function () {
  if (!previewData) return;

  const btn = document.getElementById('btn-pdf');
  const toast = document.getElementById('tb-toast');

  btn.disabled = true;
  btn.textContent = '⏳ Generating…';
  toast.textContent = 'Generating PDF — this takes a few seconds…';

  // Large PDF data (HTML + site plan URLs) was cached in background.js memory when preview opened.
  // Just send the action — background.js uses its in-memory cache automatically.
  chrome.runtime.sendMessage(
    {
      action: 'generatePdf',
      filename: previewData.filename
    },
    function (resp) {
      btn.disabled = false;
      btn.textContent = '📥 Download PDF';
      if (resp && resp.success) {
        toast.textContent = '✓ PDF saved to Downloads';
        setTimeout(function () { toast.textContent = ''; }, 4000);
      } else {
        toast.textContent = '✗ PDF failed: ' + (resp ? resp.error : 'No response');
      }
    }
  );
});

// ── Close ─────────────────────────────────────────────────────────────────────
document.getElementById('btn-close').addEventListener('click', function () {
  window.close();
});
