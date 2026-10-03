// ============================================================
// The Family page: the public board (a 3D podium, the standings
// and the race chart) and each member's private portfolio desk.
// Storage and the return math live in folio.js. Our fund runs as
// the pace setter, from the same race the home page draws.
// ============================================================

import { initShell, observeReveals, onReveal, countTo, pct1, usd0, usd2, day, esc, logoHtml, pctClass } from "./shell.js?v=18";
import { live, state } from "./live.js?v=18";
import { loadRace } from "./series.js?v=18";
import { niceTicks } from "./chart.js?v=18";
import { watchTickers, checkTicker } from "./prices.js?v=18";
import { backend, measure, publishMine, remember, COLORS, DASHES, MAX_HOLDINGS,
         makeKey, newSalt, unb64, sealMine, openMine, keepKey, keptKey, dropKey, nextLine, passcodeProblem } from "./folio.js?v=18";

const $ = (id) => document.getElementById(id);
const RANGES = { "1M": 22, "3M": 64 };   // ponytail: mirrors chart.js RANGES
const FUND_HEX = "#0B0B0C";

initShell();

let api = null, racers = [], racersIn = false, boardErr = false, fundLine = null;
let me = null, isMem = null, mine = null, measured = null, unMine = null, unMem = null;

/* ======================= the board ======================= */

// Everyone on the board, best return first. Each member keeps the
// style they picked up when they first joined. The board carries no
// one's day-by-day line; the chart shows yours, from your own sealed
// box, next to the fund's.
function entries() {
  const ids = racers.map(r => r.id).sort();
  const list = racers.map(r => {
    const i = (r.c ?? ids.indexOf(r.id)) % COLORS.length, mine_ = r.id === me?.uid;
    const own = mine_ && mine?.line?.days?.length ? mine.line : null;
    return { ...r, color: mine_ ? "#0B0B0C" : COLORS[i], dash: DASHES[i], me: mine_, days: own?.days || [], vals: own?.vals || [] };
  });
  if (fundLine) list.push(fundLine);
  return list.sort((a, b) => b.pct - a.pct);
}

function paintBoard() {
  const list = entries();
  standings(list);
  podium(list);
  chart.set(list);
}

function ago(t) {
  const m = Math.round((Date.now() - t) / 6e4);
  if (m < 2) return "just now";
  if (m < 60) return m + " min ago";
  if (m < 36 * 60) return Math.round(m / 60) + " h ago";
  return "on " + day(new Date(t).toISOString().slice(0, 10));
}

function standings(list) {
  const el = $("famList");
  if (!racersIn && !boardErr) return;   // keep "Loading the board…" until the members arrive
  el.innerHTML = list.map((r, i) => `
    <li class="fr${r.fund ? " fund" : ""}${r.me ? " me" : ""}" style="--c:${r.color}">
      <span class="fr-rank num">${i + 1}</span>
      <svg class="fr-dot" viewBox="0 0 22 6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke="${r.color}" stroke-width="${r.me || r.fund ? 3 : 2}"${r.me || r.fund ? "" : ` stroke-dasharray="${r.dash}"`}/></svg>
      <span class="fr-name"><b>${esc(r.name)}</b>${r.me ? " <em>You</em>" : ""}${r.fund ? " <em>Pace setter</em>" : ""}
        <small>${r.fund ? "Our fund's calls since July 4" : "Updated " + ago(r.at)}</small></span>
      <b class="fr-pct num ${pctClass(r.pct)}">${pct1(r.pct)}</b>
    </li>`).join("") +
    (boardErr ? `<li class="fr-cta">The family board could not load right now. Refresh the page to try again.</li>`
      : racers.length ? "" : `<li class="fr-cta">No one has joined yet. <a href="#mine">Be the first</a>.</li>`);
}

/* ---------- the podium: one 3D tower per portfolio, the leader in the middle ---------- */
let towers = null;
function podium(list) {
  if (!towers || !list.length) return;
  const top = list.slice(0, 9);   // ponytail: the podium shows the top nine, the standings show everyone
  const labelled = $("podStage").clientWidth < 560 ? 5 : 9;   // a phone labels the top five
  const max = Math.max(1, ...top.map(r => r.pct));
  towers.set(top.map((r, i) => {
    const slot = i % 2 ? -(i + 1) / 2 : i / 2;   // 0, -1, +1, -2, +2 …
    return {
      id: r.id, x: slot * 1.5, z: -Math.abs(slot) * 0.3, w: 0.95,
      h: r.pct > 0 ? 0.35 + (r.pct / max) * 4.2 : 0.25,
      color: r.pct < 0 ? "#D92D20" : r.fund ? 0x0b0b0c : r.color,
      label: i < labelled ? `${esc(r.name)} <b${r.pct < 0 ? ' class="neg"' : ""}>${pct1(r.pct)}</b>` : null,
      labelClass: (Math.abs(slot) % 2 ? "alt" : "") + (r.fund ? " fund" : ""),
    };
  }));
}
import("./bars3d.js?v=18")
  .then(m => m.startTowers($("podCanvas"), $("podLabels"), { yaw0: -0.3, pitch: 0.36, spin: 0.07 }))
  .then(t => { towers = t; podium(entries()); })
  .catch(err => { console.warn("3D podium unavailable:", err); $("podStage").classList.add("fallback"); });

/* ---------- the race chart: every portfolio's line, our fund's too ---------- */
function famChart(el) {
  el.classList.add("race");
  el.innerHTML = `<svg role="img" aria-label="Loading the family race"></svg><div class="race-tip" aria-hidden="true"></div><div class="race-empty">Loading the race…</div>`;
  const svg = el.querySelector("svg"), tip = el.querySelector(".race-tip"), empty = el.querySelector(".race-empty");
  let lines = [], range = "1M";
  onReveal(el.closest("[data-reveal]") || el, () => requestAnimationFrame(() => el.classList.add("drawn")));
  new ResizeObserver(() => draw()).observe(el);

  function draw() {
    const W = el.clientWidth, H = el.clientHeight;
    if (!W || !H || !lines.length) return;
    const all = [...new Set(lines.flatMap(l => l.days))].sort();
    const k = RANGES[range], days = k ? all.slice(-(k + 1)) : all, n = days.length;
    const at = new Map(days.map((d, i) => [d, i]));
    const ser = lines.map(l => {
      const v = new Array(n).fill(null);
      l.days.forEach((d, i) => { const j = at.get(d); if (j != null && l.vals[i] != null) v[j] = l.vals[i]; });
      return { ...l, v };
    }).filter(s => s.v.some(x => x != null));
    let lo = 0, hi = 0;
    for (const s of ser) for (const x of s.v) if (x != null) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    const span = (hi - lo) || 1; lo -= span * 0.08; hi += span * 0.1;
    const narrow = W < 560, ticks = niceTicks(lo, hi, narrow ? 4 : 5);
    lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks.at(-1));
    const pad = { l: narrow ? 46 : 58, r: narrow ? 12 : 22, t: 16, b: 30 };
    const X = (i) => pad.l + (n > 1 ? i / (n - 1) : 0.5) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
    // members record a point when they visit, so a line runs straight across the days in between
    const path = (v) => v.map((x, i) => (x == null ? "" : X(i).toFixed(1) + " " + Y(x).toFixed(1))).filter(Boolean).map((p, i) => (i ? "L" : "M") + p).join("");
    const last = (v) => { for (let i = v.length - 1; i >= 0; i--) if (v[i] != null) return i; return -1; };

    const xl = [];   // month starts for long ranges, a few days for short ones
    if (n > 45) {
      xl.push([0, day(days[0]).split(" ")[0], "start"]);
      days.forEach((d, i) => { if (i && d.slice(5, 7) !== days[i - 1].slice(5, 7)) xl.push([i, day(d).split(" ")[0]]); });
      if (xl.length > 1 && xl[1][0] < n * 0.08) xl.shift();
    } else { const every = Math.max(1, Math.round(n / (narrow ? 3 : 5))); for (let i = 0; i < n; i += every) xl.push([i, day(days[i])]); }

    const order = ser.slice().sort((a, b) => (a.fund ? 1 : 0) - (b.fund ? 1 : 0) || (a.me ? 1 : 0) - (b.me ? 1 : 0));   // ours and yours on top
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("aria-label", "The family race: " + ser.map(s => `${s.name} ${pct1(s.pct)}`).join(", "));
    svg.innerHTML = `
      <g class="grid">${ticks.map(t => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}"/>`).join("")}</g>
      <g class="axis">${ticks.map(t => `<text x="${pad.l - 10}" y="${(Y(t) + 4).toFixed(1)}" text-anchor="end">${(t > 0 ? "+" : "") + +t.toFixed(1)}%</text>`).join("")}
        ${xl.map(([i, s, a]) => `<text x="${X(i).toFixed(1)}" y="${H - 8}" text-anchor="${a || "middle"}">${s}</text>`).join("")}</g>
      <line class="base" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}"/>
      ${order.map(s => `<path class="line${s.fund ? " fund" : ""}${s.me ? " me" : ""}" d="${path(s.v)}"${s.fund ? "" : ` style="stroke:${s.color};stroke-dasharray:${s.dash}"`}/>`).join("")}
      ${order.map(s => { const i = last(s.v); return `<circle class="end${s.fund ? " fund" : ""}" cx="${X(i).toFixed(1)}" cy="${Y(s.v[i]).toFixed(1)}" r="${s.me || s.fund ? 4 : 3}" fill="${s.color}"/>`; }).join("")}
      <line class="cross" y1="${pad.t}" y2="${H - pad.b}"/>`;
    empty.hidden = true;

    const cross = svg.querySelector(".cross");
    const show = (clientX) => {
      const r = svg.getBoundingClientRect();
      const x = Math.min(Math.max(clientX - r.left, pad.l), W - pad.r);
      const i = Math.round((x - pad.l) / ((W - pad.l - pad.r) || 1) * (n - 1));
      cross.setAttribute("x1", X(i).toFixed(1)); cross.setAttribute("x2", X(i).toFixed(1));
      const rows = ser.filter(s => s.v[i] != null).sort((a, b) => b.v[i] - a.v[i]);
      tip.innerHTML = `<div class="d">${day(days[i])}, ${days[i].slice(0, 4)}</div>` +
        (rows.map(s => `<div class="r"><span class="k" style="color:${s.color}">${esc(s.name)}</span><b>${pct1(s.v[i])}</b></div>`).join("") || `<div class="r">No points this day</div>`);
      const tw = tip.offsetWidth, right = X(i) + 16;
      tip.style.left = Math.max(0, Math.min(W - tw, right + tw <= W ? right : X(i) - tw - 16)) + "px";
      el.classList.add("hover");
    };
    svg.onpointermove = (e) => show(e.clientX);
    svg.onpointerdown = (e) => show(e.clientX);
    svg.onpointerleave = () => el.classList.remove("hover");
  }
  return {
    set(ls) { lines = ls; if (!ls.length) return; draw(); },
    view(r) { range = r; draw(); },
    fail(msg) { empty.textContent = msg; empty.hidden = false; },
  };
}
const chart = famChart($("famChart"));
$("famControls").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-range]");
  if (!b) return;
  chart.view(b.dataset.range);
  $("famControls").querySelectorAll("button[data-range]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
});

/* ---------- our fund, the pace setter ---------- */
let raceKey = "", raceSeq = 0;
async function fundRace(what) {
  const sized = state.trades.filter(t => t.wt > 0 && t.opened);
  const k = JSON.stringify([state.pot, sized.map(t => [t.ticker, t.status, t.opened, t.closed, t.finalPct, t.wt, t.txns])]);
  if (k === raceKey && !(what === "quotes" && sized.some(t => t.status === "active"))) return;
  raceKey = k;
  const my = ++raceSeq;
  let r = null;
  try { r = sized.length ? await loadRace(state.trades, state.pot, state.quotes) : null; } catch (e) { console.warn("fund race failed:", e); }
  if (my !== raceSeq) return;
  fundLine = r && {
    id: "fund", name: "Albassam Fund", fund: true, color: FUND_HEX, at: Date.now(),
    days: r.days, vals: r.fund.map(v => (v / r.pot - 1) * 100), pct: (r.fund.at(-1) / r.pot - 1) * 100,
  };
  paintBoard();
}

live((what) => {
  if (what === "quotes" && mine) refreshMine();
  if (state.ready) fundRace(what);
});


/* ======================= my portfolio ======================= */

const say = (el, text, err) => { if (!el) return; el.textContent = text; el.className = "mine-msg" + (text ? (err ? " err" : " ok") : ""); };
const defaultName = (u) => (u.displayName || u.email || "Me").split(/[\s@]/)[0].slice(0, 24);
const fmtSh = (v) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 4 });
const keyOf = (hs) => JSON.stringify(hs.map(h => [h.tk, h.sh, h.avg]));   // same stocks, same numbers
const takenColors = () => racers.filter(r => r.id !== me?.uid).map(r => r.c).filter(c => c != null);
const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
const nameTaken = (n) => sameName(n, "Albassam Fund") || racers.some(r => r.id !== me?.uid && sameName(r.name, n));

// Changes run one after another, each built from the portfolio as it
// stands when its turn comes, so a tap never acts on old numbers and
// no control has to be locked while another change saves.
let queue = Promise.resolve();
const run = (fn) => (queue = queue.then(fn).catch(e => console.error(e)));

// The passcode lock: the key opens this member's sealed box. It lives
// in memory, and on this device too if the member chose to remember it.
let key = null, salt = null, raw = null, lockMode = null, rawSeq = 0, pending = null;   // pending: a new passcode being saved

// Which card shows: sign in, ask to join, the lock, or the desk.
function view() {
  $("mineGate").hidden = !!me;
  $("mineJoin").hidden = !me || isMem === true;
  $("mineLock").hidden = !me || isMem !== true || !lockMode;
  $("mineDesk").hidden = !me || isMem !== true || !!lockMode;
}

function onUser(u) {
  me = u; isMem = null;
  unMine?.(); unMem?.(); unMine = unMem = null; mine = null; measured = null; published = false;
  key = salt = raw = null; lockMode = "wait"; rawSeq++; lockForm.reset(); passForm.reset(); passForm.hidden = true;
  // nothing of the last person stays on the page (a shared phone)
  $("holdRows").innerHTML = ""; paintedFor = null;
  blankPct(); $("mineSub").textContent = "Only you see this card.";
  $("boardName").value = ""; resetForm();
  ["formMsg", "optsMsg", "gateMsg", "joinMsg", "lockMsg", "passMsg"].forEach(id => say($(id), ""));
  watchTickers([], "mine");
  view();
  if (!u) { remember(false); paintBoard(); return; }
  $("mineName").textContent = u.displayName || "Signed in";
  $("mineEmail").textContent = u.email || "";
  document.querySelectorAll("[data-me-email]").forEach(i => (i.value = u.email || ""));   // lets a password manager file the passcode under this account
  $("minePhoto").innerHTML = u.photoURL ? `<img src="${esc(u.photoURL)}" alt="" referrerpolicy="no-referrer">` : esc((u.displayName || u.email || "?")[0]);
  joinState("checking");
  unMem = api.watchMember(u, (ok) => {
    if (me?.uid !== u.uid) return;
    isMem = ok; view();
    remember(ok);   // other pages refresh the board point only for a member
    if (!ok) { unMine?.(); unMine = null; mine = null; return askedYet(u); }
    if (unMine) return;
    published = false;
    lock("wait");
    unMine = api.watchMine(u.uid, (doc) => onRaw(u, doc),
      (err) => { console.error(err); say($("lockMsg"), "Your portfolio could not load. Refresh the page to try again.", true); });
    observeReveals(document);
  }, (err) => { console.error(err); joinState("error"); });
  paintBoard();
}

/* ---------- the lock: choose a passcode, or open the box with it ---------- */
const lockForm = $("mineLock"), passForm = $("passForm");
const LOCK = {
  wait: ["Opening your portfolio…", ""],
  setup: ["Choose your passcode.",
    "Your stocks are sealed with a passcode only you know. The family can't read them, the manager can't, and neither can the database itself. Write it down: if you forget it, nobody can get it back and you type your stocks in again."],
  unlock: ["Enter your passcode.", "Your portfolio is sealed. Your passcode opens it on this device."],
};
function lock(mode) {
  lockMode = mode; view();
  if (!mode) return;
  say($("lockMsg"), "");
  const [title, copy] = LOCK[mode];
  $("lockTitle").textContent = title; $("lockCopy").textContent = copy;
  lockForm.classList.toggle("waiting", mode === "wait");
  $("lockAgainRow").hidden = mode !== "setup";
  $("lockForgot").hidden = mode !== "unlock";
  $("lockGo").textContent = mode === "setup" ? "Lock my portfolio" : "Open my portfolio";
  $("lockPass").autocomplete = mode === "setup" ? "new-password" : "current-password";
}

// Every change to the stored portfolio lands here, sealed. It opens with
// the key in memory or the one kept on this device; otherwise the lock asks.
async function onRaw(u, doc) {
  const my = ++rawSeq;
  raw = doc;
  if (!doc) {   // a new member, or one who started over
    if (key) { mine = { holdings: [], name: defaultName(u), show: true, fresh: true }; lock(null); paintMine(); return; }
    return lock("setup");
  }
  if (!doc.box) return lock("setup");   // saved before the lock existed: sealing it is the first step
  if (pending && b64of(pending.salt) === doc.box.salt) ({ key, salt } = pending);   // our own new passcode just landed
  if (!key || b64of(salt) !== doc.box.salt) {
    const k = await keptKey(u.uid);
    if (my !== rawSeq) return;
    if (k?.salt === doc.box.salt) { key = k.key; salt = unb64(k.salt); }
    else { key = null; if (k) dropKey(u.uid); }   // a key kept for an older passcode is no use
  }
  if (!key) { clearDesk(); return lock("unlock"); }
  try {
    const opened = await openMine(doc, key);
    if (my !== rawSeq) return;
    mine = opened; lock(null); paintMine(); refreshMine();
  } catch (e) {   // the passcode changed on another device
    if (my !== rawSeq) return;
    key = null; dropKey(u.uid); mine = null; lock("unlock");
  }
}
const b64of = (u8) => (u8 ? btoa(String.fromCharCode(...u8)) : "");
function clearDesk() {   // nothing of the opened portfolio stays on the page
  mine = null; measured = null;
  $("holdRows").innerHTML = ""; paintedFor = null; blankPct(); $("mineSub").textContent = "Only you see this card.";
  paintBoard();
}

lockForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!me || (lockMode !== "setup" && lockMode !== "unlock")) return;
  const msg = $("lockMsg"), pass = $("lockPass").value, keep = $("lockKeep").checked, uid = me.uid, mode = lockMode;
  if (!pass) return say(msg, "Enter your passcode.", true);
  if (mode === "setup") {
    const why = passcodeProblem(pass);
    if (why) return say(msg, why, true);
    if (pass !== $("lockAgain").value) return say(msg, "The two passcodes don't match.", true);
  }
  $("lockGo").disabled = true;
  say(msg, mode === "setup" ? "Sealing…" : "Opening…");
  try {
    if (mode === "unlock") {
      const s = unb64(raw.box.salt), k = await makeKey(pass, s);
      let opened;
      try { opened = await openMine(raw, k); } catch (err) { return say(msg, "That passcode doesn't open it. Try again.", true); }
      if (me?.uid !== uid) return;
      key = k; salt = s; mine = opened;
      if (keep) await keepKey(uid, k, s);
      lockForm.reset(); say(msg, ""); lock(null); paintMine(); refreshMine();
    } else {
      const s = newSalt(), k = await makeKey(pass, s);
      if (me?.uid !== uid) return;
      const old = raw && !raw.box ? await openMine(raw, null) : null;   // stocks saved before the lock: seal them now
      key = k; salt = s;
      mine = { holdings: old?.holdings || [], line: old?.line || null, name: old?.name || defaultName(me), show: old?.show !== false };
      if (keep) await keepKey(uid, k, s);
      lockForm.reset(); lock(null); paintMine();
      await run(() => save(() => ({}), $("optsMsg"), "Your portfolio is sealed. Add your stocks below.", { expect: raw?.box?.salt ?? null }));
    }
  } finally { $("lockGo").disabled = false; }
});
$("lockForgot").addEventListener("click", (e) => {
  const b = e.currentTarget;
  if (!me) return;
  if (!b.classList.contains("armed")) {
    b.classList.add("armed"); b.textContent = "Tap again: your stocks are erased and you start over";
    say($("lockMsg"), "Starting over erases your sealed stocks and your own line. You come back on the board when you add your stocks again.");
    setTimeout(() => { b.classList.remove("armed"); b.textContent = "Forgot it? Start over"; }, 5000);
    return;
  }
  b.classList.remove("armed"); b.textContent = "Forgot it? Start over";
  const uid = me.uid;
  run(async () => {
    try { await dropKey(uid); key = salt = null; await api.resetMine(uid); say($("lockMsg"), "Done. Choose a new passcode."); }
    catch (err) { console.error(err); say($("lockMsg"), "Could not start over. Try again.", true); }
  });
});
$("lockOut").addEventListener("click", () => { if (me) dropKey(me.uid); api?.signOut(); });

// From the desk: a new passcode (the stocks are sealed again with it), or lock now.
$("passChange").addEventListener("click", () => { passForm.hidden = !passForm.hidden; say($("passMsg"), ""); if (!passForm.hidden) $("passNew").focus(); });
passForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!me || !mine) return;
  const msg = $("passMsg"), pass = $("passNew").value, uid = me.uid;
  const why = passcodeProblem(pass);
  if (why) return say(msg, why, true);
  if (pass !== $("passAgain").value) return say(msg, "The two passcodes don't match.", true);
  say(msg, "Sealing with the new passcode…");
  const oldSalt = salt, wasKept = (await keptKey(uid))?.salt === b64of(oldSalt);
  const s = newSalt(), k = await makeKey(pass, s);
  if (me?.uid !== uid || !key) return;
  pending = { key: k, salt: s };
  const ok = await run(() => save(() => ({}), msg, "Done. Your new passcode is set.", { key: k, salt: s, expect: b64of(oldSalt) }));
  pending = null;
  if (!ok || me?.uid !== uid || !key) return;   // failed, signed out or locked meanwhile: keep nothing
  key = k; salt = s;
  if (wasKept) await keepKey(uid, k, s); else await dropKey(uid);
  passForm.reset(); passForm.hidden = true;
});
$("lockNow").addEventListener("click", () => {
  if (!me) return;
  dropKey(me.uid); key = salt = null; pending = null; clearDesk();
  lock(raw?.box ? "unlock" : "setup");
});

/* ---------- not let in yet: ask once ---------- */
function joinState(s) {
  $("joinCopy").textContent = {
    checking: "Checking the family list…",
    ask: "The race is for family only. Ask once and the manager lets you in.",
    asked: "Your request is in. You can add your stocks as soon as the manager lets you in.",
    error: "The family list could not load. Refresh the page to try again.",
  }[s];
  $("joinAsk").hidden = s !== "ask";
}
async function askedYet(u) {
  let r = null;
  try { r = await api.readAsk(u.uid); } catch (e) { /* none yet, or offline */ }
  if (me?.uid === u.uid && isMem === false) joinState(r ? "asked" : "ask");
}
$("joinAsk").addEventListener("click", async (e) => {
  const b = e.currentTarget;
  if (!me) return;
  b.disabled = true;
  try { await api.askToJoin(me, (me.displayName || me.email || "").slice(0, 40)); joinState("asked"); say($("joinMsg"), "Sent."); }
  catch (err) { console.error(err); say($("joinMsg"), "Could not send it. Try again.", true); }
  finally { b.disabled = false; }
});

// Prices move: measure again (one run at a time) and, until it has
// worked once this visit, set today's point on the board.
let measuring = false, again = false, published = false;
async function refreshMine() {
  if (!me || !mine) return;
  if (measuring) { again = true; return; }
  measuring = true;
  const uid = me.uid, doc = mine;
  try {
    watchTickers(doc.holdings.map(h => h.tk), "mine");
    const m = doc.holdings.length ? await measure(doc.holdings) : null;
    if (me?.uid !== uid || mine !== doc) return;   // signed out or changed meanwhile
    measured = m;
    paintMine();
    if (!published && !doc.fresh && m?.pct != null) {
      published = true;
      run(() => save(() => ({}), null)).then(ok => { if (!ok) published = false; });
    }
  } catch (e) { console.warn("portfolio prices failed:", e); }
  finally { measuring = false; if (again) { again = false; refreshMine(); } }
}

const blankPct = () => { const el = $("minePct"); cancelAnimationFrame(el._raf); el.textContent = "…"; el._v = 0; };   // stop a count-up mid-way too

// The table is rebuilt only when the stocks change; a price tick just
// updates the numbers, so focus and a pending "Remove?" survive it.
let paintedFor = null;
function paintMine() {
  if (!mine) return;
  const key = keyOf(mine.holdings), fresh = measured && keyOf(measured.for) === key;
  const rows = fresh ? measured.rows : mine.holdings.map(h => ({ ...h, px: null, pct: null, value: null, cost: h.sh * h.avg }));
  $("holdEmpty").hidden = rows.length > 0;
  if (paintedFor !== key) {
    paintedFor = key;
    $("holdRows").innerHTML = rows.map(r => `
      <tr>
        <th scope="row"><span class="h-tk">${logoHtml({ ticker: r.tk, logo: "" })}<b>${esc(r.tk)}</b></span></th>
        <td class="mono">${fmtSh(r.sh)}</td>
        <td class="mono">${usd2(r.avg)}</td>
        <td class="mono" data-px></td>
        <td class="mono" data-pct></td>
        <td><span class="h-act"><button type="button" class="act" data-edit="${esc(r.tk)}" aria-label="Edit ${esc(r.tk)}">Edit</button><button type="button" class="act del" data-del="${esc(r.tk)}" aria-label="Remove ${esc(r.tk)}">✕</button></span></td>
      </tr>`).join("");
  }
  $("holdRows").querySelectorAll("tr").forEach((tr, i) => {
    const r = rows[i];
    if (!r) return;
    tr.querySelector("[data-px]").textContent = r.px == null ? "…" : usd2(r.px);
    const pc = tr.querySelector("[data-pct]");
    pc.textContent = pct1(r.pct); pc.className = "mono " + pctClass(r.pct);
  });
  const p = fresh ? measured.pct : null, pctEl = $("minePct");
  if (rows.length && p != null) countTo(pctEl, p, pct1, 900); else blankPct();
  pctEl.className = "mine-pct num " + (p != null && p < 0 ? "neg" : "grad-text");
  const cost = rows.reduce((s, r) => s + r.cost, 0);
  const val = rows.every(r => r.value != null) ? rows.reduce((s, r) => s + r.value, 0) : null;
  $("mineSub").textContent = rows.length
    ? `Worth ${val == null ? "…" : usd0(val)} · cost ${usd0(cost)} · only you see this card`
    : "Only you see this card.";
  if (document.activeElement !== $("boardName")) $("boardName").value = mine.name || "";
  $("boardShow").checked = mine.show !== false;
}

// Save the whole portfolio, sealed, with today's point on your own line,
// then put your % on the board. Runs inside run(): `change(current)`
// returns the new fields, or a string to show as the reason nothing
// changed. `where` is the message line (null: quiet). `use` seals with
// a new passcode ({ key, salt }) and/or names the salt the stored box
// must still have ({ expect }); by default it is this device's own.
async function save(change, where, okText, use = {}) {
  if (!me || !mine) return false;
  const uid = me.uid, k = use.key || key, s = use.salt || salt;
  if (!k) { say(where, "Your portfolio is locked. Enter your passcode first.", true); return false; }
  const expect = "expect" in use ? use.expect : b64of(salt);
  const now = { holdings: mine.holdings, name: (mine.name || defaultName(me)).slice(0, 24), show: mine.show !== false, ...(mine.line ? { line: mine.line } : {}) };
  const patch = change(now);
  if (typeof patch === "string") { say(where, patch, true); return false; }
  const doc = { ...now, ...patch };
  const base = doc.name.slice(0, 21);
  for (let n = 2; nameTaken(doc.name) && n < 50; n++) doc.name = base + " " + n;   // two Abdullahs: the second shows as "Abdullah 2"
  say(where, "Saving…");
  try {
    const m = doc.holdings.length ? await measure(doc.holdings) : null;
    if (m?.pct != null) doc.line = { ...nextLine(doc.line, m.pct), c: doc.line?.c ?? racers.find(r => r.id === uid)?.c ?? null };
    await api.saveMine(uid, await sealMine(k, s, doc), expect);
    if (me?.uid !== uid || !key) return false;   // signed out or locked meanwhile: show nothing
    mine = doc; measured = m;
    paintMine(); paintBoard();
    const onBoard = await publishMine(uid, doc, m, takenColors());
    published = onBoard;   // prices missing: refreshMine tries again when they load
    say(where, !doc.holdings.length || !doc.show ? (doc.holdings.length ? "Saved. You are hidden from the race." : okText || "Saved.")
      : onBoard ? okText || "Saved. Your % is on the board." : "Saved. The board updates as soon as prices load.");
    return true;
  } catch (err) {
    console.error(err);
    if (err?.code === "stale") {   // the passcode or the stocks changed on another device
      say(where, "Your portfolio was changed on another device. Enter your passcode to open the latest.", true);
      if (me?.uid === uid) { key = null; dropKey(uid); clearDesk(); lock("unlock"); }
      return false;
    }
    say(where, String(err?.code || "").includes("permission") ? "The manager hasn't let you in yet, so this wasn't saved."
      : "Could not save. Check your connection and try again.", true);
    return false;
  }
}

/* ---------- add or edit a stock ---------- */
const form = $("holdForm");
let editTk = null, formRev = 0;   // formRev changes whenever the form is reset or loaded
function resetForm() {
  form.reset(); editTk = null; formRev++; delete form.dataset.unverified;
  $("formTitle").textContent = "Add a stock";
  $("formGo").textContent = "Add to my portfolio";
  $("formCancel").hidden = true;
}
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!mine) return;
  const msg = $("formMsg"), go = $("formGo");
  const tk = form.tk.value.trim().toUpperCase(), sh = parseFloat(form.sh.value), avg = parseFloat(form.avg.value);
  const from = editTk, rev = formRev;
  if (!/^[A-Z0-9^][A-Z0-9.\-=^]{0,9}$/.test(tk)) return say(msg, "Enter a ticker symbol, like MU.", true);
  if (!(sh > 0 && sh < 1e9)) return say(msg, "Enter how many shares you hold.", true);
  if (!(avg > 0 && avg < 1e7)) return say(msg, "Enter your average buy price.", true);
  go.disabled = true;
  try {
    if (tk !== from && form.dataset.unverified !== tk) {
      say(msg, "Checking " + tk + "…");
      if (!(await checkTicker(tk).catch(() => false))) {   // the price feed can be down: a second tap on the same ticker adds it anyway
        form.dataset.unverified = tk;
        return say(msg, `Couldn't confirm ${tk} with the price feed. Check the symbol, then tap again to add it anyway.`, true);
      }
    }
    await run(async () => {
      const ok = await save((cur) => {
        const list = cur.holdings.slice(), at = from ? list.findIndex(h => h.tk === from) : -1;
        if (from && at < 0) return `${from} is no longer in your portfolio.`;
        if (list.some(h => h.tk === tk && h.tk !== from)) return `${tk} is already in your portfolio. Tap Edit on it to change the numbers.`;
        if (!from && list.length >= MAX_HOLDINGS) return `That's the limit: ${MAX_HOLDINGS} stocks.`;
        from ? list.splice(at, 1, { tk, sh, avg }) : list.push({ tk, sh, avg });
        return { holdings: list };
      }, msg, `${from ? "Updated" : "Added"} ${tk}.`);
      if (ok && formRev === rev) resetForm();   // the form wasn't reused meanwhile
    });
  } finally { go.disabled = false; }
});
$("formCancel").addEventListener("click", () => { resetForm(); say($("formMsg"), ""); });

// Edit fills the form; ✕ asks once, then removes.
$("holdRows").addEventListener("click", (e) => {
  const ed = e.target.closest("[data-edit]"), del = e.target.closest("[data-del]");
  if (ed) {
    const h = mine?.holdings.find(x => x.tk === ed.dataset.edit);
    if (!h) return;
    resetForm();
    editTk = h.tk;
    form.tk.value = h.tk; form.sh.value = h.sh; form.avg.value = h.avg;
    $("formTitle").textContent = "Edit " + h.tk;
    $("formGo").textContent = "Save changes";
    $("formCancel").hidden = false;
    say($("formMsg"), "");
    form.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => form.sh.focus({ preventScroll: true }), 400);
  }
  if (del) {
    const tk = del.dataset.del;
    if (!del.classList.contains("warn")) {
      del.classList.add("warn"); del.textContent = "Remove?"; del.setAttribute("aria-label", `Confirm: remove ${tk}`);
      say($("formMsg"), `Tap Remove? again to take ${tk} out.`);
      setTimeout(() => { del.classList.remove("warn"); del.textContent = "✕"; del.setAttribute("aria-label", `Remove ${tk}`); }, 3500);
      return;
    }
    del.disabled = true;
    run(async () => {
      const ok = await save((cur) => cur.holdings.some(h => h.tk === tk) ? { holdings: cur.holdings.filter(h => h.tk !== tk) } : `${tk} was already removed.`,
        $("formMsg"), `Removed ${tk}.`);
      if (ok && editTk === tk) resetForm();
      if (!ok) del.disabled = false;
    });
  }
});

/* ---------- name, show/hide, leave ---------- */
$("boardName").addEventListener("change", (e) => {
  const v = e.target.value.trim().replace(/\s+/g, " ").slice(0, 24);
  if (!mine) return;
  if (!v) { e.target.value = mine.name || ""; return say($("optsMsg"), "Your name can't be empty.", true); }
  if (nameTaken(v)) { e.target.value = mine.name || ""; return say($("optsMsg"), `Someone on the board already shows as "${v}". Add an initial, like "${v} A".`, true); }
  if (v !== mine.name) run(() => save(() => ({ name: v }), $("optsMsg")));
});
$("boardShow").addEventListener("change", (e) => {
  const on = e.target.checked;
  if (mine) run(() => save(() => ({ show: on }), $("optsMsg")));
});
$("mineLeave").addEventListener("click", (e) => {
  const b = e.currentTarget;
  if (!me) return;
  if (!b.classList.contains("armed")) {
    b.classList.add("armed"); b.textContent = "Tap again to delete everything";
    say($("optsMsg"), "Tap the button again to delete your portfolio and leave the race.");
    setTimeout(() => { b.classList.remove("armed"); b.textContent = "Leave the race and delete my portfolio"; }, 4000);
    return;
  }
  b.classList.remove("armed"); b.textContent = "Leave the race and delete my portfolio";
  const uid = me.uid;
  say($("optsMsg"), "Deleting…");
  run(async () => {
    try {
      await api.removeMine(uid);
      if (me?.uid !== uid) return;
      measured = null; resetForm(); published = true;
      say($("optsMsg"), "Done. Your portfolio is deleted and you are off the board.");
    } catch (err) { console.error(err); say($("optsMsg"), "Could not delete it. Try again.", true); }
  });
});

/* ---------- sign in and out ---------- */
// Inside an installed iPhone app the Google window can hang without an
// answer, so after a while point the member to Safari (the race still shows here).
const installed = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
const SAFARI = "If the Google window doesn't come back, open the site in Safari to add your stocks. The race still shows here in the app.";
$("mineIn").addEventListener("click", async () => {
  say($("gateMsg"), "");
  if (installed) setTimeout(() => { if (!me) say($("gateMsg"), SAFARI, true); }, 20000);
  try { await api?.signIn(); }
  catch (err) {
    console.warn(err);
    const code = err?.code || "";
    say($("gateMsg"), code.includes("popup-blocked") ? "Your browser blocked the sign-in window. Allow pop-ups for this site and try again."
      : code.includes("closed-by-user") || code.includes("cancelled") ? "Sign-in was closed before it finished. Tap the button to try again."
      : installed ? SAFARI : "Sign-in didn't work here. Open this page in Safari or Chrome and try again.", true);
  }
});
$("mineOut").addEventListener("click", () => { if (me) dropKey(me.uid); api?.signOut(); });   // a shared phone keeps nothing
$("joinOut").addEventListener("click", () => api?.signOut());

backend().then((b) => {
  api = b;
  b.watchRacers((list) => { racers = list; racersIn = true; boardErr = false; paintBoard(); },
    (err) => { console.error(err); boardErr = true; paintBoard(); chart.fail("The board could not load right now."); });
  b.onUser(onUser);
}).catch((err) => {
  console.error(err);
  say($("gateMsg"), "Sign-in is unavailable right now. Refresh the page to try again.", true);
});
