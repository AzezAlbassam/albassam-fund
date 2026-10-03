// ============================================================
// 3D towers as a line drawing (Three.js): white boxes with crisp
// ink edges that grow to their values, on a thin grid floor that
// fades into the paper. Used for the forecast (years as towers),
// the Race podium and the Family podium.
//   const t = await startTowers(canvas, labelsEl);
//   t.set([{ id, x, z, h, color, label, labelClass, ghost, w }])   // h in world units
// color = the edge color (ink, greys, red for a loss). ghost = lighter
// edges. A labelClass with "fund" makes the tower solid (filled with
// its color, white edges): our fund reads as the one black tower.
// ============================================================

import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

const GRID_VS = `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const GRID_FS = `uniform float uTime; varying vec3 vW;
float line(vec2 p, float s){ vec2 q = p / s; vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q); return 1.0 - min(min(g.x, g.y), 1.0); }
void main(){ vec2 p = vW.xz + vec2(uTime * 0.12, 0.0);
  float g = max(line(p, 1.0) * 0.45, line(p, 4.0));
  float fade = smoothstep(14.0, 1.5, length(vW.xz));
  gl_FragColor = vec4(vec3(0.043, 0.043, 0.047), g * fade * 0.22); }`;

export async function startTowers(canvas, labelsEl, { yaw0 = -0.55, pitch = 0.42, spin = 0.08 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xffffff, 10, 40);   // the far towers fade into the paper
  const cam = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  const world = new THREE.Group(); scene.add(world);

  const gridMat = new THREE.ShaderMaterial({ vertexShader: GRID_VS, fragmentShader: GRID_FS, uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: false });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), gridMat);
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.01;
  world.add(floor);

  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);   // grows up from the floor
  const edges = new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(box));
  const res = new THREE.Vector2(1, 1);
  const cols = new Map();
  let extent = { x: 4, h: 4, z: 2 };

  // fill hides the edges behind it (a hidden-line drawing); edges sit a hair in front
  function paint(c, s) {
    const solid = /\bfund\b/.test(s.labelClass || "");
    c.fill.color.set(solid ? s.color : 0xffffff);
    c.line.color.set(solid ? 0xffffff : s.color);
    c.line.opacity = solid ? 0.55 : s.ghost ? 0.8 : 1;
    c.line.linewidth = solid ? 1 : s.ghost ? 1 : 1.5;
  }

  function set(specs) {
    const keep = new Set(specs.map(s => s.id));
    for (const [id, c] of cols) if (!keep.has(id)) { world.remove(c.group); c.fill.dispose(); c.line.dispose(); c.label?.remove(); cols.delete(id); }
    let maxX = 1, maxH = 1, maxZ = 1;
    for (const s of specs) {
      let c = cols.get(s.id);
      if (!c) {
        const fill = new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
        const line = new LineMaterial({ color: 0x0b0b0c, linewidth: 1.5, transparent: true, fog: true });
        line.resolution.copy(res);
        const body = new THREE.Group();
        body.add(new THREE.Mesh(box, fill), new LineSegments2(edges, line));
        const group = new THREE.Group(); group.add(body); world.add(group);
        c = { group, body, fill, line, h: 0.001, label: null };
        cols.set(s.id, c);
      }
      paint(c, s);   // a gain can turn into a loss
      c.target = Math.max(0.02, s.h); c.w = s.w || 0.62;
      c.group.position.set(s.x, 0, s.z || 0);
      if (s.label) {
        if (!c.label) { c.label = document.createElement("span"); labelsEl.appendChild(c.label); }
        c.label.className = "t3-label" + (s.labelClass ? " " + s.labelClass : "");
        if (c.label.innerHTML !== s.label) { c.label.innerHTML = s.label; c.lw = c.lh = 0; }
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
    renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
    res.set(w, h);
    for (const c of cols.values()) c.line.resolution.copy(res);
    kick();
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
    scene.fog.near = r - extent.z; scene.fog.far = r + extent.x * 2 + 8;
    const W = canvas.clientWidth, H = canvas.clientHeight, placed = [];
    for (const c of cols.values()) {
      const d = c.target - c.h;
      if (Math.abs(d) > 0.002) c.h += d * (reduced.matches || still ? 1 : 1 - Math.pow(0.9, dt * 60)); else c.h = c.target;
      c.body.scale.set(c.w, c.h, c.w);
      if (c.label) {
        v.set(0, c.h, 0); c.group.localToWorld(v); v.project(cam);
        const lw = (c.lw ||= c.label.offsetWidth || 110), lift = c.label.matches(".spx,.alt") ? 70 : 42;   // S&P (and every other racer) sits a row higher, so neighbours never collide
        const x = Math.min(W - lw - 8, Math.max(8, (v.x * 0.5 + 0.5) * W - lw / 2)), lh = (c.lh ||= c.label.offsetHeight || 26);
        const hit = (yy) => placed.find(b => x < b.x + b.w + 4 && b.x < x + lw + 4 && yy < b.y + b.h + 4 && b.y < yy + lh + 4);
        const y0 = Math.max(4, (-v.y * 0.5 + 0.5) * H - lift);
        let y = y0;
        for (let b; (b = hit(y));) y = b.y - lh - 6;               // stack above a label it would cover…
        if (y < 4) { y = y0; for (let b; (b = hit(y));) y = b.y + b.h + 6; }   // …or below, when the top runs out
        y = Math.max(4, Math.min(H - lh - 4, y));
        placed.push({ x, y, w: lw, h: lh });
        c.label.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
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
