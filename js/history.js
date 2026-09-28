// ============================================================
// Daily closing prices for the race chart and sparklines.
// Yahoo chart API through the same CORS mirrors as live quotes.
// Cached per browser for 30 minutes (past closes never change).
//   history("MU", "2026-07-01") -> { dates: ["2026-07-01", ...], closes: [..] }
// ============================================================

import { DEMO } from "./config.js?v=12";
import { proxiedJson, savedSeries } from "./prices.js?v=12";

const TTL = 30 * 60 * 1000;
const inflight = {};

export function history(tk, from) {
  const key = `hist:${tk}:${from}`;
  return (inflight[key] ??= load(tk, from, key).then(v => {
    if (!v.dates.length) delete inflight[key];   // mirrors down: let the next call retry
    return v;
  }));
}

async function load(tk, from, key) {
  try {
    const c = JSON.parse(localStorage.getItem(key));
    if (c && Date.now() - c.at < TTL && c.v?.dates?.length) return c.v;
  } catch (e) { /* storage blocked: just fetch */ }
  if (DEMO) return demo(tk, from);
  const f = (await savedSeries())[tk];
  if (f?.d?.length) return { dates: f.d, closes: f.c };   // the saved file is the truth, even if short
  const v = await fetchYahoo(tk, from);
  if (v.dates.length) {
    try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), v })); } catch (e) {}
  }
  return v;
}

async function fetchYahoo(tk, from) {
  // start a week early so the day before the first call has a close
  const p1 = Math.floor(Date.parse(from + "T00:00:00Z") / 1000) - 10 * 86400;
  const p2 = Math.floor(Date.now() / 1000) + 86400;
  const j = await proxiedJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(tk)}?period1=${p1}&period2=${p2}&interval=1d`);
  const r = j?.chart?.result?.[0];
  const ts = r?.timestamp || [], cl = r?.indicators?.quote?.[0]?.close || [];
  const dates = [], closes = [];
  ts.forEach((t, i) => {
    if (cl[i] == null) return;
    const d = new Date(t * 1000).toISOString().slice(0, 10);
    if (dates[dates.length - 1] === d) closes[closes.length - 1] = cl[i];
    else { dates.push(d); closes.push(cl[i]); }
  });
  return { dates, closes };
}

// Demo mode: a deterministic random walk on weekdays.
function demo(tk, from) {
  let s = [...tk].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const dates = [], closes = [];
  let px = 50 + rnd() * 150;
  for (let t = Date.parse(from) - 10 * 864e5; t <= Date.now(); t += 864e5) {
    const d = new Date(t); if (d.getUTCDay() % 6 === 0) continue;
    px *= 1 + (rnd() - 0.48) * 0.03;
    dates.push(d.toISOString().slice(0, 10)); closes.push(px);
  }
  return { dates, closes };
}

// Price on or before a date, for walking a history forward in time.
export function stepper(h) {
  let i = -1;
  return (d) => {
    while (i + 1 < h.dates.length && h.dates[i + 1] <= d) i++;
    return i >= 0 ? h.closes[i] : null;
  };
}
