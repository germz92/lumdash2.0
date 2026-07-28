/**
 * Shared drawing overlay for video review comments.
 * Coords are stored normalized (0–1) relative to the player box.
 */
(function (global) {
  'use strict';

  function createOverlay(wrapEl) {
    if (!wrapEl) return null;

    let canvas = wrapEl.querySelector('.pa-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'pa-canvas';
      wrapEl.appendChild(canvas);
    }

    const ctx = canvas.getContext('2d');
    let mode = 'off'; // off | pen | arrow | view
    let strokes = [];
    let arrows = [];
    let drawing = false;
    let currentStroke = null;
    let arrowStart = null;
    let viewOnly = false;
    let resizeObs = null;

    function sizeCanvas() {
      const rect = wrapEl.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    }

    function normFromEvent(e) {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / Math.max(1, rect.width);
      const y = (e.clientY - rect.top) / Math.max(1, rect.height);
      return {
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y))
      };
    }

    function toPx(p) {
      return {
        x: p.x * canvas.clientWidth,
        y: p.y * canvas.clientHeight
      };
    }

    function drawArrowHead(from, to, color, width) {
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const head = 10 + width * 2;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(to.x - head * Math.cos(angle - 0.4), to.y - head * Math.sin(angle - 0.4));
      ctx.lineTo(to.x - head * Math.cos(angle + 0.4), to.y - head * Math.sin(angle + 0.4));
      ctx.closePath();
      ctx.fill();
    }

    function redraw(preview) {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      for (const s of strokes) {
        if (!s.points || s.points.length < 2) continue;
        ctx.strokeStyle = s.color || '#FF3B30';
        ctx.lineWidth = s.width || 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        const first = toPx(s.points[0]);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < s.points.length; i++) {
          const p = toPx(s.points[i]);
          ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }

      for (const a of arrows) {
        if (!a.from || !a.to) continue;
        const from = toPx(a.from);
        const to = toPx(a.to);
        ctx.strokeStyle = a.color || '#FF3B30';
        ctx.lineWidth = a.width || 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        drawArrowHead(from, to, a.color || '#FF3B30', a.width || 3);
      }

      if (preview && preview.points && preview.points.length > 1) {
        ctx.strokeStyle = preview.color || '#FF3B30';
        ctx.lineWidth = preview.width || 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        const first = toPx(preview.points[0]);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < preview.points.length; i++) {
          const p = toPx(preview.points[i]);
          ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }

      if (preview && preview.from && preview.to) {
        const from = toPx(preview.from);
        const to = toPx(preview.to);
        ctx.strokeStyle = preview.color || '#FF3B30';
        ctx.lineWidth = preview.width || 3;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        drawArrowHead(from, to, preview.color || '#FF3B30', preview.width || 3);
      }
    }

    function onPointerDown(e) {
      if (viewOnly || mode === 'off' || mode === 'view') return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const p = normFromEvent(e);
      drawing = true;
      if (mode === 'pen') {
        currentStroke = { color: '#FF3B30', width: 3, points: [p] };
      } else if (mode === 'arrow') {
        arrowStart = p;
      }
    }

    function onPointerMove(e) {
      if (!drawing) return;
      e.preventDefault();
      const p = normFromEvent(e);
      if (mode === 'pen' && currentStroke) {
        currentStroke.points.push(p);
        redraw(currentStroke);
      } else if (mode === 'arrow' && arrowStart) {
        redraw({ from: arrowStart, to: p, color: '#FF3B30', width: 3 });
      }
    }

    function onPointerUp(e) {
      if (!drawing) return;
      drawing = false;
      const p = normFromEvent(e);
      if (mode === 'pen' && currentStroke) {
        currentStroke.points.push(p);
        if (currentStroke.points.length >= 2) strokes.push(currentStroke);
        currentStroke = null;
        redraw();
      } else if (mode === 'arrow' && arrowStart) {
        arrows.push({ color: '#FF3B30', width: 3, from: arrowStart, to: p });
        arrowStart = null;
        redraw();
      }
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    sizeCanvas();
    if (typeof ResizeObserver !== 'undefined') {
      resizeObs = new ResizeObserver(() => sizeCanvas());
      resizeObs.observe(wrapEl);
    }

    function setMode(next) {
      mode = next || 'off';
      viewOnly = mode === 'view' || mode === 'off';
      canvas.classList.toggle('pa-active', mode === 'pen' || mode === 'arrow');
      canvas.classList.toggle('pa-view', mode === 'view');
      canvas.style.pointerEvents = (mode === 'pen' || mode === 'arrow') ? 'auto' : 'none';
    }

    function getData() {
      if (!strokes.length && !arrows.length) return null;
      return { strokes: strokes.map(s => ({ ...s, points: s.points.slice() })), arrows: arrows.slice() };
    }

    function setData(data) {
      strokes = Array.isArray(data?.strokes) ? data.strokes.map(s => ({
        color: s.color || '#FF3B30',
        width: s.width || 3,
        points: (s.points || []).slice()
      })) : [];
      arrows = Array.isArray(data?.arrows) ? data.arrows.map(a => ({
        color: a.color || '#FF3B30',
        width: a.width || 3,
        from: a.from ? { ...a.from } : null,
        to: a.to ? { ...a.to } : null
      })) : [];
      redraw();
    }

    function clear() {
      strokes = [];
      arrows = [];
      currentStroke = null;
      arrowStart = null;
      redraw();
    }

    function destroy() {
      if (resizeObs) resizeObs.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.remove();
    }

    setMode('off');

    return { canvas, setMode, getData, setData, clear, destroy, redraw: () => redraw(), sizeCanvas };
  }

  function hasAnnotation(data) {
    return !!(data && ((data.strokes && data.strokes.length) || (data.arrows && data.arrows.length)));
  }

  global.PortalAnnotate = { createOverlay, hasAnnotation };
})(typeof window !== 'undefined' ? window : globalThis);
