// ============================================================
// Home v3 ("Line maze"): the maze hero, a moving ticker of every
// call, the bento scoreboard with rolling numbers, the 3D line orbit
// of the calls, what-if bars, the forecast towers, the record, the
// book and the wire.
// ============================================================

import { initShell, observeReveals, onReveal, roll, countTo, reducedMotion, usd0, pct1, pctBig, pts1, shortUsd,
         day, esc, pctClass, logoHtml, daysBetween } from "./shell.js?v=18";
import { live, state } from "./live.js?v=18";
import { loadRace, raceSummary } from "./series.js?v=18";
import { raceChart, bindRaceControls, viewValues } from "./chart.js?v=18";
import { simulate, statPct, derive, blendedPct } from "./roi.js?v=18";
import { watchNews } from "./news.js?v=18";

const $ = (s, r = document) => r.querySelector(s);
initShell();

/* =================== HERO: the maze, our fund's line climbing out =================== */
const media = $("#heroMedia");
let maze = null;
const phone = innerWidth < 720;
import("./maze.js?v=18")
  .then(m => m.startMaze($("#maze"), { labelsEl: $("#mzLabels"), cols: phone ? 9 : 16, rows: phone ? 11 : 11, fit: phone ? 1.12 : 1 }))
  .then(mz => { maze = mz; feedMaze(); onHeroScroll(); })
  .catch(err => { console.warn("3D maze unavailable:", err); media.classList.add("fallback"); });
function feedMaze() {
  if (!maze || !race) return;
  const n = race.fund.length - 1;
  maze.setPath(race.fund, `<b>${pct1((race.fund[n] / race.fund[0] - 1) * 100)}</b>our fund`);
}
const hero = $(".hero");
function onHeroScroll() { maze?.setScroll(Math.min(1, Math.max(0, scrollY / (hero.offsetHeight || 1)))); }
addEventListener("scroll", onHeroScroll, { passive: true });

// the title builds itself letter by letter
let ci = 0;
document.querySelectorAll(".hero-title .hl").forEach(w => {
  w.innerHTML = [...w.textContent].map(ch => `<span class="ch" style="--i:${ci++}">${esc(ch)}</span>`).join("");
});

/* =================== DATA =================== */
let race = null, raceKey = "", raceFailed = false, recordKey = "", tickerKey = "", orbit = null, orbitKey = "";
const RACE_FAIL = "The race could not load right now. Try again in a minute.";
const chart = raceChart($("#raceChart"));
chart.view({ bench: "both" });
bindRaceControls($("#raceControls"), chart);
$("#raceControls").addEventListener("click", () => setTimeout(legend, 0));

async function refreshRace() {
  const openSized = state.trades.filter(t => t.status === "active" && t.wt > 0);
  const key = JSON.stringify([state.pot, state.trades.map(t => [t.id, t.ticker, t.status, t.wt, t.finalPct, t.opened, t.closed, t.txns]),
    openSized.map(t => state.quotes[t.ticker]?.c)]);
  if (key === raceKey) return;
  raceKey = key;
  const r = await loadRace(state.trades, state.pot, state.quotes);
  if (key !== raceKey) return;
  race = r;
  raceFailed = !race && state.trades.some(t => t.wt > 0);
  chart.set(race);
  feedMaze();
  if (raceFailed) chart.fail(RACE_FAIL);
  legend(); renderScore(); renderBars(); renderForecast();
}

const pctOf = (t) => statPct(t, state.quotes);
const sinceDate = () => {
  const d = race?.first || state.trades.reduce((m, t) => (t.opened && t.opened < m ? t.opened : m), "9999");
  return d.startsWith("9999") ? null : d;
};

function renderScore() {
  const pot = state.pot, sim = simulate(state.trades, state.quotes, pot);
  const s = race ? raceSummary(race) : null;
  document.querySelectorAll("[data-pot]").forEach(el => (el.textContent = shortUsd(pot)));
  if (!state.ready) return;
  countTo($("#heroPct"), sim.totalPct, pct1, 2200);   // gradient text: a plain count-up (rolling digits break background-clip)
  roll($("#sbValue"), pct1(sim.totalPct));
  roll($("#ldBank"), pct1(sim.realizedPct));
  $("#sbRet").textContent = usd0(sim.value);   // the money, only as an example
  if (s) {
    for (const [k, id, name] of [["leadGold", "ldGold", "gold"], ["leadSpx", "ldSpx", "the S&P 500"]]) {
      const v = s[k], el = $("#" + id);
      $("#" + id + "K").textContent = (v >= 0 ? "Ahead of " : "Behind ") + name;
      el.textContent = pts1(v); el.className = "num " + pctClass(v);
    }
    const line = $("[data-liveline]");
    line.querySelector('[data-l="gold"]').textContent = pct1(s.gold);
    line.querySelector('[data-l="spx"]').textContent = pct1(s.spx);
  }
  const d = sinceDate();
  if (d) $("[data-liveline]").firstChild.textContent = "since " + new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }) + " ";
  // win rate ring
  const closed = state.trades.filter(t => t.status === "closed" && t.finalPct != null);
  const wins = closed.filter(t => t.finalPct > 0).length, rate = closed.length ? Math.round(wins / closed.length * 100) : 0;
  $("#winPct").textContent = rate + "%";
  $("#winFoot").textContent = closed.length ? `${wins} of ${closed.length} closed calls won` : "No closed calls yet";
  onReveal($(".b-win").closest("[data-stagger]"), () => $("#winRing").setAttribute("stroke-dasharray", `${rate} 100`));
  renderTop();
}

function legend() {
  const box = $("#raceLegend");
  if (!race) { box.innerHTML = ""; return; }
  const o = chart.opts, s = viewValues(race, o), b = o.bench, f = o.unit === "pct" ? pct1 : usd0;
  const item = (k, name, v) => `<span class="${k}"><i></i>${name} <b>${f(v)}</b></span>`;   // site.css: gold dashed, S&P dotted
  box.innerHTML = item("fund", "Our fund", s.fund) +
    (b !== "spx" ? item("gold", "Gold", s.gold) : "") + (b !== "gold" ? item("spx", "S&amp;P 500", s.spx) : "") +
    `<span class="muted">as of ${day(s.asOf)}</span>`;
}

/* ---------- top calls (by what they added to the pot) ---------- */
function renderTop() {
  const rows = state.trades.filter(t => t.wt > 0).map(t => ({ t, p: pctOf(t) })).filter(r => r.p != null)
    .map(r => ({ ...r, pts: r.t.wt / 100 * r.p })).sort((a, b) => b.pts - a.pts).slice(0, 5);
  const max = Math.max(...rows.map(r => Math.abs(r.pts)), 1e-9);
  const list = $("#topList");
  list.innerHTML = rows.map(r => `<li>${logoHtml(r.t)}<div class="t-name"><b>${esc(r.t.ticker)}</b><small>${esc(r.t.name || "")}</small>
      <div class="t-bar"><i style="--w:${(Math.abs(r.pts) / max).toFixed(3)}"></i></div></div>
      <span class="t-pct ${pctClass(r.p)}">${pct1(r.p)}</span></li>`).join("") || `<li class="muted">No sized calls yet.</li>`;
  onReveal($(".b-top").closest("[data-stagger]"), () => requestAnimationFrame(() => list.classList.add("in")));
}

/* ---------- the ticker tape ---------- */
function renderTicker() {
  const items = [...state.trades].sort((a, b) => (b.closed || b.opened || "").localeCompare(a.closed || a.opened || ""));
  const key = items.map(t => t.id + t.finalPct + t.status + (state.quotes[t.ticker]?.c ?? "")).join();
  if (key === tickerKey || !items.length) return;
  tickerKey = key;
  const one = items.map(t => {
    const p = pctOf(t);
    return `<span class="tk-item">${logoHtml(t)}${esc(t.ticker)} <b class="${pctClass(p)}">${pct1(p)}</b><small>${t.status === "active" ? "open" : "closed " + day(t.closed)}</small></span>`;
  }).join("");
  let reps = 2;
  while (items.length * reps < 16) reps += 2;   // the track must be wider than any screen
  const track = $("#tickerTrack");
  track.innerHTML = Array(reps).fill(one).join("");
  track.style.setProperty("--tape-s", Math.max(30, items.length * reps * 2.4) + "s");
}

/* ---------- what if: three bars race to their values ---------- */
let amt = 100000;
function renderBars() {
  const box = $("#bars");
  if (!race) return;
  const s = raceSummary(race);
  const fin = { fund: amt * (1 + s.fund / 100), gold: amt * (1 + s.gold / 100), spx: amt * (1 + s.spx / 100) };
  const max = Math.max(1, ...["fund", "gold", "spx"].map(k => s[k]));   // bar heights follow the % (a loss stays a sliver)
  onReveal(box, () => {
    for (const col of box.querySelectorAll(".bar-col")) {
      const k = col.dataset.k;
      col.querySelector(".bar-track i").style.height = Math.max(1.5, s[k] / max * 100).toFixed(2) + "%";   // height, not scale: the hatching keeps its angle
      col.querySelector("[data-v]").classList.toggle("neg", s[k] < 0);
      countTo(col.querySelector("[data-v]"), s[k], pct1, 1800);
      col.querySelector("[data-r]").textContent = `${shortUsd(amt)} → ${innerWidth < 560 && fin[k] >= 1e6 ? shortUsd(fin[k]) : usd0(fin[k])}`;
    }
  });
}
$(".amounts").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-amt]"); if (!b) return;
  amt = +b.dataset.amt;
  document.querySelectorAll(".amounts button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  renderBars();
});

/* ---------- the record: latest closed calls ---------- */
function renderRecord() {
  const row = $("#recordRow");
  const closed = state.trades.filter(t => t.status === "closed" && t.finalPct != null)
    .sort((a, b) => (b.closed || "").localeCompare(a.closed || "") || (b.opened || "").localeCompare(a.opened || "")).slice(0, 10);
  const key = state.pot + closed.map(t => t.id + t.finalPct + t.wt).join();
  if (key === recordKey) return;
  recordKey = key;
  row.removeAttribute("data-stagger"); row.classList.remove("in", "done");
  row.innerHTML = closed.map(t => {
    return `<li class="call-card tilt">
      <div class="cc-top">${logoHtml(t)}<div><b>${esc(t.ticker)}</b><small>${esc(t.name || "")}</small></div></div>
      <p class="cc-pct ${pctClass(t.finalPct)}">${pct1(t.finalPct)}</p>
      <p class="cc-meta">${day(t.opened)} → ${day(t.closed)}${t.wt > 0 ? " · " + t.wt + "% of pot" : ""}</p>
      <p class="cc-gain ${pctClass(t.finalPct)}">${t.wt > 0 ? pct1(t.wt * t.finalPct / 100) + " on the pot" : "Unsized"}</p></li>`;
  }).join("") || `<li class="muted">Closed calls land here with their result locked in.</li>`;
  row.setAttribute("data-stagger", "");
  observeReveals(row.parentElement);
}

/* ---------- on the book ---------- */
function renderBook(liveOnly) {
  const box = $("#bookList");
  if (!state.ready) return;
  const active = state.trades.filter(t => t.status === "active");
  if (liveOnly) {
    for (const t of active) {
      const el = box.querySelector(`[data-id="${CSS.escape(t.id)}"]`); if (!el) continue;
      const q = state.quotes[t.ticker], p = blendedPct(t, q?.c);
      el.querySelector("[data-f=pct]").textContent = pct1(p);
      el.querySelector("[data-f=pct]").className = pctClass(p);
      el.querySelector("[data-f=px]").textContent = q ? "$" + q.c.toFixed(2) : "…";
      el.querySelector("[data-f=today]").textContent = q?.dp != null ? pct1(q.dp) + " today" : "";
    }
    return;
  }
  box.innerHTML = active.length ? active.map(t => {
    const d = derive(t), q = state.quotes[t.ticker], p = blendedPct(t, q?.c);
    return `<article class="glass glow pos-card tilt" data-id="${esc(t.id)}" data-reveal>
      <div class="top">${logoHtml(t)}<div><div class="tk">${esc(t.ticker)}</div><div class="nm">${esc(t.name)}</div></div>
        <div class="roi"><b data-f="pct" class="${pctClass(p)}">${pct1(p)}</b><small data-f="today">${q?.dp != null ? pct1(q.dp) + " today" : ""}</small></div></div>
      <dl><div><dt>Avg cost</dt><dd>$${d.avgCost.toFixed(2)}</dd></div><div><dt>Now</dt><dd data-f="px">${q ? "$" + q.c.toFixed(2) : "…"}</dd></div>
        <div><dt>Share of pot</dt><dd>${t.wt > 0 ? t.wt + "%" : "Unsized"}</dd></div><div><dt>Opened</dt><dd>${day(t.opened)}</dd></div></dl>
    </article>`;
  }).join("") : `<div class="glass glow book-empty" data-reveal>
      <div><h3>All cash.</h3><p>Every gain is banked. The next call shows up here the minute it opens.</p></div></div>`;
  observeReveals(box);
}

/* ---------- the 3D orbit, started when its section comes near ---------- */
const stage = $("#orbitStage");
function renderOrbitCard(t) {
  const p = pctOf(t), card = $("#orbitCard");
  card.innerHTML = `<div class="oc-top">${logoHtml(t)}<div><b>${esc(t.ticker)}</b><small>${esc(t.name || "")}</small></div>
      <span class="oc-pct ${pctClass(p)}">${pct1(p)}</span></div>
    <dl><div><dt>Dates</dt><dd>${day(t.opened)} → ${t.status === "active" ? "now" : day(t.closed)}</dd></div>
      <div><dt>Pot share</dt><dd>${t.wt > 0 ? t.wt + "%" : "Unsized"}</dd></div>
      <div><dt>On the pot</dt><dd class="${pctClass(p)}">${t.wt > 0 && p != null ? pct1(t.wt * p / 100) : "…"}</dd></div></dl>`;
}
function feedOrbit() {
  if (!orbit || !state.ready) return;
  const key = state.trades.map(t => t.id + t.status + t.wt + (pctOf(t) ?? "")).join();
  if (key === orbitKey) return;
  orbitKey = key;
  orbit.set(state.trades, pctOf);
}
new IntersectionObserver(async ([e], obs) => {
  if (!e.isIntersecting) return;
  obs.disconnect();
  try {
    const { startOrbit } = await import("./orbit.js?v=18");
    orbit = await startOrbit($("#orbit"), $("#orbitLabels"), renderOrbitCard);
    feedOrbit();
  } catch (err) {
    console.warn("3D orbit unavailable:", err);
    stage.classList.add("fallback");
  }
}, { rootMargin: "600px 0px" }).observe(stage);

/* ---------- the forecast: what the pot could become ---------- */
// "Our pace" = our return so far, repeated once a year. The literal
// daily pace is shown in the note only: annualized it runs into the
// billions within a few years, which no fund sustains.
const FC_REF = [["spx", "S&amp;P 500", 0.10, 0xa1a1aa], ["gold", "Gold", 0.08, 0x6b6b74]];
const fc = { share: 1, years: 5, towers: null };
function renderForecast() {
  if (!race) return;
  const r0 = raceSummary(race).fund / 100, r = r0 * fc.share, pot = state.pot, N = fc.years;
  const val = (rate, y) => pot * Math.pow(1 + rate, y);
  const grow = (rate, y) => (Math.pow(1 + rate, y) - 1) * 100;   // total growth in %: what each person applies to their own money
  const rows = [["fund", "Our fund", r, 0x0b0b0c], ...FC_REF];
  // the numbers
  $("#fcN").textContent = N + (N === 1 ? " year" : " years");
  countTo($("#fcValue"), grow(r, N), pctBig, 1600);
  $("#fcRate").textContent = `at ${pct1(r * 100)} a year${fc.share < 1 ? "" : ", the same as our run so far"} · ${shortUsd(pot)} would become ${val(r, N) >= 1e6 ? shortUsd(val(r, N)) : usd0(val(r, N))}`;
  $("#fcRows").innerHTML = rows.map(([k, name, rate]) =>
    `<tr class="${k}"><th scope="row"><i class="sw ${k}"></i>${name}</th>` +
    [5, 10].map(y => `<td>${pctBig(grow(rate, y))}<small>${shortUsd(pot)} → ${shortUsd(val(rate, y))}</small></td>`).join("") + `</tr>`).join("");
  const days = Math.max(1, daysBetween(race.first, race.days[race.days.length - 1]));
  const ann = Math.pow(1 + r0, 365 / days) - 1;
  const toBillion = Math.log(1e9 / pot) / Math.log(1 + ann);
  $("#fcNote").textContent = `Our fund made ${pct1(r0 * 100)} in ${days} days. Held to that exact speed, the math says about ${pct1(ann * 100)} a year` +
    (ann > 0.5 && toBillion < 20 ? ` and ${Math.round(1e9 / pot).toLocaleString("en-US")} times the money in about ${Math.ceil(toBillion)} years, which nobody keeps up.` : ".") +
    ` So these towers repeat our result once a year instead. Past results do not promise future ones.`;
  // the towers: one per year, our fund in front, the S&P 500 and gold behind
  if (!fc.towers) return;
  const max = val(Math.max(r, 0.1), N), H = 4.4, gap = N > 5 ? 0.82 : N > 3 ? 1.05 : 1.3;
  const specs = [];
  rows.forEach(([k, name, rate, color], ri) => {
    for (let i = 0; i < N; i++) specs.push({
      id: k + i, x: (i - (N - 1) / 2) * gap, z: 1.1 - ri * 1.1, h: val(rate, i + 1) / max * H, color,
      ghost: k !== "fund", w: k === "fund" ? 0.56 : 0.4,
      label: i === N - 1 && (k === "fund" || N > 1) ? `${name} <b>${pctBig(grow(rate, N))}</b>` : null, labelClass: k,
    });
  });
  fc.towers.set(specs);
}
$("#fcPace").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-rate]"); if (!b) return;
  fc.share = +b.dataset.rate;
  $("#fcPace").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  renderForecast();
});
$("#fcYears").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-years]"); if (!b) return;
  fc.years = +b.dataset.years;
  $("#fcYears").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  renderForecast();
});
new IntersectionObserver(async ([e], obs) => {
  if (!e.isIntersecting) return;
  obs.disconnect();
  try {
    const { startTowers } = await import("./bars3d.js?v=18");
    fc.towers = await startTowers($("#fcCanvas"), $("#fcLabels"));
    renderForecast();
  } catch (err) { console.warn("3D forecast unavailable:", err); $("#fcStage").classList.add("fallback"); }
}, { rootMargin: "600px 0px" }).observe($("#fcStage"));

/* =================== LIVE FEED (last: the device cache calls back at once) =================== */
live((what) => {
  if (what === "quotes") {
    renderBook(true); renderScore(); renderTicker(); feedOrbit();
    if (state.trades.some(t => t.status === "active" && t.wt > 0)) refreshRace();
    return;
  }
  renderScore(); renderBook(); renderRecord(); renderTicker(); feedOrbit();
  if (what === "trades") watchNews(state.trades.filter(t => t.status === "active"));
  refreshRace();
}).catch(err => {
  console.error(err);
  if (state.ready) return;
  raceFailed = true;
  chart.fail(RACE_FAIL);
  $("#newsList").innerHTML = `<div class="empty">The wire could not load right now.</div>`;
});
setTimeout(() => { if (!state.ready) chart.fail("Still connecting to the fund. Check your connection, then refresh."); }, 15000);
