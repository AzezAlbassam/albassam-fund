// ============================================================
// In orbit: every call is a glossy planet circling a glowing core,
// live in 3D (Three.js). Size = share of the pot; green won, rose
// lost, amber still open. Drag to spin, tap a planet to pick it.
//   const o = await startOrbit(canvas, labelsEl, onPick);
//   o.set(trades, pctOf)   // pctOf(trade) -> result % or null
// ============================================================

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const RADII = [2.35, 3.2, 4.05];
const TILTS = [[0.0, 0.0], [0.28, 0.35], [-0.22, -0.4]];
const COL = { win: 0x4ade9a, loss: 0xff5470, open: 0xffb547 };

function dotTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(.35, "rgba(255,255,255,.55)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export async function startOrbit(canvas, labelsEl, onPick) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;   // keep the sunset colors rich, not washed out

  const cam = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  cam.position.set(0, 2.4, 10.2);
  cam.lookAt(0, 0, 0);

  const world = new THREE.Group();
  world.rotation.x = 0.32;
  scene.add(world);
  const dot = dotTexture();

  // the core: a glossy iridescent sphere inside a shell of sunset sparks
  const core = new THREE.Mesh(new THREE.SphereGeometry(1.2, 64, 64), new THREE.MeshPhysicalMaterial({
    color: 0xff5236, emissive: 0xff2a5e, emissiveIntensity: 0.9, metalness: 0.35, roughness: 0.2,
    clearcoat: 1, clearcoatRoughness: 0.06, iridescence: 1, iridescenceIOR: 1.7, iridescenceThicknessRange: [120, 480],
  }));
  world.add(core);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0xff6a4d, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.setScalar(6.2);
  world.add(glow);

  const N = 1500, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const c1 = new THREE.Color(0xff4f79), c2 = new THREE.Color(0xffb547), tmp = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963;
    const R = 1.5 + (Math.sin(i * 12.9898) * 0.5 + 0.5) * 0.35;
    pos.set([Math.cos(th) * r * R, y * R, Math.sin(th) * r * R], i * 3);
    tmp.copy(c1).lerp(c2, (y + 1) / 2);
    col.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  const shellGeo = new THREE.BufferGeometry();
  shellGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  shellGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const shell = new THREE.Points(shellGeo, new THREE.PointsMaterial({ size: 0.075, map: dot, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
  world.add(shell);

  // three tilted orbits
  const rings = RADII.map((r, i) => {
    const g = new THREE.Group();
    g.rotation.x = TILTS[i][0]; g.rotation.z = TILTS[i][1];
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.01, 8, 220),
      new THREE.MeshBasicMaterial({ color: i === 0 ? 0xff7a45 : i === 1 ? 0xff4f79 : 0xffb547, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    world.add(g);
    return g;
  });

  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const coreLight = new THREE.PointLight(0xff8a5c, 60, 30, 2);
  world.add(coreLight);
  const rim = new THREE.DirectionalLight(0xb9a6ff, 1.4);
  rim.position.set(-6, 5, -4);
  scene.add(rim);

  // stars far away
  const S = 500, sp = new Float32Array(S * 3);
  for (let i = 0; i < S; i++) {
    const u = Math.sin(i * 78.233) * 43758.5453 % 1, v = Math.sin(i * 12.9898) * 23421.631 % 1, w = Math.sin(i * 4.1414) * 3758.5453 % 1;
    sp.set([(u - 0.5) * 60, (v - 0.5) * 40, -12 - Math.abs(w) * 30], i * 3);
  }
  const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 0.12, map: dot, color: 0xffd9c2, transparent: true, opacity: 0.55, depthWrite: false })));

  /* ---------- planets = calls ---------- */
  let planets = [];
  const planetGeo = new THREE.SphereGeometry(1, 40, 40);
  function set(trades, pctOf) {
    for (const p of planets) { p.ring.remove(p.mesh); p.mat.dispose(); p.glow.material.dispose(); p.label.remove(); }
    planets = trades.map((t, i) => {
      const pct = pctOf(t), kind = t.status === "active" ? "open" : (pct ?? 0) < 0 ? "loss" : "win";
      const ri = i % 3, r = RADII[ri];
      const size = 0.13 + Math.sqrt(Math.max(t.wt || 4, 4)) * 0.034;
      const mat = new THREE.MeshPhysicalMaterial({ color: COL[kind], emissive: COL[kind], emissiveIntensity: 0.6, metalness: 0.2, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.05 });
      const mesh = new THREE.Mesh(planetGeo, mat);
      mesh.scale.setScalar(size);
      const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: COL[kind], transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
      g.scale.setScalar(size * 5);
      mesh.add(g);
      rings[ri].add(mesh);
      const label = document.createElement("span");
      label.innerHTML = `${t.ticker} <i style="color:#${COL[kind].toString(16).padStart(6, "0")}">${pct == null ? "" : (pct >= 0 ? "+" : "-") + Math.abs(pct).toFixed(1) + "%"}</i>`;
      labelsEl.appendChild(label);
      return { t, mesh, mat, glow: g, label, ring: rings[ri], r, a: i * 2.399963, speed: 0.34 / Math.sqrt(r) * (1 + (i % 4) * 0.08), size };
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
    cam.position.z = w / h < 0.9 ? 12.4 : 10.2;
    cam.updateProjectionMatrix();
  }
  new ResizeObserver(size).observe(canvas);
  size();

  const v = new THREE.Vector3(), clock = new THREE.Clock();
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05), k = reduced.matches ? 0.35 : 1;
    if (!dragging) { vel += (auto * k - vel) * 0.02; yaw += vel; }
    world.rotation.set(pitch, yaw, 0);
    core.rotation.y += dt * 0.25 * k;
    shell.rotation.y -= dt * 0.12 * k;
    shell.rotation.x = Math.sin(clock.elapsedTime * 0.3) * 0.15;
    glow.material.opacity = 0.48 + Math.sin(clock.elapsedTime * 1.6) * 0.08;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    for (const p of planets) {
      p.a += p.speed * dt * k;
      p.mesh.position.set(Math.cos(p.a) * p.r, 0, Math.sin(p.a) * p.r);
      const s = p.size * (p === selected ? 1.45 : p === hovered ? 1.25 : 1);
      p.mesh.scale.setScalar(p.mesh.scale.x + (s - p.mesh.scale.x) * 0.2);
      p.mesh.getWorldPosition(v);
      const camDist = v.distanceTo(cam.position);
      v.project(cam);
      const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
      p.label.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-170%)`;
      const behind = camDist > cam.position.length() + 0.4 && Math.hypot(v.x, v.y) < 0.2;
      p.label.style.opacity = behind ? "0" : p === selected || p === hovered ? "1" : ".82";
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
  loop();
  return { set: (trades, pctOf) => { set(trades, pctOf); if (!running) frame(); }, select: (id) => { selected = planets.find(p => p.t.id === id) || null; } };
}
