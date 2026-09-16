'use strict';

// ---- Game constants -------------------------------------------------------
const CFG = {
  COLS: 10,
  ROWS: 20,            // visible rows
  HIDDEN: 2,           // hidden rows above the visible board
  NEXT_COUNT: 5,
  LOCK_DELAY: 500,     // ms a grounded piece waits before locking
  MAX_LOCK_RESETS: 15, // move/rotate resets allowed per lowest row
  SOFT_DROP_MS: 30,    // ms per cell while soft-dropping
  DAS: 160,            // delayed auto shift (ms)
  ARR: 30,             // auto repeat rate (ms per cell)
  CLEAR_MS: 260,       // line clear animation length
  MAX_SPEED_LEVEL: 15, // gravity stops accelerating here
  LINES_PER_LEVEL: 10,
  MAX_START_LEVEL: 10,
};

const TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

const COLORS = {
  I: '#2ee6ff',
  O: '#ffe14d',
  T: '#c56bff',
  S: '#5cf28a',
  Z: '#ff5e6c',
  J: '#4d8bff',
  L: '#ffa640',
};

// Rotation state 0 (spawn) for each tetromino, SRS bounding boxes.
const SHAPES = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
};

// SRS wall kicks. Offsets are (x, y) in SRS space where +y is UP.
// Keys are `${from}${to}` rotation states: 0 = spawn, 1 = CW, 2 = 180, 3 = CCW.
const KICKS = {
  JLSTZ: {
    '01': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '10': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '12': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '21': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '23': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '32': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '30': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '03': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  },
  I: {
    '01': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '10': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '12': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    '21': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '23': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '32': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '30': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '03': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  },
};

// Guideline-style scoring (multiplied by level).
const SCORE = {
  LINES: [0, 100, 300, 500, 800],
  TSPIN: [400, 800, 1200, 1600],
  SOFT_DROP: 1,
  HARD_DROP: 2,
  COMBO: 50,
  B2B_MULT: 1.5,
};

// Milliseconds per row of gravity for a given level (Tetris guideline curve).
function gravityMs(level) {
  const l = Math.min(level, CFG.MAX_SPEED_LEVEL) - 1;
  return Math.max(Math.pow(0.8 - l * 0.007, l) * 1000, 8);
}

// Online ranking API endpoint (defaults to deployed Cloudflare Worker, can be overridden via window.TETRIS_API_URL)
const RANKING_API_URL = (typeof window !== 'undefined' && window.TETRIS_API_URL) || 'https://digitalarts-tetris.hjahn0523.workers.dev/api/ranking';

