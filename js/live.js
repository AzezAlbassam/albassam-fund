// ============================================================
// One live feed for every page: trades (Firestore realtime),
// the pot size (meta/settings) and live quotes for open calls.
//   live(what => render(state))   what: "trades" | "settings" | "quotes"
// ============================================================

import { initStore } from "./store.js?v=37";
import { loadSplits, splitAdjust } from "./roi.js?v=37";
import { startPrices, watchTickers, quotes } from "./prices.js?v=37";
import { DEMO } from "./config.js?v=37";

// potUsd: the whole pot in dollars today, what every "% of pot" buy is
// sized on (161k is the owner's figure from Nov 2026, until he saves one).
export const state = { trades: [], pot: 100000, potUsd: 161000, quotes, ready: false, cached: false };

// The last snapshot is kept on the device so a returning visitor sees
// numbers at once; the live Firestore feed replaces it within seconds.
const CACHE = "af:snap:v1";

export async function live(onChange) {
  startPrices(() => onChange("quotes"));
  await loadSplits();   // a tiny file from our own site: the saved snapshot needs it too
  try {
    const c = JSON.parse(localStorage.getItem(CACHE));
    if (c?.trades?.length && !DEMO) {
      Object.assign(state, { trades: c.trades.map(splitAdjust), pot: c.pot || state.pot, potUsd: c.potUsd || state.potUsd, ready: true, cached: true });
      watchTickers(c.trades.filter(t => t.status === "active").map(t => t.ticker));
      onChange("trades");
    }
  } catch (e) { console.error(e); /* no storage or a bad snapshot: wait for the live feed */ }
  const save = () => {
    if (DEMO) return;   // practice data must never replace the family's record on this device
    try { localStorage.setItem(CACHE, JSON.stringify({ trades: state.trades, pot: state.pot, potUsd: state.potUsd })); } catch (e) {}
  };
  return initStore((trades) => {
    state.trades = trades.map(({ createdAt, ...t }) => t);
    state.ready = true;
    state.cached = false;
    save();
    watchTickers(trades.filter(t => t.status === "active").map(t => t.ticker));
    onChange("trades");
  }, (settings) => {
    if (settings.simStart > 0) state.pot = settings.simStart;
    if (settings.potUsd > 0) state.potUsd = settings.potUsd;
    save();
    onChange("settings");
  });
}
