// ============================================================
// The Race page: the big chart, the headline strip, the numbers
// table, the month grid and the "where our lead came from" bars.
// Everything re-renders from live(): trades, pot and quotes.
// ============================================================

import { initShell, observeReveals, countTo, usd0, signedUsd, pct1, pts1, shortUsd, day, dayYear, month, esc, logoHtml } from "./shell.js?v=10";
import { live, state } from "./live.js?v=10";
import { statPct } from "./roi.js?v=10";
import { loadRace, raceSummary, seriesStats, monthly } from "./series.js?v=10";
import { raceChart, bindRaceControls } from "./chart.js?v=10";

const $ = (id) => document.getElementById(id);
const FAIL = "The race could not load right now. Try again in a minute.";
const EMPTY = "The race starts with the first sized call.";
const SERIES = [["fund", "Our fund", "jade"], ["gold", "Gold", "gold"], ["spx", "S&amp;P 500", "pearl"]];
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
  strip(); legend(); numbers(); months();
  observeReveals(document);
}

const note = (msg) => `<p class="state-note${status === "loading" ? " busy" : ""}">${msg}</p>`;
const stateMsg = () => status === "empty" ? EMPTY : status === "failed" ? FAIL : "Loading the race…";

/* ---------- headline strip under the lede ---------- */
function strip() {
  const el = $("strip");
  el.dataset.state = status;
  if (status !== "ok") { $("since").textContent = stateMsg(); return; }
  const s = raceSummary(race);
  $("since").textContent = `Since ${dayYear(race.first)}`;
  for (const [k] of SERIES) {
    const dd = el.querySelector(`[data-k="${k}"]`);
    dd.classList.toggle("neg", s[k] < 0);
    countTo(dd, s[k], pct1);
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
  el.innerHTML = SERIES.filter(([k]) => keys.includes(k)).map(([k, name, c]) =>
    `<span><i style="background:var(--${c})"></i>${name} <b class="${c}">${val(k)}</b></span>`).join("") +
    `<span class="asof">Through ${dayYear(race.days[n])}</span>`;
}

/* ---------- the numbers behind the lines ---------- */
function numbers() {
  const box = $("nbBox");
  if (status !== "ok") { box.innerHTML = note(stateMsg()); $("nbSpan").textContent = ""; return; }
  const S = Object.fromEntries(SERIES.map(([k]) => [k, seriesStats(race.days, race[k])]));
  $("nbSpan").textContent = `${dayYear(race.first)} to ${dayYear(race.days[race.days.length - 1])}`;
  const pc = (v) => `<span class="${v < 0 ? "neg" : ""}">${Math.abs(v) < 0.05 ? "0.0%" : pct1(v)}</span>`;
  const dayCell = (x) => x ? `${pc(x.pct)}<small>${day(x.d)}</small>` : `<span class="muted">Too early</span>`;
  const rows = [
    ["Return", k => pc(S[k].ret)],
    ["What " + shortUsd(race.pot) + " became", k => usd0(S[k].end)],
    ["Deepest drop", k => pc(S[k].maxDD)],
    ["Best day", k => dayCell(S[k].best)],
    ["Worst day", k => dayCell(S[k].worst)],
  ];
  box.innerHTML = `<table class="nb-table">
    <thead><tr><td></td>${SERIES.map(([k, name]) => `<th scope="col" class="${k === "fund" ? "us" : ""}">${name}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(([label, f]) => `<tr><th scope="row">${label}</th>${SERIES.map(([k]) =>
      `<td class="${k === "fund" ? "us" : ""}">${f(k)}</td>`).join("")}</tr>`).join("")}</tbody>
  </table>`;
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
    <tbody>${SERIES.map(([k, name]) => `<tr class="${k}"><th scope="row">${name}</th>${M.map(m =>
      `<td class="${m[k] < 0 ? "neg" : ""}" style="--a:${tint(m[k])}">${pct1(m[k])}</td>`).join("")}</tr>`).join("")}</tbody>
  </table>`;
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
    <li class="lb-row${r.pts < 0 ? " loss" : ""}">
      <div class="lb-name">${logoHtml(r.t)}<span><b>${esc(r.t.ticker)}</b>
        <small>${pct1(r.p)} × ${+(+r.t.wt).toFixed(1)}% of pot${r.t.status === "active" ? " · open" : ""}</small></span></div>
      <div class="lb-track" aria-hidden="true"><i class="lb-bar" style="width:${(Math.abs(r.pts) / span * 100).toFixed(2)}%;--d:${Math.min(i, 12) * 70}ms"></i></div>
      <div class="lb-val"><b>${pts1(r.pts)}</b><small>${signedUsd(r.pts * state.pot / 100)}</small></div>
    </li>`).join("");
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
