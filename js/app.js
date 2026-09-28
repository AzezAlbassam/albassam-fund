// The old site loaded js/app.js. A browser still holding that old page
// in its cache lands here: fetch the new page fresh instead.
location.replace(location.pathname + "?fresh=" + Date.now());
