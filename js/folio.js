// ============================================================
// The family race. Each member keeps their holdings in
// /portfolios/{uid}: only that member can read or write it
// (firestore.rules), so nobody else sees the stocks, shares or
// prices, the manager included. The board reads /racers/{uid}:
// a name and today's return %, nothing more. A member's day-by-day
// line stays inside their own sealed box: a public line of a basket
// that rarely changes can be fitted against public prices to work out
// which stocks it holds and in what proportion, so it is never shared.
//
// Return = what the holdings are worth against what they cost:
//   (Σ shares × price − Σ shares × avg price) / Σ shares × avg price
// The member's own line is RECORDED, one point per market day: each
// visit sets today's point.
// Only approved family can save (/members, set by the manager from
// the manager page; a newcomer asks via /joinRequests).
// The stocks are SEALED with the member's own passcode before they
// leave the device (see "the passcode lock" below); the rules refuse
// anything else, so the database only holds locked boxes.
// Demo mode (?demo=1) runs on an in-memory board, no network writes;
// add &join=1 to practise the "ask to join" step.
// ============================================================

import { DEMO, firebaseConfig, OWNER_EMAIL } from "./config.js?v=18";
import { checkTicker, quotes, savedSeries } from "./prices.js?v=18";

export const START = "2026-07-03";   // nothing on the board predates the fund's baseline day
export const MAX_HOLDINGS = 60;      // mirrors firestore.rules
const KEEP = 750;                    // points kept on a member's own line
const FLAG = "af:racer", AT = "af:racer:at";
const isOwnerEmail = (u) => (u?.email || "").toLowerCase() === OWNER_EMAIL.toLowerCase();

// Line styles in black and white: a grey and a dash pattern per member.
// A member keeps the one picked when they first joined (stored as `c`).
// Our fund is solid black; you are drawn darker and thicker.
export const COLORS = ["#52525B", "#71717A", "#3F3F46", "#8E8E96", "#5E5E66", "#A1A1AA", "#27272A", "#7A7A82", "#B4B4BC"];
export const DASHES = ["7 4", "2 4", "12 4 2 4", "1 3", "10 6", "4 2", "8 3 2 3", "3 6", "14 4"];

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
// The rules check types, so a hand-made board entry is only tidied
// before anything draws it: a bad % hides the entry.
const num = (v, cap = 1e4) => (typeof v === "number" && isFinite(v) && Math.abs(v) <= cap ? v : null);
function clean(id, r) {
  const pct = num(r?.pct);
  if (pct == null) return null;
  return { id, name: String(r.name ?? "").slice(0, 24) || "Member", pct,
    c: Number.isInteger(r.c) && r.c >= 0 && r.c < 50 ? r.c : null, at: r.updatedAt?.toMillis?.() ?? Date.now() };
}

// A member's own line with today's point set (earlier points stay as recorded).
export function nextLine(line, pct) {
  let days = Array.isArray(line?.days) ? line.days : [], vals = Array.isArray(line?.vals) ? line.vals : [];
  const day = marketDay(), v = Math.round(pct * 10) / 10;
  if (days.length && day <= days.at(-1)) vals = [...vals.slice(0, -1), v];   // today again (or a clock running slow)
  else { days = [...days, day].slice(-KEEP); vals = [...vals, v].slice(-KEEP); }
  return { days, vals };
}

/* ----------------------- the passcode lock ----------------------- */
// The stocks never reach the database readable: they are sealed with
// AES-GCM (256-bit) under a key made from the member's own passcode
// (PBKDF2, SHA-256, 600,000 rounds, a random salt per member). Nobody
// without the passcode can open them: not the family, not the manager,
// not anyone with the database console. A forgotten passcode can't be
// recovered; the member starts over and types the stocks in again.
// The key can be kept on this device (IndexedDB, not exportable), so
// the passcode is asked once per device.
const ROUNDS = 600000;
const b64 = (u8) => { let s = ""; for (const x of u8) s += String.fromCharCode(x); return btoa(s); };
export const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const newSalt = () => crypto.getRandomValues(new Uint8Array(16));
// ١٢٣ typed on an Arabic keyboard and 123 typed on a laptop are the same passcode.
const plain = (pass) => pass.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, d => String((d.charCodeAt(0) & 15) % 10)).normalize("NFKC");
export async function makeKey(pass, salt) {
  const raw = await crypto.subtle.importKey("raw", new TextEncoder().encode(plain(pass)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ROUNDS }, raw,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
// A passcode strong enough that nobody can just try them all: 8 or more
// characters, and a number-only one needs 12 (a 6-digit PIN falls in hours).
const COMMON = ["password", "password1", "12345678", "123456789", "qwertyui", "qwerty12", "iloveyou", "abcd1234", "abcdefgh", "aaaaaaaa", "albassam", "albassam1"];
export function passcodeProblem(pass) {
  const p = plain(pass);
  if (p.length < 8) return "Use at least 8 characters. Three short words work well, like camel sea 26.";
  if (/^\d+$/.test(p) && p.length < 12) return "A passcode of only numbers needs 12 digits. Easier: three short words, like camel sea 26.";
  if (/^(.)\1+$/.test(p) || COMMON.includes(p.toLowerCase())) return "That one is too easy to guess. Try three short words, like camel sea 26.";
  return "";
}

// What the database stores: the box, plus the public name and the show switch.
export async function sealMine(key, salt, doc) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  // padded to a 2 KB step, so the box's size doesn't tell how many stocks are inside
  let text = JSON.stringify({ holdings: doc.holdings, line: doc.line || null });
  text += " ".repeat(2048 - (text.length % 2048));
  const body = new TextEncoder().encode(text);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, body));
  return { box: { v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) }, name: doc.name, show: doc.show };
}
// The portfolio as its owner sees it. Throws when the key is wrong.
export async function openMine(raw, key) {
  if (!raw.box) return { holdings: raw.holdings || [], line: raw.line || null, name: raw.name, show: raw.show };   // saved before the lock existed
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(raw.box.iv) }, key, unb64(raw.box.ct));
  const inner = JSON.parse(new TextDecoder().decode(pt));
  return { holdings: Array.isArray(inner.holdings) ? inner.holdings : [], line: inner.line || null, name: raw.name, show: raw.show };
}
// Remembering the key on this device: { key: CryptoKey, salt } per member.
function vault(mode, fn) {
  return new Promise((res, rej) => {
    const o = indexedDB.open(DEMO ? "af-vault-demo" : "af-vault", 1);
    o.onupgradeneeded = () => o.result.createObjectStore("keys");
    o.onerror = () => rej(o.error);
    o.onsuccess = () => {
      const tx = o.result.transaction("keys", mode), q = fn(tx.objectStore("keys"));
      tx.oncomplete = () => { o.result.close(); res(q.result); };
      tx.onerror = () => { o.result.close(); rej(tx.error); };
    };
  });
}
export const keepKey = (uid, key, salt) => vault("readwrite", s => s.put({ key, salt: b64(salt) }, uid)).catch(() => {});
export const keptKey = (uid) => vault("readonly", s => s.get(uid)).catch(() => null);
export const dropKey = (uid) => vault("readwrite", s => s.delete(uid)).catch(() => {});

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
    // d from sealMine(). `expect` is the salt the stored box must still have
    // (null: no box yet): a passcode changed on another device meanwhile
    // stops the save instead of being undone by it. Needs a connection.
    saveMine: (uid, d, expect) => fs.runTransaction(db, async (tx) => {
      const cur = await tx.get(mine(uid)), had = cur.exists() ? cur.data().box?.salt ?? null : null;
      if (had !== expect) throw Object.assign(new Error("The portfolio changed on another device."), { code: "stale" });
      tx.set(mine(uid), { box: d.box, name: d.name, show: d.show, updatedAt: fs.serverTimestamp() });
    }),
    resetMine: (uid) => fs.deleteDoc(mine(uid)),   // a forgotten passcode: the board line stays
    removeMine: (uid) => Promise.all([fs.deleteDoc(racer(uid)), fs.deleteDoc(mine(uid))]),
    watchRacers: (cb, err) => fs.onSnapshot(fs.collection(db, "racers"), s => cb(s.docs.map(d => clean(d.id, d.data())).filter(Boolean)), err),
    readRacer: async (uid) => clean(uid, data(await fs.getDoc(racer(uid)))),
    colorsTaken: async (uid) => (await fs.getDocs(fs.collection(db, "racers"))).docs.filter(d => d.id !== uid).map(d => d.data().c),
    publish: (uid, r) => fs.setDoc(racer(uid), { name: r.name, pct: r.pct, c: r.c, updatedAt: fs.serverTimestamp() }),
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
  [["demo-a", "Faisal", 34.8, 0], ["demo-b", "Noura", 17.9, 1], ["demo-c", "Khalid", -8.3, 3]].forEach(([id, name, pct, c], k) =>
    racers.set(id, { id, name, pct, c, at: Date.now() - (k + 1) * 3 * 36e5 }));
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
    saveMine: async (uid, d, expect) => {
      if ((mine?.box?.salt ?? null) !== expect) throw Object.assign(new Error("The portfolio changed on another device."), { code: "stale" });
      mine = structuredClone(d); mineCbs.forEach(cb => cb(mine));
    },
    resetMine: async () => { mine = null; mineCbs.forEach(cb => cb(null)); },
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
// Put this member's name and % on the board, or take them off.
// Returns false when prices are missing: the board keeps what it had.
export async function publishMine(uid, doc, m, taken) {
  const b = await backend();
  if (!doc?.holdings?.length || doc.show === false) { await b.unpublish(uid); return true; }
  if (m?.pct == null) return false;
  const prev = await b.readRacer(uid);
  let c = prev?.c ?? doc.line?.c ?? null;
  if (c == null) {   // the first free style
    taken ??= await b.colorsTaken(uid);
    c = 0; while (taken.includes(c) && c < COLORS.length) c++;
  }
  await b.publish(uid, { name: doc.name, pct: Math.round(m.pct * 10) / 10, c });
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
  const raw = await b.readMine(u.uid), kept = await keptKey(u.uid);
  if (!raw?.box || raw.show === false || kept?.salt !== raw.box.salt) return;   // the passcode isn't kept on this device
  let doc;
  try { doc = await openMine(raw, kept.key); } catch (e) { return; }
  if (!doc.holdings.length) return;
  const m = await measure(doc.holdings);
  if (m.pct == null) return;
  const now = await b.readMine(u.uid);   // left, hid or changed in another tab meanwhile: leave everything alone
  if (!now?.box || now.show === false || now.box.ct !== raw.box.ct) return;
  doc.line = { ...nextLine(doc.line, m.pct), c: doc.line?.c ?? null };   // today's point, kept in the sealed box
  await b.saveMine(u.uid, await sealMine(kept.key, unb64(raw.box.salt), doc), raw.box.salt);
  await publishMine(u.uid, doc, m);
}
