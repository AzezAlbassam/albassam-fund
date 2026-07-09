// ============================================================
// Data layer. Real mode: Firebase Firestore with realtime
// onSnapshot sync. Demo mode (before config is filled in):
// in-memory sample data so the design can be previewed offline.
//
// Trade document shape (collection "trades"):
//   ticker   "AAPL"
//   name     "Apple Inc"            (cached from Finnhub)
//   logo     "https://…"            (cached from Finnhub)
//   status   "active" | "closed"
//   opened   "YYYY-MM-DD"           (date of first buy)
//   closed   "YYYY-MM-DD" | null
//   closePx  number | null          (price used when closing)
//   finalPct number | null          (blended ROI locked at close)
//   txns     [{t:"buy"|"sell", sh, px, d}]
//   createdAt server timestamp      (ordering)
// ============================================================

import { DEMO, firebaseConfig } from "./config.js?v=5";
import { blendedPct, derive, today } from "./roi.js?v=5";

let impl;

export async function initStore(onTrades, onSettings) {
  impl = DEMO ? demoStore() : await firestoreStore();
  impl.subscribe(onTrades);
  impl.watchSettings(onSettings || (() => {}));
  return impl;
}

export const store = {
  add: (data) => impl.add(data),
  addClosed: (data) => impl.addClosed(data),
  editActive: (id, data) => impl.editActive(id, data),
  editClosed: (id, data) => impl.editClosed(id, data),
  addTxn: (id, txn) => impl.addTxn(id, txn),
  close: (id, closePx) => impl.close(id, closePx),
  reopen: (id) => impl.reopen(id),
  remove: (id) => impl.remove(id),
  setProfile: (id, profile) => impl.setProfile(id, profile),
  setSimStart: (v) => impl.setSimStart(v),
};

/* ----------------------- Firestore ----------------------- */
async function firestoreStore() {
  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js");
  const fs = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");
  const app = window.__fbApp || (window.__fbApp = initializeApp(firebaseConfig));
  const db = fs.getFirestore(app);
  const col = fs.collection(db, "trades");
  let cache = [];

  const norm = (d) => ({ id: d.id, ...d.data() });
  const find = (id) => cache.find(t => t.id === id);

  return {
    subscribe(cb) {
      const q = fs.query(col, fs.orderBy("createdAt", "desc"));
      fs.onSnapshot(q, snap => {
        cache = snap.docs.map(norm);
        cb(cache);
      }, err => console.error("Firestore listen failed:", err));
    },
    // Shared settings (e.g. simulator starting pot) — public read,
    // owner-only write, live-synced to every viewer.
    watchSettings(cb) {
      fs.onSnapshot(fs.doc(db, "meta", "settings"),
        snap => cb(snap.data() || {}),
        err => console.warn("settings listen failed:", err));
    },
    async setSimStart(v) {
      await fs.setDoc(fs.doc(db, "meta", "settings"), { simStart: v }, { merge: true });
    },
    async add({ ticker, shares, price, date, name = "", logo = "" }) {
      await fs.addDoc(col, {
        ticker, name, logo,
        status: "active",
        opened: date || today(),
        closed: null, closePx: null, finalPct: null,
        txns: [{ t: "buy", sh: shares, px: price, d: date || today() }],
        createdAt: fs.serverTimestamp(),
      });
    },
    // Log a past call that was already bought and sold — lands
    // straight in Closed with its ROI locked in.
    async addClosed({ ticker, shares = 1, buyPx, sellPx, opened, closed, name = "", logo = "" }) {
      const finalPct = ((sellPx - buyPx) / buyPx) * 100;
      await fs.addDoc(col, {
        ticker, name, logo,
        status: "closed",
        opened: opened || today(),
        closed: closed || today(),
        closePx: sellPx, finalPct,
        txns: [{ t: "buy", sh: shares, px: buyPx, d: opened || today() }],
        createdAt: fs.serverTimestamp(),
      });
    },
    async addTxn(id, txn) {
      const t = find(id); if (!t) return;
      await fs.updateDoc(fs.doc(db, "trades", id), { txns: [...(t.txns || []), txn] });
    },
    // Fix mistyped numbers without deleting. Active: buys are
    // replaced by one equivalent buy, partial sells stay intact.
    async editActive(id, { shares, price, date }) {
      const t = find(id); if (!t) return;
      const sells = (t.txns || []).filter(x => x.t === "sell");
      await fs.updateDoc(fs.doc(db, "trades", id), {
        opened: date, txns: [{ t: "buy", sh: shares, px: price, d: date }, ...sells],
      });
    },
    async editClosed(id, { buyPx, sellPx, opened, closed }) {
      const t = find(id); if (!t) return;
      const sh = derive(t).boughtSh || 1;
      await fs.updateDoc(fs.doc(db, "trades", id), {
        opened, closed, closePx: sellPx,
        finalPct: ((sellPx - buyPx) / buyPx) * 100,
        txns: [{ t: "buy", sh, px: buyPx, d: opened }],
      });
    },
    async close(id, closePx) {
      const t = find(id); if (!t) return;
      const finalPct = blendedPct(t, closePx);
      await fs.updateDoc(fs.doc(db, "trades", id), {
        status: "closed", closed: today(), closePx, finalPct,
      });
    },
    async reopen(id) {
      await fs.updateDoc(fs.doc(db, "trades", id), {
        status: "active", closed: null, closePx: null, finalPct: null,
      });
    },
    async remove(id) {
      await fs.deleteDoc(fs.doc(db, "trades", id));
    },
    async setProfile(id, { name, logo }) {
      await fs.updateDoc(fs.doc(db, "trades", id), { name, logo });
    },
  };
}

/* ----------------------- Demo mode ----------------------- */
function demoStore() {
  const d = (offset) => {
    const dt = new Date(Date.now() - offset * 86400000);
    return dt.toISOString().slice(0, 10);
  };
  let seq = 1;
  const uid = () => "demo" + seq++;
  let trades = [
    { id: uid(), ticker: "RKLB", name: "Rocket Lab", logo: "", status: "active",
      opened: d(40), closed: null, closePx: null, finalPct: null,
      txns: [{ t: "buy", sh: 100, px: 21.4, d: d(40) }, { t: "buy", sh: 50, px: 19.1, d: d(22) }] },
    { id: uid(), ticker: "NVDA", name: "NVIDIA", logo: "", status: "active",
      opened: d(75), closed: null, closePx: null, finalPct: null,
      txns: [{ t: "buy", sh: 12, px: 118.6, d: d(75) }, { t: "sell", sh: 4, px: 141.2, d: d(12) }] },
    { id: uid(), ticker: "TSLA", name: "Tesla", logo: "", status: "active",
      opened: d(18), closed: null, closePx: null, finalPct: null,
      txns: [{ t: "buy", sh: 10, px: 262.0, d: d(18) }] },
    { id: uid(), ticker: "PLTR", name: "Palantir", logo: "", status: "closed",
      opened: d(120), closed: d(9), closePx: 92.5, finalPct: 38.4,
      txns: [{ t: "buy", sh: 60, px: 66.8, d: d(120) }] },
    { id: uid(), ticker: "SOFI", name: "SoFi Technologies", logo: "", status: "closed",
      opened: d(90), closed: d(30), closePx: 12.1, finalPct: -7.9,
      txns: [{ t: "buy", sh: 200, px: 13.14, d: d(90) }] },
  ];
  let cb = () => {};
  const emit = () => cb([...trades]);

  let settingsCb = () => {};
  return {
    subscribe(fn) { cb = fn; emit(); },
    watchSettings(fn) { settingsCb = fn; settingsCb({}); },
    async setSimStart(v) { settingsCb({ simStart: v }); },
    async add({ ticker, shares, price, date, name = "", logo = "" }) {
      trades.unshift({ id: uid(), ticker, name, logo, status: "active",
        opened: date || today(), closed: null, closePx: null, finalPct: null,
        txns: [{ t: "buy", sh: shares, px: price, d: date || today() }] });
      emit();
    },
    async addClosed({ ticker, shares = 1, buyPx, sellPx, opened, closed, name = "", logo = "" }) {
      trades.unshift({ id: uid(), ticker, name, logo, status: "closed",
        opened: opened || today(), closed: closed || today(),
        closePx: sellPx, finalPct: ((sellPx - buyPx) / buyPx) * 100,
        txns: [{ t: "buy", sh: shares, px: buyPx, d: opened || today() }] });
      emit();
    },
    async addTxn(id, txn) {
      const t = trades.find(x => x.id === id); if (!t) return;
      t.txns = [...t.txns, txn]; emit();
    },
    async editActive(id, { shares, price, date }) {
      const t = trades.find(x => x.id === id); if (!t) return;
      const sells = t.txns.filter(x => x.t === "sell");
      t.opened = date;
      t.txns = [{ t: "buy", sh: shares, px: price, d: date }, ...sells];
      emit();
    },
    async editClosed(id, { buyPx, sellPx, opened, closed }) {
      const t = trades.find(x => x.id === id); if (!t) return;
      const sh = derive(t).boughtSh || 1;
      t.opened = opened; t.closed = closed; t.closePx = sellPx;
      t.finalPct = ((sellPx - buyPx) / buyPx) * 100;
      t.txns = [{ t: "buy", sh, px: buyPx, d: opened }];
      emit();
    },
    async close(id, closePx) {
      const t = trades.find(x => x.id === id); if (!t) return;
      t.status = "closed"; t.closed = today(); t.closePx = closePx;
      t.finalPct = blendedPct(t, closePx); emit();
    },
    async reopen(id) {
      const t = trades.find(x => x.id === id); if (!t) return;
      t.status = "active"; t.closed = null; t.closePx = null; t.finalPct = null; emit();
    },
    async remove(id) { trades = trades.filter(x => x.id !== id); emit(); },
    async setProfile(id, { name, logo }) {
      const t = trades.find(x => x.id === id); if (!t) return;
      t.name = name; t.logo = logo; emit();
    },
  };
}
