// ============================================================
// The maze: black lines on white, in 3D. A labyrinth drawn as a
// line drawing (wall tops, bases and corner posts). Its walls rise
// on load, ring by ring from the middle, and it turns slowly. A
// bold line finds its way through and climbs out over the walls:
// our fund's path through the market. Home hero (big) and the page
// headers (smaller, calmer) all use it.
//   const m = await startMaze(canvas, { labelsEl, cols, rows, seed });
//   m.setPath(values, labelHtml)   // heights along the path, e.g. the fund's daily values
//   m.setScroll(p)                 // 0..1 hero scroll progress
// ============================================================

import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

const INK = 0x0b0b0c, PAPER = 0xffffff;

// A perfect maze (one way between any two cells), the same every load.
function carve(cols, rows, seed) {
  let s = seed >>> 0;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const open = new Set(), seen = new Uint8Array(cols * rows), stack = [0];
  const key = (a, b) => (a < b ? a + ":" + b : b + ":" + a);
  seen[0] = 1;
  while (stack.length) {
    const c = stack.at(-1), x = c % cols, y = (c / cols) | 0;
    const next = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
      .filter(([a, b]) => a >= 0 && b >= 0 && a < cols && b < rows && !seen[b * cols + a]);
    if (!next.length) { stack.pop(); continue; }
    const [a, b] = next[(rnd() * next.length) | 0], n = b * cols + a;
    seen[n] = 1; open.add(key(c, n)); stack.push(n);
  }
  return { isOpen: (a, b) => open.has(key(a, b)) };
}

// The way from the left door to the right door (cells, in order).
function solve(cols, rows, maze, from, to) {
  const prev = new Int32Array(cols * rows).fill(-1), q = [from];
  prev[from] = from;
  while (q.length) {
    const c = q.shift();
    if (c === to) break;
    const x = c % cols, y = (c / cols) | 0;
    for (const [a, b] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      const n = b * cols + a;
      if (a < 0 || b < 0 || a >= cols || b >= rows || prev[n] !== -1 || !maze.isOpen(c, n)) continue;
      prev[n] = c; q.push(n);
    }
  }
  const out = [];
  for (let c = to; c !== from; c = prev[c]) out.push(c);
  return [from, ...out.reverse()];
}

export async function startMaze(canvas, { labelsEl = null, cols = 16, rows = 11, seed = 20260704, wall = 0.9, spin = 0.05,
  pitch = 0.62, fit = 1, shift = 1, path: wantPath = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(PAPER, 10, 40);
  const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 200);
  const world = new THREE.Group(); scene.add(world);
  const ox = cols / 2, oz = rows / 2;   // the maze is centred on the origin
  const entry = ((rows / 2) | 0) * cols, exit = ((rows / 2) | 0) * cols + cols - 1;
  const maze = carve(cols, rows, seed);

  // walls: [x1, z1, x2, z2] on cell edges, minus the two doors
  const walls = [];
  for (let y = 0; y <= rows; y++) for (let x = 0; x < cols; x++) {
    const up = (y - 1) * cols + x, dn = y * cols + x;
    if (y === 0 || y === rows || !maze.isOpen(up, dn)) walls.push([x, y, x + 1, y]);
  }
  for (let x = 0; x <= cols; x++) for (let y = 0; y < rows; y++) {
    const c = y * cols + x;
    if ((x === 0 && c === entry) || (x === cols && c - 1 === exit)) continue;
    if (x === 0 || x === cols || !maze.isOpen(c - 1, c)) walls.push([x, y, x, y + 1]);
  }

  // rings from the centre outward, so the walls can rise in a ripple
  const RINGS = 7, maxD = Math.hypot(ox, oz), rings = Array.from({ length: RINGS }, () => ({ top: [], post: new Set() }));
  const base = [];
  for (const [x1, z1, x2, z2] of walls) {
    const d = Math.hypot((x1 + x2) / 2 - ox, (z1 + z2) / 2 - oz) / maxD;
    const r = rings[Math.min(RINGS - 1, (d * RINGS) | 0)];
    r.top.push(x1 - ox, wall, z1 - oz, x2 - ox, wall, z2 - oz);
    r.post.add(x1 + "," + z1); r.post.add(x2 + "," + z2);
    base.push(x1 - ox, 0, z1 - oz, x2 - ox, 0, z2 - oz);
  }
  const mats = [];
  const lineMat = (w, opacity = 1) => {
    const m = new LineMaterial({ color: INK, linewidth: w, transparent: opacity < 1, opacity, fog: true });
    mats.push(m); return m;
  };
  const thin = lineMat(1.15), faint = lineMat(1, 0.35), bold = lineMat(3.4);
  const seg = (arr, mat) => { const g = new LineSegmentsGeometry(); g.setPositions(arr); return new LineSegments2(g, mat); };
  world.add(seg(base, faint));
  const rising = rings.filter(r => r.top.length).map((r, i) => {
    const posts = [];
    for (const p of r.post) { const [x, z] = p.split(",").map(Number); posts.push(x - ox, 0, z - oz, x - ox, wall, z - oz); }
    const g = new THREE.Group();
    g.add(seg(r.top, thin), seg(posts, thin));
    g.scale.y = 0.001; g.userData.delay = i * 0.12;
    world.add(g);
    return g;
  });

  // the way through: cell centres, lifted by the values it is given
  const cells = solve(cols, rows, maze, entry, exit);
  const route = [[-1, (entry / cols) | 0], ...cells.map(c => [c % cols, (c / cols) | 0]), [cols, (exit / cols) | 0]]
    .map(([x, y]) => [x + 0.5 - ox, y + 0.5 - oz]);
  let pathLine = null, head = null, drawn = 0, total = 0, lift = route.map(() => 0.12), label = null;
  if (wantPath) {
    const dot = document.createElement("canvas"); dot.width = dot.height = 64;
    const g = dot.getContext("2d");
    g.fillStyle = "#fff"; g.beginPath(); g.arc(32, 32, 26, 0, 7); g.fill();
    g.lineWidth = 9; g.strokeStyle = "#0b0b0c"; g.stroke();
    head = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(dot), depthTest: false }));
    head.scale.setScalar(0.42); head.renderOrder = 3;
    world.add(head);
  }
  function buildPath() {
    if (!wantPath) return;
    if (pathLine) { world.remove(pathLine); pathLine.geometry.dispose(); }
    // a smooth climb: the route is resampled so each step is short
    const pts = [];
    for (let i = 0; i < route.length - 1; i++) {
      const [ax, az] = route[i], [bx, bz] = route[i + 1];
      for (let k = 0; k < 4; k++) {
        const t = k / 4, u = (i + t) / (route.length - 1);
        pts.push([ax + (bx - ax) * t, sample(u), az + (bz - az) * t]);
      }
    }
    pts.push([...route.at(-1).slice(0, 1), sample(1), route.at(-1)[1]]);
    const geo = new LineGeometry();
    geo.setPositions(pts.flat());
    pathLine = new Line2(geo, bold);
    pathLine.renderOrder = 2;
    pathLine.userData.pts = pts;
    total = pts.length - 1;
    world.add(pathLine);
  }
  const sample = (u) => {   // the path's height at progress u (0..1)
    const f = u * (lift.length - 1), i = Math.min(lift.length - 2, Math.floor(f)), t = f - i;
    return lift[i] + (lift[i + 1] - lift[i]) * t;
  };
  buildPath();

  if (labelsEl && wantPath) {
    label = document.createElement("span");
    label.className = "mz-label";
    labelsEl.appendChild(label);
  }

  // camera: a slow turn, a lean toward the pointer, and a dive on scroll
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let yaw = -0.5, mx = 0, my = 0, scroll = 0, visible = true, running = false, still = document.body.classList.contains("still");
  addEventListener("pointermove", (e) => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; }, { passive: true });
  const clock = new THREE.Clock(), v = new THREE.Vector3(), born = performance.now();
  let t0 = 0;

  function size() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    cam.aspect = w / h; cam.updateProjectionMatrix();
    for (const m of mats) m.resolution.set(w, h);
    kick();
  }

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05), calm = reduced.matches || still;
    t0 = (performance.now() - born) / 1000;   // the intro runs on the clock, so a slow phone still finishes it on time
    if (!calm) yaw += dt * spin;
    // walls rise, ring by ring; then the path draws itself
    let risen = true;
    for (const g of rising) {
      const k = calm ? 1 : Math.min(1, Math.max(0, (t0 - 0.2 - g.userData.delay) / 0.8));
      const e = 1 - Math.pow(1 - k, 3);
      g.scale.y = Math.max(0.001, e);
      if (k < 1) risen = false;
    }
    if (pathLine) {
      const start = 0.2 + rising.length * 0.12 + 0.3;
      drawn = calm ? total : Math.min(total, Math.max(0, (t0 - start) * total / 2.6));
      pathLine.geometry.instanceCount = Math.max(0, Math.floor(drawn));
      const pts = pathLine.userData.pts, i = Math.min(total, Math.floor(drawn)), f = drawn - i, a = pts[i], b = pts[Math.min(total, i + 1)];
      head.position.set(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
      head.visible = drawn > 0;
      head.scale.setScalar(0.42 * (drawn >= total && !calm ? 1 + Math.sin(t0 * 3) * 0.12 : 1));
    }
    // framing: the whole maze fits, wider screens sit it to the right
    const aspect = cam.aspect, wide = aspect > 1.1;
    const span = Math.max(cols, rows * (wide ? 1.15 : 1.4));
    const r = (span / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * Math.min(1, aspect * (wide ? 0.44 : 0.95)))) * 1.18 / fit;
    const p = pitch - scroll * 0.3 + my * 0.08, y = yaw + mx * 0.25;
    cam.position.set(Math.sin(y) * Math.cos(p) * r, Math.sin(p) * r * (1 - scroll * 0.35), Math.cos(y) * Math.cos(p) * r);
    cam.lookAt(0, wall * 0.4, 0);
    scene.fog.near = r - span * 0.2; scene.fog.far = r + span * 1.3;   // the far side of the maze fades into the paper
    // wide: the maze sits right of the copy; tall: it sits above it
    const W0 = canvas.clientWidth, H0 = canvas.clientHeight;
    if (wide) cam.setViewOffset(W0, H0, -W0 * 0.24 * shift, 0, W0, H0);
    else cam.setViewOffset(W0, H0, 0, H0 * 0.17 * shift, W0, H0);
    // the label rides with the head once the path is through
    if (label && head) {
      v.copy(head.position); world.localToWorld(v); v.project(cam);
      const W = canvas.clientWidth, H = canvas.clientHeight, lw = label.offsetWidth || 120;
      const x = Math.min(W - lw - 8, Math.max(8, (v.x * 0.5 + 0.5) * W + 14)), yy = Math.max(8, (-v.y * 0.5 + 0.5) * H - 40);
      label.style.transform = `translate(${x.toFixed(1)}px,${yy.toFixed(1)}px)`;
      label.classList.toggle("on", drawn >= total && !!label.innerHTML);
    }
    renderer.render(scene, cam);
    return risen;
  }
  function kick() { if (!running) requestAnimationFrame(() => running || frame()); }
  function loop() {
    const go = visible && !document.hidden && !still && !reduced.matches;
    if (go && !running) { running = true; clock.getDelta(); renderer.setAnimationLoop(frame); }
    else if (!go && running) { running = false; renderer.setAnimationLoop(null); }
  }
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; loop(); }).observe(canvas);
  document.addEventListener("visibilitychange", loop);
  addEventListener("motion", (e) => { still = e.detail.still; loop(); kick(); });
  new ResizeObserver(size).observe(canvas);   // last: size() draws a frame, so everything above must exist
  size();
  loop();

  return {
    // values: any series (e.g. the fund's daily values); the path climbs with it,
    // from the floor to just over the walls at the exit
    setPath(values, html) {
      if (values?.length > 1) {
        const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
        lift = values.map(x => 0.12 + ((x - lo) / span) * wall * 1.5);
        buildPath();
      }
      if (label && html != null) label.innerHTML = html;
      kick();
    },
    setScroll(p) { scroll = Math.min(1, Math.max(0, p)); kick(); },
  };
}
