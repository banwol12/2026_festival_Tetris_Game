'use strict';

(() => {
  const $ = (s) => document.querySelector(s);
  const LS_SETTINGS = 'festival-tetris:settings';
  const LS_RANK = 'festival-tetris:ranking';
  const MAX_RANK = 10;

  const load = (key, fallback) => {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v == null ? fallback : v;
    } catch (_) {
      return fallback;
    }
  };
  const save = (key, v) => {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch (_) { /* ignore */ }
  };
  const fmt = (n) => Number(n).toLocaleString('en-US');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const settings = Object.assign({ sfx: true, bgm: true, name: '' }, load(LS_SETTINGS, {}));
  let ranking = load(LS_RANK, []);
  let pendingResult = null;

  const game = new Game();
  const audio = new AudioEngine();
  audio.sfxOn = !!settings.sfx;
  audio.bgmOn = !!settings.bgm;
  const renderer = new Renderer(game, $('#board'), $('#hold'), $('#next'));

  const el = {
    arena: $('#arena'),
    stage: $('#stage'),
    wrap: $('#board-wrap'),
    fx: $('#fx'),
    score: $('#score'),
    level: $('#level'),
    lines: $('#lines'),
    time: $('#time'),
    best: $('#best'),
    overlay: $('#overlay'),
    hearts: $('#hearts'),
    screens: { start: $('#screen-start'), pause: $('#screen-pause'), over: $('#screen-over') },
    startBtn: $('#btn-start'),
    resumeBtn: $('#btn-resume'),
    restartBtn: $('#btn-restart'),
    againBtn: $('#btn-again'),
    menuBtn: $('#btn-menu'),
    overScore: $('#over-score'),
    overLines: $('#over-lines'),
    overLevel: $('#over-level'),
    overTime: $('#over-time'),
    nameForm: $('#name-form'),
    nameInput: $('#name-input'),
    overBoard: $('#over-board'),
    startBoard: $('#start-board'),
    sfxBtn: $('#btn-sfx'),
    bgmBtn: $('#btn-bgm'),
    pauseBtn: $('#btn-pause'),
    fullBtn: $('#btn-full'),
  };

  // ---- layout ---------------------------------------------------------------
  function resize() {
    const rect = el.arena.getBoundingClientRect();
    const pad = 8;
    const cell = Math.max(8, Math.floor(Math.min(
      (rect.height - pad) / CFG.ROWS,
      (rect.width * 0.42) / CFG.COLS
    )));
    const pcell = Math.max(12, Math.min(48, Math.round(cell * 0.78)));
    document.documentElement.style.setProperty('--cell', cell + 'px');
    renderer.resize(cell, pcell);
    renderer.draw();
    renderer.drawPreviews();
  }

  function fmtTime(ms) {
    const sec = Math.floor(ms / 1000);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }

  // ---- screens --------------------------------------------------------------
  function showScreen(name) {
    Object.entries(el.screens).forEach(([k, s]) => s.classList.toggle('active', k === name));
    el.overlay.hidden = !name;
    document.body.classList.toggle('playing', !name);
  }

  // ---- ranking --------------------------------------------------------------
  function bestScore() {
    return ranking.length ? ranking[0].score : 0;
  }

  function renderRank(table, limit, highlight = -1) {
    const rows = ranking.slice(0, limit);
    if (!rows.length) {
      table.innerHTML = '<tr><td class="empty">아직 기록이 없습니다</td></tr>';
      return;
    }
    table.innerHTML = rows.map((r, i) => (
      `<tr class="${i === highlight ? 'me' : ''}">` +
      `<td class="rk">${i + 1}</td><td class="nm">${esc(r.name)}</td>` +
      `<td class="sc">${fmt(r.score)}</td><td class="ln">${r.lines}L</td></tr>`
    )).join('');
  }

  function qualifies(score) {
    return score > 0 && (ranking.length < MAX_RANK || score > ranking[MAX_RANK - 1].score);
  }

  function addRank(entry) {
    ranking.push(entry);
    ranking.sort((a, b) => b.score - a.score || b.lines - a.lines);
    ranking = ranking.slice(0, MAX_RANK);
    save(LS_RANK, ranking);
    return ranking.indexOf(entry);
  }

  // ---- HUD ------------------------------------------------------------------
  const hud = { score: -1, level: -1, lines: -1, time: -1, best: -1 };
  function updateHud() {
    if (game.score !== hud.score) { hud.score = game.score; el.score.textContent = fmt(game.score); }
    if (game.level !== hud.level) { hud.level = game.level; el.level.textContent = game.level; }
    if (game.lines !== hud.lines) { hud.lines = game.lines; el.lines.textContent = game.lines; }
    const sec = Math.floor(game.stats.time / 1000);
    if (sec !== hud.time) {
      hud.time = sec;
      el.time.textContent = fmtTime(game.stats.time);
    }
    const best = Math.max(bestScore(), game.score);
    if (best !== hud.best) { hud.best = best; el.best.textContent = fmt(best); }
  }

  function bump(node) {
    node.classList.remove('bump');
    void node.offsetWidth;
    node.classList.add('bump');
  }

  // ---- FX -------------------------------------------------------------------
  function pop(text, cls = '') {
    const d = document.createElement('div');
    d.className = `pop ${cls}`;
    d.textContent = text;
    el.fx.appendChild(d);
    d.addEventListener('animationend', () => d.remove());
    while (el.fx.children.length > 4) el.fx.firstChild.remove();
  }

  const HEART_SVG = '<svg viewBox="0 0 32 29" aria-hidden="true"><path fill="currentColor" ' +
    'd="M23.6 0c-3.4 0-6.3 2.7-7.6 5.6C14.7 2.7 11.8 0 8.4 0 3.8 0 0 3.8 0 8.4c0 9.4 9.5 11.9 16 21.2 ' +
    '6.1-9.3 16-12.1 16-21.2C32 3.8 28.2 0 23.6 0z"/></svg>';
  const HEART_COLORS = ['#ff47c0', '#ff9485', '#ffffff', '#ffb3dd', '#ff47c0'];

  // Hearts burst out of the cleared rows and drift down while fading.
  function burstHearts(rows) {
    const rect = el.wrap.getBoundingClientRect();
    const cell = renderer.cell;
    const avgRow = rows.reduce((a, b) => a + b, 0) / rows.length;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + (avgRow - CFG.HIDDEN + 0.5) * cell;
    const count = 26;
    for (let i = 0; i < count; i++) {
      const h = document.createElement('span');
      h.className = 'heart';
      h.innerHTML = HEART_SVG;
      const size = cell * (0.45 + Math.random() * 0.75);
      h.style.width = `${size}px`;
      h.style.height = `${size}px`;
      h.style.left = `${cx - size / 2 + (Math.random() - 0.5) * rect.width * 0.6}px`;
      h.style.top = `${cy - size / 2}px`;
      h.style.color = HEART_COLORS[i % HEART_COLORS.length];
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.6;
      const dist = cell * (3 + Math.random() * 8);
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist * 0.8;
      const rot = (Math.random() - 0.5) * 90;
      const dur = 1100 + Math.random() * 700;
      el.hearts.appendChild(h);
      const anim = h.animate([
        { transform: 'translate(0, 0) scale(0.15) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5}px) scale(1.3) rotate(${rot * 0.4}deg)`, opacity: 1, offset: 0.25 },
        { transform: `translate(${dx * 0.85}px, ${dy * 0.85 + cell * 0.4}px) scale(1) rotate(${rot * 0.8}deg)`, opacity: 1, offset: 0.62 },
        { transform: `translate(${dx}px, ${dy + cell * 1.6}px) scale(0.7) rotate(${rot}deg)`, opacity: 0 },
      ], { duration: dur, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'forwards' });
      anim.onfinish = () => h.remove();
    }
  }

  // ---- game flow ------------------------------------------------------------
  function startGame() {
    audio.ensure();
    audio.resetBgm();
    game.start(1);
    showScreen(null);
    audio.startBgm(game.level);
    el.pauseBtn.textContent = '⏸';
    pendingResult = null;
    el.nameForm.hidden = true;
  }

  function pauseGame() {
    if (game.state !== 'playing') return;
    game.pause();
    showScreen('pause');
    audio.stopBgm();
    el.pauseBtn.textContent = '▶';
  }

  function resumeGame() {
    if (game.state !== 'paused') return;
    game.resume();
    showScreen(null);
    audio.startBgm(game.level);
    el.pauseBtn.textContent = '⏸';
  }

  function togglePause() {
    if (game.state === 'playing') pauseGame();
    else if (game.state === 'paused') resumeGame();
  }

  function toMenu() {
    audio.resetBgm();
    game.reset();
    renderRank(el.startBoard, 5);
    showScreen('start');
    el.pauseBtn.textContent = '⏸';
  }

  function toggleFullscreen() {
    const doc = document;
    const root = doc.documentElement;
    const isFull = doc.fullscreenElement || doc.webkitFullscreenElement;
    try {
      if (!isFull) {
        const req = root.requestFullscreen || root.webkitRequestFullscreen;
        if (req) { const r = req.call(root); if (r && r.catch) r.catch(() => {}); }
      } else {
        const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
        if (exit) { const r = exit.call(doc); if (r && r.catch) r.catch(() => {}); }
      }
    } catch (_) { /* ignore */ }
  }

  function onEnter() {
    if (game.state === 'idle') startGame();
    else if (game.state === 'over') {
      if (!el.nameForm.hidden) el.nameInput.focus();
      else startGame();
    } else if (game.state === 'paused') resumeGame();
  }

  // ---- game events ----------------------------------------------------------
  const LINE_NAMES = ['', 'SINGLE', 'DOUBLE', 'TRIPLE'];
  game.on('move', () => audio.move());
  game.on('rotate', () => audio.rotate());
  game.on('hold', () => audio.hold());
  game.on('harddrop', () => audio.hardDrop());
  game.on('lock', () => audio.lock());
  game.on('clearstart', ({ rows, count, tspin }) => {
    audio.clear(count, tspin);
    if (count === 4) burstHearts(rows);
  });
  game.on('score', ({ points, lines, tspin, b2b, combo }) => {
    let label = '';
    if (tspin) label = 'T-SPIN' + (lines ? ' ' + LINE_NAMES[lines] : '');
    else if (lines === 4) label = 'TETRIS!';
    else if (lines) label = LINE_NAMES[lines];
    if (b2b) label = 'B2B ' + label;
    if (label) pop(label, lines === 4 ? 'big' : tspin ? 'big tspin' : '');
    if (combo >= 1) pop(`COMBO ×${combo}`, 'combo');
    if (points) pop(`+${fmt(points)}`, 'pts');
  });
  game.on('levelup', (lv) => {
    audio.levelUp();
    audio.setLevel(lv);
    pop(`LEVEL ${lv} · SPEED UP`, 'level');
    bump(el.level);
  });
  game.on('gameover', (r) => {
    audio.stopBgm();
    audio.gameOver();
    el.overScore.textContent = fmt(r.score);
    el.overLines.textContent = r.lines;
    el.overLevel.textContent = r.level;
    el.overTime.textContent = fmtTime(r.stats.time);
    const q = qualifies(r.score);
    pendingResult = q ? r : null;
    el.nameForm.hidden = !q;
    renderRank(el.overBoard, MAX_RANK);
    showScreen('over');
    if (q) {
      el.nameInput.value = settings.name || '';
      setTimeout(() => el.nameInput.focus(), 50);
    }
  });

  // ---- UI wiring ------------------------------------------------------------
  el.nameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!pendingResult) return;
    const name = (el.nameInput.value.trim() || 'PLAYER').slice(0, 10);
    settings.name = name;
    save(LS_SETTINGS, settings);
    const idx = addRank({
      name,
      score: pendingResult.score,
      lines: pendingResult.lines,
      level: pendingResult.level,
      date: new Date().toISOString(),
    });
    pendingResult = null;
    el.nameForm.hidden = true;
    el.nameInput.blur();
    renderRank(el.overBoard, MAX_RANK, idx);
    hud.best = -1;
  });

  el.nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (el.nameForm.requestSubmit) el.nameForm.requestSubmit();
      else el.nameForm.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });

  function syncSoundButtons() {
    el.sfxBtn.classList.toggle('off', !audio.sfxOn);
    el.sfxBtn.textContent = audio.sfxOn ? '🔊' : '🔇';
    el.bgmBtn.classList.toggle('off', !audio.bgmOn);
  }

  el.sfxBtn.addEventListener('click', () => {
    audio.sfxOn = !audio.sfxOn;
    settings.sfx = audio.sfxOn;
    save(LS_SETTINGS, settings);
    syncSoundButtons();
    audio.ensure();
    if (audio.sfxOn) audio.rotate();
  });
  el.bgmBtn.addEventListener('click', () => {
    audio.bgmOn = !audio.bgmOn;
    settings.bgm = audio.bgmOn;
    save(LS_SETTINGS, settings);
    syncSoundButtons();
    if (audio.bgmOn && game.state === 'playing') audio.startBgm(game.level);
    else audio.stopBgm();
  });
  el.pauseBtn.addEventListener('click', togglePause);
  el.fullBtn.addEventListener('click', toggleFullscreen);
  el.startBtn.addEventListener('click', startGame);
  el.resumeBtn.addEventListener('click', resumeGame);
  el.restartBtn.addEventListener('click', startGame);
  el.againBtn.addEventListener('click', startGame);
  el.menuBtn.addEventListener('click', toMenu);

  // Keep Space/Enter from re-triggering the last clicked button.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) b.blur();
  });

  const input = new Input(game, {
    enter: onEnter,
    pause: togglePause,
    restart: () => { if (game.state !== 'idle') startGame(); },
    mute: () => el.sfxBtn.click(),
    fullscreen: toggleFullscreen,
    blur: pauseGame,
  });

  // ---- main loop ------------------------------------------------------------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(now - last, 50);
    last = now;
    input.update(dt);
    game.update(dt);
    renderer.draw();
    renderer.drawPreviews();
    updateHud();
    requestAnimationFrame(frame);
  }

  if (new URLSearchParams(location.search).has('debug')) {
    window.__tetris = { game, burstHearts };
  }

  // ---- init -----------------------------------------------------------------
  syncSoundButtons();
  renderRank(el.startBoard, 5);
  showScreen('start');
  resize();
  requestAnimationFrame(frame);

  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(el.arena);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(resize);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
  const unlock = () => audio.ensure();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
})();
