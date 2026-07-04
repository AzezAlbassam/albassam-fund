// ============================================================
// ALBASSAM FUND — configuration
// Values below are filled in during setup. While they still
// contain "__PLACEHOLDER__" markers the app runs in DEMO mode
// with sample data so you can preview the design offline.
// ============================================================

export const firebaseConfig = {
  apiKey: "AIzaSyAqE1RBIxQ_OZ01hyUcuakU46tElOPbwqg",
  authDomain: "albassam-fund.firebaseapp.com",
  projectId: "albassam-fund",
  storageBucket: "albassam-fund.firebasestorage.app",
  messagingSenderId: "882020792950",
  appId: "1:882020792950:web:d6be1279a2903c52277d57",
};

// OPTIONAL: free API key from https://finnhub.io. If left as a
// placeholder the site uses Yahoo Finance instead — no key needed.
export const FINNHUB_KEY = "__FINNHUB_KEY__";

// Only this Google account can write to the database.
export const OWNER_EMAIL = "azizbassam2018@gmail.com";

// How often live prices refresh (milliseconds).
export const PRICE_REFRESH_MS = 30000;

// Demo mode: active until Firebase is configured, or on demand
// with ?demo=1 in the URL (handy for testing design changes
// without touching the real database).
export const DEMO = firebaseConfig.apiKey.startsWith("__") ||
  new URLSearchParams(location.search).has("demo");
