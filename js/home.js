// ============================================================
// Home: the pour hero (scroll-scrubbed video) + the fund at a
// glance. Hero engineering follows the scrub standard: Blob fetch,
// dt-normalized lerp in a resting rAF loop, gated seeks, delta-gated
// DOM writes, scroll-paced caption bands, five live static gates.
// ============================================================

import { initShell, observeReveals, countTo, reducedMotion, usd0, pct1, pts1, signedUsd, shortUsd,
         day, esc, pctClass, logoHtml } from "./shell.js?v=10";
import { live, state } from "./live.js?v=10";
import { loadRace, raceSummary } from "./series.js?v=10";
import { raceChart, bindRaceControls, viewValues } from "./chart.js?v=10";
import { simulate, statPct, derive, blendedPct } from "./roi.js?v=10";
import { watchNews } from "./news.js?v=10";

const $ = (s, r = document) => r.querySelector(s);
initShell();

/* =================== HERO =================== */
const VIDEO_URL = "assets/hero-scrub.mp4", POSTER_URL = "assets/hero-poster.jpg";
const hero = $("#hero"), stage = $(".stage"), video = $("#heroVideo"), posterLayer = $(".poster"), posterEnd = $(".poster-end");
const bands = [...document.querySelectorAll(".band")].map((el, i) => ({
  el, i, a: +el.dataset.a, b: +el.dataset.b, ramp: +el.dataset.ramp || 0, op: -1, k: -1,
}));
const cue = $(".cue");

// seeded splitting, once at load: sr-only full sentence + aria-hidden spans
function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
for (const el of document.querySelectorAll("[data-split]")) {
  const text = el.textContent.trim(), words = text.split(/\s+/), mode = el.dataset.split;
  const r = rng(text.length * 7919);
  const spread = +(el.closest("[data-spread]")?.dataset.spread || 0.55);
  let ci = 0; const total = text.replace(/\s/g, "").length;
  const vis = words.map((w, wi) => {
    if (mode === "chars") {
      return `<span class="w">${[...w].map(ch => {
        const th = (ci++ / total) * spread + r() * 0.08;
        return `<span class="c" style="--th:${th.toFixed(3)};--jx:${((r() - .5) * 90).toFixed(0)}px;--jy:${((r() - .5) * 70).toFixed(0)}px;--jr:${((r() - .5) * 50).toFixed(0)}deg">${esc(ch)}</span>`;
      }).join("")}</span>`;
    }
    const th = (wi / Math.max(1, words.length)) * 0.5;
    return `<span class="w" style="--th:${th.toFixed(3)}">${esc(w)}</span>`;
  }).join(" ");
  el.innerHTML = `<span class="sr">${esc(text)}</span><span aria-hidden="true">${vis}</span>`;
}

const smoothstep = (p, e0, e1) => { const t = Math.min(1, Math.max(0, (p - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function heroProgress() {
  const total = hero.offsetHeight - innerHeight;
  return total > 0 ? clamp(-hero.getBoundingClientRect().top / total, 0, 1) : 0;
}

let loadK = 0;          // band one's one-time assembly on load
let cueGone = null;
function updateCaptions(p) {
  const last = bands.length - 1;
  for (const b of bands) {
    const f = Math.min(0.02, (b.b - b.a) / 3);
    let op = (b.i === 0 ? 1 : smoothstep(p, b.a, b.a + f)) * (b.i === last ? 1 : 1 - smoothstep(p, b.b - f, b.b));
    if (b.i === last && p < b.a) op = 0;
    let k = clamp((p - b.a) / (b.ramp || Math.min(0.025, (b.b - b.a) * 0.35)), 0, 1);
    if (b.i === 0) k = Math.max(k, loadK);
    if (Math.abs(op - b.op) > 0.003 || (op === 0) !== (b.op === 0)) { b.op = op; b.el.style.opacity = op.toFixed(3); }
    if (Math.abs(k - b.k) > 0.008 || (k === 1 && b.k !== 1) || (k === 0 && b.k !== 0)) { b.k = k; b.el.style.setProperty("--k", k.toFixed(3)); }
    if (b.i === last) {
      const on = op > 0.6;
      if (on !== b.on) { b.on = on; b.el.classList.toggle("on", on); }
    }
  }
  // until the video arrives (or if it never does), the still frames carry the journey
  const endOp = +smoothstep(p, 0.62, 0.86).toFixed(3);
  if (endOp !== updateCaptions.endOp) { updateCaptions.endOp = endOp; posterEnd.style.opacity = endOp; }
  const gone = p > 0.03;
  if (gone !== cueGone) { cueGone = gone; cue?.classList.toggle("gone", gone); }
}

// seek gate: never write currentTime while a seek is in flight
let seekBusy = false, pendingTime = null;
function requestSeek(t) {
  if (!video.duration) return;
  if (seekBusy) { pendingTime = t; return; }
  seekBusy = true;
  video.currentTime = t;
}
video.addEventListener("seeked", () => {
  seekBusy = false;
  if (pendingTime !== null) { const t = pendingTime; pendingTime = null; requestSeek(t); }
});
video.addEventListener("error", () => { seekBusy = false; pendingTime = null; failVideo(); });

// eased time, frame-rate independent, rests when converged
let target = 0, shown = 0, rafId = null, lastTick = 0, heroOnScreen = true;
function tick(now) {
  const dt = Math.min(100, now - (lastTick || now));
  lastTick = now;
  shown += (target - shown) * (1 - Math.pow(1 - 0.16, dt / 16.667));
  if (Math.abs(target - shown) < 0.0005) { shown = target; rafId = null; lastTick = 0; }
  else rafId = requestAnimationFrame(tick);
  if (video.duration) requestSeek(shown * (video.duration - 0.05));
  updateCaptions(shown);
}
function onScroll() {
  target = heroProgress();
  if (rafId === null && heroOnScreen) rafId = requestAnimationFrame(tick);
}
new IntersectionObserver(([e]) => {
  heroOnScreen = e.isIntersecting;
  if (heroOnScreen) onScroll();
}).observe(hero);

let heroInit = false;
function initHeroOnce() {
  if (heroInit) return;
  heroInit = true;
  posterLayer.style.backgroundImage = `url('${POSTER_URL}')`;
  posterEnd.style.backgroundImage = "url('assets/hero-ending.jpg')";
  let started = false;
  const start = () => { if (started) return; started = true; loadVideo().catch(failVideo); };
  const img = new Image(); img.onload = start; img.onerror = start; img.src = POSTER_URL;
  setTimeout(start, 4000);
  // band one assembles itself on load, then hands over to scroll
  const t0 = performance.now();
  const ramp = (now) => {
    loadK = reducedMotion.matches ? 1 : Math.min(1, (now - t0) / 1300);
    loadK = 1 - Math.pow(1 - loadK, 3);
    updateCaptions(shown);
    if (loadK < 1) requestAnimationFrame(ramp);
  };
  requestAnimationFrame(ramp);
}
async function loadVideo() {
  const ctrl = new AbortController(), wd = setTimeout(() => ctrl.abort(), 30000);
  const res = await fetch(VIDEO_URL, { priority: "low", signal: ctrl.signal });
  if (!res.ok) throw new Error("video " + res.status);
  const blob = await res.blob();
  clearTimeout(wd);
  video.src = URL.createObjectURL(blob);
  video.load();
  video.addEventListener("canplay", () => {
    requestSeek(heroProgress() * (video.duration - 0.05));
    stage.classList.add("video-ready");
  }, { once: true });
}
function failVideo() { stage.classList.add("video-failed"); }

// the five static-hero gates: identical strings live in home.css
const GATES = [
  "(max-width: 720px)",
  "(orientation: portrait) and (max-width: 1024px)",
  "(orientation: portrait) and (pointer: coarse)",
  "(orientation: landscape) and (pointer: coarse) and (max-height: 560px)",
  "(prefers-reduced-motion: reduce)",
];
let scrubOn = false;
function enableScrub() {
  if (scrubOn) return; scrubOn = true;
  initHeroOnce();
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll, { passive: true });
  bands.forEach(b => { b.op = -1; b.k = -1; });
  unpinFinalStates();
  shown = target = heroProgress();
  updateCaptions(shown);
  onScroll();
}
function disableScrub() {
  if (!scrubOn) return; scrubOn = false;
  removeEventListener("scroll", onScroll);
  removeEventListener("resize", onScroll);
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
}
function applyHeroMode() {
  if (GATES.some(q => matchMedia(q).matches)) disableScrub(); else enableScrub();
}
const MQLS = GATES.map(q => matchMedia(q));
MQLS.forEach(m => m.addEventListener("change", applyHeroMode));
applyHeroMode();

// reduced motion flips live, both directions
function pinToFinalStates() {
  document.querySelectorAll(".molten").forEach(el => el.classList.add("in"));
  document.querySelector("#raceChart")?.classList.add("drawn");
  pour.finish?.();
}
function unpinFinalStates() { /* scroll drives own everything again; nothing inline to undo */ }
reducedMotion.addEventListener("change", e => { if (e.matches) pinToFinalStates(); else applyHeroMode(); });

/* =================== DATA =================== */
let race = null, raceKey = "", raceFailed = false, recordKey = "";
const RACE_FAIL = "The race could not load right now. Try again in a minute.";
const chart = raceChart($("#raceChart"));
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
  if (raceFailed) chart.fail(RACE_FAIL);
  legend(); renderScore(); pour.update();
}

function sinceLabel() {
  const d = race?.first || state.trades.reduce((m, t) => (t.opened && t.opened < m ? t.opened : m), "9999");
  if (!d || d.startsWith("9999")) return "Since the first call";
  return "Since " + new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}

function renderScore() {
  const pot = state.pot, sim = simulate(state.trades, state.quotes, pot);
  const s = race ? raceSummary(race) : null;
  document.querySelectorAll("[data-pot]").forEach(el => (el.textContent = shortUsd(pot)));
  countTo($("#sbValue"), sim.value, usd0);
  const ret = $("#sbRet"); countTo(ret, sim.totalPct, pct1); ret.className = "num " + pctClass(sim.totalPct);
  countTo($("#ldBank"), sim.realizedDollars, usd0);
  if (s) {
    const lead = (k, id, name) => {
      const v = s[k], el = $("#" + id);
      $("#" + id + "K").textContent = (v >= 0 ? "Ahead of " : "Behind ") + name;
      countTo(el, v, pts1); el.className = "l-v num " + pctClass(v);
    };
    lead("leadGold", "ldGold", "gold");
    lead("leadSpx", "ldSpx", "the S&P\u00a0500");
  }
  // the live line in the hero (both versions)
  for (const line of document.querySelectorAll("[data-liveline]")) {
    line.firstChild.textContent = sinceLabel() + ": our fund ";
    const f = line.querySelector('[data-l="fund"]'); f.textContent = pct1(sim.totalPct);
    if (s) { line.querySelector('[data-l="gold"]').textContent = pct1(s.gold); line.querySelector('[data-l="spx"]').textContent = pct1(s.spx); }
  }
  // the small line under the scoreboard
  const closed = state.trades.filter(t => t.status === "closed" && t.finalPct != null);
  if (state.ready) {
    const wins = closed.filter(t => t.finalPct > 0).length;
    const best = state.trades.reduce((b, t) => { const p = statPct(t, state.quotes); return p != null && (!b || p > b.p) ? { t, p } : b; }, null);
    $("#scoreFoot").innerHTML = `Calls made <b>${state.trades.length}</b> · Won <b>${wins} of ${closed.length}</b>` +
      (best ? ` · Best call <b>${esc(best.t.ticker)} ${pct1(best.p)}</b>` : "");
  }
}

function legend() {
  const box = $("#raceLegend");
  if (!race) { box.innerHTML = ""; return; }
  const o = chart.opts, s = viewValues(race, o), b = o.bench, f = o.unit === "pct" ? pct1 : usd0;
  const item = (cls, name, v) => `<span><i style="background:var(--${cls})"></i>${name} <b>${f(v)}</b></span>`;
  box.innerHTML = item("jade", "Our fund", s.fund) +
    (b !== "spx" ? item("gold", "Gold", s.gold) : "") + (b !== "gold" ? item("pearl", "S&amp;P 500", s.spx) : "") +
    `<span class="muted">as of ${day(s.asOf)}</span>`;
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
  if (!active.length) {
    box.innerHTML = `<div class="book-empty panel" data-reveal>
      <svg viewBox="0 0 200 110" aria-hidden="true"><path class="mold-glow" d="M34 34h132l18 58H16z" fill="rgba(230,179,78,.12)"/>
        <path d="M30 26h140l22 66H8z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
        <path d="M8 92h184" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>
      <div><h3>All cash.</h3><p>Every gain is banked. The next call shows up here the minute it opens.</p></div></div>`;
  } else {
    box.innerHTML = active.map(t => {
      const d = derive(t), q = state.quotes[t.ticker], p = blendedPct(t, q?.c);
      return `<article class="pos-card" data-id="${esc(t.id)}" data-reveal>
        <div class="top">${logoHtml(t)}<div><div class="tk">${esc(t.ticker)}</div><div class="nm">${esc(t.name)}</div></div>
          <div class="roi"><b data-f="pct" class="${pctClass(p)}">${pct1(p)}</b><small data-f="today">${q?.dp != null ? pct1(q.dp) + " today" : ""}</small></div></div>
        <dl><div><dt>Avg cost</dt><dd>$${d.avgCost.toFixed(2)}</dd></div><div><dt>Now</dt><dd data-f="px">${q ? "$" + q.c.toFixed(2) : "…"}</dd></div>
          <div><dt>Share of pot</dt><dd>${t.wt > 0 ? t.wt + "%" : "Unsized"}</dd></div><div><dt>Opened</dt><dd>${day(t.opened)}</dd></div></dl>
      </article>`;
    }).join("");
  }
  observeReveals(box);
}

/* ---------- the record: latest closed calls as cast bars ---------- */
function renderRecord() {
  const list = $("#ingots");
  const closed = state.trades.filter(t => t.status === "closed" && t.finalPct != null)
    .sort((a, b) => (b.closed || "").localeCompare(a.closed || "") || (b.opened || "").localeCompare(a.opened || ""))
    .slice(0, 8);
  const key = state.pot + closed.map(t => t.id + t.finalPct + t.wt).join();
  if (key === recordKey) return;
  recordKey = key;
  list.removeAttribute("data-stagger"); list.classList.remove("in", "done");
  list.innerHTML = closed.length ? closed.map(t => {
    const pnl = t.wt > 0 ? signedUsd(t.wt / 100 * t.finalPct / 100 * state.pot) + " on the pot" : "Unsized";
    return `<li class="ingot ${t.finalPct < 0 ? "loss" : ""}">
      <div class="ig-shape"><span class="ig-pct">${pct1(t.finalPct)}</span><span class="ig-tk">${esc(t.ticker)}</span></div>
      <div class="ig-meta"><span class="who">${logoHtml(t)}${esc(t.name || t.ticker)}</span>
        <span>${day(t.opened)} → ${day(t.closed)}${t.wt > 0 ? " · " + t.wt + "% of pot" : ""}</span>
        <span class="gain ${pctClass(t.finalPct)}">${pnl}</span></div></li>`;
  }).join("") : `<li class="ig-empty">Closed calls land here with their result locked in.</li>`;
  list.setAttribute("data-stagger", "");
  observeReveals(list.parentElement);
}

/* =================== POUR IT YOURSELF =================== */
const pour = (() => {
  const sec = $("#pour"), btn = $("#pourBtn"), done = $("#pourDone"), molds = $("#molds");
  const KEYS = [["fund", "Our fund", "#4FD1A1", "#1F8F67"], ["gold", "Gold", "#FFD789", "#B8842F"], ["spx", "S&P 500", "#DCE6EF", "#7F93A6"]];
  molds.innerHTML = KEYS.map(([k, name, c1, c2]) => `
    <div class="mold" data-k="${k}">
      <svg viewBox="0 0 200 150" aria-hidden="true">
        <defs><clipPath id="clip-${k}"><path d="M34 32h132l18 96H16z"/></clipPath>
          <linearGradient id="met-${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
          <radialGradient id="glow-${k}"><stop offset="0" stop-color="${c1}" stop-opacity=".45"/><stop offset="1" stop-color="${c1}" stop-opacity="0"/></radialGradient></defs>
        <ellipse class="glow" cx="100" cy="92" rx="110" ry="60" fill="url(#glow-${k})"/>
        <line class="stream" x1="100" y1="-40" x2="100" y2="126" stroke="${c1}"/>
        <g clip-path="url(#clip-${k})"><rect class="fill" x="0" y="32" width="200" height="96" fill="url(#met-${k})"/></g>
        <path class="shell" d="M30 26h140l22 104H8z"/>
      </svg>
      <span class="mold-name">${name}</span>
      <span class="mold-val" style="color:${k === "fund" ? "var(--jade)" : k === "gold" ? "var(--gold)" : "var(--pearl)"}">$100,000</span>
      <span class="mold-ret">…</span>
    </div>`).join("");
  const els = Object.fromEntries(KEYS.map(([k]) => [k, {
    fill: molds.querySelector(`[data-k=${k}] .fill`), val: molds.querySelector(`[data-k=${k}] .mold-val`),
    ret: molds.querySelector(`[data-k=${k}] .mold-ret`) }]));

  let amt = 100000, p = 0, holding = false, complete = false, raf = null, last = 0;
  const rets = () => { const s = race && raceSummary(race); return s ? { fund: s.fund, gold: s.gold, spx: s.spx } : null; };

  const narrow = matchMedia("(max-width: 560px)");
  const money = (v) => (narrow.matches && v >= 1e6 ? shortUsd(v) : usd0(v));   // $1,686,477 does not fit three molds on a phone
  function draw() {
    const r = rets();
    const e = 1 - Math.pow(1 - p, 3);
    btn.style.setProperty("--p", p.toFixed(3));
    if (!r) return;
    const finals = Object.fromEntries(KEYS.map(([k]) => [k, amt * (1 + r[k] / 100)]));
    const max = Math.max(...Object.values(finals));
    for (const [k] of KEYS) {
      const lvl = finals[k] / max;
      els[k].fill.style.transform = `scaleY(${(lvl * e).toFixed(4)})`;
      els[k].fill.style.setProperty("--lvl", lvl.toFixed(4));
      els[k].val.textContent = money(amt + (finals[k] - amt) * e);
      els[k].ret.textContent = complete ? pct1(r[k]) : p > 0 ? "pouring…" : pct1(r[k]);
    }
  }
  function loop(now) {
    const dt = Math.min(64, now - (last || now)); last = now;
    if (holding && !complete) p = Math.min(1, p + dt / 2300);
    else if (!complete) p = Math.max(0, p - dt / 1500);
    if (p >= 1 && !complete) finish();
    draw();
    if ((holding && !complete) || (!complete && p > 0)) raf = requestAnimationFrame(loop);
    else { raf = null; last = 0; sec.classList.toggle("pouring", false); }
  }
  function start() {
    if (complete) return reset();
    if (!rets()) { done.textContent = raceFailed ? RACE_FAIL : "Loading the numbers, one moment…"; return; }
    if (reducedMotion.matches) return finish();
    holding = true; sec.classList.add("pouring");
    if (!raf) raf = requestAnimationFrame(loop);
  }
  function stop() { holding = false; sec.classList.remove("pouring"); }
  function finish() {
    const r = rets(); if (!r) return;
    p = 1; complete = true; holding = false;
    sec.classList.remove("pouring"); sec.classList.add("done");
    btn.querySelector("span").textContent = "Pour again";
    const f = k => money(amt * (1 + r[k] / 100));
    done.innerHTML = `Poured. Our fund <b>${f("fund")}</b> · Gold <b>${f("gold")}</b> · S&amp;P 500 <b>${f("spx")}</b>`;
    draw();
  }
  function reset() {
    complete = false; p = 0; sec.classList.remove("done");
    btn.querySelector("span").textContent = "Hold to pour"; done.textContent = "";
    draw();
  }
  btn.addEventListener("pointerdown", (e) => { e.preventDefault(); btn.setPointerCapture?.(e.pointerId); start(); });
  btn.addEventListener("pointerup", stop);
  btn.addEventListener("pointercancel", stop);
  btn.addEventListener("lostpointercapture", stop);
  btn.addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); start(); } });
  btn.addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") stop(); });
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
  $(".amounts").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-amt]"); if (!b) return;
    amt = +b.dataset.amt;
    document.querySelectorAll(".amounts button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    if (complete) finish(); else draw();
  });
  draw();
  return { update: () => (complete ? finish() : draw()), finish };
})();

/* =================== LIVE FEED (last: demo mode and the device cache call back synchronously, so every helper above must exist first) =================== */
live((what) => {
  if (what === "quotes") {
    renderBook(true); renderScore();
    if (state.trades.some(t => t.status === "active" && t.wt > 0)) refreshRace();
    return;
  }
  renderScore(); renderBook(); renderRecord();
  if (what === "trades") watchNews(state.trades.filter(t => t.status === "active"));
  refreshRace();
}).catch(err => {
  console.error(err);
  $("#scoreFoot").textContent = "Could not reach the fund right now. Try again in a minute.";
  if (state.ready) return;   // a saved snapshot is already on screen: keep it
  raceFailed = true;
  chart.fail(RACE_FAIL);
  $("#newsList").innerHTML = `<div class="empty">The wire could not load right now.</div>`;
});
// a cold visit that never connects ends on a message, not an endless "Loading"
setTimeout(() => {
  if (state.ready) return;
  $("#scoreFoot").textContent = "Still connecting to the fund. Check your connection, then refresh.";
  chart.fail("Still connecting to the fund.");
}, 15000);
