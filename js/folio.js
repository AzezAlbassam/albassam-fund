// ============================================================
// The family race. Each member keeps their holdings in
// /portfolios/{uid}: only that member can read or write it
// (firestore.rules), so nobody else sees the stocks, shares or
// prices, the manager included. The board reads /racers/{uid}:
// a name, today's return % and a line of past results.
//
// Return = what the holdings are worth against what they cost:
//   (Σ shares × price − Σ shares × avg price) / Σ shares × avg price
// The line is RECORDED, one point per market day from the day the
// member joins: each visit sets today's point. (Re-pricing today's
// holdings over past days would let anyone work the holdings back
// out of the line, so it is never done.)
// Only approved family can save (/members, set by the manager from
// the manager page; a newcomer asks via /joinRequests).
// Demo mode (?demo=1) runs on an in-memory board, no network writes;
// add &join=1 to practise the "ask to join" step.
// ============================================================

import { DEMO, firebaseConfig, OWNER_EMAIL } from "./config.js?v=14";
import { checkTicker, quotes, savedSeries } from "./prices.js?v=14";

export const START = "2026-07-03";   // nothing on the board predates the fund's baseline day
export const MAX_HOLDINGS = 60;      // mirrors firestore.rules
const KEEP = 750;                    // points kept per line (rules allow 800)
const FLAG = "af:racer", AT = "af:racer:at";
const isOwnerEmail = (u) => (u?.email || "").toLowerCase() === OWNER_EMAIL.toLowerCase();

// Line colors. A member keeps the one picked when they first joined
// (stored as `c`). No green or red here: those mean gain and loss.
export const COLORS = ["#38BDF8", "#A78BFA", "#FACC15", "#2DD4BF", "#E879F9", "#60A5FA", "#CBD5E1", "#F9A8D4", "#818CF8"];

/* ----------------------- the math ----------------------- */
// Today's return and a row per holding. The % is null unless every
// holding has a price: a partial answer would put a wrong % on the board.
export async function measure(holdings) {
  const tks = [...new Set(holdings.map(h => h.tk))];
  await Promise.all(tks.filter(tk => !quotes[tk] || quotes[tk].saved).map(tk => checkTicker(tk).catch(() => false)));
  const saved = await savedSeries();
  const now = (tk) => quotes[tk]?.c ?? saved[tk]?.c?.at(-1) ?? null;   // the last saved close stands in
  const rows = holdings.map(h => {
    const px = now(h.tk);
    return { ...h, px, cost: h.sh * h.avg, value: px == null ? null : h.sh * px, pct: px == null ? null : (px / h.avg - 1) * 100 };
  });
  const cost = rows.reduce((s, r) => s + r.cost, 0), val = rows.reduce((s, r) => s + (r.value ?? 0), 0);
  const priced = rows.every(r => r.px != null);
  return { for: holdings, rows, pct: priced && cost > 0 ? (val / cost - 1) * 100 : null };
}

// The New York trading day a result belongs to (weekends roll back to Friday).
// Before the 9:30 open the prices are still the last session's, so the
// point belongs to that day (Riyadh mornings are New York nights).
export function marketDay(t = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(t).map(x => [x.type, x.value]));
  let ms = Date.UTC(+p.year, +p.month - 1, +p.day);
  if (+p.hour * 60 + +p.minute < 570) ms -= 864e5;
  while ([0, 6].includes(new Date(ms).getUTCDay())) ms -= 864e5;
  return new Date(ms).toISOString().slice(0, 10);
}

/* ----------------------- reading the board safely ----------------------- */
// The rules only check sizes, so a hand-made board entry is tidied
// before anything draws it: bad points are dropped one by one (a day
// of slack for a phone clock that runs fast), a bad % hides the entry.
const num = (v, cap = 1e4) => (typeof v === "number" && isFinite(v) && Math.abs(v) <= cap ? v : null);
function clean(id, r) {
  const pct = num(r?.pct);
  if (pct == null) return null;
  const days = Array.isArray(r.days) ? r.days : [], vals = Array.isArray(r.vals) ? r.vals : [];
  const lim = marketDay(new Date(Date.now() + 864e5)), d2 = [], v2 = [];
  days.forEach((d, i) => {
    if (typeof d === "string" && /^\d{4}-\d\d-\d\d$/.test(d) && d >= START && d <= lim && (!d2.length || d > d2.at(-1)) && num(vals[i]) != null) { d2.push(d); v2.push(vals[i]); }
  });
  return { id, name: String(r.name ?? "").slice(0, 24) || "Member", pct, days: d2, vals: v2,
    c: Number.isInteger(r.c) && r.c >= 0 && r.c < 50 ? r.c : null, at: r.updatedAt?.toMillis?.() ?? Date.now() };
}

/* ----------------------- storage ----------------------- */
let api = null;
export function backend() { return (api ??= DEMO ? demoBackend() : firebaseBackend()); }

async function firebaseBackend() {
  const [{ initializeApp }, au, fs] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js"),
  ]);
  const app = window.__fbApp || (window.__fbApp = initializeApp(firebaseConfig));
  const auth = au.getAuth(app), db = fs.getFirestore(app);
  const mine = (uid) => fs.doc(db, "portfolios", uid), racer = (uid) => fs.doc(db, "racers", uid);
  const member = (email) => fs.doc(db, "members", email), ask = (uid) => fs.doc(db, "joinRequests", uid);
  const data = (s) => (s.exists() ? s.data() : null);
  return {
    onUser: (cb) => au.onAuthStateChanged(auth, cb),
    user: () => new Promise(res => { const off = au.onAuthStateChanged(auth, u => { off(); res(u); }); }),
    signIn: () => au.signInWithPopup(auth, new au.GoogleAuthProvider()),
    signOut: () => au.signOut(auth),
    // cb(true) once the manager has let this person in (the manager always is)
    watchMember: (u, cb, err) => isOwnerEmail(u) ? (cb(true), () => {})
      : fs.onSnapshot(member(u.email), s => { if (s.exists() || !s.metadata.fromCache) cb(s.exists()); }, err),
    readAsk: async (uid) => data(await fs.getDoc(ask(uid))),
    askToJoin: (u, name) => fs.setDoc(ask(u.uid), { email: u.email, name, at: fs.serverTimestamp() }),
    // offline with nothing cached, the SDK reports "no document": that is not
    // the member's portfolio, so wait for the server rather than show it empty
    watchMine: (uid, cb, err) => fs.onSnapshot(mine(uid), s => { if (s.exists() || !s.metadata.fromCache) cb(data(s)); }, err),
    readMine: async (uid) => data(await fs.getDoc(mine(uid))),
    saveMine: (uid, d) => fs.setDoc(mine(uid), { holdings: d.holdings, name: d.name, show: d.show, ...(d.line ? { line: d.line } : {}), updatedAt: fs.serverTimestamp() }),
    removeMine: (uid) => Promise.all([fs.deleteDoc(racer(uid)), fs.deleteDoc(mine(uid))]),
    watchRacers: (cb, err) => fs.onSnapshot(fs.collection(db, "racers"), s => cb(s.docs.map(d => clean(d.id, d.data())).filter(Boolean)), err),
    readRacer: async (uid) => clean(uid, data(await fs.getDoc(racer(uid)))),
    colorsTaken: async (uid) => (await fs.getDocs(fs.collection(db, "racers"))).docs.filter(d => d.id !== uid).map(d => d.data().c),
    publish: (uid, r) => fs.setDoc(racer(uid), { name: r.name, pct: r.pct, days: r.days, vals: r.vals, c: r.c, updatedAt: fs.serverTimestamp() }),
    unpublish: (uid) => fs.deleteDoc(racer(uid)),
    // the manager's side (manager page): who asked, who is in
    watchFamily: (cb, err) => {   // returns a stop function
      let reqs = [], mems = [];
      const emit = () => cb({ requests: reqs, members: mems });
      const a = fs.onSnapshot(fs.collection(db, "joinRequests"), s => { reqs = s.docs.map(d => ({ id: d.id, ...d.data() })); emit(); }, err);
      const b = fs.onSnapshot(fs.collection(db, "members"), s => { mems = s.docs.map(d => ({ id: d.id, ...d.data() })); emit(); }, err);
      return () => { a(); b(); };
    },
    approve: async (r) => { await fs.setDoc(member(r.email), { name: r.name || "", uid: r.id, at: fs.serverTimestamp() }); await fs.deleteDoc(ask(r.id)); },
    decline: (r) => fs.deleteDoc(ask(r.id)),
    removeMember: async (m) => { await fs.deleteDoc(member(m.id)); if (m.uid) await fs.deleteDoc(racer(m.uid)); },
  };
}

// Practice board: three made-up members, and "you" sign in with one tap.
async function demoBackend() {
  const you = { uid: "demo-you", displayName: "Demo Member", email: "demo@example.com", photoURL: "" };
  const racers = new Map(), userCbs = [], racerCbs = [], mineCbs = [], memberCbs = [];
  let user = null, mine = null, isMember = !new URLSearchParams(location.search).has("join"), asked = null;
  const emitRacers = () => racerCbs.forEach(cb => cb([...racers.values()]));
  const fam = { requests: [{ id: "demo-d", name: "Sara Albassam", email: "sara@example.com" }],
    members: [{ id: "faisal@example.com", name: "Faisal", uid: "demo-a" }, { id: "noura@example.com", name: "Noura", uid: "demo-b" }] };
  let famCb = null;
  const famEmit = () => famCb?.({ requests: [...fam.requests], members: [...fam.members] });
  const days = [];
  for (let t = Date.now() - 40 * 864e5; t <= Date.now(); t += 864e5) { const d = marketDay(new Date(t)); if (days.at(-1) !== d) days.push(d); }
  [["demo-a", "Faisal", 38, 0], ["demo-b", "Noura", 21, 1], ["demo-c", "Khalid", -6, 3]].forEach(([id, name, end, c], k) => {
    const n = days.length - 8 * k, vals = days.slice(8 * k).map((_, i) => Math.round((end * (0.4 + 0.6 * i / n) + Math.sin(i * 1.7 + k) * 3) * 10) / 10);
    racers.set(id, { id, name, pct: vals.at(-1), days: days.slice(8 * k), vals, c, at: Date.now() - (k + 1) * 3 * 36e5 });
  });
  return {
    onUser: (cb) => { userCbs.push(cb); cb(user); return () => {}; },
    user: async () => user,
    signIn: async () => { user = you; userCbs.forEach(cb => cb(user)); },
    signOut: async () => { user = null; userCbs.forEach(cb => cb(null)); },
    watchMember: (u, cb) => { memberCbs.push(cb); cb(isMember); return () => memberCbs.splice(memberCbs.indexOf(cb), 1); },
    readAsk: async () => asked,
    askToJoin: async (u, name) => { asked = { email: u.email, name }; setTimeout(() => { isMember = true; memberCbs.forEach(cb => cb(true)); }, 1500); },
    watchMine: (uid, cb) => { mineCbs.push(cb); cb(mine); return () => mineCbs.splice(mineCbs.indexOf(cb), 1); },
    readMine: async () => mine,
    saveMine: async (uid, d) => { mine = structuredClone(d); mineCbs.forEach(cb => cb(mine)); },
    removeMine: async (uid) => { mine = null; racers.delete(uid); mineCbs.forEach(cb => cb(null)); emitRacers(); },
    watchRacers: (cb) => { racerCbs.push(cb); cb([...racers.values()]); return () => {}; },
    readRacer: async (uid) => racers.get(uid) || null,
    colorsTaken: async (uid) => [...racers.values()].filter(r => r.id !== uid).map(r => r.c),
    publish: async (uid, r) => { racers.set(uid, { id: uid, ...r, at: Date.now() }); emitRacers(); },
    unpublish: async (uid) => { racers.delete(uid); emitRacers(); },
    watchFamily: (cb) => { famCb = cb; famEmit(); return () => { famCb = null; }; },
    approve: async (r) => { fam.requests = fam.requests.filter(x => x.id !== r.id); fam.members.push({ id: r.email, name: r.name, uid: r.id }); famEmit(); },
    decline: async (r) => { fam.requests = fam.requests.filter(x => x.id !== r.id); famEmit(); },
    removeMember: async (m) => { fam.members = fam.members.filter(x => x.id !== m.id); racers.delete(m.uid); emitRacers(); famEmit(); },
  };
}

/* ----------------------- publishing ----------------------- */
// Put this member's result on the board (today's point is set, earlier
// points stay as recorded), or take it off. Returns false when prices
// are missing: the board then keeps what it had.
export async function publishMine(uid, doc, m, taken) {
  const b = await backend();
  if (!doc?.holdings?.length || doc.show === false) { await b.unpublish(uid); return true; }
  if (m?.pct == null) return false;
  // the line on the board, or the copy kept privately while hidden
  const prev = (await b.readRacer(uid)) || (doc.line && clean(uid, { ...doc.line, pct: 0 }));
  const day = marketDay(), pct = Math.round(m.pct * 10) / 10;
  let days = prev?.days || [], vals = prev?.vals || [];
  if (days.length && day <= days.at(-1)) vals = [...vals.slice(0, -1), pct];   // today again (or a clock running slow): update the last point
  else { days = [...days, day].slice(-KEEP); vals = [...vals, pct].slice(-KEEP); }
  let c = prev?.c;
  if (c == null) {   // the first free color
    taken ??= await b.colorsTaken(uid);
    c = 0; while (taken.includes(c) && c < COLORS.length) c++;
  }
  await b.publish(uid, { name: doc.name, pct, days, vals, c });
  if (!DEMO) try { localStorage.setItem(AT, String(Date.now())); } catch (e) {}
  return true;
}

// On this device, the member's line refreshes whenever they open any page.
export function remember(on) {
  if (DEMO) return;   // practice runs never touch a real member's settings
  try { on ? localStorage.setItem(FLAG, "1") : (localStorage.removeItem(FLAG), localStorage.removeItem(AT)); } catch (e) {}
}

// Background refresh, at most every 30 minutes (shell.js runs it).
export async function syncMine() {
  if (DEMO) return;
  try {
    if (Date.now() - +(localStorage.getItem(AT) || 0) < 30 * 60 * 1000) return;
    localStorage.setItem(AT, String(Date.now()));   // count the attempt, so a failing one doesn't repeat on every page
  } catch (e) { return; }
  const b = await backend(), u = await b.user();
  if (!u) return remember(false);
  const doc = await b.readMine(u.uid);
  if (!doc?.holdings?.length || doc.show === false) return;
  const m = await measure(doc.holdings);
  const now = await b.readMine(u.uid);   // left, hid or changed in another tab meanwhile: leave the board alone
  if (!now || now.show === false || JSON.stringify(now.holdings) !== JSON.stringify(doc.holdings)) return;
  await publishMine(u.uid, now, m);
}
