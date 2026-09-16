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
        case 'KeyF': a.fullscreen(); break;
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
}
