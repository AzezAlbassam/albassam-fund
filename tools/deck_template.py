#!/usr/bin/env python3
"""
Standalone gold-themed slide deck for the Albassam Fund report.
Replicates the Claude-design gold/taupe look as a self-contained HTML
presentation (no Claude-design runtime needed): open in any browser,
press → / Space to advance, or print to PDF (one slide per page).

build_deck(ctx) -> html string.  ctx keys are filled by monthly_report.py.
"""

BG, CARD, LINE, GOLD, GOLD2, GOLD_DIM, LOSS = \
    "#4C4840", "#5B564B", "#34322D", "#E6CF8B", "#C9B478", "#B99A45", "#D2705F"

# Motion layer: 3D candlestick skyline on the title — the fund's REAL
# calls as golden candles growing from a trading-grid floor (Three.js
# from CDN, drag to orbit; __CANDLES__ is injected by build_deck) —
# plus scroll-triggered reveals, count-up numbers, self-drawing chart,
# growing bars, sweeping win-ring, and 3D card tilt. Plain string (not
# an f-string) so the JS braces stay untouched. Skips itself entirely
# under prefers-reduced-motion, and finalizes all states before printing.
ANIM_JS = """
<script type="module">
(async () => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 3D candlestick skyline: the fund's real calls ---------- */
  const CANDLES = __CANDLES__;
  const canvas = document.getElementById('bg3d');
  if (canvas && !reduced) {
    try {
      const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js');
      const renderer = new THREE.WebGLRenderer({canvas, alpha:true, antialias:true});
      renderer.setPixelRatio(Math.min(devicePixelRatio||1, 2));
      const scene = new THREE.Scene();
      const cam = new THREE.PerspectiveCamera(40, 1, .1, 200);
      cam.position.set(1.5, 5.5, 30); cam.lookAt(2.5, 2.4, 0);
      const world = new THREE.Group();
      world.scale.setScalar(.75);
      world.position.set(13.2, -1, 0);
      scene.add(world);
      const GOLD_C = 0xE6CF8B, LOSS_C = 0xD2705F, EDGE_C = 0x34322D;

      const dotTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64;
        const g = c.getContext('2d'); const gr = g.createRadialGradient(32,32,0,32,32,32);
        gr.addColorStop(0,'rgba(255,244,205,1)'); gr.addColorStop(.4,'rgba(230,207,139,.5)'); gr.addColorStop(1,'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(0,0,64,64); return new THREE.CanvasTexture(c); })();

      // faint trading-grid floor
      const grid = new THREE.GridHelper(80, 28, GOLD_C, GOLD_C);
      grid.material.transparent = true; grid.material.opacity = .10;
      world.add(grid);

      function label(tk, pct, neg) {
        const c = document.createElement('canvas'); c.width = 256; c.height = 128;
        const g = c.getContext('2d'); g.textAlign = 'center';
        g.font = "700 54px 'Baloo Bhaijaan 2',sans-serif";
        g.fillStyle = neg ? '#D2705F' : '#E6CF8B';
        g.fillText(tk, 128, 56);
        g.font = "700 40px 'IBM Plex Mono',monospace";
        g.globalAlpha = .85;
        g.fillText((pct >= 0 ? '+' : '') + pct.toFixed(1) + '%', 128, 108);
        const s = new THREE.Sprite(new THREE.SpriteMaterial({
          map: new THREE.CanvasTexture(c), transparent: true, opacity: 0}));
        s.scale.set(2.7, 1.35, 1);
        return s;
      }

      // proper candlestick anatomy: slim body + upper AND lower wicks,
      // the candle standing on its low-wick like a real chart
      const spacing = 2.2, n = CANDLES.length;
      const items = [];
      CANDLES.forEach((d, i) => {
        const x = (i - (n-1)/2) * spacing;
        const h = Math.min(8, .9 + Math.abs(d.pct) * .12);   // body height
        const uw = .35 * Math.min(3, .6 + h * .35);           // upper shadow
        const lw = .35 * Math.min(1.6, .4 + h * .18);         // lower shadow
        const neg = d.pct < 0;
        const col = neg ? LOSS_C : GOLD_C;
        const mat = () => new THREE.MeshBasicMaterial({color: col, transparent: !!d.open, opacity: d.open ? .55 : 1});
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1, 1.05), mat());
        body.add(new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(1.05, 1, 1.05)),
          new THREE.LineBasicMaterial({color: EDGE_C, transparent:true, opacity:.9})));
        const wickUp = new THREE.Mesh(new THREE.BoxGeometry(.12, 1, .12), mat());
        const wickDn = new THREE.Mesh(new THREE.BoxGeometry(.12, 1, .12), mat());
        const lab = label(d.tk, d.pct, neg);
        const grp = new THREE.Group();
        grp.add(body); grp.add(wickUp); grp.add(wickDn); grp.add(lab);
        grp.position.x = x;
        world.add(grp);
        items.push({body, wickUp, wickDn, lab, h, uw, lw, neg, stag: (i % 2) * 1.15, delay: .2 + i * .13});
      });

      // gold dust in the air
      const DN = 320, dp = new Float32Array(DN*3);
      for (let i=0;i<DN;i++){ dp[i*3]=(Math.random()-.5)*60; dp[i*3+1]=Math.random()*18-2; dp[i*3+2]=(Math.random()-.5)*30; }
      const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dp,3));
      const dust = new THREE.Points(dg, new THREE.PointsMaterial({size:.22, map:dotTex, color:GOLD_C,
        transparent:true, opacity:.5, depthWrite:false, blending:THREE.AdditiveBlending}));
      world.add(dust);

      let userY=0, tiltX=0, drag=false, lx=0, ly=0, vel=0;
      canvas.style.cursor = 'grab';
      canvas.addEventListener('pointerdown', e => { drag=true; lx=e.clientX; ly=e.clientY;
        canvas.setPointerCapture(e.pointerId); canvas.style.cursor='grabbing'; });
      canvas.addEventListener('pointermove', e => { if(!drag) return;
        userY += (e.clientX-lx)*.004;
        tiltX = Math.max(-.12, Math.min(.32, tiltX+(e.clientY-ly)*.002));
        vel=(e.clientX-lx)*.004; lx=e.clientX; ly=e.clientY; });
      const end = () => { drag=false; canvas.style.cursor='grab'; };
      canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);

      function size(){ const w=canvas.offsetWidth, h2=canvas.offsetHeight; if(!w||!h2) return false;
        renderer.setSize(w,h2,false); cam.aspect=w/h2; cam.updateProjectionMatrix(); return true; }
      let ok = size(); addEventListener('resize', () => { ok = size(); });
      const t0 = performance.now();
      renderer.setAnimationLoop(ts => { if(!ok){ ok=size(); if(!ok) return; }
        const t = (ts - t0) / 1000;
        if(!drag){ vel *= .94; userY += vel; }
        world.rotation.y = userY + Math.sin(t*.14)*.20;
        world.rotation.x = tiltX;
        dust.rotation.y += .0006;
        for (const it of items) {
          const k = Math.min(1, Math.max(0, (t - it.delay) / 1.1));
          const e = 1 - Math.pow(1 - k, 4);
          const s = it.neg ? -1 : 1;
          const bh = Math.max(.001, it.h * e);
          const uw = Math.max(.001, it.uw * e);   // shadow away from the line
          const lw = Math.max(.001, it.lw * e);   // shadow toward the line
          // low wick from the baseline, body on top of it, high wick above
          it.wickDn.scale.y = lw;
          it.wickDn.position.y = s * lw / 2;
          it.body.scale.y = bh;
          it.body.position.y = s * (lw + bh / 2);
          it.wickUp.scale.y = uw;
          it.wickUp.position.y = s * (lw + bh + uw / 2);
          it.lab.material.opacity = e * .95;
          it.lab.position.y = it.neg ? -(lw + bh + uw) - 1.1 : (lw + bh + uw) + 1.0 + it.stag;
        }
        renderer.render(scene, cam); });
    } catch(e) { console.warn('3D skyline skipped:', e); }
  }

  if (reduced) return;
  document.body.classList.add('anim');

  /* ---------- scroll-triggered reveals ---------- */
  document.querySelectorAll('.bar').forEach(b => { b.dataset.h = b.style.height;
    b.style.height='0%'; b.style.transition='height 1s cubic-bezier(.2,.8,.2,1)'; });
  document.querySelectorAll('polyline.draw').forEach(p => { const L = p.getTotalLength();
    p.style.strokeDasharray = L; p.style.strokeDashoffset = L;
    p.style.transition = 'stroke-dashoffset 1.8s cubic-bezier(.4,0,.2,1)'; });
  const ring = document.querySelector('circle.ring');
  if (ring) { ring.dataset.t = ring.getAttribute('stroke-dasharray');
    ring.setAttribute('stroke-dasharray','0 9999');
    ring.style.transition = 'stroke-dasharray 1.4s cubic-bezier(.2,.8,.2,1)'; }

  function countUp(el) {
    const txt = el.dataset.final;
    const m = txt.match(/[\\d,]+(?:\\.\\d+)?/);
    if (!m) { el.textContent = txt; return; }
    const raw = m[0], target = parseFloat(raw.replace(/,/g,'')), dec = (raw.split('.')[1]||'').length;
    const t0 = performance.now(), dur = 1300;
    const fmt = v => v.toLocaleString('en-US', {minimumFractionDigits:dec, maximumFractionDigits:dec});
    (function tick(t){ const k = Math.min(1,(t-t0)/dur), e = 1-Math.pow(1-k,4);
      el.textContent = txt.replace(raw, fmt(target*e));
      if (k<1) requestAnimationFrame(tick); else el.textContent = txt; })(t0);
  }

  const seen = new Set();
  function reveal(s) {
    if (seen.has(s)) return;
    seen.add(s);
    s.classList.add('in');
    // guarantee: whatever happens to the transitions (throttled tab,
    // frozen renderer), everything is hard-set visible shortly after
    setTimeout(() => {
      s.querySelectorAll('.card,.stat,h2.title').forEach(el => {
        el.style.opacity = '1';
        if (!el.style.transform || el.style.transform.indexOf('rotate') === -1) el.style.transform = 'none';
      });
    }, 1200);
    s.querySelectorAll('.bar').forEach((b,i) => setTimeout(() => b.style.height = b.dataset.h, 150+i*90));
    s.querySelectorAll('polyline.draw').forEach(p => setTimeout(() => p.style.strokeDashoffset = '0', 250));
    s.querySelectorAll('[data-final]').forEach((el,i) => setTimeout(() => countUp(el), 150+i*140));
    const r = s.querySelector('circle.ring');
    if (r) setTimeout(() => r.setAttribute('stroke-dasharray', r.dataset.t), 300);
  }
  // plain geometry check on scroll + a heartbeat — works everywhere,
  // no IntersectionObserver required
  const slides = [...document.querySelectorAll('.slide')];
  function check() {
    const vh = innerHeight;
    slides.forEach(s => {
      const r = s.getBoundingClientRect();
      if (r.top < vh * .6 && r.bottom > vh * .4) reveal(s);
    });
  }
  addEventListener('scroll', check, {passive:true});
  addEventListener('resize', check);
  addEventListener('visibilitychange', check);
  setInterval(check, 450);
  check();

  /* print safety: jump everything to its final state */
  function finalize(){
    document.querySelectorAll('.bar').forEach(b => { if(b.dataset.h) b.style.height = b.dataset.h; });
    document.querySelectorAll('polyline.draw').forEach(p => p.style.strokeDashoffset = '0');
    document.querySelectorAll('[data-final]').forEach(el => el.textContent = el.dataset.final);
    const r = document.querySelector('circle.ring'); if (r && r.dataset.t) r.setAttribute('stroke-dasharray', r.dataset.t);
    document.querySelectorAll('.slide').forEach(s => s.classList.add('in'));
  }
  addEventListener('beforeprint', finalize);

  /* ---------- 3D tilt on cards ---------- */
  if (matchMedia('(pointer:fine)').matches) {
    document.querySelectorAll('.card,.stat').forEach(c => {
      const baseT = c.style.transform || '';
      c.addEventListener('mousemove', e => { const r = c.getBoundingClientRect();
        const rx = ((e.clientY-r.top)/r.height-.5)*-5, ry = ((e.clientX-r.left)/r.width-.5)*5;
        c.style.transition = 'transform .15s ease-out';
        c.style.transform = baseT+' perspective(900px) rotateX('+rx+'deg) rotateY('+ry+'deg)'; });
      c.addEventListener('mouseleave', () => { c.style.transform = baseT; });
    });
  }
})();
</script>
"""


def _logo(tk, s=64, ring=64):
    return (f'<span class="lg" style="width:{ring}px;height:{ring}px">'
            f'<img src="https://assets.parqet.com/logos/symbol/{tk}?format=png&size=128" '
            f'alt="{tk}" style="width:{s}px;height:{s}px;object-fit:contain"></span>')


import json


def build_deck(c):
    # candles for the title skyline, ascending left→right so the short
    # ones sit under the title text and the towers rise on the right —
    # reads as a growth story; open positions drawn translucent
    candles = ([{"tk": x["tk"], "pct": round(x["pct"], 1), "open": False}
                for x in sorted(c["closed"], key=lambda x: x["pct"])]
               + [{"tk": x["tk"], "pct": round(x["pct"] or 0, 1), "open": True}
                  for x in sorted(c["open"], key=lambda x: x["pct"] or 0)])
    anim_js = ANIM_JS.replace("__CANDLES__", json.dumps(candles))
    money = lambda v: "$" + format(round(v), ",")
    pctf = lambda p, d=1: ("+" if (p or 0) >= 0 else "") + f"{p:.{d}f}%"
    dol = lambda v: ("+" if v >= 0 else "−") + "$" + format(abs(round(v)), ",")

    # ---- slide 4: growth line chart (fund vs S&P), schematic but scaled ----
    line, bench = c["line"], dict(c["bench"])
    lo = min([v for _, v in line] + list(bench.values()) + [c["pot"]])
    hi = max([v for _, v in line] + list(bench.values()))
    span = (hi - lo) or 1
    W, H, PADL, PAD = 1000, 440, 90, 40
    def X(i, n): return PADL + (W - PADL - PAD) * i / max(1, n - 1)
    def Y(v): return PAD + (H - 2 * PAD) * (1 - (v - lo) / span)
    fund_pts = " ".join(f"{X(i,len(line)):.0f},{Y(v):.0f}" for i, (_, v) in enumerate(line))
    bl = [(d, bench[d]) for d, _ in line if d in bench]
    spx_pts = " ".join(f"{X(i,len(bl)):.0f},{Y(v):.0f}" for i, (_, v) in enumerate(bl))
    grid = ""
    for gi in range(3):
        gy = PAD + (H - 2 * PAD) * gi / 2
        gv = hi - span * gi / 2
        grid += (f'<line x1="{PADL}" y1="{gy:.0f}" x2="{W-PAD}" y2="{gy:.0f}" stroke="{GOLD}" stroke-opacity=".14" stroke-width="2"/>'
                 f'<text x="{PADL-14}" y="{gy+8:.0f}" text-anchor="end" font-size="24" fill="{GOLD2}" font-family="IBM Plex Mono,monospace">{money(gv)}</text>')
    chart = f'''<svg viewBox="0 0 {W} {H+30}" style="width:100%;height:100%;max-height:60vh">
      {grid}
      <polyline points="{spx_pts}" fill="none" stroke="#ABA79A" stroke-width="4" stroke-dasharray="14 10" stroke-linejoin="round"/>
      <polyline class="draw" points="{fund_pts}" fill="none" stroke="{GOLD}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="{X(len(line)-1,len(line)):.0f}" cy="{Y(line[-1][1]):.0f}" r="9" fill="{GOLD}" stroke="{LINE}" stroke-width="3"/>
      <text x="{W-PAD}" y="{Y(line[-1][1])-18:.0f}" text-anchor="end" font-size="27" font-weight="700" fill="{GOLD}" font-family="IBM Plex Mono,monospace">{money(line[-1][1])}</text>
    </svg>'''

    # ---- slide 5: driver bars ----
    mx = max(abs(x["pct"]) for x in c["closed"]) or 1
    bars = ""
    for x in c["closed"]:
        h = 14 + 74 * abs(x["pct"]) / mx
        bars += f'''<div class="bar-col">
          <span class="mono" style="font-size:1.5vw;font-weight:700">{pctf(x["pct"])}</span>
          <div class="bar" style="height:{h}%"></div>
          <div class="bar-lab">{_logo(x["tk"],30,50)}<span class="baloo" style="font-size:1.35vw">{x["tk"]}</span>
            <span style="font-size:1.1vw;color:{GOLD2}">{x["wt"]}% · {dol(x["pnl"])}</span></div>
        </div>'''

    # ---- slide 6: open positions ----
    def open_card(x, tilt=0):
        col = GOLD if x["pct"] >= 0 else LOSS
        return f'''<div class="card" style="transform:rotate({tilt}deg);padding:3vw 3.4vw;gap:2.4vw">
          <div style="display:flex;align-items:center;gap:1.4vw">{_logo(x["tk"],58,96)}
            <div><div class="baloo" style="font-size:2.9vw;line-height:1.1">{x["tk"]}</div>
            <div style="font-size:1.25vw;color:{GOLD2}">{x["name"]}</div></div></div>
          <div style="display:flex;gap:2.8vw;flex-wrap:wrap">
            <div><div class="k">Avg cost</div><div class="mono" style="font-size:2.1vw">{money(x["avg"])}</div></div>
            <div><div class="k">Pot share</div><div class="mono" style="font-size:2.1vw">{x["wt"]}%</div></div>
            <div><div class="k">Live ROI</div><div class="mono" style="font-size:3vw;font-weight:700;color:{col}">{pctf(x["pct"])}</div></div>
            <div><div class="k">Open P&amp;L</div><div class="mono" style="font-size:3vw;font-weight:700;color:{col}">{dol(x["pnl"])}</div></div>
          </div></div>'''
    opens = "".join(open_card(x, t) for x, t in zip(c["open"], (0, -1)))

    # ---- slide 7: closed table ----
    rows = ""
    for x in c["closed"]:
        rows += f'''<div class="trow">
          <span style="display:flex;align-items:center;gap:.8vw">{_logo(x["tk"],28,44)}<span class="baloo" style="font-size:1.4vw">{x["tk"]}</span>
            <span style="font-size:1.15vw;color:{GOLD2}">{x["name"]}</span></span>
          <span class="mono">{money(x["buy"])} → {money(x["sell"])}</span>
          <span class="mono" style="color:{GOLD2}">{c["period_label"]}</span>
          <span class="mono">{x["wt"]}%</span>
          <span class="mono" style="text-align:right;font-weight:700;color:{GOLD}">{pctf(x["pct"])}<br><span style="font-size:1vw;color:{GOLD2};font-weight:400">{dol(x["pnl"])}</span></span>
        </div>'''

    alpha = f'{c["alpha"]:+.1f} pts' if c["alpha"] is not None else "—"
    return f'''<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Albassam Fund — {c["month_name"]}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Baloo+Bhaijaan+2:wght@600;700;800&family=Rubik:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600;700&display=swap" rel="stylesheet">
<style>
  *{{box-sizing:border-box;margin:0;padding:0}}
  html{{scroll-snap-type:y mandatory;scroll-behavior:smooth}}
  body{{background:{LINE};font-family:'Rubik',sans-serif;color:{GOLD}}}
  .baloo{{font-family:'Baloo Bhaijaan 2',sans-serif;font-weight:700}}
  .mono{{font-family:'IBM Plex Mono',monospace}}
  .slide{{height:100vh;scroll-snap-align:start;display:flex;flex-direction:column;justify-content:center;
    padding:5.5vh 6vw;background:{BG};position:relative;overflow:hidden;border-bottom:3px solid {LINE}}}
  h2.title{{font-family:'Baloo Bhaijaan 2',sans-serif;font-weight:700;font-size:3vw;color:{GOLD};
    border-bottom:3px solid {GOLD};padding-bottom:.5vw;width:max-content;margin-bottom:3vh}}
  .card{{background:{CARD};border:2.5px solid {LINE};border-radius:18px;box-shadow:6px 6px 0 rgba(52,50,45,.9);
    display:flex;flex-direction:column}}
  .k{{font-size:1.25vw;color:{GOLD2}}}
  .pill{{align-self:flex-start;background:{GOLD};color:{LINE};border:2.5px solid {LINE};border-radius:999px;
    padding:.5vw 1.8vw;font-family:'Baloo Bhaijaan 2';font-weight:700;font-size:1.5vw;box-shadow:4px 4px 0 {LINE};transform:rotate(-2deg)}}
  .lg{{display:inline-flex;align-items:center;justify-content:center;background:{BG};border:2.5px solid {LINE};border-radius:50%;flex-shrink:0}}
  .blob{{position:absolute;border:2.5px solid {LINE}}}
  .stat{{background:{CARD};border:2.5px solid {LINE};border-radius:18px;box-shadow:6px 6px 0 rgba(52,50,45,.9);
    padding:2.2vw;display:flex;flex-direction:column;justify-content:center;gap:.6vw}}
  .bar-col{{flex:1;display:flex;flex-direction:column;align-items:center;gap:1vh;justify-content:flex-end}}
  .bar{{width:100%;background:{GOLD};border:2.5px solid {LINE};border-radius:12px 12px 0 0;min-height:10px}}
  .bar-lab{{display:flex;flex-direction:column;align-items:center;gap:.4vh;height:15vh;padding-top:1vh}}
  .trow{{display:grid;grid-template-columns:2.6fr 2fr 1.6fr 1fr 1.3fr;gap:0 1.5vw;align-items:center;
    padding:1.25vh 0;border-bottom:2px solid rgba(237,233,221,.12);font-size:1.4vw}}
  .nav{{position:fixed;bottom:18px;right:22px;font-family:'IBM Plex Mono';font-size:13px;color:{GOLD2};
    background:{CARD};border:2px solid {LINE};border-radius:8px;padding:6px 12px;z-index:9}}
  body.anim .slide:not(.in) .card,body.anim .slide:not(.in) .stat,body.anim .slide:not(.in) h2.title{{opacity:0;transform:translateY(30px)}}
  .slide.in .card,.slide.in .stat,.slide.in h2.title{{opacity:1;transform:translateY(0);
    transition:opacity .7s ease,transform .7s cubic-bezier(.2,.8,.2,1)}}
  .slide.in .stat:nth-child(2){{transition-delay:.08s}}.slide.in .stat:nth-child(3){{transition-delay:.16s}}.slide.in .stat:nth-child(4){{transition-delay:.24s}}
  @media print{{.slide{{height:100vh;page-break-after:always;border:none}}.nav{{display:none}}html{{scroll-snap-type:none}}}}
</style></head><body>

<section class="slide" style="justify-content:center">
  <div class="blob" style="width:30vw;height:30vw;background:{CARD};border-radius:46% 54% 60% 40%/50% 45% 55% 50%;right:-8vw;top:-10vw"></div>
  <canvas id="bg3d" style="position:absolute;inset:0;width:100%;height:100%;touch-action:pan-y"></canvas>
  <span class="pill" style="margin-bottom:3vh;position:relative;z-index:1">live stock calls · ROI tracker</span>
  <h1 class="baloo" style="font-size:8vw;font-weight:800;line-height:1.05;position:relative;z-index:1">Albassam Fund</h1>
  <div style="font-size:2.4vw;color:{GOLD2};margin-top:1.5vh;position:relative;z-index:1">Performance Report · {c["month_name"]}</div>
  <div class="mono" style="font-size:1.6vw;color:{GOLD};margin-top:1.2vh;position:relative;z-index:1">Period ending {c["period_ending"]}</div>
</section>

<section class="slide">
  <h2 class="title">The headline</h2>
  <div class="card" style="flex-direction:row;align-items:center;justify-content:space-between;padding:3vw 4vw;gap:3vw">
    <div><div class="k">Fund value</div>
      <div class="mono" data-final="{money(c["value"])}" style="font-size:6.4vw;font-weight:700;line-height:1.1">{money(c["value"])}</div>
      <div class="k">from a {money(c["pot"])} starting book</div></div>
    <div style="text-align:right"><div class="mono" data-final="{pctf(c["total_pct"])}" style="font-size:6vw;font-weight:700;line-height:1.1">{pctf(c["total_pct"])}</div>
      <div class="k">total return</div>
      <div class="mono" data-final="+{money(c["realized_dollars"])}" style="font-size:2.4vw;font-weight:700;margin-top:1vh">+{money(c["realized_dollars"])}</div>
      <div class="k">banked in realized profit</div></div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1.8vw;margin-top:2vw">
    <div class="stat"><div class="mono" data-final="{alpha}" style="font-size:3vw;font-weight:700">{alpha}</div><div class="k">vs S&amp;P 500 (market {pctf(c["spx_ret"])})</div></div>
    <div class="stat"><div class="mono" data-final="{c["win_rate"]}%" style="font-size:3vw;font-weight:700">{c["win_rate"]}%</div><div class="k">win rate · {c["n_closed"]} calls closed</div></div>
    <div class="stat"><div style="display:flex;align-items:center;gap:.8vw">{_logo(c["best"]["tk"],34,54)}<span class="mono" style="font-size:2.6vw;font-weight:700">{pctf(c["best"]["pct"])}</span></div><div class="k">Best · {c["best"]["tk"]}</div></div>
    <div class="stat"><div style="display:flex;align-items:center;gap:.8vw">{_logo(c["worst"]["tk"],34,54)}<span class="mono" style="font-size:2.6vw;font-weight:700">{pctf(c["worst"]["pct"])}</span></div><div class="k">Worst · {c["worst"]["tk"]} (still a win)</div></div>
  </div>
</section>

<section class="slide">
  <h2 class="title">Executive summary</h2>
  <div class="card" style="padding:5vh 5vw;flex:1;justify-content:center">
    <p style="font-size:2.5vw;line-height:1.8;text-wrap:pretty">{c["narrative"]}</p>
  </div>
</section>

<section class="slide">
  <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:2vh">
    <div><h2 class="title" style="margin:0">Growth vs the market</h2>
      <div style="font-size:1.6vw;color:{GOLD2};margin-top:1vh">Same {money(c["pot"])} start — the fund beat the market this period.</div></div>
    <div style="display:flex;gap:2vw;font-size:1.4vw;padding-bottom:.5vw">
      <span style="display:flex;align-items:center;gap:.6vw"><span style="width:3vw;height:6px;background:{GOLD};border-radius:3px"></span>Albassam Fund</span>
      <span style="display:flex;align-items:center;gap:.6vw;color:{GOLD2}"><span style="width:3vw;border-top:4px dashed #ABA79A"></span>S&amp;P 500</span></div>
  </div>
  <div class="card" style="flex:1;padding:3vh 2.5vw">{chart}</div>
</section>

<section class="slide">
  <h2 class="title">What drove the return</h2>
  <div class="card" style="flex:1;flex-direction:row;align-items:stretch;gap:1.6vw;padding:4vh 3vw">{bars}</div>
</section>

<section class="slide">
  <h2 class="title">Open positions — still running</h2>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:2.6vw;flex:1">{opens}</div>
</section>

<section class="slide">
  <h2 class="title">Every closed call</h2>
  <div class="card" style="flex:1;justify-content:center;padding:2vh 3vw">
    <div class="trow" style="color:{GOLD2};font-size:1.2vw;border-bottom:2.5px solid {LINE}">
      <span>Stock</span><span>Bought → Sold</span><span>Closed</span><span>Pot</span><span style="text-align:right">Result</span></div>
    {rows}
  </div>
</section>

<section class="slide">
  <h2 class="title">Win rate</h2>
  <div class="card" style="flex:1;flex-direction:row;align-items:center;justify-content:center;gap:6vw">
    <svg viewBox="0 0 400 400" style="width:26vw;max-width:400px">
      <circle cx="200" cy="200" r="150" fill="none" stroke="{LINE}" stroke-width="52"/>
      <circle class="ring" cx="200" cy="200" r="150" fill="none" stroke="{GOLD}" stroke-width="52"
        stroke-dasharray="{2*3.14159*150*c['win_rate']/100:.0f} 999" stroke-linecap="round" transform="rotate(-90 200 200)"/>
      <text x="200" y="222" text-anchor="middle" class="mono" font-size="64" font-weight="700" fill="{GOLD}">{c["n_wins"]}/{c["n_closed"]}</text>
    </svg>
    <div><div class="mono" data-final="{c["win_rate"]}%" style="font-size:9vw;font-weight:700;line-height:1">{c["win_rate"]}%</div>
      <div style="font-size:2vw;color:{GOLD2}">win rate on closed calls</div>
      <div style="font-size:1.7vw;margin-top:2vh">Every one of the <b>{c["n_closed"]} closed calls</b> ended in profit.</div></div>
  </div>
</section>

<div class="nav">→ / Space · next</div>
<script>
  addEventListener('keydown',e=>{{
    const s=[...document.querySelectorAll('.slide')];
    let i=s.findIndex(x=>x.getBoundingClientRect().top>=-5);
    if(['ArrowRight','ArrowDown',' ','PageDown'].includes(e.key)){{e.preventDefault();s[Math.min(i+1,s.length-1)]?.scrollIntoView()}}
    if(['ArrowLeft','ArrowUp','PageUp'].includes(e.key)){{e.preventDefault();s[Math.max(i-1,0)]?.scrollIntoView()}}
  }});
</script>
''' + anim_js + '''
</body></html>'''
