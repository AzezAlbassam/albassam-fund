// ============================================================
// The Race chart: our fund (solid ink) against gold (dashed grey)
// and the S&P 500 (dotted grey), as a self-drawing SVG. The gap
// between our line and the benchmark is washed in ("the lead"),
// with a live readout at the right edge. Hover or touch shows all
// three values on that day.
//
//   const c = raceChart(el);
//   c.set(race);                          // from series.js loadRace()
//   c.view({ bench: "gold"|"spx"|"both", range: "1M"|"3M"|"ALL", unit: "pct"|"usd" });
// ============================================================

import { onReveal, observeReveals, reducedMotion, day, shortUsd } from "./shell.js?v=15";

const NS = "http://www.w3.org/2000/svg";
const RANGES = { "1M": 22, "3M": 64 };

// End values for a view, the same slice the chart draws: % since the
// range start, or $ with the benchmarks given the fund's money at that start.
export function viewValues(race, { range = "ALL", unit = "pct" } = {}) {
  const n = race.days.length - 1, k = RANGES[range], i0 = k ? Math.max(0, n - k) : 0;
  const v = key => unit === "pct" ? (race[key][n] / race[key][i0] - 1) * 100
    : key === "fund" ? race.fund[n] : race[key][n] / race[key][i0] * race.fund[i0];
  return { fund: v("fund"), gold: v("gold"), spx: v("spx"), from: race.days[i0], asOf: race.days[n] };
}
const NAMES = { fund: "Our fund", gold: "Gold", spx: "S&P 500" };
const HEX = { fund: "#0B0B0C", gold: "#6B6B74", spx: "#A1A1AA" };
const CLS = { fund: "fund", gold: "gold", spx: "spx" };

export function raceChart(el) {
  el.classList.add("race");
  el.innerHTML = `
    <svg role="img" aria-label="Loading the race"></svg>
    <div class="race-tip" aria-hidden="true"></div>
    <div class="race-lead" aria-hidden="true"></div>
    <div class="race-empty">Loading the race…</div>`;
  const svg = el.querySelector("svg"), tip = el.querySelector(".race-tip"),
    leadEl = el.querySelector(".race-lead"), empty = el.querySelector(".race-empty");
  let race = null, cut = null;
  const opts = { bench: "gold", range: "ALL", unit: "pct" };

  // the lines draw themselves the first time the chart scrolls into view
  let target = el.parentElement?.closest("[data-reveal],[data-stagger]");
  if (!target) { target = el; el.setAttribute("data-reveal", ""); observeReveals(el.parentElement || document); }
  onReveal(target, () => requestAnimationFrame(() => el.classList.add("drawn")));
  new ResizeObserver(() => render()).observe(el);

  function visible() {
    return ["fund", ...(opts.bench === "both" ? ["gold", "spx"] : [opts.bench])];
  }

  function slice() {
    const n = race.days.length, k = RANGES[opts.range];
    const i0 = k ? Math.max(0, n - 1 - k) : 0;
    const out = { days: race.days.slice(i0) };
    const f0 = race.fund[i0];
    for (const key of ["fund", "gold", "spx"]) {
      const v = race[key].slice(i0), v0 = v[0];
      out[key] = opts.unit === "pct"
        ? v.map(x => (x / v0 - 1) * 100)
        : v.map(x => key === "fund" ? x : x / v0 * f0);    // same money at the range start
    }
    return out;
  }

  const fmtV = (v) => opts.unit === "pct" ? (v >= 0 ? "+" : "-") + Math.abs(v).toFixed(1) + "%" : shortUsd(v);

  function render() {
    if (!race) return;
    const W = el.clientWidth, H = el.clientHeight;
    if (!W || !H) return;
    cut = slice();
    const keys = visible(), n = cut.days.length;
    const narrow = W < 560;
    const pad = { l: narrow ? 46 : 58, r: narrow ? 10 : 156, t: narrow ? 58 : 18, b: 30 };
    let lo = Infinity, hi = -Infinity;
    for (const k of keys) for (const v of cut[k]) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (opts.unit === "pct") { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    const span = (hi - lo) || 1; lo -= span * 0.08; hi += span * 0.1;
    const ticks = niceTicks(lo, hi, narrow ? 4 : 5);
    lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
    const X = (i) => pad.l + (n > 1 ? i / (n - 1) : 0.5) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
    const path = (arr) => arr.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1)).join("");

    const bench = opts.bench === "spx" ? "spx" : "gold";
    const endF = cut.fund[n - 1], endB = cut[bench][n - 1];
    const lead = endF - endB, ahead = lead >= 0;
    const leadTxt = (ahead ? "+" : "-") + (opts.unit === "pct" ? Math.abs(lead).toFixed(1) + " pts" : shortUsd(Math.abs(lead)));
    const area = path(cut.fund) + cut[bench].map((v, i) => "L" + X(n - 1 - i).toFixed(1) + " " + Y(cut[bench][n - 1 - i]).toFixed(1)).join("") + "Z";

    // x labels: month starts for long ranges, a few days for short ones
    const xl = [];
    if (n > 45) {
      xl.push([0, day(cut.days[0]).split(" ")[0], "start"]);
      cut.days.forEach((d, i) => { if (i && d.slice(5, 7) !== cut.days[i - 1].slice(5, 7)) xl.push([i, day(d).split(" ")[0]]); });
      if (xl.length > 1 && xl[1][0] < n * 0.08) xl.shift();   // month change right at the start: keep just one
    }
    else { const every = Math.max(1, Math.round(n / (narrow ? 3 : 5))); for (let i = 0; i < n; i += every) xl.push([i, day(cut.days[i])]); }

    const tint = ahead ? HEX.fund : "#D92D20";   // the lead: a light ink wash; behind: a light red one
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("aria-label", `Since ${day(opts.range === "ALL" ? race.first : cut.days[0])}: ` +
      keys.map(k => `${NAMES[k]} ${fmtV(cut[k][n - 1])}`).join(", "));
    // only our line draws itself (pathLength="1"); gold and the S&P keep real
    // lengths so their dash and dot patterns (site.css) stay dashes and dots
    svg.innerHTML = `
      <defs>
        <linearGradient id="leadFill" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stop-color="${tint}" stop-opacity=".01"/>
          <stop offset="1" stop-color="${tint}" stop-opacity="${ahead ? ".09" : ".14"}"/>
        </linearGradient>
      </defs>
      <g class="grid">${ticks.map(t => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}"/>`).join("")}</g>
      <g class="axis">${ticks.map(t => `<text x="${pad.l - 10}" y="${(Y(t) + 4).toFixed(1)}" text-anchor="end">${tickLabel(t)}</text>`).join("")}
        ${xl.map(([i, s, anchor]) => `<text x="${X(i).toFixed(1)}" y="${H - 8}" text-anchor="${anchor || "middle"}">${s}</text>`).join("")}</g>
      ${opts.unit === "pct" ? `<line class="base" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}"/>` : ""}
      <path class="lead" d="${area}" fill="url(#leadFill)"/>
      ${keys.slice().reverse().map(k => `<path class="line ${k}"${k === "fund" ? ' pathLength="1"' : ""} d="${path(cut[k])}"/>`).join("")}
      ${keys.map(k => `<circle class="end ${k}" cx="${X(n - 1).toFixed(1)}" cy="${Y(cut[k][n - 1]).toFixed(1)}" r="3.5" fill="${HEX[k]}"/>`).join("")}
      <line class="cross" y1="${pad.t}" y2="${H - pad.b}"/>
      ${keys.map(k => `<circle class="dot" data-k="${k}" r="4.5" fill="#FFFFFF" stroke-width="2" stroke="${HEX[k]}"/>`).join("")}`;

    // the lead readout, pinned between our end point and the benchmark's
    leadEl.className = "race-lead" + (ahead ? "" : " behind");
    leadEl.innerHTML = `${ahead ? "Lead over" : "Behind"} ${bench === "gold" ? "gold" : "the S&amp;P 500"}<b>${leadTxt}</b>`;
    leadEl.style.top = narrow ? "22px" : ((Y(endF) + Y(endB)) / 2).toFixed(0) + "px";
    leadEl.style.width = narrow ? "auto" : (pad.r - 18) + "px";

    empty.hidden = true;
    bindHover(X, Y, pad, W, n);
  }

  function bindHover(X, Y, pad, W, n) {
    const cross = svg.querySelector(".cross"), dots = [...svg.querySelectorAll(".dot")];
    const at = (clientX) => {
      const r = svg.getBoundingClientRect();
      const x = Math.min(Math.max(clientX - r.left, pad.l), W - pad.r);
      const i = Math.round((x - pad.l) / ((W - pad.l - pad.r) || 1) * (n - 1));
      const cx = X(i).toFixed(1);
      cross.setAttribute("x1", cx); cross.setAttribute("x2", cx);
      for (const dt of dots) { dt.setAttribute("cx", cx); dt.setAttribute("cy", Y(cut[dt.dataset.k][i]).toFixed(1)); }
      tip.innerHTML = `<div class="d">${day(cut.days[i])}, ${cut.days[i].slice(0, 4)}</div>` +
        visible().map(k => `<div class="r"><span class="k ${CLS[k]}">${NAMES[k]}</span><b>${fmtV(cut[k][i])}</b></div>`).join("");
      const left = +cx > W / 2 ? +cx - tip.offsetWidth - 16 : +cx + 16;
      tip.style.left = Math.max(0, left) + "px";
      el.classList.add("hover");
    };
    svg.onpointermove = (e) => at(e.clientX);
    svg.onpointerdown = (e) => at(e.clientX);
    svg.onpointerleave = () => el.classList.remove("hover");
  }

  function tickLabel(t) {
    if (opts.unit === "pct") return (t > 0 ? "+" : "") + +t.toFixed(1) + "%";
    return shortUsd(t);
  }

  return {
    set(r) {
      race = r;
      if (!r) { empty.textContent = "The race starts with the first sized call."; empty.hidden = false; svg.innerHTML = ""; leadEl.innerHTML = ""; return; }
      render();
      if (reducedMotion.matches) el.classList.add("drawn");
    },
    view(o) { Object.assign(opts, o); render(); },
    get opts() { return { ...opts }; },
    fail(msg) { empty.textContent = msg; empty.hidden = false; },
  };
}

// Round tick values across [lo, hi].
export function niceTicks(lo, hi, count) {
  const raw = (hi - lo) / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

// Wire a set of [data-bench]/[data-range]/[data-unit] buttons to a chart.
export function bindRaceControls(root, chart) {
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-bench],button[data-range],button[data-unit]");
    if (!b) return;
    const [k] = ["bench", "range", "unit"].filter(x => b.dataset[x] != null);
    chart.view({ [k]: b.dataset[k] });
    root.querySelectorAll(`button[data-${k}]`).forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  });
}
