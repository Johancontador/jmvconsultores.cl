/* ══════════════════════════════════════════
   JMV CONSULTORES — Efecto 3D de fondo
   Motor propio en canvas: poliedros wireframe
   + partículas plexus + parallax de mouse.
   Sin librerías externas.
   ══════════════════════════════════════════ */
(() => {
  const canvas = document.getElementById("bg3d");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isMobile = window.matchMedia("(max-width: 640px)").matches;

  let W = 0, H = 0;
  function resize() {
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (reduced) drawStatic();
  }
  resize();
  window.addEventListener("resize", resize);

  /* ── Colores de la marca (logo JMV: celestes y azul marino) ── */
  const COLORS = ["143, 199, 238", "46, 134, 200", "70, 105, 180"];

  /* ── Utilidades 3D ── */
  function rotXY(p, a) { const c = Math.cos(a), s = Math.sin(a); return { x: p.x * c - p.y * s, y: p.x * s + p.y * c, z: p.z }; }
  function rotYZ(p, a) { const c = Math.cos(a), s = Math.sin(a); return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c }; }

  /* Proyección en perspectiva */
  function project(p, cx, cy, dist) {
    const z = Math.max(p.z + dist, 0.1);
    const f = dist / z;
    return { x: cx + p.x * f * 100, y: cy + p.y * f * 100, f };
  }

  function norm(x, y, z, r) {
    const l = Math.hypot(x, y, z) || 1;
    return { x: (x / l) * r, y: (y / l) * r, z: (z / l) * r };
  }

  /* ── Poliedros ── */
  function icosahedron(r) {
    const t = (1 + Math.sqrt(5)) / 2;
    const v = [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ].map(([x, y, z]) => norm(x, y, z, r));
    const e = [
      [0,1],[0,5],[0,7],[0,10],[0,11],[1,5],[1,7],[1,8],[1,9],[2,3],
      [2,4],[2,6],[2,10],[2,11],[3,4],[3,6],[3,8],[3,9],[4,5],[4,9],
      [4,11],[5,9],[5,11],[6,7],[6,8],[6,10],[7,8],[7,10],[8,9],[10,11],
    ];
    return { v, e };
  }
  function octahedron(r) {
    const v = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].map(([x,y,z]) => norm(x,y,z,r));
    const e = [[0,2],[0,3],[0,4],[0,5],[1,2],[1,3],[1,4],[1,5],[2,4],[2,5],[3,4],[3,5]];
    return { v, e };
  }

  /* ── Objetos 3D flotantes ── */
  const minWH = () => Math.min(W, H);
  const figs = isMobile
    ? [
        { geo: icosahedron(0.22), rel: true, cx: 0.50, cy: 0.30, rx: 0.0021, ry: 0.0029, c: 0, depth: 2.6, alpha: 0.5 },
        { geo: octahedron(0.14),  rel: true, cx: 0.20, cy: 0.68, rx: -0.0016, ry: 0.0024, c: 1, depth: 2.2, alpha: 0.35 },
      ]
    : [
        { geo: icosahedron(230), cx: 0.82, cy: 0.28, rx: 0.0016, ry: 0.0022, c: 1, depth: 2.8, alpha: 0.55 },
        { geo: octahedron(150),  cx: 0.12, cy: 0.62, rx: -0.0013, ry: 0.0020, c: 0, depth: 2.3, alpha: 0.40 },
        { geo: icosahedron(90),  cx: 0.30, cy: 0.15, rx: 0.0020, ry: -0.0026, c: 2, depth: 2.0, alpha: 0.30 },
      ];

  function figRadius(g) {
    return g.rel ? g.geo.v[0].x : g.geo.v[0].x; // vértices ya normalizados al radio
  }

  /* ── Partículas plexus ── */
  const N = isMobile ? 36 : 70;
  let parts = [];
  function initParts() {
    parts = Array.from({ length: N }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25,
      z: 0.4 + Math.random() * 0.6,
    }));
  }
  initParts();

  /* ── Parallax del mouse ── */
  let mx = 0, my = 0, tmx = 0, tmy = 0;
  window.addEventListener("pointermove", (e) => {
    tmx = (e.clientX / W - 0.5) * 2;
    tmy = (e.clientY / H - 0.5) * 2;
  });

  let t = 0;

  function drawScene() {
    /* partículas */
    const LINK = isMobile ? 110 : 150;
    for (const p of parts) {
      if (!reduced) {
        p.x += p.vx * p.z; p.y += p.vy * p.z;
        if (p.x < -20) p.x = W + 20; if (p.x > W + 20) p.x = -20;
        if (p.y < -20) p.y = H + 20; if (p.y > H + 20) p.y = -20;
      }
    }
    ctx.lineWidth = 1;
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const a = parts[i], b = parts[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < LINK) {
          const o = (1 - d / LINK) * 0.14 * a.z;
          ctx.strokeStyle = `rgba(46, 134, 200, ${o})`;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }
    for (const p of parts) {
      ctx.fillStyle = `rgba(143, 199, 238, ${0.16 + p.z * 0.22})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.1 + p.z * 1.6, 0, Math.PI * 2); ctx.fill();
    }

    /* poliedros */
    const px = mx * 18, py = my * 14;
    for (const g of figs) {
      const R = g.rel ? minWH() * 0.5 : 1;
      const cx = W * g.cx + px * (g.depth / 2.8);
      const cy = H * g.cy + py * (g.depth / 2.8) + (reduced ? 0 : Math.sin(t * 0.008 + g.cx * 7) * 10);
      const angX = reduced ? 0.7 : t * g.rx;
      const angY = reduced ? 0.9 : t * g.ry;
      const verts = g.geo.v.map((v) => {
        let p = v;
        if (g.rel) p = { x: p.x * R * 2, y: p.y * R * 2, z: p.z * R * 2 };
        return rotYZ(rotXY(p, angX), angY);
      });
      const pts = verts.map((v) => project(v, cx, cy, g.depth));

      ctx.lineWidth = 1.2;
      for (const [a, b] of g.geo.e) {
        const p1 = pts[a], p2 = pts[b];
        const depthFade = Math.max(0.05, Math.min(1, ((p1.f + p2.f) / 2 - 0.28) / 0.44));
        const alpha = depthFade * g.alpha;
        const grad = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
        grad.addColorStop(0, `rgba(${COLORS[g.c]}, ${alpha})`);
        grad.addColorStop(1, `rgba(${COLORS[(g.c + 1) % 3]}, ${alpha * 0.55})`);
        ctx.strokeStyle = grad;
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
      }
      for (const p of pts) {
        if (p.f < 0.35) continue;
        ctx.fillStyle = `rgba(${COLORS[g.c]}, ${g.alpha * 0.8})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.2 * p.f, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function drawStatic() {
    ctx.clearRect(0, 0, W, H);
    drawScene();
  }

  function frame() {
    t += 1;
    mx += (tmx - mx) * 0.04;
    my += (tmy - my) * 0.04;
    ctx.clearRect(0, 0, W, H);
    drawScene();
    requestAnimationFrame(frame);
  }

  /* Regla 3 (velocidad/batería): pausar el render si la pestaña no es visible */
  let rafId = null;
  function startLoop() {
    if (rafId === null && !reduced) rafId = requestAnimationFrame(frame);
  }
  function stopLoop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopLoop();
    } else {
      startLoop();
    }
  });

  startLoop();
})();
