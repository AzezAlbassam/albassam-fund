// ============================================================
// Space visuals.
//  * startStarfield — lightweight 2D canvas starfield backdrop
//    (parallax drift + shooting stars), unchanged.
//  * startSphere — WebGL "Albassam Core": a 3D particle globe
//    (Three.js from CDN) with grab-to-spin inertia, a wireframe
//    hologram shell, an accretion dust ring, and one glowing
//    planet per active position carrying a live ticker + ROI%
//    label in 3D. Falls back to the original 2D canvas sphere
//    if WebGL/CDN is unavailable.
// ============================================================

const reduced = window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const GREEN = 0x6ee787, GREEN_CSS = "110,231,135";
const RED = 0xff5a4e, RED_CSS = "255,90,78";

/* ----------------------- starfield ----------------------- */
export function startStarfield(canvas) {
  if (reduced || !canvas) return;
  const cx = canvas.getContext("2d");
  let W, H, stars = [];
  let mx = 0, my = 0;         // mouse parallax offset (-1..1)

  function build() {
    W = canvas.width = innerWidth;
    H = canvas.height = innerHeight;
    stars = [];
    const n = Math.min(260, Math.floor(W * H / 6500));
    for (let i = 0; i < n; i++) {
      const depth = Math.random();                    // 0 far .. 1 near
      stars.push({
        x: Math.random() * W, y: Math.random() * H, depth,
        r: 0.4 + depth * 1.3,
        tw: Math.random() * Math.PI * 2,
        hue: Math.random() < 0.18,                    // some green stars
      });
    }
  }
  build();
  addEventListener("resize", build);
  addEventListener("mousemove", (e) => {
    mx = (e.clientX / W - 0.5) * 2;
    my = (e.clientY / H - 0.5) * 2;
  });

  let shoot = null, nextShoot = performance.now() + 4000 + Math.random() * 8000;

  function frame(ts) {
    cx.clearRect(0, 0, W, H);
    const t = ts * 0.001;
    for (const s of stars) {
      s.x -= (0.02 + s.depth * 0.06);
      if (s.x < -2) s.x = W + 2;
      const px = s.x - mx * s.depth * 14;
      const py = s.y - my * s.depth * 10;
      const glow = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 1.1 + s.tw));
      const a = (0.25 + s.depth * 0.65) * glow;
      cx.fillStyle = s.hue
        ? `rgba(140,235,160,${a})`
        : `rgba(240,235,255,${a * 0.85})`;
      cx.beginPath(); cx.arc(px, py, s.r * glow, 0, 7); cx.fill();
    }
    if (!shoot && ts > nextShoot) {
      shoot = { x: Math.random() * W * 0.7 + W * 0.2, y: Math.random() * H * 0.3, life: 0 };
    }
    if (shoot) {
      shoot.life += 0.03;
      shoot.x -= 9; shoot.y += 4.5;
      const a = Math.max(0, 1 - shoot.life);
      const g = cx.createLinearGradient(shoot.x, shoot.y, shoot.x + 70, shoot.y - 35);
      g.addColorStop(0, `rgba(170,245,190,${a})`);
      g.addColorStop(1, "rgba(170,245,190,0)");
      cx.strokeStyle = g; cx.lineWidth = 1.6;
      cx.beginPath(); cx.moveTo(shoot.x, shoot.y); cx.lineTo(shoot.x + 70, shoot.y - 35); cx.stroke();
      if (shoot.life >= 1) { shoot = null; nextShoot = ts + 6000 + Math.random() * 12000; }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/* ------------------- planets shared state ------------------- */
let planets = [];            // [{ticker, pct}] set from render on each update
let planetsDirty = false;

export function setPlanets(list) {
  planets = list;
  planetsDirty = true;
}

/* ==================== 3D sphere (Three.js) ==================== */
export function startSphere(canvas) {
  if (reduced || !canvas) return;
  startSphere3D(canvas).catch((e) => {
    console.warn("3D core unavailable, using 2D fallback:", e);
    startSphere2D(canvas);
  });
}

async function startSphere3D(canvas) {
  const THREE = await import("https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js");

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  const CAM_DIST = 46;
  camera.position.set(0, 5, CAM_DIST);
  camera.lookAt(0, 1.2, 0);

  // Everything the user can spin lives in `world`.
  const world = new THREE.Group();
  world.rotation.x = 0.18;
  world.position.y = 1.2;
  scene.add(world);

  /* ---- soft round sprite texture (glow dot) ---- */
  function glowTex(stops) {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    for (const [o, col] of stops) grad.addColorStop(o, col);
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const dotTex = glowTex([[0, "rgba(255,255,255,1)"], [0.3, "rgba(190,255,205,.55)"], [1, "rgba(0,0,0,0)"]]);
  const coreTex = glowTex([[0, "rgba(150,255,200,.55)"], [0.4, "rgba(70,205,160,.15)"], [1, "rgba(0,0,0,0)"]]);

  /* ---- particle globe (fibonacci sphere) ---- */
  const N = 2600, R = 10;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  // richer palette: emerald backbone, mint + aqua accents,
  // spring-green highlights and the odd white sparkle
  const PALETTE = [
    [new THREE.Color(0x6ee787), 0.46],
    [new THREE.Color(0xa9f5b5), 0.20],
    [new THREE.Color(0x53d8c9), 0.16],
    [new THREE.Color(0x8fff9f), 0.12],
    [new THREE.Color(0xeafff0), 0.06],
  ];
  function pick() {
    let r = Math.random();
    for (const [c, w] of PALETTE) { if ((r -= w) <= 0) return c; }
    return PALETTE[0][0];
  }
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = golden * i;
    const rad = R * (0.985 + Math.random() * 0.05);
    pos[i * 3] = Math.cos(th) * r * rad;
    pos[i * 3 + 1] = y * rad;
    pos[i * 3 + 2] = Math.sin(th) * r * rad;
    const c = pick(), v = 0.55 + Math.random() * 0.6;
    col[i * 3] = c.r * v; col[i * 3 + 1] = c.g * v; col[i * 3 + 2] = c.b * v;
  }
  const globeGeo = new THREE.BufferGeometry();
  globeGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  globeGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const globe = new THREE.Points(globeGeo, new THREE.PointsMaterial({
    size: 0.26, map: dotTex, vertexColors: true, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  }));
  world.add(globe);

  /* ---- constellation links between near particles ---- */
  const linkPos = [];
  const sample = 460;                       // only link a subset — keeps it airy
  for (let i = 0; i < sample; i++) {
    const a = i * Math.floor(N / sample);
    for (let j = i + 1; j < i + 9 && j < sample; j++) {
      const b = j * Math.floor(N / sample);
      const dx = pos[a * 3] - pos[b * 3], dy = pos[a * 3 + 1] - pos[b * 3 + 1], dz = pos[a * 3 + 2] - pos[b * 3 + 2];
      if (dx * dx + dy * dy + dz * dz < 7.5) {
        linkPos.push(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
      }
    }
  }
  const linkGeo = new THREE.BufferGeometry();
  linkGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(linkPos), 3));
  world.add(new THREE.LineSegments(linkGeo, new THREE.LineBasicMaterial({
    color: GREEN, transparent: true, opacity: 0.14, depthWrite: false, blending: THREE.AdditiveBlending,
  })));

  /* ---- faint hologram shell ---- */
  const shell = new THREE.LineSegments(
    new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(R * 0.94, 2)),
    new THREE.LineBasicMaterial({ color: GREEN, transparent: true, opacity: 0.045, depthWrite: false }));
  world.add(shell);

  /* ---- breathing core glow ---- */
  const core = new THREE.Sprite(new THREE.SpriteMaterial({
    map: coreTex, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  core.scale.setScalar(18);
  world.add(core);

  /* ---- accretion dust ring ---- */
  const DN = 900, dpos = new Float32Array(DN * 3), dcol = new Float32Array(DN * 3);
  const gold = new THREE.Color(0xe9d28e), sage = new THREE.Color(0x9adf9f);
  for (let i = 0; i < DN; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 13 + Math.pow(Math.random(), 1.6) * 8;
    dpos[i * 3] = Math.cos(a) * r;
    dpos[i * 3 + 1] = (Math.random() - 0.5) * 0.7;
    dpos[i * 3 + 2] = Math.sin(a) * r;
    // warm golden dust with sage flecks — starlight against the green
    const c = Math.random() < 0.6 ? gold : sage;
    const v = 0.22 + Math.random() * 0.45;
    dcol[i * 3] = c.r * v; dcol[i * 3 + 1] = c.g * v; dcol[i * 3 + 2] = c.b * v;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dpos, 3));
  dustGeo.setAttribute("color", new THREE.BufferAttribute(dcol, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    size: 0.18, map: dotTex, vertexColors: true, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  world.add(dust);

  /* ---- planets: one per active position ---- */
  const planetRoot = new THREE.Group();
  world.add(planetRoot);
  let built = [];   // [{tk, group, mesh, glow, label, lastPct, orbitR, tilt, speed, a0}]

  function labelTexture(tk, pct) {
    const c = document.createElement("canvas"); c.width = 256; c.height = 112;
    const g = c.getContext("2d");
    g.textAlign = "center";
    g.font = "700 44px 'JetBrains Mono',Menlo,monospace";
    g.fillStyle = "rgba(240,255,244,.96)";
    g.fillText(tk, 128, 44);
    const posv = (pct ?? 0) >= 0;
    g.font = "700 34px 'JetBrains Mono',Menlo,monospace";
    g.fillStyle = posv ? `rgba(${GREEN_CSS},.95)` : `rgba(${RED_CSS},.95)`;
    const p = pct == null ? "—" : (pct > 0 ? "+" : "") + pct.toFixed(1) + "%";
    g.fillText(p, 128, 88);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function orbitLine(rad, tilt) {
    const pts = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * rad, 0, Math.sin(a) * rad));
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: GREEN, transparent: true, opacity: 0.13, depthWrite: false }));
    line.rotation.z = tilt;
    return line;
  }

  function rebuildPlanets() {
    for (const b of built) { planetRoot.remove(b.holder); }
    built = [];
    planets.forEach((pl, i) => {
      const orbitR = 13.8 + (i % 3) * 2.9 + Math.floor(i / 3) * 1.2;
      const tilt = ((i % 3) - 1) * 0.16;
      const holder = new THREE.Group();
      holder.rotation.z = tilt;
      const colr = (pl.pct ?? 0) >= 0 ? GREEN : RED;
      const size = 0.7 + Math.min(1.2, Math.abs(pl.pct ?? 0) * 0.018);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(size, 24, 24),
        new THREE.MeshBasicMaterial({ color: colr }));
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex([[0, `rgba(${(pl.pct ?? 0) >= 0 ? GREEN_CSS : RED_CSS},.75)`], [1, "rgba(0,0,0,0)"]]),
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      glow.scale.setScalar(size * 6);
      const label = new THREE.Sprite(new THREE.SpriteMaterial({
        map: labelTexture(pl.ticker, pl.pct), transparent: true, depthWrite: false,
      }));
      label.scale.set(5.6, 2.45, 1);
      label.position.y = size + 2.1;
      const grp = new THREE.Group();
      grp.add(mesh); grp.add(glow); grp.add(label);
      holder.add(grp);
      holder.add(orbitLine(orbitR, 0));
      planetRoot.add(holder);
      built.push({
        tk: pl.ticker, holder, grp, mesh, glow, label, lastPct: pl.pct,
        orbitR, speed: 0.22 - (i % 3) * 0.05, a0: (i / Math.max(1, planets.length)) * Math.PI * 2,
      });
    });
  }

  function refreshPlanets() {
    if (built.length !== planets.length ||
        !built.every((b, i) => b.tk === planets[i].ticker)) { rebuildPlanets(); return; }
    built.forEach((b, i) => {
      const pct = planets[i].pct;
      if (b.lastPct == null || pct == null || Math.abs(pct - b.lastPct) > 0.05 ||
          (pct >= 0) !== (b.lastPct >= 0)) {
        b.label.material.map?.dispose();
        b.label.material.map = labelTexture(b.tk, pct);
        b.label.material.needsUpdate = true;
        b.mesh.material.color.set((pct ?? 0) >= 0 ? GREEN : RED);
        b.lastPct = pct;
      }
    });
  }

  /* ---- grab-to-spin with inertia ---- */
  let dragging = false, lastX = 0, lastY = 0, velY = 0;
  canvas.style.cursor = "grab";
  canvas.style.touchAction = "pan-y";      // vertical page scroll still works
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = "grabbing";
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    world.rotation.y += dx * 0.005;
    world.rotation.x = Math.max(-0.6, Math.min(0.75, world.rotation.x + dy * 0.003));
    velY = dx * 0.005;
  });
  const endDrag = () => { dragging = false; canvas.style.cursor = "grab"; };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  // subtle camera parallax when not dragging
  let pmx = 0;
  addEventListener("mousemove", (e) => { pmx = (e.clientX / innerWidth - 0.5) * 2; });

  /* ---- sizing (canvas may start hidden behind the edit gate) ---- */
  function size() {
    const w = canvas.offsetWidth || canvas.parentElement?.offsetWidth || 0;
    const h = canvas.offsetHeight || canvas.parentElement?.offsetHeight || 0;
    if (!w || !h) return false;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // On phones the DOM stats overlay covers more of the stage:
    // shrink the system and float it up into the visible sky.
    const ov = canvas.parentElement?.querySelector(".stage-overlay");
    const frac = ov ? ov.offsetHeight / h : 0.34;
    world.position.y = 1.2 + Math.max(0, frac - 0.34) * 16;
    world.scale.setScalar(Math.min(1, Math.max(0.55, w / 620)));
    // steeper viewing angle on phones: orbit rings flatten on
    // screen and stay clear of the overlay text
    if (w < 640) world.rotation.x = Math.max(world.rotation.x, 0.42);
    return true;
  }
  let sized = size();
  addEventListener("resize", () => { sized = size(); });
  if (canvas.parentElement && "ResizeObserver" in window) {
    new ResizeObserver(() => { sized = size(); }).observe(canvas.parentElement);
  }

  /* ---- animate ---- */
  const wp = new THREE.Vector3();
  renderer.setAnimationLoop((ts) => {
    if (!sized) { sized = size(); if (!sized) return; }
    const t = ts * 0.001;
    if (planetsDirty) { refreshPlanets(); planetsDirty = false; }
    if (!dragging) {
      velY *= 0.95;
      world.rotation.y += 0.0016 + velY;
    }
    dust.rotation.y -= 0.0007;
    shell.rotation.y += 0.0004;
    core.material.opacity = 0.5 + 0.18 * Math.sin(t * 1.1);
    globe.scale.setScalar(1 + 0.012 * Math.sin(t * 0.8));
    for (const b of built) {
      const a = b.a0 + t * b.speed;
      b.grp.position.set(Math.cos(a) * b.orbitR, 0, Math.sin(a) * b.orbitR);
      // keep labels the same apparent size wherever the orbit takes them
      b.grp.getWorldPosition(wp);
      const k = camera.position.distanceTo(wp) / CAM_DIST;
      b.label.scale.set(5.6 * k, 2.45 * k, 1);
    }
    camera.position.x += (pmx * 1.6 - camera.position.x) * 0.03;
    camera.lookAt(0, 1.2, 0);
    renderer.render(scene, camera);
  });
}

/* ============ 2D canvas sphere (fallback, original) ============ */
function startSphere2D(canvas) {
  const cx = canvas.getContext("2d");
  function size() {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
  }
  size();
  addEventListener("resize", size);

  const N = 320, P = [];
  for (let i = 0; i < N; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
    let r = 0.55 + Math.random() * 0.45; r = Math.pow(r, 0.7);
    const sq = Math.sqrt(1 - u * u);
    P.push({ x: sq * Math.cos(th) * r, y: u * r, z: sq * Math.sin(th) * r, tw: Math.random() * 6.28 });
  }

  let ang = 0;
  function frame(ts) {
    ang += 0.0021;
    let W = canvas.width, H = canvas.height;
    if (!W || !H) {           // canvas was hidden at init (edit gate) — retry
      size(); W = canvas.width; H = canvas.height;
      if (!W || !H) { requestAnimationFrame(frame); return; }
    }
    cx.clearRect(0, 0, W, H);
    const Cx = W / 2, Cy = H * 0.44, R = Math.min(W, H) * 0.33, F = 2.6;
    const t = ts * 0.001;

    const core = cx.createRadialGradient(Cx, Cy, 0, Cx, Cy, R * 0.55);
    core.addColorStop(0, `rgba(${GREEN_CSS},0.20)`);
    core.addColorStop(1, `rgba(${GREEN_CSS},0)`);
    cx.fillStyle = core;
    cx.beginPath(); cx.arc(Cx, Cy, R * 0.55, 0, 7); cx.fill();

    const proj = [], ca = Math.cos(ang), sa = Math.sin(ang);
    for (let i = 0; i < N; i++) {
      const p = P[i];
      const x = p.x * ca - p.z * sa, z = p.x * sa + p.z * ca, y = p.y;
      const s = F / (F + z);
      proj.push({ X: Cx + x * R * s, Y: Cy + y * R * s, s, z, tw: p.tw });
    }
    for (let i = 0; i < N; i++) {
      const a = proj[i];
      for (let j = i + 1; j < i + 7 && j < N; j++) {
        const b = proj[j], dx = a.X - b.X, dy = a.Y - b.Y, d = dx * dx + dy * dy;
        if (d < 2400) {
          cx.strokeStyle = `rgba(${GREEN_CSS},${0.10 * (1 - d / 2400) * a.s})`;
          cx.beginPath(); cx.moveTo(a.X, a.Y); cx.lineTo(b.X, b.Y); cx.stroke();
        }
      }
    }
    for (let i = 0; i < N; i++) {
      const p = proj[i];
      const glow = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 1.4 + p.tw));
      const depth = (p.z + 1) / 2;
      cx.fillStyle = `rgba(${GREEN_CSS},${(0.9 - depth * 0.6) * glow})`;
      cx.beginPath(); cx.arc(p.X, p.Y, (1.1 + (1 - depth) * 1.5) * glow, 0, 7); cx.fill();
    }

    const nP = planets.length;
    for (let i = 0; i < nP; i++) {
      const pl = planets[i];
      const orbR = R * (1.18 + (i % 3) * 0.16);
      const speed = 0.25 - (i % 3) * 0.05;
      const a0 = (i / nP) * Math.PI * 2 + t * speed;
      const x = Math.cos(a0) * orbR, z = Math.sin(a0) * orbR / R;
      const y = Math.sin(a0) * orbR * 0.30;
      const s = F / (F + z * 0.8);
      const X = Cx + x * s, Y = Cy + y * s;
      const posv = (pl.pct ?? 0) >= 0;
      const colr = posv ? GREEN_CSS : RED_CSS;
      const rad = Math.min(6.5, 2.6 + Math.abs(pl.pct ?? 0) * 0.05) * s;
      cx.strokeStyle = `rgba(${GREEN_CSS},0.05)`;
      cx.beginPath(); cx.ellipse(Cx, Cy, orbR, orbR * 0.30, 0, 0, 7); cx.stroke();
      const g = cx.createRadialGradient(X, Y, 0, X, Y, rad * 3);
      g.addColorStop(0, `rgba(${colr},0.85)`);
      g.addColorStop(0.4, `rgba(${colr},0.25)`);
      g.addColorStop(1, `rgba(${colr},0)`);
      cx.fillStyle = g;
      cx.beginPath(); cx.arc(X, Y, rad * 3, 0, 7); cx.fill();
      cx.fillStyle = `rgba(${colr},1)`;
      cx.beginPath(); cx.arc(X, Y, rad, 0, 7); cx.fill();
      cx.font = "9px ui-monospace,Menlo,monospace";
      cx.fillStyle = `rgba(${colr},${0.55 + 0.35 * s})`;
      cx.textAlign = "center";
      cx.fillText(pl.ticker, X, Y - rad * 3 - 2);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
