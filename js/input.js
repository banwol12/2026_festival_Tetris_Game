'use strict';

// Normalise a keyboard event to a KeyboardEvent.code-style id. `code` is
// layout independent (works with Korean IME on), but some environments leave
// it empty, so fall back to `key` / `keyCode`.
function keyId(e) {
  if (e.code) return e.code;
  const k = e.key || '';
  const kc = e.keyCode || 0;
  if (k === ' ' || kc === 32) return 'Space';
  if (k === 'Control') return 'ControlLeft';
  if (k === 'Shift') return 'ShiftLeft';
  if (/^[a-z]$/i.test(k)) return 'Key' + k.toUpperCase();
  if (k) return k;
  const byCode = { 13: 'Enter', 27: 'Escape', 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown', 16: 'ShiftLeft', 17: 'ControlLeft' };
  if (byCode[kc]) return byCode[kc];
  if (kc >= 65 && kc <= 90) return 'Key' + String.fromCharCode(kc);
  return '';
}

class Input {
  constructor(game, actions) {
    this.game = game;
    this.actions = actions;
    this.das = { dir: 0, timer: 0, arr: 0 };
    this.held = { '-1': false, '1': false };
    this.bindKeyboard();
  }

  // ---- keyboard -------------------------------------------------------------
  bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const k = keyId(e);
      if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Space'].includes(k)) e.preventDefault();
      if (e.repeat) return;
      const g = this.game;
      const a = this.actions;
      switch (k) {
        case 'ArrowLeft':
          if (g.state === 'idle') a.levelDelta(-1); else this.press(-1);
          break;
        case 'ArrowRight':
          if (g.state === 'idle') a.levelDelta(1); else this.press(1);
          break;
        case 'ArrowDown': g.setSoftDrop(true); break;
        case 'ArrowUp': case 'KeyX': g.rotate(1); break;
        case 'KeyZ': case 'ControlLeft': case 'ControlRight': g.rotate(-1); break;
        case 'Space': g.hardDrop(); break;
        case 'KeyC': case 'ShiftLeft': case 'ShiftRight': g.holdPiece(); break;
        case 'KeyP': case 'Escape': a.pause(); break;
        case 'Enter': a.enter(); break;
        case 'KeyR': a.restart(); break;
        case 'KeyM': a.mute(); break;
        default: break;
      }
    });

    window.addEventListener('keyup', (e) => {
      switch (keyId(e)) {
        case 'ArrowLeft': this.release(-1); break;
        case 'ArrowRight': this.release(1); break;
        case 'ArrowDown': this.game.setSoftDrop(false); break;
        default: break;
      }
    });

    window.addEventListener('blur', () => {
      this.das.dir = 0;
      this.held['-1'] = this.held['1'] = false;
      this.game.setSoftDrop(false);
      if (this.actions.blur) this.actions.blur();
    });
  }

  press(dir) {
    this.held[String(dir)] = true;
    this.das.dir = dir;
    this.das.timer = 0;
    this.das.arr = 0;
    this.game.move(dir);
  }

  release(dir) {
    this.held[String(dir)] = false;
    if (this.das.dir !== dir) return;
    const other = -dir;
    if (this.held[String(other)]) this.press(other);
    else this.das.dir = 0;
  }

  update(dt) {
    if (this.das.dir === 0) return;
    this.das.timer += dt;
    if (this.das.timer < CFG.DAS) return;
    this.das.arr += dt;
    while (this.das.arr >= CFG.ARR) {
      this.das.arr -= CFG.ARR;
      if (!this.game.move(this.das.dir)) {
        this.das.arr = 0;
        break;
      }
    }
  }

  // ---- on-screen buttons ----------------------------------------------------
  bindButtons(container) {
    container.querySelectorAll('[data-action]').forEach((btn) => {
      const action = btn.dataset.action;
      let active = false;
      const down = (e) => {
        e.preventDefault();
        if (active) return;
        active = true;
        try { btn.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        btn.classList.add('pressed');
        this.touchAction(action, true);
      };
      const up = (e) => {
        e.preventDefault();
        if (!active) return;
        active = false;
        btn.classList.remove('pressed');
        this.touchAction(action, false);
      };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }

  touchAction(action, down) {
    const g = this.game;
    const a = this.actions;
    switch (action) {
      case 'left': down ? this.press(-1) : this.release(-1); break;
      case 'right': down ? this.press(1) : this.release(1); break;
      case 'down': g.setSoftDrop(down); break;
      case 'cw': if (down) g.rotate(1); break;
      case 'ccw': if (down) g.rotate(-1); break;
      case 'hard': if (down) g.hardDrop(); break;
      case 'hold': if (down) g.holdPiece(); break;
      case 'pause': if (down) a.pause(); break;
      default: break;
    }
  }

  // ---- swipe / tap gestures on the board -----------------------------------
  bindGestures(el, getCell) {
    let start = null;
    let movedCells = 0;
    let movedRows = 0;
    let moved = false;

    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      if (!this.game.active) return;
      start = { x: e.clientX, y: e.clientY, t: performance.now() };
      movedCells = 0;
      movedRows = 0;
      moved = false;
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    });

    el.addEventListener('pointermove', (e) => {
      if (!start) return;
      const cell = getCell();
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const cx = Math.trunc(dx / cell);
      while (movedCells < cx) { this.game.move(1); movedCells++; moved = true; }
      while (movedCells > cx) { this.game.move(-1); movedCells--; moved = true; }
      const ry = Math.trunc(dy / (cell * 0.9));
      if (ry > movedRows && Math.abs(dx) < cell * 1.5) {
        for (; movedRows < ry; movedRows++) this.game.softDropStep();
        moved = true;
      }
    });

    const end = (e) => {
      if (!start) return;
      const cell = getCell();
      const dt = performance.now() - start.t;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!moved && dt < 300 && Math.hypot(dx, dy) < 10) {
        this.game.rotate(1);
      } else if (dy > cell * 2 && dt < 260 && Math.abs(dx) < Math.abs(dy)) {
        this.game.hardDrop();
      } else if (dy < -cell * 2 && dt < 300 && Math.abs(dx) < Math.abs(dy)) {
        this.game.holdPiece();
      }
      start = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
}
