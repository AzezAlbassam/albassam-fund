// ============================================================
// ALBASSAM FUND — configuration
// Values below are filled in during setup. While they still
// contain "__PLACEHOLDER__" markers the app runs in DEMO mode
// with sample data so you can preview the design offline.
// ============================================================

export const firebaseConfig = {
  apiKey: "__FIREBASE_API_KEY__",
  authDomain: "__FIREBASE_AUTH_DOMAIN__",
  projectId: "__FIREBASE_PROJECT_ID__",
  storageBucket: "__FIREBASE_STORAGE_BUCKET__",
  messagingSenderId: "__FIREBASE_SENDER_ID__",
  appId: "__FIREBASE_APP_ID__",
};

// OPTIONAL: free API key from https://finnhub.io. If left as a
// placeholder the site uses Yahoo Finance instead — no key needed.
export const FINNHUB_KEY = "__FINNHUB_KEY__";

// Only this Google account can write to the database.
export const OWNER_EMAIL = "azizbassam2018@gmail.com";

// How often live prices refresh (milliseconds).
export const PRICE_REFRESH_MS = 30000;

export const DEMO = firebaseConfig.apiKey.startsWith("__");
