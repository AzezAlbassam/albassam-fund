// ============================================================
// The Race, as numbers: our fund's daily value against gold and
// the S&P 500 from the same starting pot.
//
// Fund = the BANKING model used everywhere else (roi.js simulate,
// monthly_report.py): each call is sized by its "% of pot", counted in
// points of the start (roi.js sizePts). Closed calls bank size × final
// %, open calls count size × live %. Day by day, a call only counts
// from its open date, at the size it had that day, is marked at that
// day's close (buys/sells after that day ignored) and banks its final
// % from its close date on. Unsized calls don't count.
// Gold = GLD, S&P 500 = ^GSPC, rebased to the pot the day before
// the first call.
// ============================================================

import { history, stepper } from "./history.js?v=47";
import { watchTickers } from "./prices.js?v=47";
import { DEMO } from "./config.js?v=47";
import { afterClose, sizePts } from "./roi.js?v=47";

export const GOLD = "GLD", SPX = "^GSPC", TASI = "^TASI.SR";   // TASI: the Saudi market, in SAR (a % is a %)
const SPX_LIVE = ".SPX";   // CNBC's name for the S&P 500 (TASI has no live source)

// Fetch everything the race needs. Resolves null if no sized calls
// or the benchmark history could not be loaded.
export async function loadRace(trades, pot, quotes = {}) {
  const sized = trades.filter(t => t.wt > 0 && t.opened);
  if (!sized.length) return null;
  if (!DEMO) watchTickers([GOLD, SPX_LIVE], "bench");   // live benchmarks ride in the same single quote request
  const first = sized.reduce((m, t) => (t.opened < m ? t.opened : m), "9999-99-99");
  const tks = [...new Set(sized.map(t => t.ticker))];
  const [gold, spx, tasi, ...hs] = await Promise.all([GOLD, SPX, TASI, ...tks].map(tk => history(tk, first)));
  if (!spx.dates.length || !gold.dates.length || !tasi.dates.length) return null;
  const hist = Object.fromEntries(tks.map((tk, i) => [tk, hs[i]]));
  // a call held across a trading day with no closes would silently drop out of the line
  const end = t => (t.status === "closed" ? (t.closed || t.opened) : spx.dates.at(-1));
  if (sized.some(t => !hist[t.ticker].dates.length && spx.dates.some(d => d >= t.opened && d < end(t)))) return null;
  return buildRace({ trades: sized, hist, gold, spx, tasi, pot, quotes, first });
}

export function buildRace({ trades, hist, gold, spx, tasi, pot, quotes = {}, first }) {
  const cal = spx.dates;
  let i0 = cal.findIndex(d => d >= first);
  if (i0 === -1) i0 = cal.length;
  const days = cal.slice(Math.max(0, i0 - 1));        // baseline: last close before the first call
  if (!days.length) return null;
  // The saved closes land after the US close: live prices from a newer
  // session get their own day, so today's move is never dated yesterday.
  // ponytail: Finnhub fallback quotes carry no date, so while CNBC is down
  // and Finnhub answers, the live move sits on the last saved day as before.
  const lq = tk => (quotes[tk]?.saved ? null : quotes[tk]);
  const qd = [...trades.filter(t => t.status === "active").map(t => t.ticker), GOLD, SPX_LIVE]
    .reduce((m, tk) => (lq(tk)?.d > m ? lq(tk).d : m), "");
  if (qd > days.at(-1)) days.push(qd);

  const at = Object.fromEntries(Object.entries(hist).map(([tk, h]) => [tk, stepper(h)]));
  const g = stepper(gold), s = stepper(spx), ta = stepper(tasi);   // TASI trades Sun-Thu: a day it is shut keeps its last close
  const g0 = g(days[0]), s0 = s(days[0]), ta0 = ta(days[0]) ?? tasi.closes[0];
  const last = days.length - 1;

  const fund = [], goldV = [], spxV = [], tasiV = [];
  days.forEach((d, i) => {
    let c = 0;
    const now = i === last;   // the endpoint is "now", exactly like the scoreboard
    for (const t of trades) {
      const livePx = now && t.status === "active" ? quotes[t.ticker]?.c : null;
      if (t.opened > d && !(now && (t.status === "closed" || livePx != null))) continue;
      if (t.status === "closed" && (now || (t.closed || t.opened) <= d)) { c += sizePts(t, trades) * (t.finalPct || 0) / 1e4; continue; }
      const px = livePx ?? at[t.ticker]?.(d);
      const r = pctAt(t, px == null ? null : px * afterClose(t), now ? "9999-12-31" : d);
      if (r != null) c += sizePts(t, trades, now ? null : d) * r / 1e4;   // the size it had that day
    }
    fund.push(pot * (1 + c));
    goldV.push(pot * ((now && lq(GOLD)?.c) || g(d)) / g0);
    spxV.push(pot * ((now && lq(SPX_LIVE)?.c) || s(d)) / s0);
    tasiV.push(pot * (ta(d) ?? ta0) / ta0);
  });

  const markers = [];
  for (const t of trades) {
    if (t.opened >= days[0]) markers.push({ d: t.opened, tk: t.ticker, kind: "open" });
    if (t.status === "closed" && t.closed) markers.push({ d: t.closed, tk: t.ticker, kind: "close", pct: t.finalPct });
  }
  // TASI on its own calendar (Sun-Thu), same base and end as the line: for its stats row only
  const i1 = Math.max(0, tasi.dates.findLastIndex(d => d <= days[0])), tasiOwn = { days: [], v: [] };
  tasi.dates.forEach((d, i) => { if (i >= i1 && d <= days.at(-1)) { tasiOwn.days.push(d); tasiOwn.v.push(pot * tasi.closes[i] / tasi.closes[i1]); } });
  return { days, fund, gold: goldV, spx: spxV, tasi: tasiV, tasiOwn, pot, first, markers };
}

// A call's blended % on day d, using only its trades up to that day.
function pctAt(t, px, d) {
  let bought = 0, cost = 0, sold = 0, proceeds = 0;
  for (const x of t.txns || []) {
    if (x.d && x.d > d) continue;
    if (x.t === "buy") { bought += x.sh; cost += x.sh * x.px; }
    else { sold += x.sh; proceeds += x.sh * x.px; }
  }
  if (cost <= 0) return null;
  const held = Math.max(0, bought - sold);
  if (held === 0) return ((proceeds - cost) / cost) * 100;
  if (px == null) return null;
  return ((proceeds + held * px - cost) / cost) * 100;
}

// Summary numbers for one series of daily values.
export function seriesStats(days, v) {
  const n = v.length;
  let peak = v[0], dd = 0, best = null, worst = null;
  for (let i = 1; i < n; i++) {
    peak = Math.max(peak, v[i]);
    dd = Math.min(dd, (v[i] / peak - 1) * 100);
    const ch = (v[i] / v[i - 1] - 1) * 100;
    if (!best || ch > best.pct) best = { d: days[i], pct: ch };
    if (!worst || ch < worst.pct) worst = { d: days[i], pct: ch };
  }
  return { ret: (v[n - 1] / v[0] - 1) * 100, end: v[n - 1], maxDD: dd, best, worst };
}

// Month-by-month % change: [{ m: "2026-07", fund, gold, spx }]
export function monthly(race) {
  const out = [];
  let prev = 0;
  race.days.forEach((d, i) => {
    const m = d.slice(0, 7), nextM = race.days[i + 1]?.slice(0, 7);
    if (i === 0 || nextM === m) return;
    const ch = k => (race[k][i] / race[k][prev] - 1) * 100;
    out.push({ m, fund: ch("fund"), gold: ch("gold"), spx: ch("spx"), tasi: ch("tasi") });
    prev = i;
  });
  return out;
}

// ---- CAGR ------------------------------------------------------------
// Years from d0 to d1 ("YYYY-MM-DD"), counted by anniversaries: whole years,
// then the part of the current year by its real length (365 or 366 days).
// Exactly 1 on the first anniversary, leap years included (Feb 29 -> Feb 28).
const utc = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
function plusYears(d, n) {
  const y = +d.slice(0, 4) + n, m = +d.slice(5, 7), dd = +d.slice(8, 10);
  return Date.UTC(y, m - 1, Math.min(dd, new Date(Date.UTC(y, m, 0)).getUTCDate()));
}
// The date n years after d ("YYYY-MM-DD"), on the same rule.
export const yearsOn = (d, n) => new Date(plusYears(d, n)).toISOString().slice(0, 10);
export function yearsBetween(d0, d1) {
  const t1 = utc(d1);
  if (!(t1 > utc(d0))) return 0;
  let n = 0;
  while (plusYears(d0, n + 1) <= t1) n++;
  const a = plusYears(d0, n), b = plusYears(d0, n + 1);
  return n + (t1 - a) / (b - a);
}

// Compound annual growth rate from v0 on d0 to v1 on d1: the one steady yearly
// rate that turns v0 into v1. { pct, years, full } or null. full = a year or
// more of history; a shorter period is only a pace (an extrapolation).
export function cagr(v0, v1, d0, d1) {
  const years = yearsBetween(d0, d1);
  if (!(v0 > 0) || !(v1 > 0) || !(years > 0)) return null;
  return { pct: (Math.pow(v1 / v0, 1 / years) - 1) * 100, years, full: years >= 1 };
}

// Calendar years: each year's own change (from the last close before it, or
// from the start) and the fund's CAGR from the start to that year's end: Dec 31
// once the year is over, the last close while it runs. A year counts as over
// only when a later year's close exists. TASI uses its own Sun-Thu sessions,
// like its stats row. [{ y, from, to, partial, fund, gold, spx, tasi, cagr }]
export function yearly(race) {
  const out = [], n = race.days.length - 1, own = race.tasiOwn?.v.length ? race.tasiOwn : null;
  const tasiTo = (d) => own.v[Math.max(0, own.days.findLastIndex(x => x <= d))];
  let i0 = 0, t0 = own?.v[0];
  for (let i = 1; i <= n; i++) {
    const y = race.days[i].slice(0, 4);
    if (i < n && race.days[i + 1].slice(0, 4) === y) continue;   // not the year's last day yet
    const done = i < n, end = done ? `${y}-12-31` : race.days[i];
    const ch = k => (race[k][i] / race[k][i0] - 1) * 100, t1 = own ? tasiTo(end) : null;
    out.push({ y, from: race.days[i0], to: race.days[i], partial: i0 === 0 || !done,
      fund: ch("fund"), gold: ch("gold"), spx: ch("spx"), tasi: own ? (t1 / t0 - 1) * 100 : ch("tasi"),
      cagr: cagr(race.fund[0], race.fund[i], race.days[0], end) });
    i0 = i; t0 = t1;
  }
  return out;
}

// Race headline: returns since the start, and our lead in points.
export function raceSummary(race) {
  const n = race.days.length - 1, r = k => (race[k][n] / race[k][0] - 1) * 100;
  const fund = r("fund"), gold = r("gold"), spx = r("spx"), tasi = r("tasi");
  return { fund, gold, spx, tasi, leadGold: fund - gold, leadSpx: fund - spx, leadTasi: fund - tasi, value: race.fund[n], asOf: race.days[n] };
}
