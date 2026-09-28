// ============================================================
// Glossy 3D towers (Three.js) that grow to their values, on a
// streaming grid floor. Used for the forecast (years as towers)
// and the Race podium (our fund vs gold vs the S&P 500).
//   const t = await startTowers(canvas, labelsEl);
//   t.set([{ id, x, z, h, color, label, ghost }])   // h in world units
// ============================================================

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const GRID_VS = `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const GRID_FS = `uniform float uTime; varying vec3 vW;
float line(vec2 p, float s){ vec2 q = p / s; vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q); return 1.0 - min(min(g.x, g.y), 1.0); }
void main(){ vec2 p = vW.xz + vec2(uTime * 0.35, 0.0);
  float g = line(p, 1.0) * 0.5 + line(p, 4.0) * 0.5;
  float fade = smoothstep(16.0, 2.0, length(vW.xz));
  gl_FragColor = vec4(mix(vec3(1.0, .31, .47), vec3(1.0, .71, .28), clamp(vW.x / 14.0 + .5, 0., 1.)) * g * fade * .7, 1.0); }`;

function glowTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(.3, "rgba(255,255,255,.45)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export async function startTowers(canvas, labelsEl, { yaw0 = -0.55, pitch = 0.42, spin = 0.08 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  const cam = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  const world = new THREE.Group(); scene.add(world);
  const glowTex = glowTexture();

  const gridMat = new THREE.ShaderMaterial({ vertexShader: GRID_VS, fragmentShader: GRID_FS, uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), gridMat);
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.01;
  world.add(floor);
  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  const key = new THREE.PointLight(0xff9a6a, 60, 40, 2); key.position.set(3, 8, 6); scene.add(key);
  const rim = new THREE.DirectionalLight(0xb9a6ff, 1.1); rim.position.set(-6, 6, -6); scene.add(rim);

  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);   // grows up from the floor
  const cols = new Map();
  let extent = { x: 4, h: 4, z: 2 };

  function set(specs) {
    const keep = new Set(specs.map(s => s.id));
    for (const [id, c] of cols) if (!keep.has(id)) { world.remove(c.group); c.mat.dispose(); c.label?.remove(); cols.delete(id); }
    let maxX = 1, maxH = 1, maxZ = 1;
    for (const s of specs) {
      let c = cols.get(s.id);
      if (!c) {
        const mat = new THREE.MeshPhysicalMaterial({ color: s.color, emissive: s.color, emissiveIntensity: s.ghost ? 0.25 : 0.55,
          metalness: 0.25, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08, transparent: !!s.ghost, opacity: s.ghost ? 0.5 : 1 });
        const mesh = new THREE.Mesh(box, mat);
        const cap = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: s.color, transparent: true, opacity: s.ghost ? 0.35 : 0.8,
          blending: THREE.AdditiveBlending, depthWrite: false }));
        const group = new THREE.Group(); group.add(mesh, cap); world.add(group);
        c = { group, mesh, mat, cap, h: 0.001, label: null };
        cols.set(s.id, c);
      }
      c.target = Math.max(0.02, s.h); c.w = s.w || 0.62;
      c.group.position.set(s.x, 0, s.z || 0);
      if (s.label) {
        if (!c.label) { c.label = document.createElement("span"); labelsEl.appendChild(c.label); }
        c.label.className = "t3-label" + (s.labelClass ? " " + s.labelClass : "");
        if (c.label.innerHTML !== s.label) { c.label.innerHTML = s.label; c.lw = 0; }
      } else if (c.label) { c.label.remove(); c.label = null; }
      maxX = Math.max(maxX, Math.abs(s.x) + 0.6); maxH = Math.max(maxH, s.h); maxZ = Math.max(maxZ, Math.abs(s.z || 0) + 0.6);
    }
    extent = { x: maxX, h: maxH, z: maxZ };
    kick();
  }

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let visible = true, still = document.body.classList.contains("still"), running = false;

  // drag to spin, with a slow drift of its own
  let yaw = yaw0, vel = spin * 0.01, dragging = false, lx = 0;
  canvas.addEventListener("pointerdown", (e) => { dragging = true; lx = e.clientX; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => { if (!dragging) return; vel = (e.clientX - lx) * 0.006; yaw += vel; lx = e.clientX; kick(); });
  const up = () => (dragging = false);
  canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);

  function size() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); kick();
  }

  const clock = new THREE.Clock(), v = new THREE.Vector3();

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05), k = reduced.matches ? 0.3 : 1;
    gridMat.uniforms.uTime.value += dt * k;
    if (!dragging) { vel += (spin * 0.01 * k - vel) * 0.03; yaw += vel; }
    // fit everything: the camera backs off as the towers grow
    const t = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const dH = (extent.h * 0.66) / t, dW = (extent.x + 0.9) / (t * cam.aspect);
    const r = Math.max(dH, dW, 5) * 1.22 + extent.z;   // the whole of every tower stays in frame
    cam.position.set(Math.sin(yaw) * r, extent.h * 0.5 + r * Math.sin(pitch) * 0.45, Math.cos(yaw) * r);
    cam.lookAt(0, extent.h * 0.47, 0);
    let moving = false;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    for (const c of cols.values()) {
      const d = c.target - c.h;
      if (Math.abs(d) > 0.002) { c.h += d * (reduced.matches || still ? 1 : 1 - Math.pow(0.9, dt * 60)); moving = true; } else c.h = c.target;
      c.mesh.scale.set(c.w, c.h, c.w);
      c.cap.position.y = c.h; c.cap.scale.setScalar(c.w * 2.2);
      if (c.label) {
        v.set(0, c.h, 0); c.group.localToWorld(v); v.project(cam);
        const lw = (c.lw ||= c.label.offsetWidth || 110), lift = c.label.classList.contains("spx") ? 70 : 42;   // S&P sits a row above gold
        const x = Math.min(W - lw - 8, Math.max(8, (v.x * 0.5 + 0.5) * W - lw / 2));
        c.label.style.transform = `translate(${x.toFixed(1)}px,${Math.max(4, (-v.y * 0.5 + 0.5) * H - lift).toFixed(1)}px)`;
      }
    }
    renderer.render(scene, cam);
  }
  function kick() { if (!running) frame(); }
  function loop() {
    const go = visible && !document.hidden && !still;
    if (go && !running) { running = true; clock.getDelta(); renderer.setAnimationLoop(frame); }
    else if (!go && running) { running = false; renderer.setAnimationLoop(null); frame(); }
  }
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; loop(); }).observe(canvas);
  document.addEventListener("visibilitychange", loop);
  addEventListener("motion", (e) => { still = e.detail.still; loop(); });
  new ResizeObserver(size).observe(canvas);   // last: size() renders a frame, so everything above must exist
  size();
  loop();
  return { set };
}
