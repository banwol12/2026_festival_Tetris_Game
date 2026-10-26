'use strict';

(() => {
  const $ = (s) => document.querySelector(s);
  const LS_SETTINGS = 'festival-tetris:settings';
  const LS_RANK = 'festival-tetris:ranking:v2';
  const MAX_RANK = 20;

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

  const settings = Object.assign({ sfx: true, bgm: true, bgmTrack: 'korobeiniki', name: '', mode: 'classic' }, load(LS_SETTINGS, {}));
  const MODES = {
    classic: {
      title: 'Digitalarts Tetris',
      rank: 'TOP 20 RANKING',
      tagline: '조각이 나오자마자 바닥에 꽂히는 초고속 테트리스<br />점수가 오를수록 고정 시간이 짧아집니다',
    },
    spin: {
      title: 'Digitalarts Tetris · 빙글빙글',
      rank: 'TOP 20 · 빙글빙글',
      tagline: '조각이 혼자서 시계방향으로 빙글빙글 돌아갑니다<br />원하는 모양이 된 순간 <kbd>Space</kbd>로 꽂으세요',
    },
  };
  let mode = settings.mode === 'spin' ? 'spin' : 'classic';
  // Each mode keeps its own ranking; classic keeps the original storage key.
  const rankKey = () => (mode === 'classic' ? LS_RANK : `${LS_RANK}:${mode}`);
  let ranking = load(rankKey(), []);
  let serverModes = false; // true once the ranking API answers with a mode
  let pendingResult = null;

  const game = new Game();
  const audio = new AudioEngine();
  audio.sfxOn = !!settings.sfx;
  audio.bgmOn = !!settings.bgm;
  if (settings.bgmTrack) audio.setTrack(settings.bgmTrack);
  const renderer = new Renderer(game, $('#board'), $('#hold'), $('#next'));
  const chat = typeof ChatClient !== 'undefined' ? new ChatClient(audio) : null;

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
    bgmCtrl: $('.bgm-ctrl'),
    bgmMenuBtn: $('#btn-bgm-menu'),
    bgmLabel: $('#bgm-current-label'),
    bgmDropdown: $('#bgm-dropdown'),
    bgmDropdownList: $('#bgm-dropdown-list'),
    startTrackGrid: $('#start-track-grid'),
    pauseTrackGrid: $('#pause-track-grid'),
    toast: $('#toast'),
    pauseBtn: $('#btn-pause'),
    fullBtn: $('#btn-full'),
    modeTagline: $('#mode-tagline'),
    titleName: $('.title-name'),
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
    if (name === 'start' || name === 'pause') renderTrackSelectors();
  }

  // ---- ranking --------------------------------------------------------------

  function fmtDate(raw) {
    if (!raw) return '-';
    let str = String(raw);
    if (!str.includes('T') && !str.endsWith('Z')) {
      str = str.replace(' ', 'T') + 'Z';
    }
    const d = new Date(str);
    if (isNaN(d.getTime())) return '-';

    const now = new Date();
    const diffMs = now - d;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);

    if (diffSec >= 0 && diffSec < 60) return '방금 전';
    if (diffMin >= 0 && diffMin < 60) return `${diffMin}분 전`;

    const isToday = d.toDateString() === now.toDateString();
    const pad = (n) => String(n).padStart(2, '0');
    const hh = pad(d.getHours());
    const mm = pad(d.getMinutes());

    if (isToday) return `오늘 ${hh}:${mm}`;

    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    if (d.getFullYear() === now.getFullYear()) {
      return `${month}.${day} ${hh}:${mm}`;
    }
    return `${String(d.getFullYear()).slice(2)}.${month}.${day}`;
  }

  function fmtFullDate(raw) {
    if (!raw) return '';
    let str = String(raw);
    if (!str.includes('T') && !str.endsWith('Z')) {
      str = str.replace(' ', 'T') + 'Z';
    }
    const d = new Date(str);
    if (isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function bestScore() {
    return ranking.length ? ranking[0].score : 0;
  }

  function renderRank(table, limit, highlight = -1) {
    if (!table) return;
    const rows = ranking.slice(0, limit);
    if (!rows.length) {
      table.innerHTML = '<tr><td class="empty" colspan="5">아직 기록이 없습니다</td></tr>';
      return;
    }
    const thead = (
      '<thead><tr>' +
        '<th class="rk">순위</th>' +
        '<th class="nm">이름</th>' +
        '<th class="sc">점수</th>' +
        '<th class="ln">줄</th>' +
        '<th class="dt">기록일시</th>' +
      '</tr></thead>'
    );
    const tbody = rows.map((r, i) => {
      const rankNum = i + 1;
      let topClass = '';
      let medal = '';
      if (rankNum === 1) {
        topClass = 'top-1';
        medal = '<span class="medal-icon gold" title="1위">🥇</span>';
      } else if (rankNum === 2) {
        topClass = 'top-2';
        medal = '<span class="medal-icon silver" title="2위">🥈</span>';
      } else if (rankNum === 3) {
        topClass = 'top-3';
        medal = '<span class="medal-icon bronze" title="3위">🥉</span>';
      }
      const rawDate = r.created_at || r.date;
      const dateDisplay = fmtDate(rawDate);
      const fullDate = fmtFullDate(rawDate);
      return (
        `<tr class="${topClass} ${i === highlight ? 'me' : ''}">` +
        `<td class="rk"><span class="rk-val">${medal ? `${medal} ${rankNum}` : rankNum}</span></td>` +
        `<td class="nm">${esc(r.name)}</td>` +
        `<td class="sc">${fmt(r.score)}</td>` +
        `<td class="ln">${r.lines}L</td>` +
        `<td class="dt" title="${esc(fullDate)}"><span class="dt-val">${esc(dateDisplay)}</span></td></tr>`
      );
    }).join('');
    table.innerHTML = thead + '<tbody>' + tbody + '</tbody>';
  }

  function qualifies(score) {
    return score > 0 && (ranking.length < MAX_RANK || score > ranking[ranking.length - 1].score);
  }

  function addRank(entry) {
    if (!entry.created_at && entry.date) {
      entry.created_at = entry.date;
    }
    ranking.push(entry);
    ranking.sort((a, b) => b.score - a.score || b.lines - a.lines);
    ranking = ranking.slice(0, MAX_RANK);
    save(rankKey(), ranking);
    return ranking.indexOf(entry);
  }

  async function fetchRankings() {
    const apiUrl = typeof RANKING_API_URL !== 'undefined' ? RANKING_API_URL : '/api/ranking';
    const m = mode;
    try {
      const res = await fetch(`${apiUrl}?limit=${MAX_RANK}&mode=${m}`, {
        headers: { 'Accept': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        if (m !== mode) return ranking; // mode changed while loading
        if (data.success && Array.isArray(data.rankings)) {
          if (data.mode) serverModes = true;
          // A server without modes ignores ?mode and sends classic scores.
          if (m !== 'classic' && data.mode !== m) return ranking;
          ranking = data.rankings;
          save(rankKey(), ranking);
          return ranking;
        }
      }
    } catch (_) {
      // offline: keep the local ranking
    }
    return ranking;
  }

  async function submitScore(entry) {
    const localIdx = addRank(entry);
    // Until the server knows about modes, keep spin scores local so they
    // don't land on the classic board.
    if (mode !== 'classic' && !serverModes) return localIdx;
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
          await fetchRankings();
          const onlineIdx = ranking.findIndex(
            (r) => r.name === entry.name && r.score === entry.score && r.lines === entry.lines
          );
          return onlineIdx >= 0 ? onlineIdx : localIdx;
        }
      }
    } catch (_) {
      // offline: the local entry stays
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
    game.start(1, mode);
    showScreen(null);
    audio.startBgm(game.level);
    el.pauseBtn.textContent = '⏸';
    pendingResult = null;
    el.nameForm.hidden = true;
    if (chat) chat.pausePolling();
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
    renderRank(el.startBoard, MAX_RANK);
    fetchRankings().then(() => renderRank(el.startBoard, MAX_RANK));
    showScreen('start');
    el.pauseBtn.textContent = '⏸';
    if (chat) chat.resumePolling();
  }

  function setMode(next) {
    mode = next === 'spin' ? 'spin' : 'classic';
    settings.mode = mode;
    save(LS_SETTINGS, settings);
    const info = MODES[mode];
    document.body.dataset.mode = mode;
    document.querySelectorAll('.mode-btn').forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    });
    el.modeTagline.innerHTML = info.tagline;
    el.titleName.textContent = info.title;
    document.querySelectorAll('.rank-title').forEach((h) => { h.textContent = info.rank; });
    ranking = load(rankKey(), []);
    renderRank(el.startBoard, MAX_RANK);
    hud.best = -1;
    fetchRankings().then(() => renderRank(el.startBoard, MAX_RANK));
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
  game.on('clearstart', ({ rows, count, spin, tspin }) => {
    audio.clear(count, !!spin || tspin);
    if (count === 4) burstHearts(rows);
  });
  game.on('score', ({ points, lines, spin, tspin, b2b, combo }) => {
    let label = '';
    if (spin) {
      label = spin.name + (lines ? ' ' + LINE_NAMES[lines] : '');
    } else if (lines === 4) label = 'TETRIS!';
    else if (lines) label = LINE_NAMES[lines];
    if (b2b) label = 'B2B ' + label;
    if (label) {
      const cls = lines === 4 ? 'big' : spin ? (spin.mini ? 'spin-mini' : 'big tspin') : '';
      pop(label, cls);
    }
    if (combo >= 1) pop(`COMBO ×${combo}`, 'combo');
    if (points) pop(`+${fmt(points)}`, 'pts');
  });
  game.on('levelup', (lv) => {
    audio.levelUp();
    audio.setLevel(lv);
    pop(`LEVEL ${lv} · SPEED UP`, 'level');
    bump(el.level);
  });
  game.on('gameover', async (r) => {
    if (chat) chat.resumePolling();
    audio.stopBgm();
    audio.gameOver();
    el.overScore.textContent = fmt(r.score);
    el.overLines.textContent = r.lines;
    el.overLevel.textContent = r.level;
    el.overTime.textContent = fmtTime(r.stats.time);
    let q = qualifies(r.score);
    el.nameForm.hidden = !q;
    renderRank(el.overBoard, MAX_RANK);
    showScreen('over');
    if (q) {
      el.nameInput.value = (chat && chat.myNickname) || settings.name || '';
      setTimeout(() => el.nameInput.focus(), 50);
    }

    // Refresh online rankings from D1 and re-evaluate qualification
    await fetchRankings();
    q = qualifies(r.score);
    if (!pendingResult && q) {
      pendingResult = r;
      el.nameForm.hidden = false;
      el.nameInput.value = (chat && chat.myNickname) || settings.name || '';
    }
    renderRank(el.overBoard, MAX_RANK);
  });

  // ---- UI wiring ------------------------------------------------------------
  el.nameForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pendingResult) return;
    const name = el.nameInput.value.trim().slice(0, 10);
    if (!name) {
      el.nameInput.classList.remove('input-error');
      void el.nameInput.offsetWidth;
      el.nameInput.classList.add('input-error');
      el.nameInput.focus();
      showToast('⚠️ 랭킹에 등록할 닉네임을 입력해주세요!');
      return;
    }
    settings.name = name;
    save(LS_SETTINGS, settings);
    if (chat) chat.setNickname(name);
    const entry = {
      name,
      score: pendingResult.score,
      lines: pendingResult.lines,
      level: pendingResult.level,
      mode,
      date: new Date().toISOString(),
      created_at: new Date().toISOString(),
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

  function syncSoundButtons() {
    el.sfxBtn.classList.toggle('off', !audio.sfxOn);
    el.sfxBtn.textContent = audio.sfxOn ? '🔊' : '🔇';
    el.bgmBtn.classList.toggle('off', !audio.bgmOn);
    renderTrackSelectors();
  }

  // ---- BGM Track Selection --------------------------------------------------
  let toastTimer = null;
  function showToast(msg) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.hidden = true;
    }, 1800);
  }
  window.showTetrisToast = showToast;

  function renderTrackSelectors() {
    const tracks = audio.getTracks();
    const current = audio.getCurrentTrack();

    if (el.bgmLabel) {
      el.bgmLabel.textContent = `${current.code}: ${current.name}`;
    }

    if (el.bgmDropdownList) {
      el.bgmDropdownList.innerHTML = tracks.map((t) => {
        const isActive = t.id === current.id;
        return (
          `<button class="bgm-dropdown-item ${isActive ? 'active' : ''}" type="button" data-track="${t.id}">` +
            `<div class="bgm-item-main">` +
              `<span class="bgm-item-icon">${t.icon}</span>` +
              `<div class="bgm-item-info">` +
                `<span class="bgm-item-name">${t.code}: ${t.name}</span>` +
                `<span class="bgm-item-desc">${t.desc}</span>` +
              `</div>` +
            `</div>` +
            (isActive && audio.bgmOn ? '<div class="eq-bars"><i class="eq-bar"></i><i class="eq-bar"></i><i class="eq-bar"></i></div>' : '') +
          `</button>`
        );
      }).join('');
    }

    if (el.startTrackGrid) {
      el.startTrackGrid.innerHTML = tracks.map((t) => {
        const isActive = t.id === current.id;
        return (
          `<button class="music-card ${isActive ? 'active' : ''}" type="button" data-track="${t.id}">` +
            `<div class="card-main">` +
              `<span class="card-icon">${t.icon}</span>` +
              `<div class="card-info">` +
                `<span class="card-code">${t.code}</span>` +
                `<span class="card-title">${t.name}</span>` +
                `<span class="card-desc">${t.desc}</span>` +
              `</div>` +
            `</div>` +
            (isActive && audio.bgmOn ? '<div class="eq-bars"><i class="eq-bar"></i><i class="eq-bar"></i><i class="eq-bar"></i></div>' : '') +
          `</button>`
        );
      }).join('');
    }

    if (el.pauseTrackGrid) {
      el.pauseTrackGrid.innerHTML = tracks.map((t) => {
        const isActive = t.id === current.id;
        return (
          `<button class="music-card ${isActive ? 'active' : ''}" type="button" data-track="${t.id}">` +
            `<div class="card-main">` +
              `<span class="card-icon">${t.icon}</span>` +
              `<div class="card-info">` +
                `<span class="card-code">${t.code}</span>` +
                `<span class="card-title">${t.name}</span>` +
              `</div>` +
            `</div>` +
            (isActive && audio.bgmOn ? '<div class="eq-bars"><i class="eq-bar"></i><i class="eq-bar"></i><i class="eq-bar"></i></div>' : '') +
          `</button>`
        );
      }).join('');
    }
  }

  function selectBgmTrack(trackId, preview = true) {
    audio.ensure();
    const shouldPreview = preview && (game.state === 'playing' || el.screens.start.classList.contains('active') || el.screens.pause.classList.contains('active'));
    audio.setTrack(trackId, shouldPreview);
    settings.bgmTrack = trackId;
    save(LS_SETTINGS, settings);
    renderTrackSelectors();
    const cur = audio.getCurrentTrack();
    showToast(`🎵 ${cur.code}: ${cur.name}`);
    if (el.bgmDropdown) el.bgmDropdown.hidden = true;
    if (el.bgmCtrl) el.bgmCtrl.classList.remove('open');
  }

  function cycleBgmTrack() {
    audio.ensure();
    const cur = audio.nextTrack();
    settings.bgmTrack = cur.id;
    save(LS_SETTINGS, settings);
    renderTrackSelectors();
    showToast(`🎵 ${cur.code}: ${cur.name}`);
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
    if (audio.bgmOn) {
      audio.ensure();
      if (game.state === 'playing' || el.screens.start.classList.contains('active') || el.screens.pause.classList.contains('active')) {
        audio.startBgm(game.level);
      }
    } else {
      audio.stopBgm();
    }
  });

  if (el.bgmMenuBtn) {
    el.bgmMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !el.bgmDropdown.hidden;
      el.bgmDropdown.hidden = isOpen;
      el.bgmCtrl.classList.toggle('open', !isOpen);
    });
  }
  document.addEventListener('click', (e) => {
    if (el.bgmCtrl && !el.bgmCtrl.contains(e.target)) {
      if (el.bgmDropdown) el.bgmDropdown.hidden = true;
      el.bgmCtrl.classList.remove('open');
    }
  });

  function handleTrackClick(e) {
    const btn = e.target.closest('[data-track]');
    if (!btn) return;
    const trackId = btn.dataset.track;
    selectBgmTrack(trackId, true);
  }
  if (el.bgmDropdownList) el.bgmDropdownList.addEventListener('click', handleTrackClick);
  if (el.startTrackGrid) el.startTrackGrid.addEventListener('click', handleTrackClick);
  if (el.pauseTrackGrid) el.pauseTrackGrid.addEventListener('click', handleTrackClick);

  el.pauseBtn.addEventListener('click', togglePause);
  el.fullBtn.addEventListener('click', toggleFullscreen);
  el.startBtn.addEventListener('click', startGame);
  el.resumeBtn.addEventListener('click', resumeGame);
  el.restartBtn.addEventListener('click', startGame);
  el.againBtn.addEventListener('click', startGame);
  el.menuBtn.addEventListener('click', toMenu);
  document.querySelectorAll('.mode-btn').forEach((b) => {
    b.addEventListener('click', () => setMode(b.dataset.mode));
  });

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
    cycleBgm: cycleBgmTrack,
    fullscreen: toggleFullscreen,
    toggleMode: () => setMode(mode === 'spin' ? 'classic' : 'spin'),
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
  setMode(mode);
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
