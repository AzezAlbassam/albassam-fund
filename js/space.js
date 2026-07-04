// ============================================================
// Space visuals — lightweight 2D canvas only.
//  * fixed full-screen starfield with 3 parallax depth layers,
//    slow drift, mouse parallax and the odd shooting star
//  * rotating 3D-projected particle sphere in the hero stage,
//    with an orbiting "planet" per active position (orange for
//    profit, red for loss, sized by |ROI|)
// ============================================================

const reduced = window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
        hue: Math.random() < 0.18,                    // some orange stars
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
      // slow diagonal drift, near stars move faster
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
    // occasional shooting star
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

/* ------------------- particle sphere -------------------- */
let planets = [];   // [{ticker, pct}] set from render on each update

export function setPlanets(list) { planets = list; }

export function startSphere(canvas) {
  if (reduced || !canvas) return;
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

    // glowing core
    const core = cx.createRadialGradient(Cx, Cy, 0, Cx, Cy, R * 0.55);
    core.addColorStop(0, "rgba(110,231,135,0.20)");
    core.addColorStop(1, "rgba(110,231,135,0)");
    cx.fillStyle = core;
    cx.beginPath(); cx.arc(Cx, Cy, R * 0.55, 0, 7); cx.fill();

    // rotate + project shell particles
    const proj = [], ca = Math.cos(ang), sa = Math.sin(ang);
    for (let i = 0; i < N; i++) {
      const p = P[i];
      const x = p.x * ca - p.z * sa, z = p.x * sa + p.z * ca, y = p.y;
      const s = F / (F + z);
      proj.push({ X: Cx + x * R * s, Y: Cy + y * R * s, s, z, tw: p.tw });
    }
    // connections
    for (let i = 0; i < N; i++) {
      const a = proj[i];
      for (let j = i + 1; j < i + 7 && j < N; j++) {
        const b = proj[j], dx = a.X - b.X, dy = a.Y - b.Y, d = dx * dx + dy * dy;
        if (d < 2400) {
          cx.strokeStyle = `rgba(110,231,135,${0.10 * (1 - d / 2400) * a.s})`;
          cx.beginPath(); cx.moveTo(a.X, a.Y); cx.lineTo(b.X, b.Y); cx.stroke();
        }
      }
    }
    // twinkling points
    for (let i = 0; i < N; i++) {
      const p = proj[i];
      const glow = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 1.4 + p.tw));
      const depth = (p.z + 1) / 2;
      cx.fillStyle = `rgba(${100 + Math.round(40 * glow)},${215 + Math.round(30 * glow)},140,${(0.9 - depth * 0.6) * glow})`;
      cx.beginPath(); cx.arc(p.X, p.Y, (1.1 + (1 - depth) * 1.5) * glow, 0, 7); cx.fill();
    }

    // orbiting planets — one per active position
    const nP = planets.length;
    for (let i = 0; i < nP; i++) {
      const pl = planets[i];
      const orbR = R * (1.18 + (i % 3) * 0.16);
      const speed = 0.25 - (i % 3) * 0.05;
      const a0 = (i / nP) * Math.PI * 2 + t * speed;
      const x = Math.cos(a0) * orbR, z = Math.sin(a0) * orbR / R;  // squashed ellipse
      const y = Math.sin(a0) * orbR * 0.30;
      const s = F / (F + z * 0.8);
      const X = Cx + x * s, Y = Cy + y * s;
      const pos = (pl.pct ?? 0) >= 0;
      const col = pos ? "110,231,135" : "255,90,78";
      const rad = Math.min(6.5, 2.6 + Math.abs(pl.pct ?? 0) * 0.05) * s;
      // faint orbit path
      cx.strokeStyle = `rgba(110,231,135,0.05)`;
      cx.beginPath(); cx.ellipse(Cx, Cy, orbR, orbR * 0.30, 0, 0, 7); cx.stroke();
      const g = cx.createRadialGradient(X, Y, 0, X, Y, rad * 3);
      g.addColorStop(0, `rgba(${col},0.85)`);
      g.addColorStop(0.4, `rgba(${col},0.25)`);
      g.addColorStop(1, `rgba(${col},0)`);
      cx.fillStyle = g;
      cx.beginPath(); cx.arc(X, Y, rad * 3, 0, 7); cx.fill();
      cx.fillStyle = `rgba(${col},1)`;
      cx.beginPath(); cx.arc(X, Y, rad, 0, 7); cx.fill();
      // ticker label
      cx.font = "9px ui-monospace,Menlo,monospace";
      cx.fillStyle = `rgba(${col},${0.55 + 0.35 * s})`;
      cx.textAlign = "center";
      cx.fillText(pl.ticker, X, Y - rad * 3 - 2);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
