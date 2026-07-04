// ============================================================
// Market Wire — latest headlines for ACTIVE tickers only,
// filtered hard: keep only material news and rumors, label
// each item with which one it is, drop opinion/fluff pieces.
// Source: Yahoo Finance search API (free, no key) through the
// same CORS mirrors the price feed uses.
// ============================================================

import { DEMO } from "./config.js";
import { proxiedJson } from "./prices.js";

const NEWS_REFRESH_MS = 5 * 60 * 1000;   // headlines refresh every 5 min
const MAX_PER_TICKER = 3, MAX_TOTAL = 12;

// Rumors: unconfirmed, sourced-whisper language.
const rumorRe = /\b(rumor|rumour|reportedly|sources?\s+say|people\s+familiar|in\s+talks|speculat\w*|mulls?|weighs?|considering|exploring|eyeing|said\s+to\s+be|leak\w*|unconfirmed|report:)\b/i;
// Material: things that actually move a stock.
const materialRe = /\b(earnings|revenue|profits?|guidance|outlook|forecast|beats?|misses|acquir\w+|acquisition|merger|buyout|takeover|deal|contract|order|partnership|FDA|approv\w+|clearance|lawsuit|sues?|settle\w+|SEC|probe|investigat\w+|upgrades?d?|downgrades?d?|price\s+target|layoffs?|job\s+cuts|CEO|CFO|resigns?|appoints?|steps\s+down|dividend|stock\s+split|buyback|bankruptc\w+|delist\w+|recall|breach|hack\w+|launch\w+|unveil\w+|wins?|awarded|patent|results|halts?|short\s+report|stake|funding|milestone|record\s+(?:high|revenue|quarter)|announces|expands?|rolls?\s+out|signs?|secures?|delivers|ships|begins|starts\s+production|opens|prices?\s+offering|raises\s+\$)\b/i;
// Fluff/opinion: never show these.
const fluffRe = /\b(should\s+you|why\s+(?:you|i)\b|\d+\s+reasons?|best\s+stocks?|top\s+\d+|smartest|prediction|history\s+says|here'?s\s+(?:why|how|what)|opinion|vs\.?\s|could\s+make\s+you|millionaire|if\s+you'?d\s+invested|is\s+it\s+a\s+buy|buy\s+(?:now|before)|motley)\b/i;

function classify(title) {
  if (fluffRe.test(title)) return null;
  if (rumorRe.test(title)) return "rumor";
  if (materialRe.test(title)) return "material";
  return null;
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function timeAgo(unixSec) {
  const m = Math.max(1, Math.round((Date.now() / 1000 - unixSec) / 60));
  if (m < 60) return m + "m ago";
  const h = Math.round(m / 60);
  if (h < 36) return h + "h ago";
  return Math.round(h / 24) + "d ago";
}

let watchlist = [];   // [{tk, name}] for active positions
let timer = null;

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A headline only counts if it actually names the company or
// ticker — Yahoo's relatedTickers are too loose on their own.
function relevanceRe({ tk, name }) {
  const alts = [escRe(tk)];
  const clean = (name || "").replace(/\b(inc|corp|corporation|ltd|plc|co)\.?$/i, "").trim();
  if (clean) alts.push(escRe(clean));
  const first = clean.split(/\s+/)[0];
  if (first && first.length >= 5) alts.push(escRe(first));
  return new RegExp("\\b(" + alts.join("|") + ")\\b", "i");
}

// Called whenever the active positions change.
export function watchNews(list) {
  const next = list.map(t => ({ tk: t.ticker, name: t.name || "" }))
    .sort((a, b) => a.tk.localeCompare(b.tk));
  const sig = next.map(x => x.tk).join();
  const prev = watchlist.map(x => x.tk).join();
  watchlist = next;
  if (sig === prev) return;
  refresh();
  clearInterval(timer);
  if (watchlist.length) timer = setInterval(refresh, NEWS_REFRESH_MS);
}

async function refresh() {
  const box = document.getElementById("newsList");
  if (!box) return;
  if (!watchlist.length) {
    box.innerHTML = `<div class="empty">No active calls — the wire lights up when a position opens.</div>`;
    return;
  }
  const items = DEMO ? demoItems() : await fetchAll();
  render(box, items);
}

async function fetchAll() {
  const seen = new Set();
  const all = [];
  await Promise.all(watchlist.map(async (w) => {
    const j = await proxiedJson(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(w.tk)}&newsCount=12&quotesCount=0`);
    const rel = relevanceRe(w);
    let kept = 0;
    for (const n of j?.news || []) {
      if (kept >= MAX_PER_TICKER) break;
      if (!n.title || !(n.relatedTickers || []).includes(w.tk)) continue;
      if (!rel.test(n.title)) continue;
      const kind = classify(n.title);
      if (!kind) continue;
      const key = n.title.toLowerCase().slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      all.push({ tk: w.tk, kind, title: n.title, link: n.link, pub: n.publisher, t: n.providerPublishTime });
      kept++;
    }
  }));
  return all.sort((a, b) => b.t - a.t).slice(0, MAX_TOTAL);
}

function render(box, items) {
  if (!items.length) {
    box.innerHTML = `<div class="empty">Quiet skies — no material news or rumors on your active calls right now.</div>`;
    return;
  }
  box.innerHTML = items.map(n => `
    <div class="news-row">
      <span class="chip ${n.kind}">${n.kind === "rumor" ? "RUMOR" : "MATERIAL"}</span>
      <div class="nbody">
        <a href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>
        <div class="nmeta"><b>${esc(n.tk)}</b> · ${esc(n.pub || "")} · ${timeAgo(n.t)}</div>
      </div>
    </div>`).join("");
}

/* ----------------------- demo items ----------------------- */
function demoItems() {
  const now = Date.now() / 1000;
  return [
    { tk: "RKLB", kind: "material", title: "Rocket Lab wins $515M contract to build satellite constellation", link: "#", pub: "Reuters", t: now - 3600 },
    { tk: "NVDA", kind: "rumor", title: "NVIDIA reportedly in talks to acquire AI chip startup", link: "#", pub: "Bloomberg", t: now - 7200 },
    { tk: "TSLA", kind: "material", title: "Tesla Q2 deliveries beat estimates as production ramps", link: "#", pub: "CNBC", t: now - 14400 },
  ].filter(n => watchlist.some(w => w.tk === n.tk));
}
