// ============================================================
// The Race page: the big chart, the headline strip, the numbers
// table, the month grid and the "where our lead came from" bars.
// Everything re-renders from live(): trades, pot and quotes.
// ============================================================

import { initShell, observeReveals, onReveal, roll, countTo, usd0, signedUsd, pct1, pts1, shortUsd, day, dayYear, month, esc, logoHtml } from "./shell.js?v=13";
import { live, state } from "./live.js?v=13";
import { statPct } from "./roi.js?v=13";
import { loadRace, raceSummary, seriesStats, monthly } from "./series.js?v=13";
import { raceChart, bindRaceControls } from "./chart.js?v=13";

const $ = (id) => document.getElementById(id);
const FAIL = "The race could not load right now. Try again in a minute.";
const EMPTY = "The race starts with the first sized call.";
// [key, name, text class, swatch]: our fund is the gradient, gold amber, the S&P lavender
const SERIES = [["fund", "Our fund", "grad-text", "var(--grad)"], ["gold", "Gold", "gold", "var(--gold)"], ["spx", "S&amp;P 500", "spx", "var(--spx)"]];
const RANGES = { "1M": 22, "3M": 64 };   // ponytail: mirrors chart.js RANGES (the chart does not expose its slice)

initShell();
const chart = raceChart($("race"));
const controls = $("raceControls");
bindRaceControls(controls, chart);
controls.addEventListener("click", () => race && legend());   // runs after the chart has taken the new view

let race = null, status = "loading", key = "", seq = 0;

async function onLive(what) {
  if (!state.ready) return;                         // settings can land before the first trades
  bars();
  const sized = state.trades.filter(t => t.wt > 0 && t.opened);
  const k = JSON.stringify([state.pot, sized.map(t => [t.ticker, t.status, t.opened, t.closed, t.finalPct, t.wt, t.txns])]);
  const quotesMatter = what === "quotes" && sized.some(t => t.status === "active");
  if (k === key && !quotesMatter) return;
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
  strip(); legend(); numbers(); months(); podium();
  observeReveals(document);
}

/* ---------- the podium: three 3D towers ---------- */
let towers = null;
function podium() {
  if (!towers || status !== "ok") return;
  const s = raceSummary(race), n = race.days.length - 1;
  const rows = [["fund", "Our fund", race.fund[n], 0xff7a45], ["gold", "Gold", race.gold[n], 0xffc24b], ["spx", "S&amp;P 500", race.spx[n], 0xa78bfa]];
  const max = Math.max(...rows.map(r => r[2]));
  towers.set(rows.map(([k, name, v, color], i) => ({ id: k, x: (i - 1) * 1.7, z: 0, h: 0.4 + v / max * 4, color, w: 1.05,
    label: `${name} <b>${usd0(v)}</b>`, labelClass: k })));
  document.querySelectorAll("[data-pot]").forEach(el => (el.textContent = shortUsd(race.pot)));
}
new IntersectionObserver(async ([e], obs) => {
  if (!e.isIntersecting) return;
  obs.disconnect();
  try {
    const { startTowers } = await import("./bars3d.js?v=13");
    towers = await startTowers($("pdCanvas"), $("pdLabels"), { yaw0: -0.45, pitch: 0.35, spin: 0.06 });
    podium();
  } catch (err) { console.warn("3D podium unavailable:", err); $("pdStage").classList.add("fallback"); }
}, { rootMargin: "500px 0px" }).observe($("pdStage"));

const note = (msg) => `<p class="state-note${status === "loading" ? " busy" : ""}">${msg}</p>`;
const stateMsg = () => status === "empty" ? EMPTY : status === "failed" ? FAIL : "Loading the race…";

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

/* ---------- legend under the chart: latest values for the current view ---------- */
function legend() {
  const el = $("legend");
  if (status !== "ok") { el.innerHTML = ""; return; }
  const { bench, range, unit } = chart.opts;
  const keys = ["fund", ...(bench === "both" ? ["gold", "spx"] : [bench])];
  const n = race.days.length - 1, i0 = RANGES[range] ? Math.max(0, n - RANGES[range]) : 0;
  const val = (k) => unit === "pct"
    ? pct1((race[k][n] / race[k][i0] - 1) * 100)
    : usd0(k === "fund" ? race.fund[n] : race[k][n] / race[k][i0] * race.fund[i0]);
  el.innerHTML = SERIES.filter(([k]) => keys.includes(k)).map(([k, name, c, sw]) =>
    `<span><i style="background:${sw}"></i>${name} <b class="${c}">${val(k)}</b></span>`).join("") +
    `<span class="asof">Through ${dayYear(race.days[n])}</span>`;
}

/* ---------- the numbers behind the lines ---------- */
function numbers() {
  const box = $("nbBox");
  if (status !== "ok") { box.innerHTML = note(stateMsg()); $("nbSpan").textContent = ""; return; }
  const S = Object.fromEntries(SERIES.map(([k]) => [k, seriesStats(race.days, race[k])]));
  $("nbSpan").textContent = `${dayYear(race.first)} to ${dayYear(race.days[race.days.length - 1])}`;
  const pc = (v) => Math.abs(v) < 0.05 ? `<span class="v">0.0%</span>` : `<span class="v ${v < 0 ? "neg" : "pos"}">${pct1(v)}</span>`;
  const dayCell = (x) => x ? `${pc(x.pct)}<small>${day(x.d)}</small>` : `<span class="muted">Too early</span>`;
  const rows = [
    ["Return", k => pc(S[k].ret)],
    ["What " + shortUsd(race.pot) + " became", k => `<span class="v">${usd0(S[k].end)}</span>`],
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
  const max = Math.max(...M.flatMap(m => [m.fund, m.gold, m.spx].map(Math.abs)), 1e-9);
  // tint grows with size; sqrt keeps a +2% gold month visible next to a +40% fund month
  const tint = (v) => (0.07 + 0.35 * Math.sqrt(Math.min(1, Math.abs(v) / max))).toFixed(3);
  box.innerHTML = `<table class="hm">
    <colgroup><col class="lab">${M.map(() => "<col>").join("")}</colgroup>
    <thead><tr><td></td>${M.map(m => `<th scope="col">${month(m.m)}</th>`).join("")}</tr></thead>
    <tbody>${SERIES.map(([k, name], r) => `<tr class="${k}"><th scope="row">${name}</th>${M.map((m, c) =>
      `<td class="${m[k] < 0 ? "neg" : ""}" style="--a:${tint(m[k])};--i:${r + c}">${pct1(m[k])}</td>`).join("")}</tr>`).join("")}</tbody>
  </table>`;
  playOnce(box.closest("[data-reveal]"));
}

/* ---------- where our lead came from ---------- */
function bars() {
  const el = $("leadBars");
  const rows = state.trades
    .filter(t => t.wt > 0 && (t.status === "closed" || t.status === "active"))
    .map(t => { const p = statPct(t, state.quotes); return p == null ? null : { t, p, pts: t.wt / 100 * p }; })
    .filter(Boolean)
    .sort((a, b) => b.pts - a.pts);
  if (!rows.length) { el.innerHTML = `<li class="state-note">${EMPTY}</li>`; return; }
  const pos = Math.max(0, ...rows.map(r => r.pts)), neg = Math.max(0, ...rows.map(r => -r.pts));
  const span = pos + neg || 1;
  el.style.setProperty("--z", (neg / span * 100).toFixed(2) + "%");   // the zero line
  el.innerHTML = rows.map((r, i) => `
    <li class="lb-row${r.pts < 0 ? " loss" : ""}" style="--i:${Math.min(i, 12)}">
      <div class="lb-name">${logoHtml(r.t)}<span><b>${esc(r.t.ticker)}</b>
        <small>${pct1(r.p)} × ${+(+r.t.wt).toFixed(1)}% of pot${r.t.status === "active" ? " · open" : ""}</small></span></div>
      <div class="lb-track" aria-hidden="true"><i class="lb-bar" style="width:${(Math.abs(r.pts) / span * 100).toFixed(2)}%;--d:${Math.min(i, 12) * 70}ms"></i></div>
      <div class="lb-val"><b>${pts1(r.pts)}</b><small>${signedUsd(r.pts * state.pot / 100)}</small></div>
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
}, 15000);
