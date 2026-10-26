import { shoot } from "./shoot.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const DASH = "http://localhost:3000/?q=gloves";
const PANEL = pathToFileURL(join(here, "harness", "sidepanel.html")).href;

const jobs = [
  { name: "shot1-dashboard-results-1280x800", url: DASH, width: 1280, height: 800, scrollTo: 640, waitMs: 8000, settleMs: 2000 },
  {
    name: "shot2-dashboard-modal-1280x800", url: DASH, width: 1280, height: 800, waitMs: 8000,
    action: `var b=document.querySelector('#results .product-card .info-btn:not(.list-btn)'); if(b){b.click(); 'clicked'} else {'no-button'}`,
    check: `JSON.stringify({hidden: document.querySelector('#detailModal').hidden, cards: document.querySelectorAll('#results .product-card').length, bodyLen: document.querySelector('#modalBody').innerHTML.length})`,
    actionWaitMs: 9000
  },
  { name: "shot3-sidepanel-640x400", url: PANEL, width: 640, height: 400, waitMs: 8000, scrollTo: 340, settleMs: 2000, check: `JSON.stringify({cards: document.querySelectorAll('#results .product-card, #results .item').length, status: document.querySelector('#status').textContent.slice(0,60)})` },
  {
    name: "shot4-dashboard-filters-1280x800", url: DASH, width: 1280, height: 800,
    waitMs: 8000, scrollTo: 300, settleMs: 600,
    action: `var d=document.querySelector('details.filters'); if(d){d.open=true;} var q=document.querySelector('#fQuickDelivery'); if(q && !q.checked){q.checked=true;} document.querySelector('#searchForm').requestSubmit(); 'ok'`,
    check: `JSON.stringify({open: document.querySelector('details.filters').open, quick: (document.querySelector('#fQuickDelivery')||{}).checked, cards: document.querySelectorAll('#results .product-card').length, badges: document.querySelectorAll('.quick-delivery').length})`,
    actionWaitMs: 9000
  },
  {
    name: "shot5-settings-1280x800", url: DASH, width: 1280, height: 800, waitMs: 8000,
    action: `var b=document.querySelector('#settingsBtn'); if(b){b.click(); 'clicked'} else {'no-button'}`,
    check: `JSON.stringify({open: !document.querySelector('#settingsModal').hidden, meta: (document.querySelector('#cjKeyMeta')||{}).textContent})`,
    actionWaitMs: 3000
  }
];

const only = process.argv.slice(2);

for (const j of jobs) {
  if (only.length && !only.some((o) => j.name.includes(o))) continue;
  const out = join(here, `${j.name}.png`);
  try {
    const r = await shoot({ ...j, out });
    console.log("OK  " + j.name + (r.actionResult ? " | action=" + r.actionResult : "") + (r.checkResult ? " | check=" + r.checkResult : ""));
  } catch (e) {
    console.log("FAIL " + j.name + " -> " + e.message);
  }
}
