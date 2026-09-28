// ============================================================
// The hero's live 3D market (Three.js), built from the fund's real
// data. A glowing grid floor streams toward the viewer; our fund's
// daily line rises in 3D (coral to amber) with gold and the S&P 500
// behind it; every closed call stands in front as a 3D candle
// (green won, rose lost). Rendered live, so it stays sharp on any
// screen. The camera drifts on its own, follows the mouse and dives
// forward as the page scrolls.
//   const m = await startMarket(canvas, labelsEl);
//   m.setData(race, trades, pctOf); m.setScroll(0..1)
// ============================================================

import * as THREE from "three";

const GRID_VS = `varying vec3 vW;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const GRID_FS = `uniform float uTime; varying vec3 vW;
float line(vec2 p, float s){ vec2 q = p / s; vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q); return 1.0 - min(min(g.x, g.y), 1.0); }
void main(){
  vec2 p = vW.xz + vec2(0.0, uTime * 0.9);
  float g = line(p, 1.0) * 0.55 + line(p, 4.0) * 0.45;
  float d = length(vW.xz - vec2(0.0, -2.0));
  float fade = smoothstep(24.0, 3.0, d);
  vec3 c = mix(vec3(1.0, 0.31, 0.47), vec3(1.0, 0.71, 0.28), clamp(vW.x / 18.0 + 0.5, 0.0, 1.0));
  gl_FragColor = vec4(c * g * fade * 0.9, 1.0);
}`;
const DUST_VS = `uniform float uTime; attribute float aSeed; varying float vA;
void main(){
  vec3 p = position;
  p.y = mod(p.y + uTime * (0.25 + aSeed * 0.35), 7.0) - 0.5;
  p.x += sin(uTime * 0.4 + aSeed * 12.0) * 0.25;
  vA = smoothstep(-0.5, 0.8, p.y) * (1.0 - smoothstep(4.5, 6.5, p.y));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (2.0 + aSeed * 3.0) * (18.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const DUST_FS = `varying float vA;
void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA;
  gl_FragColor = vec4(vec3(1.0, 0.62, 0.42) * a, 1.0); }`;

function glowTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(.3, "rgba(255,255,255,.5)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const ease = (k) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

export async function startMarket(canvas, labelsEl) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x07060a, 12, 30);
  const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 80);
  const world = new THREE.Group();
  scene.add(world);
  const glowTex = glowTexture();

  // streaming grid floor
  const gridMat = new THREE.ShaderMaterial({ vertexShader: GRID_VS, fragmentShader: GRID_FS, uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), gridMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  scene.add(floor);

  // rising sparks
  const DN = 420, dp = new Float32Array(DN * 3), ds = new Float32Array(DN);
  for (let i = 0; i < DN; i++) {
    const r = (k) => (Math.sin(i * k) * 43758.5453) % 1;
    dp.set([r(12.9898) * 11, Math.abs(r(78.233)) * 7, -1.5 + r(39.425) * 6], i * 3);
    ds[i] = Math.abs(r(93.989));
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dp, 3));
  dustGeo.setAttribute("aSeed", new THREE.BufferAttribute(ds, 1));
  const dustMat = new THREE.ShaderMaterial({ vertexShader: DUST_VS, fragmentShader: DUST_FS, uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  world.add(new THREE.Points(dustGeo, dustMat));

  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const key = new THREE.PointLight(0xff8a5c, 40, 30, 2); key.position.set(2, 5, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0xb9a6ff, 1.2); rim.position.set(-5, 6, -6); scene.add(rim);

  /* ---------- the data: three lines and the candles ---------- */
  let lines = [], candles = [], labels = [], built = 0, drawT = -1;
  const X0 = -6, X1 = 6;
  function clear() {
    for (const o of [...lines.flatMap(l => l.meshes), ...candles.map(c => c.group)]) { o.parent?.remove(o); o.traverse?.(n => { n.geometry?.dispose(); n.material?.dispose?.(); }); }
    labels.forEach(l => l.el.remove());
    lines = []; candles = []; labels = [];
  }
  function setData(race, trades, pctOf) {
    if (!race) return;
    clear();
    const n = race.days.length;
    const pct = (k) => race[k].map(v => (v / race[k][0] - 1) * 100);
    const series = { fund: pct("fund"), gold: pct("gold"), spx: pct("spx") };
    const all = [...series.fund, ...series.gold, ...series.spx];
    const lo = Math.min(0, ...all), hi = Math.max(10, ...all);
    const Y = (p) => 0.35 + (p - lo) / (hi - lo) * 4.2;
    const X = (i) => X0 + (i / Math.max(1, n - 1)) * (X1 - X0);
    const LANES = [["fund", 0, 0.075, [0xff4f79, 0xffb547]], ["gold", -1.5, 0.04, [0xffc24b, 0xffc24b]], ["spx", -2.8, 0.04, [0xa78bfa, 0xa78bfa]]];
    for (const [k, z, r, [c0, c1]] of LANES) {
      const pts = series[k].map((p, i) => new THREE.Vector3(X(i), Y(p), z));
      const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.2);
      const segs = Math.max(60, n * 5);
      const geo = new THREE.TubeGeometry(curve, segs, r, 10, false);
      const uv = geo.attributes.uv, col = new Float32Array(uv.count * 3), a = new THREE.Color(c0), b = new THREE.Color(c1), t = new THREE.Color();
      for (let i = 0; i < uv.count; i++) { t.copy(a).lerp(b, uv.getX(i)); col.set([t.r, t.g, t.b], i * 3); }
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      const core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
      const haloGeo = new THREE.TubeGeometry(curve, segs, r * 3.2, 8, false);
      const huv = haloGeo.attributes.uv, hcol = new Float32Array(huv.count * 3);
      for (let i = 0; i < huv.count; i++) { t.copy(a).lerp(b, huv.getX(i)); hcol.set([t.r, t.g, t.b], i * 3); }
      haloGeo.setAttribute("color", new THREE.BufferAttribute(hcol, 3));
      const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: k === "fund" ? 0.22 : 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
      const meshes = [core, halo];
      // the area under our fund's line glows down to the floor
      if (k === "fund") {
        const m = segs + 1, pos = new Float32Array(m * 6), cc = new Float32Array(m * 6), idx = [];
        for (let i = 0; i <= segs; i++) {
          const p = curve.getPoint(i / segs); t.copy(a).lerp(b, i / segs);
          pos.set([p.x, p.y, z, p.x, 0, z], i * 6);
          cc.set([t.r * .26, t.g * .26, t.b * .26, 0, 0, 0], i * 6);
          if (i < segs) { const q = i * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
        }
        const ag = new THREE.BufferGeometry();
        ag.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        ag.setAttribute("color", new THREE.BufferAttribute(cc, 3));
        ag.setIndex(idx);
        meshes.push(new THREE.Mesh(ag, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })));
      }
      const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: c1, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      head.scale.setScalar(k === "fund" ? 1.1 : 0.6);
      meshes.push(head);
      meshes.forEach(o => world.add(o));
      const el = document.createElement("span");
      el.className = "mk-label " + k;
      const last = series[k][n - 1];
      el.innerHTML = `${k === "fund" ? "Our fund" : k === "gold" ? "Gold" : "S&amp;P 500"} <b>${(last >= 0 ? "+" : "-") + Math.abs(last).toFixed(1)}%</b>`;
      labelsEl.appendChild(el);
      const drawn = meshes.filter(m => m !== head);   // only our own geometries get a draw range
      const L = { k, curve, meshes, drawn, head, el };
      lines.push(L); labels.push({ el, obj: head });
    }
    // candles: every closed call at its close date, in front of the lines
    const dayIdx = (d) => { let i = race.days.findIndex(x => x >= d); return i < 0 ? n - 1 : i; };
    const closed = trades.filter(t => t.status === "closed" && t.finalPct != null && t.closed)
      .sort((a, b) => (a.closed || "").localeCompare(b.closed || ""));
    const seen = {};
    closed.forEach((t, j) => {
      const i = dayIdx(t.closed), stack = (seen[i] = (seen[i] || 0) + 1) - 1;
      const p = pctOf(t) ?? t.finalPct, up = p >= 0;
      const h = 0.18 + Math.min(3.2, Math.abs(p) * 0.045);
      const color = up ? 0x4ade9a : 0xff5470;
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.2 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.26, 1, 0.26), mat);
      const wick = new THREE.Mesh(new THREE.BoxGeometry(0.035, 1, 0.035), mat);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
      g.add(body, wick, glow);
      g.position.set(X(i) + stack * 0.34 - 0.1, 0, 1.25 + (stack % 2) * 0.45);
      world.add(g);
      candles.push({ group: g, body, wick, glow, h, delay: 1.6 + j * 0.12 });
    });
    built = performance.now(); drawT = 0;
    frame(true);
  }

  /* ---------- camera: drift, mouse, scroll ---------- */
  let mx = 0, my = 0, sx = 0, sy = 0, scroll = 0;
  addEventListener("pointermove", (e) => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; }, { passive: true });
  let portrait = false;
  function size() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    portrait = w / h < 1;
    cam.fov = portrait ? 60 : 38;
    world.position.x = portrait ? 0 : 5.6;
    world.scale.setScalar(portrait ? 0.78 : 0.8);
    cam.updateProjectionMatrix();
  }
  new ResizeObserver(size).observe(canvas);
  size();

  const clock = new THREE.Clock(), v = new THREE.Vector3();
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let still = document.body.classList.contains("still"), visible = true, running = false;
  function frame(force) {
    const t = clock.getElapsedTime(), k = reduced.matches ? 0.3 : 1;
    gridMat.uniforms.uTime.value = t * k;
    dustMat.uniforms.uTime.value = t * k;
    sx += (mx - sx) * 0.04; sy += (my - sy) * 0.04;
    const sway = Math.sin(t * 0.18 * k) * 0.22;
    const R = portrait ? 17 : 14, yaw = -0.5 + sway + sx * 0.35;
    const dive = scroll * (portrait ? 5 : 6);
    cam.position.set(Math.sin(yaw) * (R - dive) + world.position.x, (portrait ? 4.4 : 3.6) + sy * 1.2 + scroll * 1.5, Math.cos(yaw) * (R - dive));
    cam.lookAt(world.position.x * 0.95, portrait ? 0.7 : 1.7, -0.6);
    // the lines draw themselves, then the candles rise
    const since = drawT < 0 ? 0 : (performance.now() - built) / 1000;
    const kd = reduced.matches || still ? 1 : ease(since / 2.6);
    for (const L of lines) {
      for (const m of L.drawn) m.geometry.setDrawRange(0, Math.floor(m.geometry.index.count * kd / 6) * 6);
      L.curve.getPoint(Math.max(0.001, kd), v);
      L.head.position.copy(v);
      L.head.material.opacity = 0.85 + Math.sin(t * 3) * 0.15;
    }
    for (const c of candles) {
      const e = reduced.matches || still ? 1 : ease((since - c.delay) / 0.9);
      const bh = Math.max(0.001, c.h * e), wh = Math.max(0.001, c.h * 0.35 * e);
      c.body.scale.y = bh; c.body.position.y = bh / 2;
      c.wick.scale.y = wh; c.wick.position.y = bh + wh / 2;
      c.glow.position.y = bh; c.glow.scale.setScalar(0.9 * e);
    }
    // labels ride the line ends
    const W = canvas.clientWidth, H = canvas.clientHeight;
    for (const l of labels) {
      l.obj.getWorldPosition(v); v.project(cam);
      const x = (v.x * 0.5 + 0.5) * W, lw = (l.w ||= l.el.offsetWidth || 120);
      // right of its point, or left of it near the edge; never outside the frame
      const left = Math.min(W - lw - 8, Math.max(8, x + 14 + lw > W - 8 ? x - lw - 14 : x + 14));
      l.el.style.transform = `translate(${left.toFixed(1)}px,${((-v.y * 0.5 + 0.5) * H).toFixed(1)}px)`;
      l.el.style.opacity = kd > 0.96 ? "1" : "0";
    }
    renderer.render(scene, cam);
  }
  function loop() {
    const go = visible && !document.hidden && !still;
    if (go && !running) { running = true; renderer.setAnimationLoop(() => frame()); }
    else if (!go && running) { running = false; renderer.setAnimationLoop(null); frame(true); }
  }
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; loop(); }).observe(canvas);
  document.addEventListener("visibilitychange", loop);
  addEventListener("motion", (e) => { still = e.detail.still; loop(); if (still) frame(true); });
  loop();
  return { setData, setScroll: (p) => { scroll = p; } };
}
