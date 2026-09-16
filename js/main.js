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

  const settings = Object.assign({ sfx: true, bgm: true, level: 1, name: '' }, load(LS_SETTINGS, {}));
  let ranking = load(LS_RANK, []);
  let pendingResult = null;

  const game = new Game();
  const audio = new AudioEngine();
  audio.sfxOn = !!settings.sfx;
  audio.bgmOn = !!settings.bgm;
  const renderer = new Renderer(game, $('#board'), $('#hold'), $('#next'));

  const el = {
    stage: $('#stage'),
    wrap: $('#board-wrap'),
    fx: $('#fx'),
    score: $('#score'),
    level: $('#level'),
    lines: $('#lines'),
    time: $('#time'),
    best: $('#best'),
    overlay: $('#overlay'),
    screens: { start: $('#screen-start'), pause: $('#screen-pause'), over: $('#screen-over') },
    levelPicker: $('#level-picker'),
    startBtn: $('#btn-start'),
    resumeBtn: $('#btn-resume'),
    restartBtn: $('#btn-restart'),
    againBtn: $('#btn-again'),
    menuBtn: $('#btn-menu'),
    overScore: $('#over-score'),
    overLines: $('#over-lines'),
    overLevel: $('#over-level'),
    nameForm: $('#name-form'),
    nameInput: $('#name-input'),
    overBoard: $('#over-board'),
    startBoard: $('#start-board'),
    startRankBadge: $('#start-rank-badge'),
    overRankBadge: $('#over-rank-badge'),
    sfxBtn: $('#btn-sfx'),
    bgmBtn: $('#btn-bgm'),
    pauseBtn: $('#btn-pause'),
    fullBtn: $('#btn-full'),
  };

  // ---- layout ---------------------------------------------------------------
  function resize() {
    const rect = el.stage.getBoundingClientRect();
    const pad = 6;
    const cell = Math.max(8, Math.floor(Math.min(
      (rect.height - pad) / CFG.ROWS,
      (rect.width - pad) / CFG.COLS
    )));
    const pcell = Math.max(14, Math.min(26, Math.round(cell * 0.62)));
    renderer.resize(cell, pcell);
    renderer.draw(0);
    renderer.drawPreviews();
  }

  // ---- screens --------------------------------------------------------------
  function showScreen(name) {
    Object.entries(el.screens).forEach(([k, s]) => s.classList.toggle('active', k === name));
    el.overlay.hidden = !name;
  }

  // ---- ranking --------------------------------------------------------------
  let isOnline = false;

  function updateRankBadges() {
    [el.startRankBadge, el.overRankBadge].forEach((b) => {
      if (!b) return;
      b.textContent = isOnline ? 'ONLINE (D1)' : 'LOCAL';
      b.className = `rank-badge ${isOnline ? 'online' : 'local'}`;
    });
  }

  function bestScore() {
    return ranking.length ? ranking[0].score : 0;
  }

  function renderRank(table, limit, highlight = -1) {
    if (!table) return;
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
    return score > 0 && (ranking.length < MAX_RANK || score > ranking[ranking.length - 1].score);
  }

  function addRank(entry) {
    ranking.push(entry);
    ranking.sort((a, b) => b.score - a.score || b.lines - a.lines);
    ranking = ranking.slice(0, MAX_RANK);
    save(LS_RANK, ranking);
    return ranking.indexOf(entry);
  }

  async function fetchRankings() {
    const apiUrl = typeof RANKING_API_URL !== 'undefined' ? RANKING_API_URL : '/api/ranking';
    try {
      const res = await fetch(`${apiUrl}?limit=${MAX_RANK}`, {
        headers: { 'Accept': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.rankings)) {
          ranking = data.rankings;
          isOnline = true;
          updateRankBadges();
          save(LS_RANK, ranking);
          return ranking;
        }
      }
    } catch (_) {
      // offline fallback
    }
    isOnline = false;
    updateRankBadges();
    return ranking;
  }

  async function submitScore(entry) {
    const localIdx = addRank(entry);
    const apiUrl = typeof RANKING_API_URL !== 'undefined' ? RANKING_API_URL : '/api/ranking';
    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          isOnline = true;
          updateRankBadges();
          await fetchRankings();
          const onlineIdx = ranking.findIndex(
            (r) => r.name === entry.name && r.score === entry.score && r.lines === entry.lines
          );
          return onlineIdx >= 0 ? onlineIdx : localIdx;
        }
      }
    } catch (_) {
      isOnline = false;
      updateRankBadges();
    }
    return localIdx;
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
      el.time.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
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

  let shakeTime = 0;
  let shakeAmp = 0;
  function shake(amp) {
    shakeAmp = Math.max(shakeAmp, amp);
    shakeTime = 180;
  }

  // ---- game flow ------------------------------------------------------------
  function startGame() {
    audio.ensure();
    audio.resetBgm();
    game.start(settings.level);
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
    fetchRankings().then(() => renderRank(el.startBoard, 5));
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
  game.on('harddrop', (n) => { audio.hardDrop(); shake(n > 0 ? 3 : 1); });
  game.on('lock', () => audio.lock());
  game.on('clearstart', ({ count, tspin }) => {
    audio.clear(count, tspin);
    renderer.flash = count === 4 || tspin ? 1 : 0.45;
    if (count === 4) shake(7);
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
    pop(`LEVEL ${lv}`, 'level');
    bump(el.level);
  });
  game.on('gameover', async (r) => {
    audio.stopBgm();
    audio.gameOver();
    el.overScore.textContent = fmt(r.score);
    el.overLines.textContent = r.lines;
    el.overLevel.textContent = r.level;
    let q = qualifies(r.score);
    pendingResult = q ? r : null;
    el.nameForm.hidden = !q;
    renderRank(el.overBoard, MAX_RANK);
    showScreen('over');
    if (q) {
      el.nameInput.value = settings.name || '';
      setTimeout(() => el.nameInput.focus(), 50);
    }

    // Refresh online rankings from D1 and re-evaluate qualification
    await fetchRankings();
    q = qualifies(r.score);
    if (!pendingResult && q) {
      pendingResult = r;
      el.nameForm.hidden = false;
      el.nameInput.value = settings.name || '';
    }
    renderRank(el.overBoard, MAX_RANK);
  });

  // ---- UI wiring ------------------------------------------------------------
  el.nameForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pendingResult) return;
    const name = (el.nameInput.value.trim() || 'PLAYER').slice(0, 10);
    settings.name = name;
    save(LS_SETTINGS, settings);
    const entry = {
      name,
      score: pendingResult.score,
      lines: pendingResult.lines,
      level: pendingResult.level,
      date: new Date().toISOString(),
    };
    pendingResult = null;
    el.nameForm.hidden = true;
    el.nameInput.blur();

    const idx = await submitScore(entry);
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

  function buildLevelPicker() {
    el.levelPicker.innerHTML = '';
    for (let i = 1; i <= CFG.MAX_START_LEVEL; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lv';
      b.textContent = i;
      b.dataset.level = i;
      b.addEventListener('click', () => setLevel(i));
      el.levelPicker.appendChild(b);
    }
    setLevel(settings.level);
  }

  function setLevel(n) {
    settings.level = Math.min(CFG.MAX_START_LEVEL, Math.max(1, n | 0));
    save(LS_SETTINGS, settings);
    el.levelPicker.querySelectorAll('.lv').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.level) === settings.level);
    });
  }

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
    levelDelta: (d) => setLevel(settings.level + d),
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
    renderer.draw(dt);
    renderer.drawPreviews();
    updateHud();
    if (shakeTime > 0) {
      shakeTime -= dt;
      const k = Math.max(0, shakeTime / 180);
      const ox = (Math.random() - 0.5) * shakeAmp * k * 2;
      const oy = (Math.random() - 0.5) * shakeAmp * k * 2;
      el.wrap.style.transform = `translate(${ox.toFixed(1)}px, ${oy.toFixed(1)}px)`;
      if (shakeTime <= 0) {
        el.wrap.style.transform = '';
        shakeAmp = 0;
      }
    }
    requestAnimationFrame(frame);
  }

  // ---- init -----------------------------------------------------------------
  buildLevelPicker();
  syncSoundButtons();
  renderRank(el.startBoard, 5);
  fetchRankings().then(() => {
    renderRank(el.startBoard, 5);
    hud.best = -1;
    updateHud();
  });
  showScreen('start');
  resize();
  requestAnimationFrame(frame);

  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(el.stage);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(resize);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
  const unlock = () => audio.ensure();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
})();
