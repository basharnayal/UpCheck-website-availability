'use strict';
/*
 * «من الظل إلى النور» — مشهد الافتتاح (10 ثوانٍ)
 *
 * كل إطار يُرسم بدالة نقية من الزمن t، لذلك يمكن تصييره إطارًا إطارًا
 * (render.cjs) أو تشغيله مباشرة في المتصفح للمعاينة.
 *
 *  اللقطة A  00:00–04:40  ممر الجامعة — تتبّع جانبي للبطل بين الطلاب، ضوء النوافذ وظلالها
 *  اللقطة B  04:40–07:40  دفتر المشروع — قلب الصفحة، الرسومات تتحرك، المصباح يتوهّج
 *  اللقطة C  07:40–10:00  العنوان — «من الظل إلى النور» يخرج من العتمة إلى الضوء
 */
(function () {
  const W = 1920, H = 1080, FPS = 24, DURATION = 10, FRAMES = FPS * DURATION;
  const BAR = 138;                 // أشرطة سينمائية 2.39:1 داخل إطار 16:9
  const T1 = 4.40, T2 = 7.40;      // نقاط القطع بين اللقطات
  const qs = new URLSearchParams(location.search);
  const RENDER = qs.has('render');
  const TAU = Math.PI * 2;

  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  if (RENDER) document.body.classList.add('render');

  // ---------------------------------------------------------------- helpers
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const eio = (t) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  const eout = (t) => { t = clamp(t); return 1 - Math.pow(1 - t, 3); };
  const wrap = (x) => x - Math.floor(x);
  const bump = (p, c, w) => { const d = wrap(p - c + 0.5) - 0.5; return Math.exp(-d * d / (2 * w * w)); };
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function capsule(c, x1, y1, x2, y2, r1, r2) {
    const a = Math.atan2(y2 - y1, x2 - x1);
    c.beginPath();
    c.arc(x1, y1, r1, a + Math.PI / 2, a - Math.PI / 2);
    c.arc(x2, y2, r2, a - Math.PI / 2, a + Math.PI / 2);
    c.closePath();
    c.fill();
  }
  function smoothClosed(c, pts) {
    const n = pts.length;
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      c.bezierCurveTo(
        p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
        p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
        p2[0], p2[1]);
    }
    c.closePath();
  }
  function ensure(c, w, h) {
    if (c.width < w || c.height < h) { c.width = Math.max(c.width, w); c.height = Math.max(c.height, h); }
  }
  function softDot(color) {
    const c = mk(32, 32), g = c.getContext('2d');
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, color); gr.addColorStop(0.35, color.replace(/[\d.]+\)$/, '0.45)')); gr.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    return c;
  }
  const DOT = softDot('rgba(255,248,236,1)');
  const DOT_WARM = softDot('rgba(255,214,150,1)');

  // ================================================================ GAIT
  // نموذج مشي بسيط بوحدات «طول الجسم». القدم الثابتة لا تنزلق على الأرض.
  const G = { A: 0.40, L1: 0.25, L2: 0.255, FOOT: 0.035 };
  function legA(th, flex, fa) {
    const sh = th - flex;
    const kx = G.L1 * Math.sin(th), ky = G.L1 * Math.cos(th);
    return { kx, ky, ax: kx + G.L2 * Math.sin(sh), ay: ky + G.L2 * Math.cos(sh), fa };
  }
  function leg(p, A = G.A) {
    const th = A * Math.sin(TAU * p);
    const flex = 0.08 + 1.0 * bump(p, 0.95, 0.13) + 0.16 * bump(p, 0.36, 0.07);
    const fa = 0.55 * bump(p, 0.70, 0.07) - 0.28 * bump(p, 0.22, 0.06) + 0.2 * bump(p, 0.92, 0.09);
    return legA(th, flex, fa);
  }
  const stepLen = (A) => leg(0.25, A).ax - leg(0.75, A).ax;
  function bodyX(P, A) {
    const q = P - 0.25, s = Math.floor(q / 0.5), u = q - s * 0.5;
    return s * stepLen(A) + (leg(0.25, A).ax - leg(0.25 + u, A).ax);
  }
  function walkPose(P, A) {
    const l1 = leg(P, A), l2 = leg(P + 0.5, A);
    const sw = Math.sin(TAU * P);
    return {
      hipY: -(Math.max(l1.ay, l2.ay) + G.FOOT), lean: 0.045, legs: [l1, l2],
      arms: [{ a: -0.30 * sw, f: 0.22 + 0.25 * Math.max(0, -sw) }, { a: 0.30 * sw, f: 0.22 + 0.25 * Math.max(0, sw) }],
      nod: 0.005 * Math.sin(TAU * P * 2), P,
    };
  }
  function idlePose(t, seed, gesture) {
    const ph = seed * 7.31;
    const sway = 0.012 * Math.sin(t * 0.9 + ph);
    const l1 = legA(0.05 + sway, 0.04, 0), l2 = legA(-0.045 + sway, 0.05, 0);
    const arms = gesture
      ? [{ a: 0.30 + 0.12 * Math.sin(t * 2.1 + ph), f: 1.25 + 0.35 * Math.sin(t * 3.3 + ph) }, { a: 0.03, f: 0.18 }]
      : [{ a: 0.05, f: 0.25 + 0.05 * Math.sin(t * 1.3) }, { a: -0.02, f: 0.2 }];
    return { hipY: -(Math.max(l1.ay, l2.ay) + G.FOOT), lean: 0.02 + 0.01 * Math.sin(t * 1.7 + ph), legs: [l1, l2], arms, nod: 0.01 * Math.sin(t * 2.4 + ph), P: t * 0.3 };
  }

  // الشكل المحلي: الوجه نحو +x، الأرض y=0، الأعلى سالب. وحدة = طول الشخص.
  function foot(c, ax, ay, fa) {
    c.save(); c.translate(ax, ay); c.rotate(fa);
    c.beginPath();
    c.moveTo(-0.032, -0.014);
    c.quadraticCurveTo(0.03, -0.032, 0.112, 0.008);
    c.quadraticCurveTo(0.124, 0.022, 0.112, 0.032);
    c.lineTo(-0.034, 0.032);
    c.closePath(); c.fill();
    c.restore();
  }
  function drawFigure(c, pose, o) {
    const hy = pose.hipY, ln = pose.lean;
    const S = [Math.sin(ln) * 0.285, hy - Math.cos(ln) * 0.285];
    const N = [Math.sin(ln) * 0.312, hy - Math.cos(ln) * 0.312];
    const Hc = [N[0] + 0.02 + Math.sin(ln) * 0.06, N[1] - 0.072 + pose.nod];
    const [l1, l2] = pose.legs;
    const casual = o.type === 'casual';

    // الساقان: ظاهرتان للبنطال فقط، أما الثوب فيُظهر القدمين من تحت الحاشية
    const hemLim = [-0.12, 0.13];
    for (const l of [l1, l2]) {
      if (casual) {
        capsule(c, 0, hy, l.kx, hy + l.ky, 0.046, 0.037);
        capsule(c, l.kx, hy + l.ky, l.ax, hy + l.ay, 0.036, 0.027);
        foot(c, l.ax, hy + l.ay, l.fa);
      } else {
        const ax = clamp(l.ax, hemLim[0], hemLim[1]), ay = Math.max(hy + l.ay, -0.075);
        foot(c, ax, ay, l.fa * 0.6);
      }
    }
    // الذراعان
    pose.arms.forEach((arm, i) => {
      let a = arm.a, f = arm.f;
      const hold = o.books && i === 0;
      if (hold) { a = 0.12 + 0.03 * Math.sin(TAU * pose.P); f = 1.75; }
      const E = [S[0] + 0.165 * Math.sin(a), S[1] + 0.165 * Math.cos(a)];
      const fl = hold ? 0.11 : 0.15;
      const Hd = [E[0] + fl * Math.sin(a + f), E[1] + fl * Math.cos(a + f)];
      capsule(c, S[0], S[1] + 0.01, E[0], E[1], 0.034, 0.026);
      capsule(c, E[0], E[1], Hd[0], Hd[1], 0.025, 0.02);
      if (!hold) { c.beginPath(); c.arc(Hd[0], Hd[1] + 0.008, 0.023, 0, TAU); c.fill(); }
    });
    // الجذع / الثوب
    if (casual) {
      smoothClosed(c, [
        [S[0] - 0.01, S[1] - 0.012], [S[0] + 0.055, S[1] + 0.012], [S[0] + 0.078, S[1] + 0.09],
        [0.07, hy - 0.07], [0.066, hy + 0.03], [-0.004, hy + 0.06], [-0.078, hy + 0.035],
        [-0.072, hy - 0.10], [S[0] - 0.074, S[1] + 0.07], [S[0] - 0.05, S[1] + 0.005],
      ]);
      c.fill();
    } else {
      const k1 = [l1.kx, hy + l1.ky], k2 = [l2.kx, hy + l2.ky];
      const a1 = [l1.ax, hy + l1.ay], a2 = [l2.ax, hy + l2.ay];
      const fk = k1[0] > k2[0] ? k1 : k2, bk = k1[0] > k2[0] ? k2 : k1;
      const fa = a1[0] > a2[0] ? a1 : a2, ba = a1[0] > a2[0] ? a2 : a1;
      const hemF = clamp(fa[0] + 0.03, 0.07, 0.15), hemB = clamp(ba[0] - 0.03, -0.15, -0.075);
      smoothClosed(c, [
        [S[0] - 0.01, S[1] - 0.016], [S[0] + 0.06, S[1] + 0.01], [S[0] + 0.086, S[1] + 0.09],
        [0.078, hy - 0.08], [0.074, hy + 0.04], [clamp(fk[0] + 0.045, 0.075, 0.13), fk[1]],
        [hemF, -0.048], [(hemF + hemB) / 2, -0.038], [hemB, -0.05],
        [clamp(bk[0] - 0.04, -0.13, -0.08), bk[1]], [-0.084, hy + 0.03], [-0.072, hy - 0.12],
        [S[0] - 0.076, S[1] + 0.07], [S[0] - 0.05, S[1] + 0.004],
      ]);
      c.fill();
    }
    // الحقيبة والكتب
    if (o.backpack) {
      c.beginPath(); c.roundRect(S[0] - 0.175, S[1] + 0.015, 0.11, 0.235, 0.03); c.fill();
      capsule(c, S[0] - 0.085, S[1] + 0.02, S[0] + 0.045, S[1] + 0.03, 0.013, 0.013);
    }
    if (o.books) {
      c.save(); c.translate(S[0] + 0.1, S[1] + 0.135); c.rotate(-0.1);
      c.beginPath(); c.roundRect(-0.032, -0.105, 0.064, 0.205, 0.008); c.fill();
      c.restore();
    }
    // الرقبة والرأس
    capsule(c, N[0], N[1] + 0.02, Hc[0] - 0.004, Hc[1] + 0.035, 0.033, 0.03);
    c.beginPath(); c.ellipse(Hc[0], Hc[1], 0.054, 0.064, 0, 0, TAU); c.fill();
    c.beginPath(); c.ellipse(Hc[0] + 0.024, Hc[1] + 0.042, 0.034, 0.029, 0.2, 0, TAU); c.fill();
    c.beginPath();
    c.moveTo(Hc[0] + 0.05, Hc[1] - 0.012); c.lineTo(Hc[0] + 0.073, Hc[1] + 0.017); c.lineTo(Hc[0] + 0.05, Hc[1] + 0.03);
    c.closePath(); c.fill();
    if (o.type === 'ghutra') {
      const sway = 0.012 * Math.sin(TAU * pose.P * 2 + 1);
      smoothClosed(c, [
        [Hc[0] - 0.006, Hc[1] - 0.09], [Hc[0] + 0.05, Hc[1] - 0.077], [Hc[0] + 0.064, Hc[1] - 0.046],
        [Hc[0] + 0.022, Hc[1] - 0.008], [Hc[0] + 0.028, Hc[1] + 0.07], [S[0] + 0.078, S[1] + 0.06],
        [S[0] + 0.02, S[1] + 0.035], [S[0] - 0.07 + sway, S[1] + 0.15], [S[0] - 0.095 + sway, S[1] + 0.05],
        [Hc[0] - 0.082, Hc[1] + 0.02], [Hc[0] - 0.066, Hc[1] - 0.062],
      ]);
      c.fill();
      c.beginPath(); c.ellipse(Hc[0] - 0.004, Hc[1] - 0.07, 0.063, 0.02, -0.08, 0, TAU); c.fill();
    } else {
      const hx = Hc[0], hyy = Hc[1];
      smoothClosed(c, [
        [hx - 0.06, hyy + 0.03], [hx - 0.068, hyy - 0.02], [hx - 0.052, hyy - 0.066], [hx - 0.012, hyy - 0.084],
        [hx + 0.028, hyy - 0.079], [hx + 0.05, hyy - 0.066], [hx + 0.057, hyy - 0.044], [hx + 0.036, hyy - 0.048],
        [hx - 0.01, hyy - 0.03], [hx - 0.036, hyy + 0.02],
      ]);
      c.fill();
      c.beginPath(); c.ellipse(hx - 0.012, hyy + 0.004, 0.013, 0.02, 0, 0, TAU); c.fill();
    }
  }

  // ================================================================ SHOT A — الممر
  const CAM = { F: 1188, HOR: 388, H: 1.5, V: 1.3, ZW: 12, ZF: 4 };
  const camX = (t) => -CAM.V * t;
  const sy = (Y, z) => CAM.HOR + CAM.F * (CAM.H - Y) / z;
  const sxw = (X, z, t) => W / 2 + CAM.F * (X - camX(t)) / z;
  const XW0 = -21, XW1 = 12, PPMW = CAM.F / CAM.ZW;
  const WALL_W = Math.ceil((XW1 - XW0) * PPMW), WALL_BASE = sy(0, CAM.ZW);
  const WINDOWS = []; for (let k = -7; k <= 4; k++) WINDOWS.push(3 * k);
  const WIN = { hw: 0.7, y0: 0.45, ys: 2.75, ya: 3.5 };
  const SLANT = 0.5, PZ1 = 11.7, PZ2 = 9.0;

  const PEOPLE = [
    { z: 11.0, X0: -13.0, dir: 1, v: 1.0, h: 1.75, type: 'thobe', P0: 0.5 },
    { z: 10.6, X0: -3.45, dir: -1, idle: true, h: 1.80, type: 'casual', seed: 2 },
    { z: 10.5, X0: -4.15, dir: 1, idle: true, h: 1.72, type: 'ghutra', gesture: true, seed: 1 },
    { z: 9.5, X0: -6.0, dir: -1, v: 1.1, h: 1.78, type: 'thobe', P0: 0.62 },
    { z: 9.0, X0: -1.2, dir: 1, v: 1.1, h: 1.71, type: 'casual', P0: 0.9 },
    { z: 8.4, X0: -9.5, dir: 1, v: 1.3, h: 1.77, type: 'ghutra', P0: 0.2 },
    { z: 7.8, X0: 5.5, dir: -1, v: 1.15, h: 1.79, type: 'ghutra', P0: 0.05 },
    { z: 7.2, X0: -3.5, dir: 1, v: 1.2, h: 1.74, type: 'ghutra', P0: 0.37 },
    { z: 6.0, X0: 2.6, dir: -1, v: 1.45, h: 1.73, type: 'casual', P0: 0.81 },
    { z: 4.0, X0: 0.62, dir: -1, v: 1.33, h: 1.76, type: 'hair', backpack: true, books: true, P0: 0.1, hero: true },
    { z: 2.3, X0: -5.0, dir: 1, v: 1.3, h: 1.78, type: 'ghutra', P0: 0.44 },
  ];
  const gaitA = (p) => (p.type === 'casual' ? 0.40 : 0.31);
  const cadence = (p) => p.v / (2 * stepLen(gaitA(p)) * p.h);
  function personState(p, t) {
    if (p.idle) return { X: p.X0, pose: idlePose(t, p.seed, p.gesture) };
    const A = gaitA(p), P = p.P0 + cadence(p) * t;
    return { X: p.X0 + p.dir * p.h * (bodyX(P, A) - bodyX(p.P0, A)), pose: walkPose(P, A) };
  }
  const dofBlur = (z) => (z >= CAM.ZF ? 45 : 70) * Math.abs(1 / z - 1 / CAM.ZF);

  let wallC, wallReflC;
  function archPath(g, cx, hw, yb, ys, ya) {
    g.beginPath();
    g.moveTo(cx - hw, yb); g.lineTo(cx - hw, ys);
    g.bezierCurveTo(cx - hw, ys - (ys - ya) * 0.58, cx - hw * 0.32, ya + (ys - ya) * 0.1, cx, ya);
    g.bezierCurveTo(cx + hw * 0.32, ya + (ys - ya) * 0.1, cx + hw, ys - (ys - ya) * 0.58, cx + hw, ys);
    g.lineTo(cx + hw, yb); g.closePath();
  }
  function palm(g, x, yb, hgt, lean, r) {
    g.save();
    g.lineCap = 'round';
    const tx = x + lean, ty = yb - hgt;
    g.lineWidth = hgt * 0.035;
    g.beginPath(); g.moveTo(x, yb); g.quadraticCurveTo(x + lean * 0.2, yb - hgt * 0.5, tx, ty); g.stroke();
    for (let i = 0; i < 11; i++) {
      const a = -Math.PI / 2 + (i / 10 - 0.5) * 3.4 + (r() - 0.5) * 0.2;
      const L = hgt * (0.42 + r() * 0.12);
      const ex = tx + Math.cos(a) * L, ey = ty + Math.sin(a) * L * 0.55 + L * 0.35;
      g.lineWidth = hgt * 0.022;
      g.beginPath(); g.moveTo(tx, ty);
      g.quadraticCurveTo(tx + Math.cos(a) * L * 0.6, ty + Math.sin(a) * L * 0.6 - L * 0.1, ex, ey);
      g.stroke();
    }
    g.restore();
  }
  function buildWall() {
    const r = rng(11);
    const c = mk(WALL_W, H), g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 0, WALL_BASE);
    bg.addColorStop(0, '#0f1318'); bg.addColorStop(0.5, '#181d23'); bg.addColorStop(1, '#20262c');
    g.fillStyle = bg; g.fillRect(0, 0, WALL_W, WALL_BASE + 2);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.02 + r() * 0.03})`;
      g.fillRect(r() * WALL_W, r() * WALL_BASE, 1 + r() * 2, 1 + r() * 2);
    }
    // إفريز علوي بنقوش مثلثات نجدية
    const fy0 = sy(3.98, CAM.ZW), fy1 = sy(3.80, CAM.ZW);
    g.fillStyle = '#262d35'; g.fillRect(0, fy0, WALL_W, fy1 - fy0);
    g.fillStyle = 'rgba(190,205,220,0.10)';
    for (let x = 0; x < WALL_W; x += 16) {
      g.beginPath(); g.moveTo(x, fy1 - 2); g.lineTo(x + 8, fy0 + 3); g.lineTo(x + 16, fy1 - 2); g.closePath(); g.fill();
    }
    g.fillStyle = '#111519'; g.fillRect(0, fy1, WALL_W, 3);
    // أعمدة جدارية بين النوافذ
    for (const Xk of WINDOWS) {
      const px = (Xk + 1.5 - XW0) * PPMW, pw = 0.46 * PPMW;
      const pg = g.createLinearGradient(px - pw / 2, 0, px + pw / 2, 0);
      pg.addColorStop(0, '#1a2026'); pg.addColorStop(0.5, '#262d35'); pg.addColorStop(0.92, '#2d353d'); pg.addColorStop(1, '#151a1f');
      g.fillStyle = pg; g.fillRect(px - pw / 2, fy1 + 3, pw, WALL_BASE - fy1 - 3);
    }
    // الإطلالة الخارجية (مشمسة ومحروقة الإضاءة)
    const out = mk(WALL_W, H), og = out.getContext('2d');
    const sk = og.createLinearGradient(0, sy(WIN.ya, CAM.ZW), 0, sy(WIN.y0, CAM.ZW));
    sk.addColorStop(0, '#e6eef6'); sk.addColorStop(0.55, '#f6f6f2'); sk.addColorStop(0.7, '#fbf3e4'); sk.addColorStop(1, '#f2e6d0');
    og.fillStyle = sk; og.fillRect(0, 0, WALL_W, H);
    og.fillStyle = 'rgba(176,186,194,0.55)';
    for (let x = 0; x < WALL_W; x += 140 + r() * 160) {
      const bw = 120 + r() * 220, bh = 30 + r() * 46;
      og.fillRect(x, CAM.HOR + 14 - bh, bw, bh + 40);
    }
    og.strokeStyle = 'rgba(150,164,174,0.75)';
    og.filter = 'blur(2.5px)';
    for (let x = 60; x < WALL_W; x += 210 + r() * 260) palm(og, x, CAM.HOR + 40, 150 + r() * 70, (r() - 0.5) * 40, r);
    og.filter = 'none';
    // النوافذ المقوسة
    const yb = sy(WIN.y0, CAM.ZW), ys = sy(WIN.ys, CAM.ZW), ya = sy(WIN.ya, CAM.ZW), hw = WIN.hw * PPMW;
    for (const Xk of WINDOWS) {
      const cx = (Xk - XW0) * PPMW;
      archPath(g, cx, hw + 9, yb + 6, ys, ya - 9); g.fillStyle = '#0e1215'; g.fill();
      g.save(); archPath(g, cx, hw, yb, ys, ya); g.clip();
      g.drawImage(out, 0, 0);
      g.strokeStyle = 'rgba(28,34,40,0.9)'; g.lineWidth = 2.2;
      for (let d = -400; d < 400; d += 15) {
        g.beginPath(); g.moveTo(cx + d, ya); g.lineTo(cx + d + (ys - ya + 4), ys + 4); g.stroke();
        g.beginPath(); g.moveTo(cx + d, ya); g.lineTo(cx + d - (ys - ya + 4), ys + 4); g.stroke();
      }
      g.fillStyle = '#1c2228';
      g.fillRect(cx - hw, ys, hw * 2, 5);
      g.fillRect(cx - 2.5, ys, 5, yb - ys);
      g.fillRect(cx - hw, (ys + yb) / 2 + 20, hw * 2, 3);
      g.fillStyle = 'rgba(255,240,215,0.35)'; g.fillRect(cx - hw, ya, 6, yb - ya);
      g.restore();
    }
    // توهّج النوافذ على الجدار
    g.globalCompositeOperation = 'lighter';
    g.filter = 'blur(26px)';
    g.fillStyle = 'rgba(150,175,200,0.42)';
    for (const Xk of WINDOWS) { archPath(g, (Xk - XW0) * PPMW, hw + 4, yb, ys, ya); g.fill(); }
    g.filter = 'blur(70px)';
    g.fillStyle = 'rgba(120,150,180,0.20)';
    for (const Xk of WINDOWS) { archPath(g, (Xk - XW0) * PPMW, hw + 30, yb + 20, ys, ya); g.fill(); }
    g.filter = 'none'; g.globalCompositeOperation = 'source-over';
    // الوزرة
    g.fillStyle = '#15191d'; g.fillRect(0, sy(0.16, CAM.ZW), WALL_W, WALL_BASE - sy(0.16, CAM.ZW) + 2);
    // عمق الميدان: الجدار خارج التركيز
    wallC = mk(WALL_W, H);
    const wg = wallC.getContext('2d');
    wg.filter = `blur(${dofBlur(CAM.ZW).toFixed(1)}px)`;
    wg.drawImage(c, 0, 0);
    wg.filter = 'none';
    wg.drawImage(c, 0, WALL_BASE - 4, WALL_W, 6, 0, WALL_BASE - 4, WALL_W, 6);
    // انعكاس الجدار على الأرضية اللامعة
    wallReflC = mk(WALL_W, H);
    const rg = wallReflC.getContext('2d');
    rg.save(); rg.translate(0, 2 * WALL_BASE); rg.scale(1, -1);
    rg.filter = 'blur(10px)'; rg.drawImage(wallC, 0, 0); rg.restore();
    rg.globalCompositeOperation = 'destination-in';
    const fade = rg.createLinearGradient(0, WALL_BASE, 0, WALL_BASE + 420);
    fade.addColorStop(0, 'rgba(0,0,0,0.85)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
    rg.fillStyle = fade; rg.fillRect(0, 0, WALL_W, H);
    rg.clearRect(0, 0, WALL_W, WALL_BASE);
  }

  let PC = mk(64, 64), RC = mk(64, 64);
  function personSprite(p, pose, hpx) {
    const w = Math.ceil(hpx * 1.02), h = Math.ceil(hpx * 1.14);
    ensure(PC, w, h); ensure(RC, w, h);
    const pc = PC.getContext('2d'), rc = RC.getContext('2d');
    const ox = w / 2, oy = h - Math.ceil(hpx * 0.05);
    pc.setTransform(1, 0, 0, 1, 0, 0); pc.globalCompositeOperation = 'source-over'; pc.filter = 'none'; pc.globalAlpha = 1;
    pc.clearRect(0, 0, w + 2, h + 2);
    pc.setTransform(p.dir * hpx, 0, 0, hpx, ox, oy);
    pc.fillStyle = '#000';
    drawFigure(pc, pose, p);
    pc.setTransform(1, 0, 0, 1, 0, 0);
    pc.globalCompositeOperation = 'source-in';
    const gr = pc.createLinearGradient(0, oy - hpx, 0, oy);
    gr.addColorStop(0, p.hero ? '#0d1014' : '#0b0e12');
    gr.addColorStop(1, p.hero ? '#1a1f25' : '#161b20');
    pc.fillStyle = gr; pc.fillRect(0, 0, w, h);
    // حافة الضوء الخلفي
    rc.setTransform(1, 0, 0, 1, 0, 0); rc.globalCompositeOperation = 'source-over'; rc.filter = 'none';
    rc.clearRect(0, 0, w + 2, h + 2);
    rc.drawImage(PC, 0, 0, w, h, 0, 0, w, h);
    rc.globalCompositeOperation = 'source-in';
    rc.fillStyle = p.hero ? 'rgba(240,222,196,0.62)' : 'rgba(190,208,232,0.5)';
    rc.fillRect(0, 0, w, h);
    rc.globalCompositeOperation = 'destination-out';
    const d = Math.max(1.6, hpx * 0.008);
    rc.drawImage(PC, 0, 0, w, h, -d * 0.7, d, w, h);
    pc.globalCompositeOperation = 'source-atop';
    pc.filter = `blur(${Math.max(0.8, hpx * 0.0032).toFixed(2)}px)`;
    pc.drawImage(RC, 0, 0, w, h, 0, 0, w, h);
    pc.filter = 'none'; pc.globalCompositeOperation = 'source-over';
    return { w, h, ox, oy };
  }
  function drawPerson(p, t) {
    const st = personState(p, t);
    const ppm = CAM.F / p.z, hpx = p.h * ppm;
    const x = W / 2 + ppm * (st.X - camX(t)), y = sy(0, p.z);
    if (x < -hpx * 0.7 || x > W + hpx * 0.7) return;
    const s = personSprite(p, st.pose, hpx);
    const blur = dofBlur(p.z) + (p.hero ? 0.5 : 0);
    // ظل على الأرض نحو الكاميرا
    ctx.save();
    ctx.translate(x, y);
    ctx.transform(1, 0, 0.18, -0.2, 0, 0);
    ctx.globalAlpha = 0.3;
    ctx.filter = `brightness(0) blur(${(blur + hpx * 0.02).toFixed(1)}px)`;
    ctx.drawImage(PC, 0, 0, s.w, s.h, -s.ox, -s.oy, s.w, s.h);
    ctx.restore();
    // الشخص
    ctx.save();
    ctx.filter = blur > 0.4 ? `blur(${blur.toFixed(1)}px)` : 'none';
    ctx.shadowColor = p.hero ? 'rgba(235,215,190,0.20)' : 'rgba(180,200,228,0.16)';
    ctx.shadowBlur = hpx * 0.04;
    ctx.drawImage(PC, 0, 0, s.w, s.h, x - s.ox, y - s.oy, s.w, s.h);
    ctx.restore();
  }

  const FXP = mk(W / 2, H / 2), FXS = mk(W / 2, H / 2);
  function windowLight(Xk, t) {
    const P = (X, z, Y = 0) => [sxw(X, z, t), sy(Y, z)];
    const s1 = SLANT * (CAM.ZW - PZ1), s2 = SLANT * (CAM.ZW - PZ2);
    return {
      patch: [P(Xk - WIN.hw - s1, PZ1), P(Xk + WIN.hw - s1, PZ1), P(Xk + WIN.hw - s2, PZ2), P(Xk - WIN.hw - s2, PZ2)],
      top: [P(Xk - WIN.hw, CAM.ZW, 3.25), P(Xk + WIN.hw, CAM.ZW, 3.25)],
    };
  }
  function poly(g, pts) { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); }
  function drawFloor(t) {
    const fg = ctx.createLinearGradient(0, WALL_BASE, 0, H);
    fg.addColorStop(0, '#20262c'); fg.addColorStop(0.3, '#161a1f'); fg.addColorStop(1, '#0a0c0f');
    ctx.fillStyle = fg; ctx.fillRect(-60, WALL_BASE, W + 120, H - WALL_BASE + 60);
    const dx = W / 2 + PPMW * (XW0 - camX(t));
    ctx.save();
    ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.42;
    ctx.drawImage(wallReflC, dx, 0);
    ctx.restore();
    // فواصل البلاط
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.16)'; ctx.lineWidth = 1.2;
    for (const z of [11, 9.6, 8.3, 7.1, 6.0, 5.0, 4.1, 3.3]) { const y = sy(0, z); ctx.beginPath(); ctx.moveTo(-60, y); ctx.lineTo(W + 60, y); ctx.stroke(); }
    const xa = Math.floor((camX(t) - 30) / 1.5) * 1.5;
    for (let X = xa; X < camX(t) + 30; X += 1.5) {
      ctx.beginPath(); ctx.moveTo(sxw(X, CAM.ZW, t), WALL_BASE); ctx.lineTo(sxw(X, 2.6, t), sy(0, 2.6)); ctx.stroke();
    }
    ctx.restore();
    // بقع الشمس على الأرض
    const g = FXP.getContext('2d');
    g.setTransform(0.5, 0, 0, 0.5, 0, 0); g.clearRect(0, 0, W, H);
    g.filter = 'blur(3px)';
    for (const Xk of WINDOWS) {
      const L = windowLight(Xk, t);
      if (L.patch[1][0] < -300 || L.patch[3][0] > W + 300) continue;
      const gr = g.createLinearGradient(0, L.patch[0][1], 0, L.patch[2][1]);
      gr.addColorStop(0, 'rgba(255,238,210,0.40)'); gr.addColorStop(1, 'rgba(255,238,210,0.16)');
      g.fillStyle = gr; poly(g, L.patch); g.fill();
    }
    g.filter = 'none';
    ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.drawImage(FXP, 0, 0, W, H); ctx.restore();
  }
  const DUST = (() => { const r = rng(77), a = []; for (let i = 0; i < 46; i++) a.push([r(), r(), r() * TAU, r() * TAU, 0.6 + r() * 1.4, r()]); return a; })();
  function drawShafts(t) {
    const g = FXS.getContext('2d');
    g.setTransform(0.5, 0, 0, 0.5, 0, 0); g.clearRect(0, 0, W, H);
    g.filter = 'blur(9px)';
    const shafts = [];
    for (const Xk of WINDOWS) {
      const L = windowLight(Xk, t);
      const q = [L.top[0], L.top[1], L.patch[2], L.patch[3]];
      if (Math.max(q[1][0], q[2][0]) < -200 || Math.min(q[0][0], q[3][0]) > W + 200) continue;
      shafts.push(q);
      const gr = g.createLinearGradient(0, q[0][1], 0, q[2][1]);
      gr.addColorStop(0, 'rgba(225,234,246,0.26)'); gr.addColorStop(0.6, 'rgba(225,234,246,0.11)'); gr.addColorStop(1, 'rgba(225,234,246,0.02)');
      g.fillStyle = gr; poly(g, q); g.fill();
    }
    g.filter = 'none';
    ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.drawImage(FXS, 0, 0, W, H);
    // غبار يسبح في أشعة الضوء
    ctx.globalCompositeOperation = 'lighter';
    for (const q of shafts) {
      for (const d of DUST) {
        const u = wrap(d[0] + 0.03 * Math.sin(t * 0.4 + d[2]));
        const v = wrap(d[1] + 0.035 * t + 0.02 * Math.sin(t * 0.3 + d[3]));
        const xa = lerp(q[0][0], q[1][0], u), ya = lerp(q[0][1], q[1][1], u);
        const xb = lerp(q[3][0], q[2][0], u), yb = lerp(q[3][1], q[2][1], u);
        const x = lerp(xa, xb, v), y = lerp(ya, yb, v);
        const tw = 0.5 + 0.5 * Math.sin(t * (1.5 + d[5]) + d[2] * 3);
        ctx.globalAlpha = 0.22 * tw * (1 - v * 0.6);
        const s = 5 + d[4] * 4;
        ctx.drawImage(DOT, x - s / 2, y - s / 2, s, s);
      }
    }
    ctx.restore();
  }
  // عمود قريب جدًا من العدسة يمسح الكادر — يخفي القطع إلى اللقطة التالية
  function drawWipePillar(t) {
    const z = 0.5, ppm = CAM.F / z, X = -CAM.V * T1;
    const cx = W / 2 + ppm * (X - camX(t)), hw = ppm * 0.5;
    if (cx + hw < -40 || cx - hw > W + 40) return;
    const gr = ctx.createLinearGradient(cx - hw - 160, 0, cx + hw + 160, 0);
    const e = 160 / (2 * hw + 320);
    gr.addColorStop(0, 'rgba(5,6,8,0)'); gr.addColorStop(e * 2, 'rgba(5,6,8,1)');
    gr.addColorStop(0.5, 'rgba(10,12,15,1)');
    gr.addColorStop(1 - e * 2, 'rgba(5,6,8,1)'); gr.addColorStop(1, 'rgba(5,6,8,0)');
    ctx.fillStyle = gr; ctx.fillRect(cx - hw - 160, -60, 2 * hw + 320, H + 120);
  }
  function shotA(t) {
    const zoom = 1.02 + 0.035 * eio(t / T1);
    const shx = 2.2 * Math.sin(t * 1.7) + 1.1 * Math.sin(t * 3.9 + 1), shy = 1.6 * Math.sin(t * 2.3 + 2) + 0.8 * Math.sin(t * 5.1);
    const rot = 0.0012 * Math.sin(t * 1.3);
    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.rotate(rot); ctx.scale(zoom, zoom); ctx.translate(-W / 2 + shx, -H / 2 + shy);
    ctx.drawImage(wallC, W / 2 + PPMW * (XW0 - camX(t)), 0);
    drawFloor(t);
    const far = PEOPLE.filter((p) => p.z > PZ2), near = PEOPLE.filter((p) => p.z <= PZ2);
    for (const p of far) drawPerson(p, t);
    drawShafts(t);
    for (const p of near) drawPerson(p, t);
    drawWipePillar(t);
    ctx.restore();
  }

  // ================================================================ SHOT B — الدفتر
  const PW = 700, PH = 930;
  const TB = { w: 2800, h: 1900 };
  let baseB, lightB, pageL0, pageR0, pageR1, pageL1base, pageL1;
  const strokesL1 = [];
  const BULB = [340, 315];   // داخل الصفحة اليسرى الجديدة
  const BULB_T = [-PW + BULB[0], -PH / 2 + BULB[1]];

  function jitterLine(r, x1, y1, x2, y2, bow = 1) {
    const pts = [], n = Math.max(6, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 10));
    const nx = -(y2 - y1), ny = x2 - x1, nl = Math.hypot(nx, ny) || 1;
    const b = (r() - 0.5) * 6 * bow;
    for (let i = 0; i <= n; i++) {
      const u = i / n, s = Math.sin(Math.PI * u) * b + (r() - 0.5) * 0.9;
      pts.push([lerp(x1, x2, u) + nx / nl * s, lerp(y1, y2, u) + ny / nl * s]);
    }
    return pts;
  }
  function circlePts(r, cx, cy, rad, a0 = 0, turns = 1.08, sq = 1) {
    const pts = [], n = Math.ceil(rad * turns * 0.7) + 16;
    const wob = r() * TAU;
    for (let i = 0; i <= n; i++) {
      const a = a0 + TAU * turns * i / n;
      const rr = rad * (1 + 0.04 * Math.sin(a * 2 + wob)) + (r() - 0.5) * 0.8 + i / n * 2;
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * sq]);
    }
    return pts;
  }
  function rectStrokes(r, x1, y1, x2, y2) {
    const o = 4;
    return [jitterLine(r, x1 - o, y1, x2 + o, y1), jitterLine(r, x2, y1 - o, x2, y2 + o), jitterLine(r, x2 + o, y2, x1 - o, y2), jitterLine(r, x1, y2 + o, x1, y1 - o)];
  }
  function arrowStrokes(r, pts) {
    const a = pts[pts.length - 1], b = pts[pts.length - 3];
    const ang = Math.atan2(a[1] - b[1], a[0] - b[0]);
    const h1 = [a[0] - Math.cos(ang - 0.5) * 18, a[1] - Math.sin(ang - 0.5) * 18];
    const h2 = [a[0] - Math.cos(ang + 0.5) * 18, a[1] - Math.sin(ang + 0.5) * 18];
    return [pts, [h1, a, h2]];
  }
  // كتابة يدوية تشبه العربية لكنها غير مقروءة (لا نصوص مولّدة داخل الصورة)
  function scribble(r, xRight, y, width) {
    const out = [];
    let x = xRight;
    while (x > xRight - width) {
      const word = [];
      const letters = 2 + Math.floor(r() * 4);
      word.push([x, y]);
      for (let l = 0; l < letters && x > xRight - width; l++) {
        const lw = 9 + r() * 12, type = r();
        if (type < 0.22) { word.push([x - 1, y - 16 - r() * 8]); word.push([x - 3, y]); }
        else if (type < 0.45) { word.push([x - lw * 0.3, y - 5 - r() * 3]); word.push([x - lw * 0.55, y]); }
        else if (type < 0.6) { word.push([x - lw * 0.4, y + 4]); word.push([x - lw * 0.7, y - 3]); word.push([x - lw * 0.5, y - 7]); word.push([x - lw * 0.35, y - 2]); }
        x -= lw;
        word.push([x, y + (r() - 0.5) * 1.5]);
        if (r() < 0.3) out.push({ dot: [x + lw * 0.5, y + (r() < 0.6 ? -13 : 9)] });
      }
      if (r() < 0.45) { word.push([x - 6, y + 8]); word.push([x - 2, y + 13]); word.push([x + 4, y + 10]); }
      out.push({ pts: word });
      x -= 14 + r() * 12;
    }
    return out;
  }
  function prepStroke(pts, opt = {}) {
    const len = [0];
    for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, len, total: len[len.length - 1], t0: opt.t0 ?? -1, dur: opt.dur ?? 0.3, warm: !!opt.warm, w: opt.w ?? 2.4 };
  }
  function strokePath(g, s, prog) {
    const target = s.total * prog, p = s.pts;
    g.beginPath(); g.moveTo(p[0][0], p[0][1]);
    for (let i = 1; i < p.length; i++) {
      if (s.len[i] <= target) { g.lineTo(p[i][0], p[i][1]); continue; }
      const u = (target - s.len[i - 1]) / Math.max(1e-6, s.len[i] - s.len[i - 1]);
      g.lineTo(lerp(p[i - 1][0], p[i][0], u), lerp(p[i - 1][1], p[i][1], u));
      break;
    }
  }
  function pencil(g, s, prog = 1, color = 'rgba(42,43,50,') {
    if (prog <= 0) return;
    g.lineCap = 'round'; g.lineJoin = 'round';
    strokePath(g, s, prog);
    g.strokeStyle = color + '0.10)'; g.lineWidth = s.w + 4; g.stroke();
    g.strokeStyle = color + '0.62)'; g.lineWidth = s.w; g.stroke();
    g.save(); g.translate(0.7, 0.5); strokePath(g, s, prog);
    g.strokeStyle = color + '0.42)'; g.lineWidth = s.w * 0.55; g.stroke(); g.restore();
  }
  function drawScribbles(g, list, color) {
    for (const it of list) {
      if (it.dot) { g.fillStyle = (color || 'rgba(42,43,50,') + '0.7)'; g.beginPath(); g.arc(it.dot[0], it.dot[1], 2.3, 0, TAU); g.fill(); }
      else pencil(g, prepStroke(it.pts, { w: 2.0 }), 1, color);
    }
  }
  function paperPage(seed, side) {
    const r = rng(seed);
    const c = mk(PW, PH), g = c.getContext('2d');
    g.fillStyle = '#ebe5d6'; g.fillRect(0, 0, PW, PH);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '255,255,250' : '120,110,90'},${0.03 + r() * 0.04})`;
      g.fillRect(r() * PW, r() * PH, 1 + r() * 3, 1);
    }
    g.strokeStyle = 'rgba(92,118,150,0.22)'; g.lineWidth = 1.3;
    for (let y = 92; y < PH - 30; y += 38) { g.beginPath(); g.moveTo(26, y); g.lineTo(PW - 26, y); g.stroke(); }
    g.strokeStyle = 'rgba(176,86,86,0.20)';
    const mx = side === 'L' ? PW - 120 : PW - 70;
    g.beginPath(); g.moveTo(mx, 0); g.lineTo(mx, PH); g.stroke();
    // تظليل منطقة الكعب (انحناء الورق)
    const gx = side === 'L' ? PW : 0, dir = side === 'L' ? -1 : 1;
    const gr = g.createLinearGradient(gx, 0, gx + dir * 110, 0);
    gr.addColorStop(0, 'rgba(40,30,20,0.42)'); gr.addColorStop(0.35, 'rgba(40,30,20,0.12)'); gr.addColorStop(1, 'rgba(40,30,20,0)');
    g.fillStyle = gr; g.fillRect(0, 0, PW, PH);
    const ex = side === 'L' ? 0 : PW;
    const gr2 = g.createLinearGradient(ex, 0, ex - dir * 26, 0);
    gr2.addColorStop(0, 'rgba(60,50,40,0.22)'); gr2.addColorStop(1, 'rgba(60,50,40,0)');
    g.fillStyle = gr2; g.fillRect(0, 0, PW, PH);
    return c;
  }
  function buildNotebook() {
    const r = rng(5);
    // المقعد الخشبي
    baseB = mk(TB.w, TB.h);
    const g = baseB.getContext('2d');
    g.fillStyle = '#0a0705'; g.fillRect(0, 0, TB.w, TB.h);
    for (let y = -40; y < TB.h; y += 276) {
      const wg = g.createLinearGradient(0, y, 0, y + 260);
      wg.addColorStop(0, '#3b2b1f'); wg.addColorStop(0.5, '#453325'); wg.addColorStop(1, '#2f2218');
      g.fillStyle = wg; g.fillRect(0, y, TB.w, 260);
      for (let i = 0; i < 46; i++) {
        const yy = y + r() * 260, amp = 2 + r() * 6, fr = 0.002 + r() * 0.004, ph = r() * TAU;
        g.strokeStyle = `rgba(${r() < 0.5 ? '20,12,6' : '90,66,44'},${0.12 + r() * 0.12})`;
        g.lineWidth = 0.8 + r() * 1.8;
        g.beginPath();
        for (let x = 0; x <= TB.w; x += 40) g.lineTo(x, yy + Math.sin(x * fr + ph) * amp);
        g.stroke();
      }
      g.fillStyle = 'rgba(255,230,200,0.05)'; g.fillRect(0, y + 2, TB.w, 3);
    }
    // ظل الدفتر وغلافه
    const ox = TB.w / 2, oy = TB.h / 2;
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.75)'; g.shadowBlur = 40; g.shadowOffsetX = -14; g.shadowOffsetY = 18;
    g.fillStyle = '#1c2431'; g.beginPath(); g.roundRect(ox - PW - 18, oy - PH / 2 - 16, 2 * PW + 36, PH + 32, 14); g.fill();
    g.restore();
    g.fillStyle = 'rgba(255,255,255,0.04)'; g.fillRect(ox - PW - 18, oy - PH / 2 - 16, 2 * PW + 36, 3);
    // حواف الصفحات المكدسة
    g.fillStyle = '#d9d1bf'; g.fillRect(ox - PW - 6, oy - PH / 2 - 4, 2 * PW + 12, PH + 8);
    g.strokeStyle = 'rgba(90,80,60,0.35)'; g.lineWidth = 1;
    for (let i = 0; i < 4; i++) { g.strokeRect(ox - PW - 6 + i * 1.5, oy - PH / 2 - 4 + i * 1.5, 2 * PW + 12 - i * 3, PH + 8 - i * 3); }
    // قلم رصاص على المقعد
    g.save();
    g.translate(ox + PW + 140, oy + 40); g.rotate(1.25);
    g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = 18; g.shadowOffsetX = -10; g.shadowOffsetY = 12;
    g.fillStyle = '#c9a04a'; g.fillRect(-260, -12, 470, 24);
    g.shadowColor = 'transparent';
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(-260, -12, 470, 6);
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(-260, 5, 470, 7);
    g.fillStyle = '#9aa1a8'; g.fillRect(-300, -12.5, 42, 25);
    g.fillStyle = '#b86b62'; g.beginPath(); g.roundRect(-336, -11.5, 38, 23, 6); g.fill();
    g.fillStyle = '#ddb98e'; g.beginPath(); g.moveTo(210, -12); g.lineTo(272, -3); g.lineTo(272, 3); g.lineTo(210, 12); g.closePath(); g.fill();
    g.fillStyle = '#2b2b2e'; g.beginPath(); g.moveTo(258, -5); g.lineTo(284, 0); g.lineTo(258, 5); g.closePath(); g.fill();
    g.restore();

    // الصفحات
    pageL0 = paperPage(21, 'L'); pageR0 = paperPage(22, 'R'); pageR1 = paperPage(23, 'R'); pageL1base = paperPage(24, 'L');
    pageL1 = mk(PW, PH);
    // الصفحات القديمة: ملاحظات وفكرة مشطوبة (تردد)
    let gg = pageR0.getContext('2d');
    for (let i = 0; i < 9; i++) drawScribbles(gg, scribble(r, PW - 90, 130 + i * 76, 380 + r() * 180));
    gg = pageL0.getContext('2d');
    for (let i = 0; i < 4; i++) drawScribbles(gg, scribble(r, PW - 140, 130 + i * 76, 300 + r() * 160));
    for (const s of rectStrokes(r, 170, 470, 470, 690)) pencil(gg, prepStroke(s));
    pencil(gg, prepStroke(jitterLine(r, 150, 470, 500, 700, 2), { w: 3 }));
    pencil(gg, prepStroke(jitterLine(r, 500, 465, 150, 705, 2), { w: 3 }));

    // الصفحة اليمنى الجديدة: رسم أولي لواجهة محل
    gg = pageR1.getContext('2d');
    const R1 = [];
    R1.push(jitterLine(r, 80, 480, 620, 480, 0.5));
    R1.push(...rectStrokes(r, 150, 236, 550, 480));
    const crown = []; for (let x = 140; x <= 560; x += 28) { crown.push([x, 236]); crown.push([x + 14, 214]); } crown.push([560, 236]);
    R1.push(crown);
    R1.push(...rectStrokes(r, 222, 254, 478, 304));
    R1.push(jitterLine(r, 165, 326, 535, 326));
    const scal = []; for (let x = 165; x < 535; x += 37) { for (let a = 0; a <= 8; a++) scal.push([x + 37 * a / 8, 330 + Math.sin(Math.PI * a / 8) * 26]); }
    R1.push(scal);
    for (let x = 202; x < 535; x += 37) R1.push(jitterLine(r, x, 328, x, 352, 0.2));
    R1.push(...rectStrokes(r, 384, 376, 452, 480));
    R1.push(...rectStrokes(r, 196, 380, 338, 446));
    R1.push(jitterLine(r, 267, 382, 267, 444, 0.2)); R1.push(jitterLine(r, 198, 413, 336, 413, 0.2));
    for (let i = 0; i < 9; i++) R1.push(jitterLine(r, 470 + i * 9, 384, 452 + i * 9, 476, 0.1));
    R1.push(...arrowStrokes(r, jitterLine(r, 610, 190, 492, 262, 2)));
    for (const s of R1) pencil(gg, prepStroke(s));
    drawScribbles(gg, scribble(r, 650, 168, 120));
    for (let i = 0; i < 5; i++) drawScribbles(gg, scribble(r, PW - 90, 570 + i * 76, 300 + r() * 220));
    pencil(gg, prepStroke(jitterLine(r, PW - 360, 596, PW - 92, 594, 0.3), { w: 2.2 }));

    // الصفحة اليسرى الجديدة: المصباح + مخطط + رسم بياني (بعضها يُرسم أمامنا)
    gg = pageL1base.getContext('2d');
    drawScribbles(gg, scribble(r, PW - 140, 116, 260));
    const [bx, by] = BULB, br = 62;
    const bulb = [];
    for (let i = 0; i <= 40; i++) { const a = Math.PI * 0.72 + (Math.PI * 1.56) * i / 40; bulb.push([bx + Math.cos(a) * br + (r() - 0.5), by + Math.sin(a) * br + (r() - 0.5)]); }
    const statics = [
      bulb,
      jitterLine(r, bx - br * 0.63, by + br * 0.78, bx - 22, by + 96, 0.4),
      jitterLine(r, bx + br * 0.63, by + br * 0.78, bx + 22, by + 96, 0.4),
      jitterLine(r, bx - 26, by + 100, bx + 26, by + 100, 0.2),
      jitterLine(r, bx - 24, by + 111, bx + 24, by + 111, 0.2),
      jitterLine(r, bx - 20, by + 122, bx + 20, by + 122, 0.2),
      jitterLine(r, bx - 8, by + 134, bx + 8, by + 134, 0.2),
      [[bx - 16, by + 82], [bx - 12, by + 10], [bx - 6, by + 2], [bx, by + 12], [bx + 6, by + 2], [bx + 12, by + 10], [bx + 16, by + 82]],
    ];
    const C = [[540, 572], [350, 572], [160, 572]];
    for (const [cx, cy] of C) statics.push(circlePts(r, cx, cy, 38, r() * TAU));
    statics.push(circlePts(r, 540, 562, 9, 0, 1.0));
    statics.push(jitterLine(r, 524, 590, 556, 590, 0.6));
    statics.push(circlePts(r, 350, 572, 12, 0, 1.0));
    for (let i = 0; i < 6; i++) { const a = i * TAU / 6; statics.push(jitterLine(r, 350 + Math.cos(a) * 14, 572 + Math.sin(a) * 14, 350 + Math.cos(a) * 22, 572 + Math.sin(a) * 22, 0)); }
    const star = []; for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + i * TAU / 10, rr = i % 2 ? 9 : 21; star.push([160 + Math.cos(a) * rr, 574 + Math.sin(a) * rr]); }
    statics.push(star);
    statics.push(jitterLine(r, 110, 700, 110, 872, 0.3));
    statics.push(jitterLine(r, 104, 866, 610, 866, 0.3));
    const bars = [[160, 40], [250, 62], [340, 90], [430, 118], [520, 150]];
    for (const [x, hgt] of bars) {
      statics.push(...rectStrokes(r, x, 866 - hgt, x + 52, 866));
      for (let yy = 866 - hgt + 10; yy < 866; yy += 11) statics.push(jitterLine(r, x + 6, yy, x + 46, yy - 6, 0));
    }
    for (const s of statics) pencil(gg, prepStroke(s));
    // العناصر المتحركة
    strokesL1.length = 0;
    const flowA = arrowStrokes(r, jitterLine(r, 496, 566, 398, 566, 1.2));
    const flowB = arrowStrokes(r, jitterLine(r, 306, 566, 208, 566, 1.2));
    flowA.forEach((s, i) => strokesL1.push(prepStroke(s, { t0: 5.42 + i * 0.22, dur: i ? 0.12 : 0.24 })));
    flowB.forEach((s, i) => strokesL1.push(prepStroke(s, { t0: 5.78 + i * 0.22, dur: i ? 0.12 : 0.24 })));
    const trendPts = []; for (let i = 0; i <= 24; i++) { const u = i / 24; trendPts.push([150 + u * 450, 810 - Math.pow(u, 1.6) * 150 + (r() - 0.5) * 1.5]); }
    arrowStrokes(r, trendPts).forEach((s, i) => strokesL1.push(prepStroke(s, { t0: 6.0 + i * 0.4, dur: i ? 0.12 : 0.4, w: 2.8 })));
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * (1.08 + i * 0.14);
      strokesL1.push(prepStroke(jitterLine(r, bx + Math.cos(a) * (br + 16), by + Math.sin(a) * (br + 16), bx + Math.cos(a) * (br + 48), by + Math.sin(a) * (br + 48), 0.3),
        { t0: 6.12 + i * 0.07, dur: 0.16, warm: true, w: 2.8 }));
    }
    strokesL1.bulb = statics.slice(0, 8).map((s) => prepStroke(s));

    // ضوء النافذة عبر المشربية
    const mask = mk(TB.w, TB.h), mg = mask.getContext('2d');
    mg.fillStyle = '#000'; mg.fillRect(0, 0, TB.w, TB.h);
    mg.save();
    mg.translate(ox + 330, oy - 60); mg.rotate(0.55);
    archPath(mg, 0, 400, 900, -560, -820);
    mg.fillStyle = '#fff'; mg.fill(); mg.clip();
    mg.strokeStyle = '#000'; mg.lineWidth = 10;
    const cell = 100;
    for (let i = -14; i <= 14; i++) {
      for (let j = -14; j <= 14; j++) {
        const cx = i * cell, cy = j * cell;
        mg.strokeRect(cx - 32, cy - 32, 64, 64);
        mg.save(); mg.translate(cx, cy); mg.rotate(Math.PI / 4); mg.strokeRect(-32, -32, 64, 64); mg.restore();
        mg.beginPath(); mg.moveTo(cx + 45, cy); mg.lineTo(cx + 55, cy); mg.moveTo(cx, cy + 45); mg.lineTo(cx, cy + 55); mg.stroke();
      }
    }
    mg.lineWidth = 7;
    for (let i = -14; i <= 14; i++) { mg.beginPath(); mg.moveTo(i * cell + 50, -2000); mg.lineTo(i * cell + 50, 2000); mg.stroke(); mg.beginPath(); mg.moveTo(-2000, i * cell + 50); mg.lineTo(2000, i * cell + 50); mg.stroke(); }
    mg.restore();
    const blurred = mk(TB.w, TB.h), bgc = blurred.getContext('2d');
    bgc.filter = 'blur(4.5px)'; bgc.drawImage(mask, 0, 0); bgc.filter = 'none';
    bgc.globalCompositeOperation = 'multiply'; bgc.fillStyle = 'rgb(160,146,116)'; bgc.fillRect(0, 0, TB.w, TB.h);
    lightB = mk(TB.w, TB.h);
    const lg = lightB.getContext('2d');
    lg.fillStyle = 'rgb(92,100,114)'; lg.fillRect(0, 0, TB.w, TB.h);
    lg.globalCompositeOperation = 'lighter'; lg.drawImage(blurred, 0, 0);
  }
  function renderL1(t) {
    const g = pageL1.getContext('2d');
    g.globalCompositeOperation = 'source-over';
    g.drawImage(pageL1base, 0, 0);
    for (const s of strokesL1) {
      const p = s.t0 < 0 ? 1 : clamp((t - s.t0) / s.dur);
      pencil(g, s, eout(p));
    }
    const warm = sstep(6.2, 7.0, t);
    if (warm > 0) {
      g.globalAlpha = warm;
      for (const s of strokesL1.bulb) pencil(g, s, 1, 'rgba(214,146,58,');
      for (const s of strokesL1) if (s.warm) pencil(g, s, eout(clamp((t - s.t0) / s.dur)), 'rgba(214,146,58,');
      g.globalAlpha = 1;
    }
  }
  const SB = mk(W, H), SBB = mk(W, H), SBM = mk(W, H);
  function camB(t) {
    const u = eio((t - 4.5) / (T2 - 4.5));
    const cx = lerp(70, BULB_T[0], u), cy = lerp(10, BULB_T[1], u);
    return { cx, cy, s: lerp(0.80, 1.16, u), rot: lerp(-0.10, -0.045, u) + 0.004 * Math.sin(t * 1.1) };
  }
  function drawPage(g, img, x, w, shade) {
    if (w < 0.5) return;
    g.drawImage(img, x, -PH / 2, w, PH);
    if (shade > 0) { g.fillStyle = `rgba(20,16,12,${shade})`; g.fillRect(x, -PH / 2, w, PH); }
  }
  function shotB(t) {
    const g = SB.getContext('2d');
    const cam = camB(t);
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.filter = 'none';
    g.translate(W / 2, H / 2); g.rotate(cam.rot); g.scale(cam.s, cam.s); g.translate(-cam.cx, -cam.cy);
    g.drawImage(baseB, -TB.w / 2, -TB.h / 2);
    renderL1(t);
    const fp = eio((t - 4.72) / 0.62), phi = Math.PI * fp;
    // قلب الصفحة من اليسار إلى اليمين (كالدفاتر العربية)
    drawPage(g, fp > 0 ? pageL1 : pageL0, -PW, PW, 0);
    drawPage(g, pageR0, 0, PW, 0);
    if (fp > 0 && fp < 1) {
      const c = Math.cos(phi), lift = Math.sin(phi);
      const sc = 1 + 0.07 * lift;
      g.save(); g.scale(1, sc);
      if (c > 0) {
        const w = PW * c;
        const sh = g.createLinearGradient(-w, 0, -w - 90 * lift, 0);
        sh.addColorStop(0, `rgba(0,0,0,${0.4 * lift})`); sh.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = sh; g.fillRect(-w - 90 * lift, -PH / 2, 90 * lift, PH);
        drawPage(g, pageL0, -w, w, 0.28 * lift);
      } else {
        const w = -PW * c;
        const sh = g.createLinearGradient(w, 0, w + 110 * lift, 0);
        sh.addColorStop(0, `rgba(0,0,0,${0.45 * lift})`); sh.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = sh; g.fillRect(w, -PH / 2, 110 * lift, PH);
        drawPage(g, pageR1, 0, w, 0.22 * lift);
      }
      g.restore();
    } else if (fp >= 1) {
      drawPage(g, pageR1, 0, PW, 0);
    }
    g.fillStyle = 'rgba(30,22,16,0.5)'; g.fillRect(-1.5, -PH / 2, 3, PH);
    // الضوء والظل
    g.globalCompositeOperation = 'multiply';
    g.drawImage(lightB, -TB.w / 2 + 14 * Math.sin(t * 0.5), -TB.h / 2 - 22 + 10 * (t - T1));
    g.globalCompositeOperation = 'source-over';
    // توهّج المصباح — أول لون دافئ في الفيلم
    const glow = sstep(6.15, T2, t);
    if (glow > 0) {
      const [gx, gy] = BULB_T;
      g.globalCompositeOperation = 'screen';
      const gr = g.createRadialGradient(gx, gy, 0, gx, gy, 260);
      gr.addColorStop(0, `rgba(255,196,120,${0.55 * glow})`); gr.addColorStop(0.4, `rgba(255,170,90,${0.22 * glow})`); gr.addColorStop(1, 'rgba(255,160,80,0)');
      g.fillStyle = gr; g.fillRect(gx - 300, gy - 300, 600, 600);
      g.globalCompositeOperation = 'source-over';
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    // عمق ميدان خفيف (أعلى وأسفل الكادر)
    const bb = SBB.getContext('2d');
    bb.filter = 'blur(6px)'; bb.drawImage(SB, 0, 0); bb.filter = 'none';
    const mm = SBM.getContext('2d');
    mm.globalCompositeOperation = 'source-over'; mm.clearRect(0, 0, W, H); mm.drawImage(SB, 0, 0);
    mm.globalCompositeOperation = 'destination-in';
    const dg = mm.createLinearGradient(0, BAR, 0, H - BAR);
    dg.addColorStop(0, 'rgba(0,0,0,0)'); dg.addColorStop(0.3, 'rgba(0,0,0,1)'); dg.addColorStop(0.7, 'rgba(0,0,0,1)'); dg.addColorStop(1, 'rgba(0,0,0,0)');
    mm.fillStyle = dg; mm.fillRect(0, 0, W, H);
    ctx.drawImage(SBB, 0, 0); ctx.drawImage(SBM, 0, 0);
    // الانتقال: كل شيء يغيب في الظل إلا الضوء
    const dark = sstep(6.75, T2, t);
    if (dark > 0) {
      ctx.fillStyle = `rgba(0,0,0,${0.97 * dark})`; ctx.fillRect(0, 0, W, H);
      const p = bulbScreen(t);
      coreGlow(p[0], p[1], dark, 170 + 40 * dark);
    }
    // بقية العمود الماسح
    ctx.save(); drawWipePillar(t); ctx.restore();
  }
  function bulbScreen(t) {
    const cam = camB(t), dx = BULB_T[0] - cam.cx, dy = BULB_T[1] - cam.cy;
    const c = Math.cos(cam.rot), s = Math.sin(cam.rot);
    return [W / 2 + cam.s * (c * dx - s * dy), H / 2 + cam.s * (s * dx + c * dy)];
  }
  function coreGlow(x, y, a, rad) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const gr = ctx.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(255,236,200,${0.95 * a})`); gr.addColorStop(0.18, `rgba(255,190,110,${0.55 * a})`);
    gr.addColorStop(0.5, `rgba(240,150,70,${0.16 * a})`); gr.addColorStop(1, 'rgba(240,140,60,0)');
    ctx.fillStyle = gr; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    ctx.restore();
  }

  // ================================================================ SHOT C — العنوان
  const TITLE = 'من الظل إلى النور';
  const TC = { x: W / 2, y: 540 };
  let titleLit, titleDim, titleMask;
  const RAYS = mk(W / 2, H / 2), RAYS2 = mk(W / 2, H / 2), TL = mk(W, H);
  function buildTitle() {
    const make = (fill) => {
      const c = mk(W, H), g = c.getContext('2d');
      g.direction = 'rtl'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '700 176px Amiri';
      if (typeof fill === 'function') fill(g); else g.fillStyle = fill;
      g.fillText(TITLE, TC.x, TC.y);
      return c;
    };
    titleMask = make('#fff');
    titleDim = make('#39414b');
    titleLit = make((g) => {
      const gr = g.createLinearGradient(0, TC.y - 110, 0, TC.y + 90);
      gr.addColorStop(0, '#fffaf0'); gr.addColorStop(0.55, '#ffe9c4'); gr.addColorStop(1, '#e7b874');
      g.fillStyle = gr;
    });
  }
  const MOTES = (() => { const r = rng(303), a = []; for (let i = 0; i < 90; i++) a.push([r() * W, BAR + r() * (H - 2 * BAR), r() * TAU, 0.4 + r(), r()]); return a; })();
  function shotC(t) {
    const u = t - T2;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const out = 1 - sstep(2.2, 2.6, u);
    // نواة الضوء القادمة من المصباح
    const core = sstep(0, 0.12, u) * (1 - 0.55 * sstep(0.9, 2.2, u)) * out;
    coreGlow(TC.x, TC.y, core, lerp(210, 120, eout(u / 0.5)) + 60 * sstep(0.5, 1.4, u));
    // خط الضوء الأفقي (anamorphic)
    const st = sstep(0.22, 1.0, u) * (1 - 0.6 * sstep(1.3, 2.3, u)) * out;
    if (st > 0) {
      const wd = lerp(80, 1900, eout((u - 0.22) / 0.9));
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (const [hh, col, al] of [[3, '255,250,240', 0.95], [14, '170,205,255', 0.45], [60, '110,150,230', 0.14]]) {
        ctx.save(); ctx.translate(TC.x, TC.y + 6); ctx.scale(wd / 2, hh);
        const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        gr.addColorStop(0, `rgba(${col},${al * st})`); gr.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = gr; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
      }
      ctx.restore();
    }
    // النص في الظل
    const dimA = sstep(0.25, 0.9, u) * 0.55 * out;
    if (dimA > 0) { ctx.globalAlpha = dimA; ctx.drawImage(titleDim, 0, 0); ctx.globalAlpha = 1; }
    // كشف النص بالضوء من المركز
    const rev = eout((u - 0.5) / 1.15);
    if (rev > 0) {
      const tl = TL.getContext('2d');
      tl.globalCompositeOperation = 'source-over'; tl.clearRect(0, 0, W, H);
      tl.drawImage(titleLit, 0, 0);
      tl.globalCompositeOperation = 'destination-in';
      tl.save(); tl.translate(TC.x, TC.y); tl.scale(1, 0.42);
      const R = 60 + rev * 1050;
      const gr = tl.createRadialGradient(0, 0, 0, 0, 0, R);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.78, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      tl.fillStyle = gr; tl.fillRect(-R, -R, 2 * R, 2 * R); tl.restore();
      // لمعة تعبر النص من اليمين إلى اليسار
      const gl = (u - 1.7) / 0.5;
      if (gl > 0 && gl < 1) {
        tl.globalCompositeOperation = 'source-atop';
        const gx = lerp(TC.x + 560, TC.x - 560, eio(gl));
        const sg = tl.createLinearGradient(gx - 90, 0, gx + 90, 0);
        sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,0.85)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
        tl.fillStyle = sg; tl.fillRect(gx - 90, 0, 180, H);
      }
      // أشعة ضوئية تنبعث من الحروف
      const rg = RAYS.getContext('2d'), rg2 = RAYS2.getContext('2d');
      rg.globalCompositeOperation = 'source-over'; rg.clearRect(0, 0, W / 2, H / 2);
      rg.drawImage(TL, 0, 0, W / 2, H / 2);
      rg2.clearRect(0, 0, W / 2, H / 2);
      rg2.globalCompositeOperation = 'lighter';
      for (let i = 1; i <= 14; i++) {
        const sc = 1 + i * 0.022;
        rg2.globalAlpha = 0.11 * (1 - i / 15);
        rg2.drawImage(RAYS, W / 4 - (W / 4) * sc, H / 4 - (H / 4) * sc, (W / 2) * sc, (H / 2) * sc);
      }
      rg2.globalAlpha = 1;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.9 * sstep(0.7, 1.4, u) * out;
      ctx.filter = 'blur(3px)';
      ctx.drawImage(RAYS2, 0, 0, W, H);
      ctx.filter = 'none';
      ctx.globalAlpha = out;
      ctx.globalCompositeOperation = 'source-over';
      ctx.shadowColor = 'rgba(255,190,110,0.85)'; ctx.shadowBlur = 38;
      ctx.drawImage(TL, 0, 0);
      ctx.restore();
    }
    // زخرفة: خط ونجمة ثمانية
    const orn = eout((u - 1.25) / 0.6) * out;
    if (orn > 0) {
      ctx.save();
      ctx.globalAlpha = orn;
      const y = TC.y + 128, hw = 230 * orn;
      const lg = ctx.createLinearGradient(TC.x - hw, 0, TC.x + hw, 0);
      lg.addColorStop(0, 'rgba(231,184,116,0)'); lg.addColorStop(0.5, 'rgba(231,184,116,0.9)'); lg.addColorStop(1, 'rgba(231,184,116,0)');
      ctx.fillStyle = lg; ctx.fillRect(TC.x - hw, y - 1, hw * 2, 2);
      ctx.translate(TC.x, y); ctx.fillStyle = '#e7b874';
      for (const a of [0, Math.PI / 4]) { ctx.save(); ctx.rotate(a); ctx.fillRect(-6, -6, 12, 12); ctx.restore(); }
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(0, 0, 2.6, 0, TAU); ctx.fill();
      ctx.restore();
    }
    // ذرات غبار في الضوء
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const m of MOTES) {
      const x = m[0] + 18 * Math.sin(u * 0.5 + m[2]), y = m[1] - u * 14 * m[3] + 8 * Math.cos(u * 0.7 + m[2]);
      const d = Math.hypot((x - TC.x) / 900, (y - TC.y) / 300);
      const a = Math.max(0, 1 - d) * (0.5 + 0.5 * Math.sin(u * 3 + m[2] * 5)) * sstep(0.3, 1.2, u) * out;
      if (a <= 0.01) continue;
      ctx.globalAlpha = 0.5 * a;
      const s = 4 + m[4] * 7;
      ctx.drawImage(DOT_WARM, x - s / 2, y - s / 2, s, s);
    }
    ctx.restore();
  }

  // ================================================================ POST
  const BLOOM = mk(W / 4, H / 4);
  function bloom(k) {
    const b = BLOOM.getContext('2d');
    b.globalCompositeOperation = 'source-over';
    b.filter = 'brightness(0.62) contrast(4) blur(5px)';
    b.clearRect(0, 0, W / 4, H / 4);
    b.drawImage(canvas, 0, 0, W / 4, H / 4);
    b.filter = 'none';
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = k;
    ctx.drawImage(BLOOM, 0, 0, W, H);
    ctx.restore();
  }
  function grade(desat, tint, tintA, lift) {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'saturation'; ctx.globalAlpha = desat; ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = tintA; ctx.fillStyle = tint; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 1; ctx.fillStyle = lift; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  const TMP = mk(W, H);
  function contrast(k) {
    const g = TMP.getContext('2d');
    g.globalCompositeOperation = 'copy'; g.drawImage(canvas, 0, 0);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'copy'; ctx.filter = `contrast(${k})`;
    ctx.drawImage(TMP, 0, 0);
    ctx.restore();
  }
  function vignette(k) {
    ctx.save();
    const gr = ctx.createRadialGradient(W / 2, H / 2, 380, W / 2, H / 2, 1150);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${k})`);
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  const GRAIN = (() => {
    const r = rng(999), tiles = [];
    for (let k = 0; k < 6; k++) {
      const c = mk(1024, 600), g = c.getContext('2d'), id = g.createImageData(1024, 600), d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = 128 + ((r() + r() + r() - 1.5) * 70);
        d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
      }
      g.putImageData(id, 0, 0); tiles.push(c);
    }
    return tiles;
  })();
  function grain(frame, k) {
    const r = rng(frame * 7919 + 13);
    ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = k;
    ctx.drawImage(GRAIN[frame % GRAIN.length], -r() * 64, -r() * 60, 2048, 1200);
    ctx.restore();
  }
  function textBlock(txt, x, y, font, color, alpha, shadow = 10) {
    if (alpha <= 0.002) return;
    ctx.save();
    ctx.direction = 'rtl'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = font; ctx.globalAlpha = alpha;
    ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = shadow;
    ctx.fillStyle = color; ctx.fillText(txt, x, y);
    ctx.restore();
  }
  const SUBS = [
    { t0: 1.75, t1: 4.25, text: 'من وأنا صغير، وأنا أحلم يكون لي مشروع خاص فيني…' },
    { t0: 4.95, t1: 7.15, text: 'شيء أبنيه بنفسي… وأفتخر فيه.' },
  ];
  function subtitles(t) {
    for (const s of SUBS) {
      const a = sstep(s.t0, s.t0 + 0.25, t) * (1 - sstep(s.t1 - 0.25, s.t1, t));
      textBlock(s.text, W / 2, H - BAR / 2 + 2, '400 40px Tajawal', '#ece8e1', a * 0.94, 0);
    }
  }

  // ================================================================ FRAME
  let ready = false;
  function draw(t, opts) {
    const frame = Math.round(t * FPS);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.filter = 'none';
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (t < T1) {
      shotA(t);
      bloom(0.5);
      grade(0.36, '#3d5d7c', 0.42, '#030609');
      contrast(1.1);
      vignette(0.62);
      textBlock('معسكر بُناة يقدّم', 560, 836, '300 36px Tajawal', '#efe6d6', sstep(0.6, 1.2, t) * (1 - sstep(2.3, 2.9, t)) * 0.92, 14);
    } else if (t < T2) {
      shotB(t);
      bloom(0.4);
      grade(0.2, '#41607c', 0.22, '#05080b');
      contrast(1.06);
      vignette(0.55);
    } else {
      shotC(t);
      bloom(0.7);
      vignette(0.4);
    }
    grain(frame, t < T2 ? 0.13 : 0.09);
    // فتح من السواد
    const fin = 1 - sstep(0, 0.75, t);
    if (fin > 0) { ctx.fillStyle = `rgba(0,0,0,${fin})`; ctx.fillRect(0, 0, W, H); }
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, BAR); ctx.fillRect(0, H - BAR, W, BAR);
    if (!opts || opts.subs !== false) subtitles(t);
  }

  // خط زمني للصوت (خطوات البطل والطلاب، نقاط القطع)
  function timeline() {
    const steps = [];
    for (const p of PEOPLE) {
      if (p.idle) continue;
      const fc = cadence(p);
      for (let k = 0; k < 40; k++) {
        const t = (0.25 + 0.5 * k - p.P0) / fc;
        if (t < 0) continue;
        if (t > T1) break;
        const st = personState(p, t);
        const x = W / 2 + (CAM.F / p.z) * (st.X - camX(t));
        if (x < -200 || x > W + 200) continue;
        steps.push({ t: +t.toFixed(4), z: p.z, pan: +clamp((x - W / 2) / (W / 2), -1, 1).toFixed(3), hero: !!p.hero, type: p.type });
      }
    }
    steps.sort((a, b) => a.t - b.t);
    return { fps: FPS, duration: DURATION, cuts: [T1, T2], pageFlip: [4.72, 5.34], sketch: [5.42, 6.6], glow: 6.15, barcode: 9.62, steps, subtitles: SUBS };
  }

  async function init() {
    const faces = [
      new FontFace('Amiri', 'url(fonts/Amiri-Bold.ttf)', { weight: '700' }),
      new FontFace('Tajawal', 'url(fonts/Tajawal-Regular.ttf)', { weight: '400' }),
      new FontFace('Tajawal', 'url(fonts/Tajawal-Light.ttf)', { weight: '300' }),
    ];
    for (const f of faces) { await f.load(); document.fonts.add(f); }
    await document.fonts.ready;
    buildWall(); buildNotebook(); buildTitle();
    ready = true;
    window.SCENE = {
      FPS, FRAMES, DURATION, W, H,
      renderFrame: (i, opts) => draw(i / FPS, opts),
      renderSubs: (i) => subtitles(i / FPS),
      timeline,
    };
    window.sceneReady = true;
    if (!RENDER) {
      let start = performance.now();
      canvas.addEventListener('click', () => { start = performance.now(); });
      const loop = (now) => {
        const t = ((now - start) / 1000) % DURATION;
        draw(t, { subs: true });
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
  }
  init().catch((e) => { window.sceneError = String(e && e.stack || e); console.error(e); });
})();
