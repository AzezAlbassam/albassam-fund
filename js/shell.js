// ============================================================
// Shared page behaviors: the environment layer, nav state, reveal
// choreography, number count-ups, pausing on hidden tabs, the
// build stamp and the "new version" bar. Plus small formatters.
// ============================================================

import { BUILD } from "./config.js?v=18";

export const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

export function initShell() {
  // environment: a few sparks drifting up (seeded, so identical every load)
  const env = document.querySelector(".env");
  if (env && !env.querySelector("i")) {
    let s = 20260704;
    const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < 14; i++) {
      const sp = document.createElement("i");
      const dur = 26 + rnd() * 22;
      sp.style.cssText = `left:${(4 + rnd() * 92).toFixed(1)}%;animation-duration:${dur.toFixed(1)}s;` +
        `animation-delay:${(-rnd() * dur).toFixed(1)}s;--dx:${((rnd() - 0.5) * 120).toFixed(0)}px;` +
        `scale:${(0.5 + rnd() * 0.9).toFixed(2)}`;
      env.appendChild(sp);
    }
  }

  // nav gets a glass background once the page moves
  const nav = document.querySelector(".nav");
  let scrolled = null;
  const onScroll = () => {
    const s = scrollY > 24;
    if (s !== scrolled) { scrolled = s; nav?.classList.toggle("scrolled", s); }
  };
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // pause every loop on hidden tabs
  document.addEventListener("visibilitychange", () =>
    document.body.classList.toggle("paused", document.hidden));

  // reveal choreography
  observeReveals(document);

  // the viewer's own "Pause motion" switch (remembered on this device)
  const still = () => { try { return localStorage.getItem("af:still") === "1"; } catch (e) { return false; } };
  const applyStill = (on) => {
    document.body.classList.toggle("still", on);
    document.querySelectorAll("video").forEach(v => (on ? v.pause() : v.play().catch(() => {})));
    document.querySelectorAll("[data-motion-toggle]").forEach(b => { b.textContent = on ? "Play motion" : "Pause motion"; b.setAttribute("aria-pressed", String(on)); });
    window.dispatchEvent(new CustomEvent("motion", { detail: { still: on } }));
  };
  document.querySelectorAll("[data-motion-toggle]").forEach(b => b.addEventListener("click", () => {
    const on = !document.body.classList.contains("still");
    try { localStorage.setItem("af:still", on ? "1" : "0"); } catch (e) {}
    applyStill(on);
  }));
  if (still()) applyStill(true);

  // cards lean toward the pointer (mouse only)
  if (matchMedia("(pointer: fine)").matches && !reducedMotion.matches) {
    document.addEventListener("pointermove", (e) => {
      const c = e.target.closest?.(".tilt");
      if (!c) return;
      const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      const k = 8 * Math.min(1, 420 / r.width);   // wide rows lean less than small cards
      c.style.transform = `perspective(900px) rotateY(${(x * k).toFixed(2)}deg) rotateX(${(-y * k).toFixed(2)}deg) translateY(-4px)`;
    }, { passive: true });
    document.addEventListener("pointerout", (e) => {
      const c = e.target.closest?.(".tilt");
      if (c && !c.contains(e.relatedTarget)) c.style.transform = "";
    });
  }

  // the owner's "+ New call" button, only on a device where the manager signed in
  try {
    if (localStorage.getItem("af:owner") === "1" && !document.getElementById("addForm"))
      import("./owner.js?v=18").then(m => m.startOwner()).catch(e => console.warn("quick add unavailable:", e));
  } catch (e) { /* storage blocked */ }

  // a family member's line on the board refreshes whenever they open any page
  try {
    if (localStorage.getItem("af:racer") === "1" && !document.getElementById("mineDesk"))
      setTimeout(() => import("./folio.js?v=18").then(m => m.syncMine()).catch(e => console.warn("board refresh skipped:", e)), 4000);
  } catch (e) { /* storage blocked */ }

  // "Get the app": install on the phone's home screen
  installer();

  // build stamp + update bar
  document.querySelectorAll("[data-build]").forEach(el => (el.textContent = "build " + BUILD));
  setTimeout(checkForUpdate, 10000);
  setInterval(checkForUpdate, 4 * 60 * 1000);
}

// Adds .in to [data-reveal], [data-stagger] and .molten once they are
// on screen; staggers retire their delays after the entrance.
const revealCbs = new WeakMap();
let io = null;
export function observeReveals(root) {
  const els = root.querySelectorAll("[data-reveal]:not(.in),[data-stagger]:not(.in),.molten:not(.in)");
  if (!("IntersectionObserver" in window) || reducedMotion.matches) {
    els.forEach(show);
    return;
  }
  io ??= new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); show(e.target); }
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
  els.forEach(el => io.observe(el));
}
function show(el) {
  el.classList.add("in");
  if (el.hasAttribute("data-stagger")) setTimeout(() => el.classList.add("done"), 1400);
  const fns = revealCbs.get(el);
  revealCbs.delete(el);
  fns?.forEach(fn => fn());
}
// Run fn the first time el is revealed (immediately if it already was).
export function onReveal(el, fn) {
  if (!el || el.classList.contains("in")) return fn();
  const fns = revealCbs.get(el) || [];
  fns.push(fn);
  revealCbs.set(el, fns);
}

// Count a number up to its new value. fmt turns a number into text.
export function countTo(el, to, fmt, ms = 1100) {
  if (!el || to == null || isNaN(to)) return;
  const from = el._v ?? 0;
  el._v = to;
  cancelAnimationFrame(el._raf);
  if (reducedMotion.matches || document.hidden || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}

// Rolling digits: each digit is a column of 0-9 that slides to its
// value. Rebuilds when the shape of the text changes.
export function roll(el, text) {
  if (!el || text == null) return;
  if (el._rolled === text) return;
  el._rolled = text;
  el.classList.add("odo");
  el.setAttribute("aria-label", text);
  const shape = text.replace(/\d/g, "0");
  if (el._shape !== shape) {
    el._shape = shape;
    el.innerHTML = [...text].map(ch => /\d/.test(ch)
      ? `<span class="col" aria-hidden="true"><span>${"0123456789".split("").map(d => `<span>${d}</span>`).join("")}</span></span>`
      : `<span aria-hidden="true">${esc(ch)}</span>`).join("");
    el.offsetWidth;   // commit the zero state so the first roll animates
  }
  const cols = el.querySelectorAll(".col > span");
  let k = 0;
  [...text].forEach(ch => {
    if (!/\d/.test(ch)) return;
    const col = cols[k++];
    col.style.transitionDelay = (reducedMotion.matches ? 0 : k * 0.06) + "s";
    col.style.transform = `translateY(-${+ch}em)`;
  });
}

// The site installs like an app: Android gets the browser's own install
// prompt; iPhone gets the two Safari steps (Apple offers no prompt).
let deferred = null;
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; });
function installer() {
  const btn = document.querySelector("[data-install]");
  if (!btn) return;
  if (matchMedia("(display-mode: standalone)").matches || navigator.standalone) { btn.hidden = true; return; }
  btn.addEventListener("click", async () => {
    if (deferred) {
      const e = deferred; deferred = null;
      try { await e.prompt(); return; } catch (err) { /* the browser said no: show the steps instead */ }
    }
    let d = document.querySelector(".install-sheet");
    if (!d) {
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      d = document.createElement("dialog");
      d.className = "install-sheet glass";
      d.setAttribute("aria-labelledby", "instTitle");
      d.innerHTML = `<h2 id="instTitle">Put the fund on your home screen</h2>
        <ol>${ios
          ? "<li>Open this page in <b>Safari</b>.</li><li>Tap <b>Share</b> <span aria-hidden=\"true\">(the square with an arrow)</span>.</li><li>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>"
          : "<li>Open this page in <b>Chrome</b>.</li><li>Tap the <b>⋮</b> menu.</li><li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li>"}</ol>
        <p>It opens full screen with its own icon, like any app. Only people with the link can get it.</p>
        <button class="btn" type="button">Got it</button>`;
      d.querySelector("button").addEventListener("click", () => d.close());
      d.addEventListener("click", (e) => {   // a tap outside the sheet closes it (not one on its own padding)
        const r = d.getBoundingClientRect();
        if (e.target === d && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) d.close();
      });
      document.body.appendChild(d);
    }
    d.showModal();
  });
}

async function checkForUpdate() {
  try {
    const html = await (await fetch(location.pathname, { cache: "no-store" })).text();
    const m = html.match(/\?v=(\d+)/);
    if (m && +m[1] > BUILD && !document.querySelector(".bar-note")) {
      const b = document.createElement("button");
      b.className = "bar-note";
      b.textContent = "New version ready. Tap to update.";
      b.onclick = async () => {
        b.textContent = "Updating…";
        try { await fetch(location.href, { cache: "reload" }); } catch (e) {}
        location.reload();
      };
      document.body.appendChild(b);
    }
  } catch (e) { /* offline: try later */ }
}

/* ----------------------- formatters ----------------------- */
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const usd0 = (v) => (v < 0 ? "-$" : "$") + Math.round(Math.abs(v)).toLocaleString("en-US");
export const usd2 = (v) => v == null || isNaN(v) ? "…" :
  "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const signedUsd = (v) => (v >= 0 ? "+" : "-") + "$" + Math.round(Math.abs(v)).toLocaleString("en-US");
export const pct1 = (p) => p == null || isNaN(p) ? "…" : (p >= 0 ? "+" : "-") + Math.abs(p).toFixed(1) + "%";
export const pctBig = (p) => p == null || isNaN(p) ? "…" : Math.abs(p) < 1000 ? pct1(p)
  : (p >= 0 ? "+" : "-") + Math.round(Math.abs(p)).toLocaleString("en-US") + "%";
export const pts1 = (p) => (p >= 0 ? "+" : "-") + Math.abs(p).toFixed(1) + " pts";
export const shortUsd = (v) => v >= 1e6 ? "$" + +(v / 1e6).toFixed(2) + "M" : v >= 1e3 ? "$" + +(v / 1e3).toFixed(1) + "K" : "$" + Math.round(v);
export const day = (d) => d ? MON[+d.slice(5, 7) - 1] + " " + +d.slice(8, 10) : "";
export const dayYear = (d) => d ? day(d) + ", " + d.slice(0, 4) : "";
export const month = (m) => MON[+m.slice(5, 7) - 1];
export const daysBetween = (a, b) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 864e5));
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const pctClass = (p) => p == null ? "" : p >= 0 ? "pos" : "neg";

// Company logo with a letter-badge fallback.
export function logoHtml(t) {
  const ph = `<span class="logo ph" aria-hidden="true">${esc((t.ticker || "?")[0])}</span>`;
  return t.logo
    ? `<img class="logo" src="${esc(t.logo)}" alt="" loading="lazy" onerror="this.outerHTML='${ph.replace(/"/g, "&quot;")}'">`
    : ph;
}
