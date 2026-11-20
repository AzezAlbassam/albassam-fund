// ============================================================
// Live prices + company profiles.
//  * First choice: CNBC's quote service. Free, no key, open to
//    browsers, every ticker in one request, and it carries the
//    pre-market and after-hours price.
//  * Fallbacks: Finnhub (only if a key is set in config.js), then
//    Yahoo Finance through public CORS mirrors, then the closes
//    saved next to the site.
//  * Demo mode: fabricated random walk (no network at all).
// Logos come from the free Parqet logo CDN; the UI falls back
// to a letter badge if a logo doesn't exist.
// ============================================================

import { DEMO, FINNHUB_KEY, PRICE_REFRESH_MS } from "./config.js?v=39";

const USE_FINNHUB = !FINNHUB_KEY.startsWith("__");
const FINNHUB = "https://finnhub.io/api/v1";

export const quotes = {};   // ticker -> {c: current, pc: prevClose, dp: day %, ext: "pre" | "post" outside regular hours}
const names = {};           // ticker -> company name (from Yahoo meta)
let onUpdate = () => {};
let tickers = [];
let timer = null;
const lists = {};           // who -> tickers it needs (open calls, a member's portfolio)

export function startPrices(cb) {
  onUpdate = cb;
}

// Called whenever a ticker list changes; keeps polling only
// the tickers that are on screen.
export function watchTickers(list, who = "calls") {
  lists[who] = list;
  const next = [...new Set(Object.values(lists).flat())].sort();
  if (next.join() === tickers.join()) return;
  tickers = next;
  refresh();
  clearInterval(timer);
  if (tickers.length) timer = setInterval(refresh, PRICE_REFRESH_MS);
}

// Closes saved next to the site by .github/workflows/market-data.yml
// (fetched server side twice a day). Re-read every 10 minutes.
let saved = null, savedAt = 0;
export function savedSeries() {
  if (!saved || Date.now() - savedAt > 6e5) {
    savedAt = Date.now();
    saved = fetch(new URL("../data/market.json?t=" + Math.floor(savedAt / 6e5), import.meta.url))
      .then(r => (r.ok ? r.json() : {})).then(j => j.series || {}).catch(() => ({}));
  }
  return saved;
}

async function refresh() {
  if (DEMO) return demoRefresh();
  // ponytail: the last saved close stands in until a live quote lands
  const s = await savedSeries();
  let seeded = false;
  for (const tk of tickers) {
    const h = s[tk];
    if (quotes[tk] || !h?.c?.length) continue;
    const c = h.c[h.c.length - 1], pc = h.c[h.c.length - 2] ?? null;
    quotes[tk] = { c, pc, dp: pc ? ((c - pc) / pc) * 100 : null, saved: true };
    seeded = true;
  }
  if (seeded) onUpdate(quotes);
  const live = await cnbcQuotes(tickers);   // one request for every ticker
  await Promise.all(tickers.map(async (tk) => {
    const q = live[tk] || await fallbackQuote(tk);
    if (q) quotes[tk] = q;
  }));
  onUpdate(quotes);
}

const fallbackQuote = (tk) => (USE_FINNHUB ? finnhubQuote(tk) : yahooQuote(tk));
async function getQuote(tk) {
  return (await cnbcQuotes([tk]))[tk] || fallbackQuote(tk);
}

/* ----------------------- CNBC: live, with pre-market and after-hours ----------------------- */
const CNBC = "https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol";
async function cnbcQuotes(list) {
  const out = {};
  if (!list.length) return out;
  try {
    const r = await fetch(`${CNBC}?symbols=${list.map(encodeURIComponent).join("%7C")}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json`,
      { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return out;
    const got = (await r.json())?.FormattedQuoteResult?.FormattedQuote;
    for (const q of [got].flat()) {
      const v = cnbcQuote(q);
      if (!v) continue;
      out[q.symbol] = v;
      if (q.name) names[q.symbol] = q.name;
    }
  } catch (e) { /* the fallbacks take over */ }
  return out;
}
// One CNBC record -> our quote. Outside regular hours the extended price is the
// current one and the day's % is measured from the last regular close.
export function cnbcQuote(q) {
  const num = (v) => { const n = parseFloat(String(v ?? "").replace(/[,%]/g, "")); return Number.isFinite(n) ? n : null; };
  const last = num(q?.last);
  if (q?.code !== 0 || !(last > 0)) return null;
  const x = q.ExtendedMktQuote, xl = num(x?.last);
  if (xl > 0 && q.curmktstatus !== "REG_MKT")
    return { c: xl, pc: last, dp: ((xl - last) / last) * 100, ext: x.type === "PRE_MKT" ? "pre" : "post" };
  const pc = num(q.previous_day_closing);
  return { c: last, pc, dp: pc ? ((last - pc) / pc) * 100 : num(q.change_pct) };
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
  // the live feed can be down: a ticker with saved closes is real, and its
  // last close stands in until a live quote lands
  const h = (await savedSeries())[ticker];
  if (h?.c?.length) {
    const c = h.c[h.c.length - 1], pc = h.c[h.c.length - 2] ?? null;
    quotes[ticker] ??= { c, pc, dp: pc ? ((c - pc) / pc) * 100 : null, saved: true };
    return true;
  }
  return false;
}

/* ----------------------- Yahoo Finance ----------------------- */
// Public CORS mirrors, tried in order. Only the ticker symbol is
// ever sent, no personal data. (corsproxy.io was dropped in Sept 2026:
// it now answers 401 without a paid key.)
const PROXIES = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,   // wraps the body in {contents}
];

export async function proxiedJson(url) {
  // every mirror at once: the wait is one timeout, not one per dead mirror
  // (a ticker with no saved closes used to stall the whole race for ~30s)
  const one = async (wrap) => {
    const r = await fetch(wrap(url), { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error("mirror " + r.status);
    const j = await r.json();
    const v = typeof j?.contents === "string" ? JSON.parse(j.contents) : j;
    if (v == null) throw new Error("mirror empty");
    return v;
  };
  return Promise.any(PROXIES.map(one)).catch(() => null);
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
