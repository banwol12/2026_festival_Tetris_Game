'use strict';

class Renderer {
  constructor(game, boardCanvas, holdCanvas, nextCanvas) {
    this.game = game;
    this.canvas = boardCanvas;
    this.ctx = boardCanvas.getContext('2d');
    this.holdCanvas = holdCanvas;
    this.holdCtx = holdCanvas.getContext('2d');
    this.nextCanvas = nextCanvas;
    this.nextCtx = nextCanvas.getContext('2d');
    this.cell = 30;
    this.pcell = 20;
    this.dpr = 1;
    this.flash = 0;
    this.previewKey = null;
    this.sizes = {};
  }

  resize(cell, pcell) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.cell = cell;
    this.pcell = pcell;
    this.sizes.board = this.setup(this.canvas, this.ctx, cell * CFG.COLS, cell * CFG.ROWS);
    this.sizes.hold = this.setup(this.holdCanvas, this.holdCtx, pcell * 5, pcell * 3);
    this.sizes.next = this.setup(this.nextCanvas, this.nextCtx, pcell * 5, pcell * (3 * CFG.NEXT_COUNT));
    this.previewKey = null;
  }

  setup(canvas, ctx, w, h) {
    canvas.width = Math.round(w * this.dpr);
    canvas.height = Math.round(h * this.dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    return { w, h };
  }

  // ---- primitives -----------------------------------------------------------
  drawCell(ctx, x, y, s, type, alpha = 1) {
    const inset = Math.max(1, Math.round(s * 0.06));
    const bevel = Math.max(1, Math.round(s * 0.14));
    const inner = s - inset * 2;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = COLORS[type];
    ctx.fillRect(x + inset, y + inset, inner, inner);
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.fillRect(x + inset, y + inset, inner, bevel);
    ctx.fillRect(x + inset, y + inset, bevel, inner);
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fillRect(x + inset, y + s - inset - bevel, inner, bevel);
    ctx.fillRect(x + s - inset - bevel, y + inset, bevel, inner);
    ctx.globalAlpha = 1;
  }

  drawGhost(ctx, x, y, s, type) {
    const inset = Math.max(1, Math.round(s * 0.06));
    const lw = Math.max(1, s * 0.07);
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = COLORS[type];
    ctx.fillRect(x + inset, y + inset, s - inset * 2, s - inset * 2);
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = COLORS[type];
    ctx.lineWidth = lw;
    ctx.strokeRect(x + inset + lw / 2, y + inset + lw / 2, s - inset * 2 - lw, s - inset * 2 - lw);
    ctx.globalAlpha = 1;
  }

  drawPiece(ctx, m, x, y, s, type, ghost, alpha = 1) {
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m[r].length; c++) {
        if (!m[r][c]) continue;
        const vy = y + r - CFG.HIDDEN;
        if (vy < 0) continue;
        if (ghost) this.drawGhost(ctx, (x + c) * s, vy * s, s, type);
        else this.drawCell(ctx, (x + c) * s, vy * s, s, type, alpha);
      }
    }
  }

  // ---- board ----------------------------------------------------------------
  draw(dt) {
    const ctx = this.ctx;
    const s = this.cell;
    const g = this.game;
    const W = s * CFG.COLS;
    const H = s * CFG.ROWS;

    ctx.fillStyle = '#08090f';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 1; c < CFG.COLS; c++) {
      ctx.moveTo(c * s + 0.5, 0);
      ctx.lineTo(c * s + 0.5, H);
    }
    for (let r = 1; r < CFG.ROWS; r++) {
      ctx.moveTo(0, r * s + 0.5);
      ctx.lineTo(W, r * s + 0.5);
    }
    ctx.stroke();

    const clearingRows = g.clearing ? new Set(g.clearing.rows) : null;
    const prog = g.clearing ? Math.min(1, g.clearing.t / CFG.CLEAR_MS) : 0;
    for (let r = CFG.HIDDEN; r < g.board.length; r++) {
      const vy = r - CFG.HIDDEN;
      for (let c = 0; c < CFG.COLS; c++) {
        const t = g.board[r][c];
        if (!t) continue;
        if (clearingRows && clearingRows.has(r)) {
          const shrink = s * prog * 0.5;
          this.drawCell(ctx, c * s, vy * s, s, t, 1 - prog);
          ctx.fillStyle = `rgba(255,255,255,${0.9 * (1 - prog)})`;
          ctx.fillRect(c * s + shrink, vy * s + shrink, s - shrink * 2, s - shrink * 2);
        } else {
          this.drawCell(ctx, c * s, vy * s, s, t);
        }
      }
    }

    if (g.piece && (g.state === 'playing' || g.state === 'paused')) {
      const p = g.piece;
      const gy = g.ghostY();
      if (gy !== p.y) this.drawPiece(ctx, p.matrix, p.x, gy, s, p.type, true);
      const grounded = gy === p.y;
      const alpha = grounded ? 1 - 0.35 * Math.min(1, g.lockTimer / g.lockDelay) : 1;
      this.drawPiece(ctx, p.matrix, p.x, p.y, s, p.type, false, alpha);
    }

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash * 0.35})`;
      ctx.fillRect(0, 0, W, H);
      this.flash = Math.max(0, this.flash - dt / 220);
    }
  }

  // ---- hold / next ----------------------------------------------------------
  drawPreviews() {
    const g = this.game;
    const key = `${g.hold || '-'}|${g.queue.join('')}|${g.canHold ? 1 : 0}|${this.pcell}`;
    if (key === this.previewKey) return;
    this.previewKey = key;

    const pc = this.pcell;
    const hc = this.holdCtx;
    hc.clearRect(0, 0, this.sizes.hold.w, this.sizes.hold.h);
    if (g.hold) this.drawMini(hc, g.hold, pc * 2.5, pc * 1.5, pc, g.canHold ? 1 : 0.35);

    const nc = this.nextCtx;
    nc.clearRect(0, 0, this.sizes.next.w, this.sizes.next.h);
    for (let i = 0; i < CFG.NEXT_COUNT; i++) {
      const t = g.queue[i];
      if (!t) continue;
      this.drawMini(nc, t, pc * 2.5, pc * (1.5 + 3 * i), pc, i === 0 ? 1 : 0.8);
    }
  }

  drawMini(ctx, type, cx, cy, s, alpha) {
    const m = SHAPES[type];
    let minR = 9, maxR = -1, minC = 9, maxC = -1;
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m[r].length; c++) {
        if (!m[r][c]) continue;
        minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        minC = Math.min(minC, c); maxC = Math.max(maxC, c);
      }
    }
    const w = (maxC - minC + 1) * s;
    const h = (maxR - minR + 1) * s;
    const ox = cx - w / 2 - minC * s;
    const oy = cy - h / 2 - minR * s;
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        if (m[r][c]) this.drawCell(ctx, ox + c * s, oy + r * s, s, type, alpha);
      }
    }
  }
}
