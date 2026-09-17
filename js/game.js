'use strict';

function rotateCW(m) {
  return m[0].map((_, c) => m.map((row) => row[c]).reverse());
}

function rotateCCW(m) {
  return m[0].map((_, c) => m.map((row) => row[row.length - 1 - c]));
}

class Game {
  constructor() {
    this.listeners = {};
    this.startLevel = 1;
    this.reset();
  }

  on(evt, fn) {
    (this.listeners[evt] = this.listeners[evt] || []).push(fn);
  }

  emit(evt, data) {
    (this.listeners[evt] || []).forEach((fn) => fn(data));
  }

  reset() {
    const total = CFG.ROWS + CFG.HIDDEN;
    this.board = Array.from({ length: total }, () => Array(CFG.COLS).fill(null));
    this.bag = [];
    this.queue = [];
    this.hold = null;
    this.canHold = true;
    this.piece = null;
    this.score = 0;
    this.lines = 0;
    this.level = this.startLevel;
    this.combo = -1;
    this.b2b = false;
    this.state = 'idle'; // idle | playing | paused | over
    this.gravityAcc = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.lowestY = -1;
    this.softDrop = false;
    this.lastRotated = false;
    this.clearing = null; // { rows: number[], t: ms }
    this.stats = { pieces: 0, tetris: 0, tspin: 0, maxCombo: 0, time: 0 };
    while (this.queue.length < CFG.NEXT_COUNT) this.queue.push(this.nextFromBag());
  }

  start(level) {
    this.startLevel = Math.max(1, level || 1);
    this.reset();
    this.state = 'playing';
    this.spawn();
    this.emit('start');
  }

  // ---- piece generation (7-bag) -------------------------------------------
  nextFromBag() {
    if (this.bag.length === 0) {
      this.bag = TYPES.slice();
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
    }
    return this.bag.pop();
  }

  makePiece(type) {
    const matrix = SHAPES[type].map((r) => r.slice());
    let top = 0;
    while (top < matrix.length && matrix[top].every((v) => !v)) top++;
    return {
      type,
      matrix,
      rot: 0,
      x: Math.floor((CFG.COLS - matrix[0].length) / 2),
      y: CFG.HIDDEN - top, // spawn fully visible at the top of the board
    };
  }

  spawn() {
    const type = this.queue.shift();
    this.queue.push(this.nextFromBag());
    this.spawnPiece(this.makePiece(type));
  }

  spawnPiece(p) {
    this.piece = p;
    this.gravityAcc = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.lowestY = p.y;
    this.lastRotated = false;
    this.lastKickIndex = -1;
    if (this.collides(p.matrix, p.x, p.y)) {
      if (!this.collides(p.matrix, p.x, p.y - 1)) {
        p.y -= 1;
      } else {
        this.gameOver();
        return;
      }
    }
    this.emit('spawn', p);
  }

  // ---- collision ------------------------------------------------------------
  collides(matrix, x, y) {
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix[r].length; c++) {
        if (!matrix[r][c]) continue;
        const bx = x + c;
        const by = y + r;
        if (bx < 0 || bx >= CFG.COLS || by < 0 || by >= this.board.length) return true;
        if (this.board[by][bx]) return true;
      }
    }
    return false;
  }

  isGrounded() {
    const p = this.piece;
    return this.collides(p.matrix, p.x, p.y + 1);
  }

  ghostY() {
    const p = this.piece;
    let y = p.y;
    while (!this.collides(p.matrix, p.x, y + 1)) y++;
    return y;
  }

  get active() {
    return this.state === 'playing' && this.piece && !this.clearing;
  }

  onMoved(rotated) {
    this.lastRotated = rotated;
    if (this.isGrounded() && this.lockResets < CFG.MAX_LOCK_RESETS) {
      this.lockTimer = 0;
      this.lockResets++;
    }
  }

  checkLowest() {
    if (this.piece.y > this.lowestY) {
      this.lowestY = this.piece.y;
      this.lockTimer = 0;
      this.lockResets = 0;
    }
  }

  // ---- player actions -------------------------------------------------------
  move(dx) {
    if (!this.active) return false;
    const p = this.piece;
    if (this.collides(p.matrix, p.x + dx, p.y)) return false;
    p.x += dx;
    this.lastKickIndex = -1;
    this.onMoved(false);
    this.emit('move');
    return true;
  }

  rotate(dir) {
    if (!this.active) return false;
    const p = this.piece;
    if (p.type === 'O') {
      this.emit('rotate');
      return true;
    }
    const from = p.rot;
    const to = (p.rot + dir + 4) % 4;
    const m = dir === 1 ? rotateCW(p.matrix) : rotateCCW(p.matrix);
    const table = (p.type === 'I' ? KICKS.I : KICKS.JLSTZ)[`${from}${to}`];
    for (let i = 0; i < table.length; i++) {
      const [kx, ky] = table[i];
      const nx = p.x + kx;
      const ny = p.y - ky; // SRS y is up, board y is down
      if (!this.collides(m, nx, ny)) {
        p.matrix = m;
        p.x = nx;
        p.y = ny;
        p.rot = to;
        this.lastKickIndex = i;
        this.onMoved(true);
        this.emit('rotate');
        return true;
      }
    }
    return false;
  }

  setSoftDrop(on) {
    if (this.softDrop === on) return;
    this.softDrop = on;
    if (on) {
      this.gravityAcc = 0;
      this.softDropStep();
    }
  }

  softDropStep() {
    if (!this.active) return false;
    const p = this.piece;
    if (this.collides(p.matrix, p.x, p.y + 1)) return false;
    p.y++;
    this.score += SCORE.SOFT_DROP;
    this.lastRotated = false;
    this.lastKickIndex = -1;
    this.checkLowest();
    return true;
  }

  hardDrop() {
    if (!this.active) return;
    const p = this.piece;
    let n = 0;
    while (!this.collides(p.matrix, p.x, p.y + 1)) {
      p.y++;
      n++;
    }
    this.score += n * SCORE.HARD_DROP;
    if (n > 0) {
      this.lastRotated = false;
      this.lastKickIndex = -1;
    }
    this.emit('harddrop', n);
    this.lock();
  }

  holdPiece() {
    if (!this.active || !this.canHold) return false;
    const cur = this.piece.type;
    let next;
    if (this.hold) {
      next = this.makePiece(this.hold);
      this.hold = cur;
    } else {
      this.hold = cur;
      next = this.makePiece(this.queue.shift());
      this.queue.push(this.nextFromBag());
    }
    this.canHold = false;
    this.emit('hold');
    this.spawnPiece(next);
    return true;
  }

  // ---- simulation -----------------------------------------------------------
  update(dt) {
    if (this.state !== 'playing') return;
    this.stats.time += dt;

    if (this.clearing) {
      this.clearing.t += dt;
      if (this.clearing.t >= CFG.CLEAR_MS) this.finishClear();
      return;
    }
    if (!this.piece) return;

    const p = this.piece;
    if (CFG.INSTANT_GRAVITY) {
      // 20G: the piece always sits on the floor; only the lock delay
      // (with move resets) gives the player time to slide and rotate.
      let fell = false;
      while (!this.collides(p.matrix, p.x, p.y + 1)) {
        p.y++;
        fell = true;
      }
      if (fell) {
        this.lastRotated = false;
        this.checkLowest();
      }
    } else if (!this.isGrounded()) {
      const g = gravityMs(this.level);
      const interval = this.softDrop ? Math.min(CFG.SOFT_DROP_MS, g) : g;
      this.gravityAcc += dt;
      while (this.gravityAcc >= interval) {
        this.gravityAcc -= interval;
        if (this.collides(p.matrix, p.x, p.y + 1)) {
          this.gravityAcc = 0;
          break;
        }
        p.y++;
        if (this.softDrop) this.score += SCORE.SOFT_DROP;
        this.lastRotated = false;
        this.checkLowest();
      }
    }

    if (this.isGrounded()) {
      this.lockTimer += dt;
      if (this.lockTimer >= this.lockDelay) this.lock();
    }
  }

  get lockDelay() {
    return lockDelayMs(this.level);
  }

  lock() {
    const p = this.piece;
    const spin = this.detectSpin();
    let lockedVisible = false;
    for (let r = 0; r < p.matrix.length; r++) {
      for (let c = 0; c < p.matrix[r].length; c++) {
        if (!p.matrix[r][c]) continue;
        const by = p.y + r;
        const bx = p.x + c;
        if (by >= 0 && by < this.board.length) {
          this.board[by][bx] = p.type;
          if (by >= CFG.HIDDEN) lockedVisible = true;
        }
      }
    }
    this.stats.pieces++;
    this.emit('lock', p);
    this.piece = null;
    this.canHold = true;

    if (!lockedVisible) {
      this.gameOver();
      return;
    }

    const full = [];
    for (let r = 0; r < this.board.length; r++) {
      if (this.board[r].every(Boolean)) full.push(r);
    }
    this.applyScore(full.length, spin);

    if (full.length) {
      this.clearing = { rows: full, t: 0 };
      this.emit('clearstart', {
        rows: full,
        count: full.length,
        spin,
        tspin: !!(spin && spin.type === 'T' && !spin.mini),
      });
    } else {
      this.spawn();
    }
  }

  // SRS Spin Detection with All-Mini rule:
  // - T-Spin: 3-corner rule. Front 2 corners or 5th kick (TST kick) -> Regular T-Spin. Otherwise -> T-Spin Mini.
  // - T-Spin Mini (All-Mini 2-corner rule): 2 corners filled & immobile.
  // - All-Mini for non-T pieces (J, L, S, Z, I): Immobile (cannot move left, right, or up) after rotation.
  detectSpin() {
    const p = this.piece;
    if (!p || !this.lastRotated) return null;

    const filled = (x, y) =>
      x < 0 || x >= CFG.COLS || y < 0 || y >= this.board.length || !!this.board[y][x];

    // Immobile check: cannot translate left, right, or up
    const isImmobile =
      this.collides(p.matrix, p.x + 1, p.y) &&
      this.collides(p.matrix, p.x - 1, p.y) &&
      this.collides(p.matrix, p.x, p.y - 1);

    if (p.type === 'T') {
      const cx = p.x + 1;
      const cy = p.y + 1;
      const tl = filled(cx - 1, cy - 1);
      const tr = filled(cx + 1, cy - 1);
      const bl = filled(cx - 1, cy + 1);
      const br = filled(cx + 1, cy + 1);
      const corners = (tl ? 1 : 0) + (tr ? 1 : 0) + (bl ? 1 : 0) + (br ? 1 : 0);

      // Front corners based on rotation state
      // 0: up (tl, tr), 1: right (tr, br), 2: down (bl, br), 3: left (tl, bl)
      let frontCorners = 0;
      switch (p.rot) {
        case 0: frontCorners = (tl ? 1 : 0) + (tr ? 1 : 0); break;
        case 1: frontCorners = (tr ? 1 : 0) + (br ? 1 : 0); break;
        case 2: frontCorners = (bl ? 1 : 0) + (br ? 1 : 0); break;
        case 3: frontCorners = (tl ? 1 : 0) + (bl ? 1 : 0); break;
      }

      if (corners >= 3) {
        // Standard guideline: front 2 corners OR 5th kick (index 4 in SRS, TST kick)
        if (frontCorners === 2 || this.lastKickIndex === 4) {
          return { type: 'T', mini: false, name: 'T-SPIN' };
        }
        return { type: 'T', mini: true, name: 'T-SPIN MINI' };
      }

      // All-Mini 2-corner rule: at least 2 corners filled and piece is immobile
      if (corners >= 2 && isImmobile) {
        return { type: 'T', mini: true, name: 'T-SPIN MINI' };
      }
      return null;
    }

    // All-Mini for non-T pieces (J, L, S, Z, I):
    if (p.type !== 'O' && isImmobile) {
      return { type: p.type, mini: true, name: `${p.type}-SPIN MINI` };
    }

    return null;
  }

  applyScore(n, spin) {
    let pts;
    let difficult;
    if (spin) {
      pts = (spin.mini ? SCORE.SPIN_MINI : SCORE.TSPIN)[n] || 0;
      difficult = true; // All spins/minis maintain & trigger Back-to-Back!
      if (spin.type === 'T' && !spin.mini) {
        this.stats.tspin++;
      }
    } else {
      pts = SCORE.LINES[n];
      difficult = n === 4;
    }

    let b2b = false;
    if (n > 0) {
      if (difficult && this.b2b) {
        pts = Math.floor(pts * SCORE.B2B_MULT);
        b2b = true;
      }
      this.b2b = difficult;
      this.combo++;
      pts += SCORE.COMBO * this.combo;
      if (this.combo > this.stats.maxCombo) this.stats.maxCombo = this.combo;
      if (n === 4) this.stats.tetris++;
    } else {
      this.combo = -1;
    }

    pts *= this.level;
    this.score += pts;
    if (n > 0 || spin) {
      this.emit('score', {
        points: pts,
        lines: n,
        spin,
        tspin: !!(spin && spin.type === 'T' && !spin.mini),
        b2b,
        combo: this.combo,
      });
    }

    if (n > 0) this.lines += n;
    const newLevel = Math.max(this.startLevel, levelForScore(this.score));
    if (newLevel > this.level) {
      this.level = newLevel;
      this.emit('levelup', this.level);
    }
  }

  finishClear() {
    const rows = this.clearing.rows; // ascending (top -> bottom)
    for (const r of rows) {
      this.board.splice(r, 1);
      this.board.unshift(Array(CFG.COLS).fill(null));
    }
    this.clearing = null;
    this.emit('clearend', rows.length);
    this.spawn();
  }

  // ---- state ----------------------------------------------------------------
  gameOver() {
    this.state = 'over';
    this.piece = null;
    this.softDrop = false;
    this.emit('gameover', {
      score: this.score,
      lines: this.lines,
      level: this.level,
      stats: this.stats,
    });
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.softDrop = false;
    this.emit('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.emit('resume');
  }
}
