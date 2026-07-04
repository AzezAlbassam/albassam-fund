// ============================================================
// Live prices + company profiles via Finnhub (free tier).
// Real mode: polls /quote for every active ticker on a timer.
// Demo mode: fabricates a gentle random walk so the design
// can be previewed without an API key.
// ============================================================

import { DEMO, FINNHUB_KEY, PRICE_REFRESH_MS } from "./config.js";

const BASE = "https://finnhub.io/api/v1";
export const quotes = {};   // ticker -> {c: current, pc: prevClose, dp: day %}
let onUpdate = () => {};
let tickers = [];
let timer = null;

export function startPrices(cb) {
  onUpdate = cb;
}

// Called whenever the trade list changes; keeps polling only
// the tickers that are on screen.
export function watchTickers(list) {
  const next = [...new Set(list)].sort();
  if (next.join() === tickers.join()) return;
  tickers = next;
  refresh();
  clearInterval(timer);
  if (tickers.length) timer = setInterval(refresh, PRICE_REFRESH_MS);
}

async function refresh() {
  if (DEMO) return demoRefresh();
  await Promise.all(tickers.map(async (tk) => {
    try {
      const r = await fetch(`${BASE}/quote?symbol=${encodeURIComponent(tk)}&token=${FINNHUB_KEY}`);
      if (!r.ok) return;
      const q = await r.json();
      if (q && q.c) quotes[tk] = { c: q.c, pc: q.pc, dp: q.dp };
    } catch (e) { /* offline / rate limited — keep last quote */ }
  }));
  onUpdate(quotes);
}

// Company name + logo, fetched once when a position is added.
export async function fetchProfile(ticker) {
  if (DEMO) return { name: ticker + " Inc", logo: "" };
  try {
    const r = await fetch(`${BASE}/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_KEY}`);
    if (!r.ok) return { name: "", logo: "" };
    const p = await r.json();
    return { name: p.name || "", logo: p.logo || "" };
  } catch (e) { return { name: "", logo: "" }; }
}

// Quick validity check when adding a ticker.
export async function checkTicker(ticker) {
  if (DEMO) return true;
  try {
    const r = await fetch(`${BASE}/quote?symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_KEY}`);
    if (!r.ok) return false;
    const q = await r.json();
    if (q && q.c) { quotes[ticker] = { c: q.c, pc: q.pc, dp: q.dp }; return true; }
    return false;
  } catch (e) { return false; }
}

/* ----------------------- demo walk ----------------------- */
const demoBase = { RKLB: 26.8, NVDA: 152.3, TSLA: 249.7, PLTR: 92.5, SOFI: 12.1 };
function demoRefresh() {
  for (const tk of tickers) {
    const base = quotes[tk]?.c ?? demoBase[tk] ?? (20 + Math.random() * 200);
    const c = Math.max(1, base * (1 + (Math.random() - 0.5) * 0.004));
    const pc = demoBase[tk] ?? base;
    quotes[tk] = { c, pc, dp: ((c - pc) / pc) * 100 };
  }
  onUpdate(quotes);
}
// Demo prices drift every few seconds so the dashboard feels live.
if (DEMO) setInterval(() => { if (tickers.length) demoRefresh(); }, 4000);
