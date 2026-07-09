// ============================================================
// Live prices + company profiles.
//  * Default provider: Yahoo Finance — free, no API key. Yahoo
//    doesn't send CORS headers, so requests go through public
//    CORS-friendly mirrors (with fallbacks).
//  * Optional provider: Finnhub — used automatically if a key
//    is set in config.js.
//  * Demo mode: fabricated random walk (no network at all).
// Logos come from the free Parqet logo CDN; the UI falls back
// to a letter badge if a logo doesn't exist.
// ============================================================

import { DEMO, FINNHUB_KEY, PRICE_REFRESH_MS } from "./config.js?v=5";

const USE_FINNHUB = !FINNHUB_KEY.startsWith("__");
const FINNHUB = "https://finnhub.io/api/v1";

export const quotes = {};   // ticker -> {c: current, pc: prevClose, dp: day %}
const names = {};           // ticker -> company name (from Yahoo meta)
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
    const q = await getQuote(tk);
    if (q) quotes[tk] = q;
  }));
  onUpdate(quotes);
}

async function getQuote(tk) {
  return USE_FINNHUB ? finnhubQuote(tk) : yahooQuote(tk);
}

// Company name + logo, fetched once when a position is added.
export async function fetchProfile(ticker) {
  if (DEMO) return { name: ticker + " Inc", logo: "" };
  const logo = `https://assets.parqet.com/logos/symbol/${encodeURIComponent(ticker)}?format=png&size=64`;
  if (USE_FINNHUB) {
    try {
      const r = await fetch(`${FINNHUB}/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_KEY}`);
      if (r.ok) {
        const p = await r.json();
        return { name: p.name || names[ticker] || "", logo: p.logo || logo };
      }
    } catch (e) { /* fall through */ }
  }
  return { name: names[ticker] || "", logo };
}

// Quick validity check when adding a ticker.
export async function checkTicker(ticker) {
  if (DEMO) return true;
  const q = await getQuote(ticker);
  if (q) { quotes[ticker] = q; return true; }
  return false;
}

/* ----------------------- Yahoo Finance ----------------------- */
// Public CORS mirrors, tried in order. Only the ticker symbol is
// ever sent — no personal data.
const PROXIES = [
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
];

export async function proxiedJson(url) {
  for (const wrap of PROXIES) {
    try {
      const r = await fetch(wrap(url));
      if (r.ok) return await r.json();
    } catch (e) { /* try next mirror */ }
  }
  return null;
}

async function yahooQuote(tk) {
  const j = await proxiedJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(tk)}?interval=1d&range=2d`);
  const meta = j?.chart?.result?.[0]?.meta;
  const c = meta?.regularMarketPrice;
  if (c == null) return null;
  if (meta.shortName || meta.longName) names[tk] = meta.shortName || meta.longName;
  const pc = meta.chartPreviousClose ?? meta.previousClose ?? null;
  return { c, pc, dp: pc ? ((c - pc) / pc) * 100 : null };
}

/* ----------------------- Finnhub ----------------------- */
async function finnhubQuote(tk) {
  try {
    const r = await fetch(`${FINNHUB}/quote?symbol=${encodeURIComponent(tk)}&token=${FINNHUB_KEY}`);
    if (!r.ok) return null;
    const q = await r.json();
    return q && q.c ? { c: q.c, pc: q.pc, dp: q.dp } : null;
  } catch (e) { return null; }
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
