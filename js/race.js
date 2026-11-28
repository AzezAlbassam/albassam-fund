// ============================================================
// The Race page: the big chart, the headline strip, the numbers
// table, the month grid and the "where our lead came from" bars.
// Everything re-renders from live(): trades, pot and quotes.
// ============================================================

import { initShell, observeReveals, onReveal, roll, countTo, usd0, pct1, shortUsd, day, dayYear, month, esc, logoHtml, pctClass } from "./shell.js?v=45";
import { live, state } from "./live.js?v=45";
import { statPct, share } from "./roi.js?v=45";
import { loadRace, raceSummary, seriesStats, monthly, cagr, yearly, yearsOn } from "./series.js?v=45";
import { raceChart, bindRaceControls } from "./chart.js?v=45";

const $ = (id) => document.getElementById(id);
const FAIL = "Analytics could not load right now. Try again in a minute.";
const EMPTY = "Nothing to show until the first sized call.";
// [key, name]: our fund is drawn solid ink, gold dashed grey, the S&P dotted grey (site.css)
const SERIES = [["fund", "Our fund"], ["gold", "Gold"], ["spx", "S&amp;P 500"], ["tasi", "TASI"]];
const RANGES = { "1M": 22, "3M": 64 };   // ponytail: mirrors chart.js RANGES (the chart does not expose its slice)

initShell();
const chart = raceChart($("race"));
const controls = $("raceControls");
bindRaceControls(controls, chart);
controls.addEventListener("click", () => race && legend());   // runs after the chart has taken the new view

let race = null, status = "loading", key = "", seq = 0;

/* ---------- header: the line maze, our fund's path climbing out of it ---------- */
let maze = null;
const phone = innerWidth < 720;
import("./maze.js?v=45")
  .then(m => m.startMaze($("rhMaze"), { labelsEl: $("rhLabels"), cols: phone ? 8 : 12, rows: phone ? 7 : 9, seed: 20260712, spin: 0.035, fit: phone ? 0.92 : 1 }))
  .then(mz => { maze = mz; feedMaze(); })
  .catch(err => console.warn("3D maze unavailable:", err));
function feedMaze() {
  if (maze && status === "ok") maze.setPath(race.fund, `<b>${pct1(raceSummary(race).fund)}</b>our fund`);
}

async function onLive(what) {
  if (!state.ready) return;                         // settings can land before the first trades
  bars();
  const sized = state.trades.filter(t => t.wt > 0 && t.opened);
  const live = [...sized.filter(t => t.status === "active").map(t => state.quotes[t.ticker]?.c), state.quotes.GLD?.c, state.quotes[".SPX"]?.c];
  const k = JSON.stringify([state.pot, sized.map(t => [t.ticker, t.status, t.opened, t.closed, t.finalPct, t.wt, t.txns]), live]);
  if (k === key) return;
  key = k;
  const my = ++seq;
  if (!sized.length) { race = null; status = "empty"; chart.set(null); return paint(); }
  let r = null;
  try { r = await loadRace(state.trades, state.pot, state.quotes); } catch (e) { console.warn("race failed:", e); }
  if (my !== seq) return;                           // a newer load started meanwhile
  race = r; status = r ? "ok" : "failed";
  if (r) chart.set(r); else chart.fail(FAIL);
  paint();
}

function paint() {
  strip(); cagrChip(); legend(); numbers(); months(); years(); podium(); feedMaze();
  observeReveals(document);
}

/* ---------- the podium: four 3D towers ---------- */
let towers = null;
function podium() {
  if (!towers || status !== "ok") return;
  const s = raceSummary(race), n = race.days.length - 1;
  const rows = [["fund", "Our fund", race.fund[n], 0x0b0b0c], ["gold", "Gold", race.gold[n], 0x55555d], ["spx", "S&amp;P 500", race.spx[n], 0x8a8a93], ["tasi", "TASI", race.tasi[n], 0x2e2e33]];
  const max = Math.max(...rows.map(r => r[2]));
  towers.set(rows.map(([k, name, v, color], i) => ({ id: k, x: (i - 1.5) * 1.6, z: 0, h: 0.4 + v / max * 4, color, w: 1.05,
    label: `${name} <b>${pct1((v / race.pot - 1) * 100)}</b>`, labelClass: k })));
  document.querySelectorAll("[data-pot]").forEach(el => (el.textContent = shortUsd(race.pot)));
}
new IntersectionObserver(async ([e], obs) => {
  if (!e.isIntersecting) return;
  obs.disconnect();
  try {
    const { startTowers } = await import("./bars3d.js?v=45");
    towers = await startTowers($("pdCanvas"), $("pdLabels"), { yaw0: -0.45, pitch: 0.35, spin: 0.06 });
    podium();
  } catch (err) { console.warn("3D podium unavailable:", err); $("pdStage").classList.add("fallback"); }
}, { rootMargin: "500px 0px" }).observe($("pdStage"));

const pc = (v) => `<span class="v ${pctClass(v)}">${pct1(v)}</span>`;
// how long a CAGR covers, rounded down: the day before the anniversary never reads "12.0 months"
// (+1e-9 only absorbs float noise: 4.6 * 100 is 459.99999999999994, and a real fraction of a year is never that close to the next step)
const howLong = (y) => (y >= 1 ? `${(Math.floor(y * 100 + 1e-9) / 100).toFixed(2)} years` : `${(Math.floor(y * 120 + 1e-9) / 10).toFixed(1)} months`);
const note = (msg) => `<p class="state-note${status === "loading" ? " busy" : ""}">${msg}</p>`;
const stateMsg = () => status === "empty" ? EMPTY : status === "failed" ? FAIL : "Loading…";

/* ---------- headline strip under the lede ---------- */
function strip() {
  const el = $("strip");
  el.dataset.state = status;
  if (status !== "ok") { $("since").textContent = stateMsg(); return; }
  const s = raceSummary(race);
  $("since").textContent = `Since ${dayYear(race.first)}`;
  const top = Math.max(...SERIES.map(([k]) => s[k]), 1e-9);
  for (const [k] of SERIES) {
    const dd = el.querySelector(`[data-k="${k}"]`);
    dd.classList.toggle("neg", s[k] < 0);
    countTo(dd, s[k], pct1, 1800);
    dd.parentElement.style.setProperty("--w", Math.min(1, Math.max(0.03, s[k] / top)).toFixed(3));   // the lane's runner
  }
}

/* ---------- the CAGR, top left of the first screen (the same number as the table below) ---------- */
function cagrChip() {
  const el = $("rhCagr"), n = race && race.days.length - 1;
  const c = status === "ok" ? cagr(race.fund[0], race.fund[n], race.days[0], race.days[n]) : null;
  el.hidden = !c;
  if (!c) return;
  el.innerHTML = `<span class="k">${c.full ? "CAGR · per year" : "Yearly pace (CAGR)"}</span><b class="${c.pct < 0 ? "neg" : ""}">${pct1(c.pct)}</b>` +
    `<small>${c.full ? `over ${howLong(c.years)}` : `from ${howLong(c.years)} of history`}</small>`;
}

/* ---------- legend under the chart: latest values for the current view ---------- */
function legend() {
  const el = $("legend");
  if (status !== "ok") { el.innerHTML = ""; return; }
  const { bench, range, unit } = chart.opts;
  const keys = ["fund", ...(bench === "both" ? ["gold", "spx", "tasi"] : [bench])];
  const n = race.days.length - 1, i0 = RANGES[range] ? Math.max(0, n - RANGES[range]) : 0;
  const val = (k) => unit === "pct"
    ? pct1((race[k][n] / race[k][i0] - 1) * 100)
    : usd0(k === "fund" ? race.fund[n] : race[k][n] / race[k][i0] * race.fund[i0]);
  el.innerHTML = SERIES.filter(([k]) => keys.includes(k)).map(([k, name]) =>
    `<span><i class="${k}"></i>${name} <b>${val(k)}</b></span>`).join("") +
    `<span class="asof">Through ${dayYear(race.days[n])}</span>`;
}

/* ---------- the numbers behind the lines ---------- */
function numbers() {
  const box = $("nbBox");
  if (status !== "ok") { box.innerHTML = note(stateMsg()); $("nbSpan").textContent = ""; return; }
  const own = race.tasiOwn?.v.length > 2 ? race.tasiOwn : null;   // TASI's own Sun-Thu sessions
  const S = Object.fromEntries(SERIES.map(([k]) => [k, k === "tasi" && own ? seriesStats(own.days, own.v) : seriesStats(race.days, race[k])]));
  $("nbSpan").textContent = `${dayYear(race.first)} to ${dayYear(race.days[race.days.length - 1])}`;
  const dayCell = (x) => x ? `${pc(x.pct)}<small>${day(x.d)}</small>` : `<span class="muted">Too early</span>`;
  // CAGR from each Return above, over the same dates (all four share them)
  const n = race.days.length - 1, C = Object.fromEntries(SERIES.map(([k]) => [k, cagr(1, 1 + S[k].ret / 100, race.days[0], race.days[n])]));
  const c = C.fund, cagrLabel = !c ? "Per year (CAGR)" : c.full ? `Per year (CAGR)<small>over ${howLong(c.years)}</small>`
    : `Yearly pace (CAGR)<small>from ${howLong(c.years)} of history</small>`;   // under a year it is a pace, not a result
  const rows = [
    ["Return", k => `${pc(S[k].ret)}<small>${shortUsd(race.pot)} → ${usd0(S[k].end)}</small>`],   // the money only as an example
    [cagrLabel, k => (C[k] ? pc(C[k].pct) : "…")],
    ["Deepest drop", k => pc(S[k].maxDD)],
    ["Best day", k => dayCell(S[k].best)],
    ["Worst day", k => dayCell(S[k].worst)],
  ];
  box.innerHTML = `<table class="nb-table">
    <thead><tr><td></td>${SERIES.map(([k, name]) => k === "fund"
      ? `<th scope="col" class="us"><span class="grad-text">${name}</span></th>` : `<th scope="col" class="${k}">${name}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(([label, f], i) => `<tr style="--i:${i}"><th scope="row">${label}</th>${SERIES.map(([k]) =>
      `<td class="${k === "fund" ? "us" : ""}">${f(k)}</td>`).join("")}</tr>`).join("")}</tbody>
  </table>`;
  playOnce(box.closest("[data-reveal]"), ".v");
}

/* ---------- month by month ---------- */
function months() {
  const box = $("mmBox");
  if (status !== "ok") { box.innerHTML = note(stateMsg()); return; }
  const M = monthly(race);
  if (!M.length) { box.innerHTML = note("The first month is still running."); return; }
  const max = Math.max(...M.flatMap(m => [m.fund, m.gold, m.spx, m.tasi].map(Math.abs)), 1e-9);
  // ink (or red, for a loss) in four steps; sqrt keeps a +2% gold month visible next to a +40% fund month
  const tint = (v) => (0.03 + 0.07 * Math.ceil(4 * Math.sqrt(Math.min(1, Math.abs(v) / max)))).toFixed(2);
  box.innerHTML = `<table class="hm" style="--m:${M.length}">
    <colgroup><col class="lab">${M.map(() => "<col>").join("")}</colgroup>
    <thead><tr><td></td>${M.map(m => `<th scope="col">${month(m.m)}</th>`).join("")}</tr></thead>
    <tbody>${SERIES.map(([k, name], r) => `<tr class="${k}"><th scope="row">${name}</th>${M.map((m, c) =>
      `<td class="${m[k] < 0 ? "neg" : ""}" style="--a:${tint(m[k])};--i:${r + c}">${pct1(m[k])}</td>`).join("")}</tr>`).join("")}</tbody>
  </table>`;
  if (!box._end) { box._end = true; box.scrollLeft = box.scrollWidth; }   // phones: open on the latest month; later repaints keep the viewer's place
  playOnce(box.closest("[data-reveal]"));
}

/* ---------- year by year, and the CAGR ---------- */
// Under a year of history a CAGR is only a pace: the row and the note say so.
function years() {
  const box = $("yrBox"), noteEl = $("yrNote");
  if (status !== "ok") { box.innerHTML = note(stateMsg()); noteEl.textContent = ""; return; }
  const Y = yearly(race), last = Y.length - 1;
  if (!Y.length) { box.innerHTML = note("The first year is still running."); noteEl.textContent = ""; return; }
  const when = (r, i) => (i === 0 && r.partial && i === last ? `${day(race.first)} to ${day(r.to)}`
    : i === 0 ? `from ${day(race.first)}` : i === last && r.partial ? `to ${day(r.to)}` : "full year");
  box.innerHTML = `<table class="nb-table yr-table">
    <thead><tr><td></td>${Y.map((r, i) => `<th scope="col">${r.y}<small>${when(r, i)}</small></th>`).join("")}</tr></thead>
    <tbody>${SERIES.map(([k, name], j) => `<tr class="${k === "fund" ? "yr-fund" : ""}" style="--i:${j}"><th scope="row">${name}</th>${Y.map(r =>
      `<td>${pc(r[k])}</td>`).join("")}</tr>`).join("")}
      <tr class="yr-fund yr-cagr" style="--i:${SERIES.length}"><th scope="row">Our fund's CAGR<small>from the start</small></th>${Y.map(r =>
        `<td>${r.cagr ? `${pc(r.cagr.pct)}<small>${r.cagr.full ? "per year" : "pace"}, ${howLong(r.cagr.years)}</small>` : "…"}</td>`).join("")}</tr></tbody>
  </table>`;
  if (!box._end) { box._end = true; box.scrollLeft = box.scrollWidth; }   // many years: open on the latest one
  const c = Y[last].cagr, so = (race.fund[race.days.length - 1] / race.fund[0] - 1) * 100;
  const what = "CAGR (compound annual growth rate) is the one steady yearly rate that turns the starting pot into today's value";
  const paced = Y.some(r => r.cagr && !r.cagr.full);   // the first year's column stays a pace after the anniversary
  noteEl.textContent = !c ? "" : c.full ? `${what}: ${pct1(c.pct)} a year over ${howLong(c.years)}.` +
      (paced ? " A cell marked “pace” covers less than a year from the start, so it is not a yearly result: it is what a full year at that speed would make." : "")
    : `${what}. With ${howLong(c.years)} of history (${pct1(so)} so far) there is no yearly result yet: ${pct1(c.pct)} is the pace, what a full year at the same speed would make. The first full year ends on ${dayYear(yearsOn(race.days[0], 1))}.`;
  playOnce(box.closest("[data-reveal]"), ".v");
}

/* ---------- where our lead came from ---------- */
function bars() {
  const el = $("leadBars");
  const rows = state.trades
    .filter(t => t.wt > 0 && (t.status === "closed" || t.status === "active"))
    // an open call's share is of today's pot, a closed call's of the pot it was sized on
    .map(t => { const p = statPct(t, state.quotes), w = share(t, state.trades); return p == null ? null : { t, p, w, pts: w / 100 * p }; })
    .filter(Boolean)
    .sort((a, b) => b.p - a.p);   // the return leads; what it added to the pot comes second
  if (!rows.length) { el.innerHTML = `<li class="state-note">${EMPTY}</li>`; return; }
  const pos = Math.max(0, ...rows.map(r => r.p)), neg = Math.max(0, ...rows.map(r => -r.p));
  const span = pos + neg || 1;
  el.style.setProperty("--z", (neg / span * 100).toFixed(2) + "%");   // the zero line
  el.innerHTML = rows.map((r, i) => `
    <li class="lb-row${r.p < 0 ? " loss" : ""}" style="--i:${Math.min(i, 12)}">
      <div class="lb-name">${logoHtml(r.t)}<span><b>${esc(r.t.ticker)}</b>
        <small>${+r.w.toFixed(1)}% of pot${r.t.status === "active" ? " ·&nbsp;open" : ""}</small></span></div>
      <div class="lb-track" aria-hidden="true"><i class="lb-bar" style="width:${(Math.abs(r.p) / span * 100).toFixed(2)}%;--d:${Math.min(i, 12) * 70}ms"></i></div>
      <div class="lb-val"><b>${pct1(r.p)}</b><small>${pct1(r.pts)} on the pot</small></div>
    </li>`).join("");
  playOnce(el, ".lb-val b");
}

// First reveal with real content only: rows/tiles enter and numbers roll.
// Live re-renders after that (price ticks) swap in quietly, never replay.
function playOnce(el, rollSel) {
  if (!el || el._played) return;
  onReveal(el, () => {
    if (el._played) return;
    el._played = true;
    el.classList.add("play");
    if (rollSel) el.querySelectorAll(rollSel).forEach(x => roll(x, x.textContent));
    setTimeout(() => el.classList.remove("play"), 2600);
  });
}

live(onLive).catch(e => {   // last: demo mode calls back synchronously, so every helper above must exist first
  console.error("Race feed failed:", e);
  if (state.ready) return;   // a saved snapshot is already on screen: keep it
  status = "failed";
  chart.fail(FAIL);
  paint();
  $("leadBars").innerHTML = `<li class="state-note">${FAIL}</li>`;
});
// a cold visit that never connects ends on a message, not an endless "Loading"
setTimeout(() => {
  if (state.ready || status !== "loading") return;
  status = "failed";
  chart.fail("Still connecting to the fund. Check your connection, then refresh.");
  paint();
  $("leadBars").innerHTML = `<li class="state-note">${FAIL}</li>`;   // bars() only runs once the feed is ready
}, 15000);
