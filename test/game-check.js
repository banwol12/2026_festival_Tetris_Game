// Run: node test/game-check.js  — headless checks for the game engine.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const src = ['js/config.js', 'js/game.js'].map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
const ctx = { Math, Array, console };
vm.createContext(ctx);
vm.runInContext(`${src}\nthis.Game = Game; this.CFG = CFG; this.spinTurnMs = spinTurnMs;`, ctx);
const { Game, CFG, spinTurnMs } = ctx;

function fillRows(g, n) {
  const H = g.board.length;
  for (let r = H - n; r < H; r++) for (let c = 0; c < CFG.COLS - 1; c++) g.board[r][c] = 'J';
}

// Classic: instant drop, player rotation, tetris scoring.
{
  const g = new Game(); g.start(1);
  assert.strictEqual(g.mode, 'classic');
  g.update(16);
  assert.ok(g.isGrounded(), 'classic piece lands on the first frame');
  const points = [];
  g.on('score', (d) => points.push(d.points));
  fillRows(g, 4);
  g.spawnPiece(g.makePiece('I'));
  assert.ok(g.rotate(1), 'player can rotate in classic');
  while (g.move(1)) {}
  g.hardDrop();
  assert.strictEqual(points[0], 800, 'tetris = 800 at level 1');
}

// Spin: the piece falls over time and turns clockwise on the beat.
{
  const g = new Game(); g.start(1, 'spin');
  g.spawnPiece(g.makePiece('T'));
  const y0 = g.piece.y;
  assert.strictEqual(g.rotate(1), false, 'player rotation is disabled');
  assert.strictEqual(g.piece.rot, 0);
  g.update(16);
  assert.strictEqual(g.piece.y, y0, 'no instant drop in spin mode');
  let turns = 0;
  g.on('autospin', () => turns++);
  const beat = spinTurnMs(1);
  for (let t = 16; t < beat * 4 + 10; t += 16) g.update(16);
  assert.strictEqual(turns, 4, 'four quarter turns in four beats');
  assert.strictEqual(g.piece.rot, 0, 'back to spawn orientation after a full turn');
  assert.ok(g.piece.y > y0, 'piece has fallen');
}

// Spin: auto turns don't extend the lock delay.
{
  const g = new Game(); g.start(1, 'spin');
  g.spawnPiece(g.makePiece('O'));
  while (g.softDropStep()) {}
  let locked = 0;
  g.on('lock', () => locked++);
  for (let t = 0; t < g.lockDelay + 32 && !locked; t += 16) g.update(16);
  assert.strictEqual(locked, 1, 'locks after lock delay even while spinning');
}

// Spin: hard drop keeps the current orientation.
{
  const g = new Game(); g.start(1, 'spin');
  g.spawnPiece(g.makePiece('I'));
  g.autoSpin(); // now vertical
  const cells = [];
  g.on('lock', (p) => p.matrix.forEach((row, r) => row.forEach((v, c) => v && cells.push([p.x + c, p.y + r]))));
  g.hardDrop();
  assert.strictEqual(new Set(cells.map(([x]) => x)).size, 1, 'vertical I locks as a vertical line');
}

console.log('game-check: all passed');
