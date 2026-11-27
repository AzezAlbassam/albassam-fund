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
//   finalPct number | null          (ROI locked at close, after purification)
//   grossPct number | null          (the ROI before purification)
//   pur      number | null          (purification: % of the profit given away at close)
//   txns     [{t:"buy"|"sell", sh, px, d, asOf?, wt?, cash?, k?}]   asOf: shares already counted after splits up to that day;
//            wt: the "% of pot" an add used; cash: free cash % before it; k: the pot it was sized on / the start (see roi.js)
//   createdAt server timestamp      (ordering)
// ============================================================

import { DEMO, firebaseConfig } from "./config.js?v=43";
import { blendedPct, derive, exitPx, lastAdd, loadSplits, sizePts, splitAdjust, today } from "./roi.js?v=43";

const SYNCING = "Still syncing with the fund record. Try again in a moment.";

// "Fix" forms prefill rounded prices. When the owner left the prices
// alone, only dates and pot share change: the buy/sell history and the
// locked result stay exactly as recorded.
const samePx = (a, b) => Math.abs(a - b) < 0.005;
// Purification (تطهير): a share of a PROFIT is given away when the call
// closes, so the locked result is the profit minus that share. A loss
// has nothing to purify.
export const purified = (g, pur) => (g != null && g > 0 && pur > 0 ? g * (1 - Math.min(pur, 100) / 100) : g);
// A Fix that folds every buy into one keeps the pot they were sized on (their average k).
const keepK = (t, all) => { const k = t.wt > 0 ? +(sizePts(t, all) / t.wt).toFixed(6) : 0; return k > 0 ? { k } : {}; };
// Reopening a call whose last sell emptied it (the sale closed it): that
// sell is taken back too, so the call comes back holding its shares.
const unsellAll = (t) => (derive(t).heldSh <= 1e-9 && t.txns?.at(-1)?.t === "sell" ? { txns: t.txns.slice(0, -1) } : {});
function metaPatch(t, opened, wt, closed) {
  const buys = (t.txns || []).filter(x => x.t === "buy");
  const txns = buys.length === 1 ? t.txns.map(x => (x.t === "buy" ? { ...x, d: opened } : x)) : t.txns;
  return closed === undefined ? { opened, wt, txns } : { opened, closed, wt, txns };
}

let impl;

export async function initStore(onTrades, onSettings) {
  await loadSplits();
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
  addTxn: (id, txn, wt) => impl.addTxn(id, txn, wt),
  undoBuy: (id) => impl.undoBuy(id),
  close: (id, closePx, d) => impl.close(id, closePx, d),   // d: the day it closed (default today)
  reopen: (id) => impl.reopen(id),
  remove: (id) => impl.remove(id),
  setPur: (id, pur) => impl.setPur(id, pur),
  setProfile: (id, profile) => impl.setProfile(id, profile),
  saveTxns: (id, txns) => impl.saveTxns(id, txns),   // the same trades, with a field filled in (see owner.js healRecord)
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

  const norm = (d) => splitAdjust({ id: d.id, ...d.data() });
  const find = (id) => cache.find(t => t.id === id);

  return {
    subscribe(cb) {
      const q = fs.query(col, fs.orderBy("createdAt", "desc"));
      fs.onSnapshot(q, snap => {
        // offline with nothing cached yet: the SDK reports an empty list.
        // That is not the record, so keep what is on screen.
        if (snap.metadata.fromCache && snap.empty) return;
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
    async add({ ticker, shares, price, date, name = "", logo = "", wt = null, pur = null, cash = null, k = null }) {
      await fs.addDoc(col, {
        ticker, name, logo, wt, pur,
        status: "active",
        opened: date || today(),
        closed: null, closePx: null, finalPct: null,
        txns: [{ t: "buy", sh: shares, px: price, d: date || today(), asOf: today(), ...(wt > 0 && cash != null && { cash }), ...(wt > 0 && k > 0 && { k }) }],
        createdAt: fs.serverTimestamp(),
      });
    },
    // Log a past call that was already bought and sold — lands
    // straight in Closed with its ROI locked in.
    async addClosed({ ticker, shares = 1, buyPx, sellPx, opened, closed, name = "", logo = "", wt = null, pur = null }) {
      const grossPct = ((sellPx - buyPx) / buyPx) * 100;
      await fs.addDoc(col, {
        ticker, name, logo, wt, pur,
        status: "closed",
        opened: opened || today(),
        closed: closed || today(),
        closePx: sellPx, grossPct, finalPct: purified(grossPct, pur),
        txns: [{ t: "buy", sh: shares, px: buyPx, d: opened || today(), asOf: today() }],
        createdAt: fs.serverTimestamp(),
      });
    },
    async addTxn(id, txn, wt) {   // wt: the call's new "% of pot" after a buy
      const t = find(id); if (!t) throw new Error(SYNCING);
      await fs.updateDoc(fs.doc(db, "trades", id), { txns: [...(t.txns || []), txn], ...(wt > 0 && { wt }) });
    },
    // Take the latest buy back: it leaves the list and its size returns to cash.
    async undoBuy(id) {
      const t = find(id); if (!t) throw new Error(SYNCING);
      const u = lastAdd(t); if (!u) throw new Error("There is no buy to undo on this call.");
      await fs.updateDoc(fs.doc(db, "trades", id), { txns: t.txns.slice(0, -1), wt: u.wt });
    },
    // Fix mistyped numbers without deleting. Active: buys are
    // replaced by one equivalent buy, partial sells stay intact.
    async editActive(id, { shares, price, date, wt = null, pur = null }) {
      const t = find(id); if (!t) throw new Error(SYNCING);
      const d = derive(t);
      if (shares === d.boughtSh && samePx(price, d.avgCost))
        return fs.updateDoc(fs.doc(db, "trades", id), { ...metaPatch(t, date, wt), pur });
      const sells = (t.txns || []).filter(x => x.t === "sell");
      await fs.updateDoc(fs.doc(db, "trades", id), {
        opened: date, wt, pur, txns: [{ t: "buy", sh: shares, px: price, d: date, asOf: today(), ...keepK(t, cache) }, ...sells],
      });
    },
    async editClosed(id, { buyPx, sellPx, opened, closed, wt = null, pur = null }) {
      const t = find(id); if (!t) throw new Error(SYNCING);
      const d = derive(t);
      if (samePx(buyPx, d.avgCost) && samePx(sellPx, exitPx(t) ?? 0)) {
        const g = t.grossPct ?? t.finalPct;   // the prices stay: only the purification can change the result
        return fs.updateDoc(fs.doc(db, "trades", id), { ...metaPatch(t, opened, wt, closed), pur, grossPct: g, finalPct: purified(g, pur) });
      }
      const sh = d.boughtSh || 1, g = ((sellPx - buyPx) / buyPx) * 100;
      await fs.updateDoc(fs.doc(db, "trades", id), {
        opened, closed, closePx: sellPx, wt, pur,
        grossPct: g, finalPct: purified(g, pur),
        txns: [{ t: "buy", sh, px: buyPx, d: opened, asOf: today(), ...keepK(t, cache) }],
      });
    },
    async close(id, closePx, d = today()) {
      const t = find(id); if (!t) throw new Error(SYNCING);
      const g = blendedPct(t, closePx);
      await fs.updateDoc(fs.doc(db, "trades", id), {
        status: "closed", closed: d, closePx, grossPct: g, finalPct: purified(g, t.pur),
      });
    },
    async reopen(id) {
      const t = find(id); if (!t) throw new Error(SYNCING);
      await fs.updateDoc(fs.doc(db, "trades", id), {
        status: "active", closed: null, closePx: null, finalPct: null, grossPct: null, ...unsellAll(t),
      });
    },
    async saveTxns(id, txns) {
      const t = find(id);
      if (!t || (t.txns || []).length !== txns.length) return;   // a buy or sell landed meanwhile: leave it for the next visit
      await fs.updateDoc(fs.doc(db, "trades", id), { txns });
    },
    async remove(id) {
      await fs.deleteDoc(fs.doc(db, "trades", id));
    },
    // purification on its own: an open call keeps it for its close, a closed
    // call's result is worked out again from its result before purification
    async setPur(id, pur) {
      const t = find(id); if (!t) throw new Error(SYNCING);
      if (t.status !== "closed") return fs.updateDoc(fs.doc(db, "trades", id), { pur });
      const g = t.grossPct ?? t.finalPct;
      await fs.updateDoc(fs.doc(db, "trades", id), { pur, grossPct: g, finalPct: purified(g, pur) });
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
    { id: uid(), ticker: "RKLB", name: "Rocket Lab", logo: "", status: "active", wt: 30,
      opened: d(40), closed: null, closePx: null, finalPct: null,
      txns: [{ t: "buy", sh: 100, px: 21.4, d: d(40) }, { t: "buy", sh: 50, px: 19.1, d: d(22) }] },
    { id: uid(), ticker: "NVDA", name: "NVIDIA", logo: "", status: "active", wt: 25,
      opened: d(75), closed: null, closePx: null, finalPct: null,
      txns: [{ t: "buy", sh: 12, px: 118.6, d: d(75) }, { t: "sell", sh: 4, px: 141.2, d: d(12) }] },
    { id: uid(), ticker: "TSLA", name: "Tesla", logo: "", status: "active", wt: 15,
      opened: d(18), closed: null, closePx: null, finalPct: null,
      txns: [{ t: "buy", sh: 10, px: 262.0, d: d(18) }] },
    { id: uid(), ticker: "PLTR", name: "Palantir", logo: "", status: "closed", wt: 20,
      opened: d(120), closed: d(9), closePx: 92.5, finalPct: 38.4,
      txns: [{ t: "buy", sh: 60, px: 66.8, d: d(120) }] },
    { id: uid(), ticker: "SOFI", name: "SoFi Technologies", logo: "", status: "closed", wt: 10,
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
    async add({ ticker, shares, price, date, name = "", logo = "", wt = null, pur = null, cash = null, k = null }) {
      trades.unshift({ id: uid(), ticker, name, logo, wt, pur, status: "active",
        opened: date || today(), closed: null, closePx: null, finalPct: null,
        txns: [{ t: "buy", sh: shares, px: price, d: date || today(), asOf: today(), ...(wt > 0 && cash != null && { cash }), ...(wt > 0 && k > 0 && { k }) }] });
      emit();
    },
    async addClosed({ ticker, shares = 1, buyPx, sellPx, opened, closed, name = "", logo = "", wt = null, pur = null }) {
      const g = ((sellPx - buyPx) / buyPx) * 100;
      trades.unshift({ id: uid(), ticker, name, logo, wt, pur, status: "closed",
        opened: opened || today(), closed: closed || today(),
        closePx: sellPx, grossPct: g, finalPct: purified(g, pur),
        txns: [{ t: "buy", sh: shares, px: buyPx, d: opened || today(), asOf: today() }] });
      emit();
    },
    async addTxn(id, txn, wt) {   // wt: the call's new "% of pot" after a buy
      const t = trades.find(x => x.id === id); if (!t) return;
      t.txns = [...t.txns, txn]; if (wt > 0) t.wt = wt; emit();
    },
    async undoBuy(id) {
      const t = trades.find(x => x.id === id), u = t && lastAdd(t); if (!u) return;
      t.txns = t.txns.slice(0, -1); t.wt = u.wt; emit();
    },
    async editActive(id, { shares, price, date, wt = null, pur = null }) {
      const t = trades.find(x => x.id === id); if (!t) return;
      const d = derive(t);
      t.pur = pur;
      if (shares === d.boughtSh && samePx(price, d.avgCost)) { Object.assign(t, metaPatch(t, date, wt)); return emit(); }
      const sells = t.txns.filter(x => x.t === "sell"), kk = keepK(t, [...trades]);   // k from the call as it was, like the live store
      t.opened = date; t.wt = wt;
      t.txns = [{ t: "buy", sh: shares, px: price, d: date, asOf: today(), ...kk }, ...sells];
      emit();
    },
    async editClosed(id, { buyPx, sellPx, opened, closed, wt = null, pur = null }) {
      const t = trades.find(x => x.id === id); if (!t) return;
      const d = derive(t);
      t.grossPct = t.grossPct ?? t.finalPct; t.pur = pur;
      if (samePx(buyPx, d.avgCost) && samePx(sellPx, exitPx(t) ?? 0)) { Object.assign(t, metaPatch(t, opened, wt, closed)); t.finalPct = purified(t.grossPct, pur); return emit(); }
      const sh = d.boughtSh || 1, kk = keepK(t, [...trades]);
      t.opened = opened; t.closed = closed; t.closePx = sellPx; t.wt = wt;
      t.grossPct = ((sellPx - buyPx) / buyPx) * 100; t.finalPct = purified(t.grossPct, pur);
      t.txns = [{ t: "buy", sh, px: buyPx, d: opened, asOf: today(), ...kk }];
      emit();
    },
    async close(id, closePx, d = today()) {
      const t = trades.find(x => x.id === id); if (!t) return;
      t.status = "closed"; t.closed = d; t.closePx = closePx;
      t.grossPct = blendedPct(t, closePx); t.finalPct = purified(t.grossPct, t.pur); emit();
    },
    async reopen(id) {
      const t = trades.find(x => x.id === id); if (!t) return;
      Object.assign(t, unsellAll(t));
      t.status = "active"; t.closed = null; t.closePx = null; t.finalPct = null; t.grossPct = null; emit();
    },
    async saveTxns(id, txns) {
      const t = trades.find(x => x.id === id); if (!t) return;
      t.txns = txns; emit();
    },
    async remove(id) { trades = trades.filter(x => x.id !== id); emit(); },
    async setPur(id, pur) {
      const t = trades.find(x => x.id === id); if (!t) return;
      t.pur = pur;
      if (t.status === "closed") { t.grossPct = t.grossPct ?? t.finalPct; t.finalPct = purified(t.grossPct, pur); }
      emit();
    },
    async setProfile(id, { name, logo }) {
      const t = trades.find(x => x.id === id); if (!t) return;
      t.name = name; t.logo = logo; emit();
    },
  };
}
