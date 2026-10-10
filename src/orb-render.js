// Orbe 3.0 — dibujo del orbe "edición Claude": esfera de vidrio negro con aureola flotante.
// Todo se dibuja en un <canvas> (sin imágenes), en alta resolución.
// API: OrbRender.draw(ctx, cssW, cssH, s)  donde s = estado de animación (ver defaultState()).
(function () {
  const OR = '255,122,40';      // naranja de la aureola y el iris
  const HOT = '255,214,160';    // centro "incandescente"

  function defaultState() {
    return {
      t: 0,              // tiempo en segundos (para la flotación)
      cx: 0, cy: 0, r: 40, // centro y radio de la esfera
      lookX: 0, lookY: 0,  // -1..1 hacia dónde mira el ojo
      lid: 0,            // 0 abierto .. 1 cerrado (párpado)
      eye: 'open',       // 'open' | 'heart' | 'wide' | 'happy'
      blush: 0,          // 0..1
      halo: 1,           // intensidad de la aureola 0..1.5
      haloSpin: 0,       // giro de la aureola (para "pensando")
      haloDash: false,   // aureola punteada (sin ventana fijada)
      scaleX: 1, scaleY: 1, rot: 0, dy: 0,
    };
  }

  function glowStroke(ctx, path, color, width, blur, alpha) {
    ctx.save();
    ctx.shadowColor = `rgba(${color},${alpha})`; ctx.shadowBlur = blur;
    ctx.strokeStyle = `rgba(${color},${alpha})`; ctx.lineWidth = width;
    path(); ctx.stroke();
    ctx.restore();
  }

  function drawHalo(ctx, s, front) {
    const { cx, cy, r } = s;
    const bob = Math.sin(s.t * 2.1 + 0.9) * r * 0.05;
    const hy = cy - r * 1.42 + bob, rx = r * 0.78, ry = r * 0.17;
    const a = Math.min(1.5, s.halo);
    // la aureola tiene parte de atrás y de adelante: se dibuja en dos mitades
    const start = front ? 0 : Math.PI, end = front ? Math.PI : Math.PI * 2;
    const path = () => { ctx.beginPath(); ctx.ellipse(cx, hy, rx, ry, 0, start, end); };
    ctx.save();
    if (s.haloDash) ctx.setLineDash([r * 0.12, r * 0.1]);
    if (s.haloSpin) ctx.lineDashOffset = -s.haloSpin * r;
    glowStroke(ctx, path, OR, r * 0.11, r * 0.55, 0.55 * a);
    glowStroke(ctx, path, OR, r * 0.075, r * 0.2, 0.95 * a);
    glowStroke(ctx, path, HOT, r * 0.03, r * 0.05, 1 * Math.min(1, a));
    ctx.restore();
    return hy;
  }

  // reflejo de ciudad (luces cálidas) dentro de la mitad inferior de la esfera
  const LIGHTS = Array.from({ length: 45 }, (_, i) => {
    const k = Math.sin(i * 12.9898) * 43758.5453; const f = k - Math.floor(k);
    const k2 = Math.sin(i * 78.233) * 12345.678; const g = k2 - Math.floor(k2);
    return { x: f * 2 - 1, y: 0.42 + g * 0.55, s: 0.008 + ((f * 7) % 1) * 0.018, w: (g * 13) % 1 };
  });

  function drawSphere(ctx, s) {
    const { cx, cy, r } = s;
    // sombra/brillo ambiental bajo la esfera
    ctx.save();
    const sh = ctx.createRadialGradient(cx, cy + r * 1.15, 0, cx, cy + r * 1.15, r * 0.9);
    sh.addColorStop(0, 'rgba(0,0,0,0.18)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sh; ctx.beginPath(); ctx.ellipse(cx, cy + r * 1.15, r * 0.9, r * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // cuerpo de vidrio negro
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    const body = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.45, r * 0.1, cx, cy, r * 1.05);
    body.addColorStop(0, '#2b2d36'); body.addColorStop(0.45, '#0b0c11'); body.addColorStop(1, '#020203');
    ctx.fillStyle = body; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    // cielo azul reflejado arriba
    const sky = ctx.createLinearGradient(0, cy - r, 0, cy + r * 0.2);
    sky.addColorStop(0, 'rgba(70,100,140,0.35)'); sky.addColorStop(1, 'rgba(70,100,140,0)');
    ctx.fillStyle = sky; ctx.fillRect(cx - r, cy - r, r * 2, r * 1.2);
    // luces de ciudad reflejadas (curvadas por la esfera)
    for (const L of LIGHTS) {
      const px = cx + L.x * r * 0.95 * Math.sqrt(1 - Math.min(1, L.y * L.y) * 0.6);
      const py = cy + L.y * r;
      if (Math.hypot(px - cx, py - cy) > r * 0.97) continue;
      const tw = 0.55 + 0.45 * Math.sin(s.t * 1.7 + L.w * 20);
      ctx.fillStyle = `rgba(255,${180 + (L.w * 60) | 0},${90 + (L.w * 80) | 0},${0.55 * tw})`;
      ctx.beginPath(); ctx.arc(px, py, Math.max(0.6, r * L.s), 0, Math.PI * 2); ctx.fill();
    }
    // reflejo naranja de la aureola sobre la parte de arriba de la esfera
    ctx.save();
    ctx.shadowColor = `rgba(${OR},0.9)`; ctx.shadowBlur = r * 0.15;
    ctx.strokeStyle = `rgba(${OR},${0.75 * Math.min(1, s.halo)})`; ctx.lineWidth = r * 0.045;
    ctx.beginPath(); ctx.ellipse(cx, cy - r * 0.82, r * 0.5, r * 0.11, 0, Math.PI * 1.05, Math.PI * 1.95, false);
    ctx.ellipse(cx, cy - r * 0.82, r * 0.5, r * 0.11, 0, Math.PI * 0.05, Math.PI * 0.95, false);
    ctx.stroke();
    ctx.restore();
    ctx.restore();

    // borde de luz (rim) frío
    ctx.save();
    const rim = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    rim.addColorStop(0, 'rgba(210,230,255,0.85)'); rim.addColorStop(0.5, 'rgba(160,190,230,0.25)'); rim.addColorStop(1, 'rgba(210,230,255,0.7)');
    ctx.strokeStyle = rim; ctx.lineWidth = Math.max(1, r * 0.035);
    ctx.beginPath(); ctx.arc(cx, cy, r - r * 0.02, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function drawHighlights(ctx, s) {
    const { cx, cy, r } = s;
    ctx.save();
    // gran brillo especular arriba-izquierda
    const hx = cx - r * 0.55, hy = cy - r * 0.42;
    ctx.translate(hx, hy); ctx.rotate(-0.6);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.2);
    g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.6, 'rgba(255,255,255,0.75)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, r * 0.2, r * 0.13, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // brillo chico a la derecha
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.ellipse(cx + r * 0.72, cy - r * 0.38, r * 0.05, r * 0.1, 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawEye(ctx, s) {
    const { cx, cy, r } = s;
    // el ojo se desplaza y se achata hacia donde mira (como si la esfera girara)
    const lx = Math.max(-1, Math.min(1, s.lookX)), ly = Math.max(-1, Math.min(1, s.lookY));
    const wide = s.eye === 'wide' ? 1.12 : 1;
    const ex = cx + lx * r * 0.32, ey = cy + r * 0.1 + ly * r * 0.2;
    const ew = r * 0.74 * (1 - Math.abs(lx) * 0.25) * wide, eh = r * 0.5 * (1 - Math.abs(ly) * 0.15) * wide;

    if (s.eye === 'happy') {          // ojo feliz: arco
      glowStroke(ctx, () => { ctx.beginPath(); ctx.ellipse(ex, ey + eh * 0.3, ew * 0.8, eh * 0.8, 0, Math.PI * 1.1, Math.PI * 1.9); }, OR, r * 0.1, r * 0.3, 0.9);
      glowStroke(ctx, () => { ctx.beginPath(); ctx.ellipse(ex, ey + eh * 0.3, ew * 0.8, eh * 0.8, 0, Math.PI * 1.1, Math.PI * 1.9); }, '255,250,240', r * 0.05, r * 0.05, 1);
      return;
    }
    const open = 1 - Math.max(0, Math.min(1, s.lid));
    ctx.save();
    // anillo naranja incandescente (iris externo)
    const ringPath = () => { ctx.beginPath(); ctx.ellipse(ex, ey, ew, eh, 0, 0, Math.PI * 2); };
    ctx.save(); ctx.shadowColor = `rgba(${OR},0.95)`; ctx.shadowBlur = r * 0.35;
    ctx.fillStyle = `rgba(${OR},1)`; ringPath(); ctx.fill(); ctx.restore();
    // esclerótica blanca luminosa
    const sg = ctx.createRadialGradient(ex - ew * 0.2, ey - eh * 0.3, 0, ex, ey, ew);
    sg.addColorStop(0, '#ffffff'); sg.addColorStop(0.7, '#fff6ea'); sg.addColorStop(1, '#ffd9b0');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.ellipse(ex, ey, ew * 0.9, eh * 0.86, 0, 0, Math.PI * 2); ctx.fill();

    if (s.eye === 'heart') {
      const hs = eh * 0.75;
      ctx.fillStyle = '#ff3d6e'; ctx.shadowColor = 'rgba(255,61,110,0.8)'; ctx.shadowBlur = r * 0.2;
      ctx.beginPath(); ctx.moveTo(ex, ey + hs * 0.9);
      ctx.bezierCurveTo(ex - hs * 1.5, ey + hs * 0.1, ex - hs * 0.8, ey - hs * 1.05, ex, ey - hs * 0.35);
      ctx.bezierCurveTo(ex + hs * 0.8, ey - hs * 1.05, ex + hs * 1.5, ey + hs * 0.1, ex, ey + hs * 0.9);
      ctx.fill();
    } else {
      // pupila negra grande con la ciudad reflejada
      const px = ex + lx * ew * 0.28, py = ey + ly * eh * 0.22, pr = eh * (s.eye === 'wide' ? 0.45 : 0.6);
      ctx.save();
      ctx.beginPath(); ctx.ellipse(px, py, pr * (1 - Math.abs(lx) * 0.15), pr, 0, 0, Math.PI * 2); ctx.clip();
      const pg = ctx.createLinearGradient(0, py - pr, 0, py + pr);
      pg.addColorStop(0, '#0a0d14'); pg.addColorStop(0.55, '#06070b'); pg.addColorStop(1, '#1b1408');
      ctx.fillStyle = pg; ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
      for (let i = 0; i < 14; i++) {
        const k = (Math.sin(i * 91.7) * 1000) % 1, xx = px + (((i * 0.37) % 1) * 2 - 1) * pr * 0.8, yy = py + pr * (0.25 + Math.abs(k) * 0.6);
        ctx.fillStyle = `rgba(255,200,120,${0.5 + 0.4 * Math.sin(s.t * 2 + i)})`;
        ctx.fillRect(xx, yy, Math.max(0.8, pr * 0.07), Math.max(0.8, pr * 0.07));
      }
      ctx.restore();
      // pequeño brillo en la pupila
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.ellipse(px - pr * 0.4, py - pr * 0.45, pr * 0.14, pr * 0.1, -0.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // párpado: el vidrio negro baja desde arriba y tapa el ojo
    if (open < 0.98) {
      const ly2 = ey - eh * 1.15 + 2.3 * eh * (1 - open);
      ctx.save();
      ctx.beginPath(); ctx.ellipse(ex, ey, ew * 1.12, eh * 1.15, 0, 0, Math.PI * 2); ctx.clip();
      const lg = ctx.createLinearGradient(0, ey - eh, 0, ly2);
      lg.addColorStop(0, '#0b0c11'); lg.addColorStop(1, '#14161d');
      ctx.fillStyle = lg; ctx.fillRect(ex - ew * 1.2, ey - eh * 1.3, ew * 2.4, ly2 - (ey - eh * 1.3));
      ctx.strokeStyle = `rgba(${OR},0.95)`; ctx.lineWidth = r * 0.045; ctx.shadowColor = `rgba(${OR},0.9)`; ctx.shadowBlur = r * 0.18;
      ctx.beginPath(); ctx.moveTo(ex - ew * 1.2, ly2); ctx.quadraticCurveTo(ex, ly2 + eh * 0.25, ex + ew * 1.2, ly2); ctx.stroke();
      ctx.restore();
    }
  }

  function drawBlush(ctx, s) {
    if (!s.blush) return;
    const { cx, cy, r } = s;
    for (const sx of [-1, 1]) {
      const g = ctx.createRadialGradient(cx + sx * r * 0.55, cy + r * 0.55, 0, cx + sx * r * 0.55, cy + r * 0.55, r * 0.22);
      g.addColorStop(0, `rgba(255,90,90,${0.55 * s.blush})`); g.addColorStop(1, 'rgba(255,90,90,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx + sx * r * 0.55, cy + r * 0.55, r * 0.22, 0, Math.PI * 2); ctx.fill();
    }
  }

  function draw(ctx, w, h, s) {
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    // flotación suave + transformaciones de las reacciones
    const float = Math.sin(s.t * 1.6) * s.r * 0.06;
    ctx.translate(s.cx, s.cy + float + s.dy); ctx.rotate(s.rot); ctx.scale(s.scaleX, s.scaleY); ctx.translate(-s.cx, -s.cy);
    drawHalo(ctx, s, false);   // mitad de atrás de la aureola
    drawSphere(ctx, s);
    drawEye(ctx, s);
    drawBlush(ctx, s);
    drawHighlights(ctx, s);
    drawHalo(ctx, s, true);    // mitad de adelante
    ctx.restore();
  }

  window.OrbRender = { draw, defaultState };
})();
