// ============================================================
// In orbit: every call is a small faceted planet circling the
// core, drawn in black lines on white, live in 3D (Three.js).
// Size = share of the pot; ink won, red lost, grey still open.
// Drag to spin, tap a planet to pick it.
//   const o = await startOrbit(canvas, labelsEl, onPick);
//   o.set(trades, pctOf)   // pctOf(trade) -> result % or null
// ============================================================

import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

const RADII = [2.1, 2.75, 3.4];
const TILTS = [[0.0, 0.0], [0.28, 0.35], [-0.22, -0.4]];
const COL = { win: 0x0b0b0c, loss: 0xd92d20, open: 0x8a8a93 };
const PAPER = 0xffffff;

export async function startOrbit(canvas, labelsEl, onPick) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(PAPER, 10, 20);   // the far side of every orbit fades into the paper

  const cam = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  cam.position.set(0, 2.4, 10.2);
  cam.lookAt(0, 0, 0);

  const world = new THREE.Group();
  world.rotation.x = 0.32;
  scene.add(world);

  const res = new THREE.Vector2(1, 1), mats = [];
  const lineMat = (color, linewidth, opacity = 1) => {
    const m = new LineMaterial({ color, linewidth, transparent: opacity < 1, opacity, fog: true });
    m.resolution.copy(res); mats.push(m); return m;
  };
  // a white body that hides the lines behind it, so it reads as a solid drawn in lines
  const paper = new THREE.MeshBasicMaterial({ color: PAPER, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const edgesOf = (geo) => new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(geo));

  // the core: a geodesic sphere
  const coreGeo = new THREE.IcosahedronGeometry(1.2, 1);
  const core = new THREE.Mesh(coreGeo, paper);
  core.add(new LineSegments2(edgesOf(coreGeo), lineMat(0x0b0b0c, 1.4)));
  world.add(core);

  // three tilted orbits: thin ink circles
  const circle = [];
  for (let i = 0, n = 160; i < n; i++) {
    const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2;
    circle.push(Math.cos(a), 0, Math.sin(a), Math.cos(b), 0, Math.sin(b));
  }
  const circleGeo = new LineSegmentsGeometry().setPositions(circle);
  const ringMat = lineMat(0x0b0b0c, 1, 0.4);
  const rings = RADII.map((r, i) => {
    const g = new THREE.Group();
    g.rotation.x = TILTS[i][0]; g.rotation.z = TILTS[i][1];
    const ring = new LineSegments2(circleGeo, ringMat);
    ring.scale.setScalar(r);
    g.add(ring);
    world.add(g);
    return g;
  });

  /* ---------- planets = calls ---------- */
  let planets = [];
  const planetGeo = new THREE.IcosahedronGeometry(1, 0), planetEdges = edgesOf(planetGeo);
  function set(trades, pctOf) {
    for (const p of planets) { p.ring.remove(p.mesh); p.mat.dispose(); mats.splice(mats.indexOf(p.mat), 1); p.label.remove(); }
    planets = trades.map((t, i) => {
      const pct = pctOf(t), kind = t.status === "active" ? "open" : (pct ?? 0) < 0 ? "loss" : "win";
      const ri = i % 3, r = RADII[ri];
      const size = 0.13 + Math.sqrt(Math.max(t.wt || 4, 4)) * 0.034;
      const mat = lineMat(COL[kind], 1.3);
      const mesh = new THREE.Mesh(planetGeo, paper);
      mesh.add(new LineSegments2(planetEdges, mat));
      mesh.scale.setScalar(size);
      mesh.rotation.set(i * 0.7, i * 1.3, 0);
      rings[ri].add(mesh);
      const label = document.createElement("span");
      label.innerHTML = `${t.ticker} <i class="${kind}">${pct == null ? "" : (pct >= 0 ? "+" : "-") + Math.abs(pct).toFixed(1) + "%"}</i>`;
      labelsEl.appendChild(label);
      return { t, mesh, mat, label, ring: rings[ri], r, a: i * 2.399963, speed: 0.34 / Math.sqrt(r) * (1 + (i % 4) * 0.08), size };
    });
  }

  /* ---------- interaction: drag to spin, tap to pick ---------- */
  let yaw = 0, pitch = 0.32, vel = 0.0035, dragging = false, lx = 0, ly = 0, moved = 0;
  const auto = 0.0035;
  canvas.addEventListener("pointerdown", (e) => { dragging = true; moved = 0; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => {
    if (dragging) {
      const dx = e.clientX - lx, dy = e.clientY - ly;
      moved += Math.abs(dx) + Math.abs(dy);
      vel = dx * 0.006; yaw += vel; pitch = Math.max(-0.2, Math.min(0.9, pitch + dy * 0.004));
      lx = e.clientX; ly = e.clientY;
    } else hover(e);
  });
  const end = (e) => { if (dragging && moved < 8) pick(e); dragging = false; };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", () => (dragging = false));

  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let hovered = null, selected = null;
  function hit(e) {
    const r = canvas.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, cam);
    const hits = ray.intersectObjects(planets.map(p => p.mesh), false);
    return hits.length ? planets.find(p => p.mesh === hits[0].object) : null;
  }
  function hover(e) { hovered = hit(e); canvas.style.cursor = hovered ? "pointer" : "grab"; }
  function pick(e) { const p = hit(e); if (p) { selected = p; onPick?.(p.t); } }

  /* ---------- the loop: runs only while on screen ---------- */
  let visible = true, still = document.body.classList.contains("still");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; loop(); }).observe(canvas);
  document.addEventListener("visibilitychange", loop);
  addEventListener("motion", (e) => { still = e.detail.still; loop(); });

  function size() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.position.z = w / h < 0.9 ? 15 : 12.6;   // the outer orbit always fits inside the frame
    cam.updateProjectionMatrix();
    const d = cam.position.length();
    scene.fog.near = d - 1.5; scene.fog.far = d + 7;
    res.set(w, h);
    for (const m of mats) m.resolution.copy(res);
    if (!running) frame();
  }

  const v = new THREE.Vector3(), clock = new THREE.Clock();
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05), k = reduced.matches ? 0.35 : 1;
    if (!dragging) { vel += (auto * k - vel) * 0.02; yaw += vel; }
    world.rotation.set(pitch, yaw, 0);
    core.rotation.y += dt * 0.25 * k;
    core.rotation.x = Math.sin(clock.elapsedTime * 0.3) * 0.15;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    for (const p of planets) {
      p.a += p.speed * dt * k;
      p.mesh.position.set(Math.cos(p.a) * p.r, 0, Math.sin(p.a) * p.r);
      p.mesh.rotation.y += dt * 0.6 * k;
      const s = p.size * (p === selected ? 1.45 : p === hovered ? 1.25 : 1);
      p.mesh.scale.setScalar(p.mesh.scale.x + (s - p.mesh.scale.x) * 0.2);
      p.mat.linewidth = p === selected ? 2.4 : 1.3;
      p.mesh.getWorldPosition(v);
      p.d = v.distanceTo(cam.position);
      v.project(cam);
      p.x = (v.x * 0.5 + 0.5) * W; p.y = (-v.y * 0.5 + 0.5) * H; p.c = Math.hypot(v.x, v.y);
    }
    // labels: the picked one first, then nearest first; one that would cover another waits its turn
    const placed = [];
    for (const p of [...planets].sort((a, b) => (b === selected) - (a === selected) || a.d - b.d)) {
      const { x, y } = p, lw = (p.lw ||= p.label.offsetWidth || 90), lh = (p.lh ||= p.label.offsetHeight || 22);
      const box = { l: x - lw / 2, t: y - lh * 1.7, r: x + lw / 2, b: y - lh * 0.7 };
      p.label.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-170%)`;
      const behind = p.d > cam.position.length() + 0.4 && p.c < 0.2;
      const outside = x < 40 || x > W - 40 || y < 30 || y > H - 10;   // never let a label hang off the frame
      const covers = placed.some(q => box.l < q.r + 4 && q.l < box.r + 4 && box.t < q.b + 2 && q.t < box.b + 2);
      const show = !behind && !outside && !covers;
      if (show) placed.push(box);
      p.label.style.opacity = show ? (p === selected || p === hovered ? "1" : ".9") : "0";
    }
    renderer.render(scene, cam);
  }
  let running = false;
  function loop() {
    const go = visible && !document.hidden && !still;
    if (go && !running) { running = true; clock.getDelta(); renderer.setAnimationLoop(frame); }
    else if (!go && running) { running = false; renderer.setAnimationLoop(null); frame(); }
    else if (!go) frame();
  }
  new ResizeObserver(size).observe(canvas);   // last: size() draws a frame, so everything above must exist
  size();
  loop();
  return { set: (trades, pctOf) => { set(trades, pctOf); if (!running) frame(); }, select: (id) => { selected = planets.find(p => p.t.id === id) || null; } };
}
