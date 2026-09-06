/* Rumba UI controller. Depends on engine.js (global Rumba). */
(function () {
  'use strict';
  var R = window.Rumba;
  var EQ = R.EQ, NE = R.NE;

  // ---- SVG glyphs (accessible: distinct shape + colour) ----
  var SUN_SVG = '<svg class="glyph" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="5" fill="#fff5df"/>' +
    [0,45,90,135,180,225,270,315].map(function (a) {
      var rad = a * Math.PI / 180, x1 = 12 + Math.cos(rad) * 8, y1 = 12 + Math.sin(rad) * 8, x2 = 12 + Math.cos(rad) * 10.5, y2 = 12 + Math.sin(rad) * 10.5;
      return '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="#fff5df" stroke-width="2" stroke-linecap="round"/>';
    }).join('') + '</svg>';
  var MOON_SVG = '<svg class="glyph" viewBox="0 0 24 24"><path d="M15.5 3.2A9 9 0 1 0 20.8 14 7.2 7.2 0 0 1 15.5 3.2z" fill="#eef1ff"/></svg>';

  // ---- DOM refs ----
  var boardEl = document.getElementById('board');
  var timerEl = document.getElementById('timer');
  var remainEl = document.getElementById('remain');
  var modeVEl = document.getElementById('modeV');
  var modeKEl = document.getElementById('modeK');
  var hintLineEl = document.getElementById('hintLine');

  // ---- state ----
  var state = {
    N: 6, diff: 'easy', mode: 'free',
    puz: null, board: null, given: null,
    history: [], hints: 0, logicSteps: [],
    started: 0, elapsed: 0, timerId: 0, done: false, seed: 0
  };

  // ---------------- layout ----------------
  function layout() {
    var N = state.N;
    var maxW = Math.min(window.innerWidth - 24, 460);
    var gapRatio = 0.4;
    var cell = Math.floor(maxW / (N + gapRatio * (N - 1)));
    cell = Math.max(30, Math.min(cell, 72));
    var gap = Math.max(12, Math.round(cell * gapRatio));
    document.documentElement.style.setProperty('--cell', cell + 'px');
    document.documentElement.style.setProperty('--gap', gap + 'px');
    // radius scales a touch with cell
    document.documentElement.style.setProperty('--radius', Math.round(cell * 0.28) + 'px');
    var tmpl = [];
    for (var i = 0; i < 2 * N - 1; i++) tmpl.push(i % 2 === 0 ? 'var(--cell)' : 'var(--gap)');
    var t = tmpl.join(' ');
    boardEl.style.gridTemplateColumns = t;
    boardEl.style.gridTemplateRows = t;
  }

  // ---------------- build board DOM ----------------
  var tileEls = [], hBadge = [], vBadge = [];
  function buildBoard() {
    var N = state.N, puz = state.puz;
    boardEl.innerHTML = '';
    tileEls = new Array(N * N);
    hBadge = new Array(N * (N - 1));
    vBadge = new Array((N - 1) * N);

    for (var R2 = 0; R2 < 2 * N - 1; R2++) {
      for (var C2 = 0; C2 < 2 * N - 1; C2++) {
        var el;
        if (R2 % 2 === 0 && C2 % 2 === 0) {
          var r = R2 / 2, c = C2 / 2, pos = r * N + c;
          el = document.createElement('div');
          el.className = 'tile';
          el.dataset.pos = pos;
          tileEls[pos] = el;
        } else if (R2 % 2 === 0 && C2 % 2 === 1) {
          // horizontal gutter between (r,c)-(r,c+1)
          var rh = R2 / 2, ch = (C2 - 1) / 2, hi = rh * (N - 1) + ch;
          el = document.createElement('div');
          el.className = 'gutter';
          var relh = puz.hRel[hi];
          if (relh) { var b = document.createElement('div'); b.className = 'badge ' + (relh === EQ ? 'eq' : 'ne'); b.textContent = relh === EQ ? '=' : '×'; el.appendChild(b); hBadge[hi] = b; }
        } else if (R2 % 2 === 1 && C2 % 2 === 0) {
          var rv = (R2 - 1) / 2, cv = C2 / 2, vi = rv * N + cv;
          el = document.createElement('div');
          el.className = 'gutter';
          var relv = puz.vRel[vi];
          if (relv) { var b2 = document.createElement('div'); b2.className = 'badge ' + (relv === EQ ? 'eq' : 'ne'); b2.textContent = relv === EQ ? '=' : '×'; el.appendChild(b2); vBadge[vi] = b2; }
        } else {
          el = document.createElement('div'); el.className = 'gutter';
        }
        boardEl.appendChild(el);
      }
    }
  }

  // ---------------- error detection ----------------
  function computeErrors() {
    var N = state.N, half = N / 2, b = state.board;
    var cellErr = new Uint8Array(N * N);
    var hErr = {}, vErr = {};

    // triples
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) {
        var v = b[r * N + c];
        if (v < 0) continue;
        if (c <= N - 3 && b[r * N + c + 1] === v && b[r * N + c + 2] === v) { cellErr[r * N + c] = cellErr[r * N + c + 1] = cellErr[r * N + c + 2] = 1; }
        if (r <= N - 3 && b[(r + 1) * N + c] === v && b[(r + 2) * N + c] === v) { cellErr[r * N + c] = cellErr[(r + 1) * N + c] = cellErr[(r + 2) * N + c] = 1; }
      }
    }
    // balance overflow
    for (var line = 0; line < N; line++) {
      var c0 = 0, c1 = 0, k;
      for (k = 0; k < N; k++) { var x = b[line * N + k]; if (x === 0) c0++; else if (x === 1) c1++; }
      if (c0 > half) for (k = 0; k < N; k++) if (b[line * N + k] === 0) cellErr[line * N + k] = 1;
      if (c1 > half) for (k = 0; k < N; k++) if (b[line * N + k] === 1) cellErr[line * N + k] = 1;
      c0 = 0; c1 = 0;
      for (k = 0; k < N; k++) { var y = b[k * N + line]; if (y === 0) c0++; else if (y === 1) c1++; }
      if (c0 > half) for (k = 0; k < N; k++) if (b[k * N + line] === 0) cellErr[k * N + line] = 1;
      if (c1 > half) for (k = 0; k < N; k++) if (b[k * N + line] === 1) cellErr[k * N + line] = 1;
    }
    // constraints
    var puz = state.puz;
    for (var rr = 0; rr < N; rr++) for (var cc = 0; cc < N - 1; cc++) {
      var rel = puz.hRel[rr * (N - 1) + cc]; if (!rel) continue;
      var a = b[rr * N + cc], bb = b[rr * N + cc + 1];
      if (a < 0 || bb < 0) continue;
      if ((rel === EQ && a !== bb) || (rel === NE && a === bb)) { cellErr[rr * N + cc] = cellErr[rr * N + cc + 1] = 1; hErr[rr * (N - 1) + cc] = 1; }
    }
    for (var r3 = 0; r3 < N - 1; r3++) for (var c3 = 0; c3 < N; c3++) {
      var rel2 = puz.vRel[r3 * N + c3]; if (!rel2) continue;
      var u = b[r3 * N + c3], d = b[(r3 + 1) * N + c3];
      if (u < 0 || d < 0) continue;
      if ((rel2 === EQ && u !== d) || (rel2 === NE && u === d)) { cellErr[r3 * N + c3] = cellErr[(r3 + 1) * N + c3] = 1; vErr[r3 * N + c3] = 1; }
    }
    return { cell: cellErr, h: hErr, v: vErr };
  }

  // ---------------- render ----------------
  function render() {
    var N = state.N, b = state.board, g = state.given;
    var errs = computeErrors();
    var empty = 0;
    for (var pos = 0; pos < N * N; pos++) {
      var el = tileEls[pos], v = b[pos];
      var cls = 'tile';
      if (v === 0) cls += ' sun'; else if (v === 1) cls += ' moon';
      if (g[pos]) cls += ' given lock';
      if (errs.cell[pos]) cls += ' err';
      el.className = cls;
      var want = v === 0 ? SUN_SVG : v === 1 ? MOON_SVG : '';
      if (el._v !== v) { el.innerHTML = want; el._v = v; }
      if (v < 0) empty++;
    }
    // badges error state
    for (var i = 0; i < hBadge.length; i++) if (hBadge[i]) hBadge[i].classList.toggle('err', !!errs.h[i]);
    for (var j = 0; j < vBadge.length; j++) if (vBadge[j]) vBadge[j].classList.toggle('err', !!errs.v[j]);
    remainEl.textContent = empty === 0 ? '0' : String(empty);

    // win?
    if (!state.done && empty === 0) {
      var hasErr = false;
      for (var e = 0; e < errs.cell.length; e++) if (errs.cell[e]) { hasErr = true; break; }
      if (!hasErr) win();
    }
  }

  // ---------------- timer ----------------
  function fmt(s) { var m = Math.floor(s / 60); var ss = s % 60; return m + ':' + (ss < 10 ? '0' : '') + ss; }
  function startTimer() {
    if (state.timerId || state.done) return;
    state.started = Date.now() - state.elapsed * 1000;
    state.timerId = setInterval(function () {
      state.elapsed = Math.floor((Date.now() - state.started) / 1000);
      timerEl.textContent = fmt(state.elapsed);
    }, 250);
  }
  function stopTimer() { if (state.timerId) { clearInterval(state.timerId); state.timerId = 0; } }

  // ---------------- moves ----------------
  function setCell(pos, v, isHint) {
    state.history.push({ pos: pos, prev: state.board[pos] });
    state.board[pos] = v;
    startTimer();
    render();
    if (isHint) flash(pos);
  }
  function flash(pos) {
    var el = tileEls[pos]; if (!el) return;
    el.classList.remove('hintflash'); void el.offsetWidth; el.classList.add('hintflash');
  }

  function onTap(pos) {
    if (state.done || state.given[pos]) { if (state.given[pos]) nudge(pos); return; }
    var cur = state.board[pos];
    var next = cur === -1 ? 0 : cur === 0 ? 1 : -1;
    setCell(pos, next, false);
  }
  function nudge(pos) {
    var el = tileEls[pos]; if (!el) return;
    el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 180 });
  }

  boardEl.addEventListener('click', function (e) {
    var t = e.target.closest('.tile'); if (!t) return;
    onTap(+t.dataset.pos);
  });

  // ---------------- hint ----------------
  function hint() {
    if (state.done) return;
    hintLineEl.textContent = '';
    // clear any wrong cells the user placed that block the next logical step?
    // Strategy: use precomputed logic step order from the clean puzzle.
    var b = state.board, sol = state.puz.solution, N = state.N;

    // 1) if a user cell is wrong, point it out first
    for (var p = 0; p < N * N; p++) {
      if (!state.given[p] && b[p] >= 0 && b[p] !== sol[p]) {
        setCell(p, -1, false);
        state.hints++;
        hintLineEl.innerHTML = 'Một ô đang sai đã được <b>gỡ ra</b>.';
        flash(p);
        return;
      }
    }
    // 2) reveal the next logically-forced empty cell
    for (var s = 0; s < state.logicSteps.length; s++) {
      var st = state.logicSteps[s];
      var pos = st.r * N + st.c;
      if (b[pos] === -1) {
        setCell(pos, st.v, true);
        state.hints++;
        hintLineEl.innerHTML = 'Gợi ý: ' + reasonText(st.reason) + '.';
        return;
      }
    }
    // 3) fallback (hard puzzles): reveal a correct empty cell
    var empties = [];
    for (var q = 0; q < N * N; q++) if (b[q] === -1) empties.push(q);
    if (empties.length) {
      var pick = empties[Math.floor(Math.random() * empties.length)];
      setCell(pick, sol[pick], true);
      state.hints++;
      hintLineEl.innerHTML = 'Gợi ý: đã mở một ô đúng.';
    }
  }
  function reasonText(reason) {
    switch (reason) {
      case 'eq': return 'dấu = buộc hai ô giống nhau';
      case 'ne': return 'dấu × buộc hai ô khác nhau';
      case 'no3': return 'tránh ba ô liền nhau giống nhau';
      case 'balance': return 'hàng/cột đã đủ một loại';
      default: return 'suy luận được ô này';
    }
  }

  // ---------------- undo / erase ----------------
  function undo() {
    if (state.done || !state.history.length) return;
    var m = state.history.pop();
    state.board[m.pos] = m.prev;
    render();
  }
  function erase() {
    if (state.done) return;
    for (var p = 0; p < state.N * state.N; p++) if (!state.given[p]) state.board[p] = -1;
    state.history = [];
    hintLineEl.textContent = '';
    render();
  }

  // ---------------- new game ----------------
  function todaySeed() {
    var d = new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }
  function newGame(mode) {
    stopTimer();
    state.mode = mode || 'free';
    var seed;
    if (state.mode === 'daily') {
      // deterministic per day + size + difficulty
      seed = todaySeed() * 100 + state.N + (state.diff === 'easy' ? 1 : state.diff === 'medium' ? 2 : 3) * 10;
    } else {
      seed = (Math.floor(Math.random() * 2147483647));
    }
    state.seed = seed;
    var puz = R.generate({ N: state.N, difficulty: state.diff, seed: seed });
    state.puz = puz;
    state.given = puz.given;
    state.board = Int8Array.from(puz.cells);
    state.history = [];
    state.hints = 0;
    state.elapsed = 0; state.started = 0; state.done = false;
    state.logicSteps = R.logicSolve({ N: puz.N, cells: puz.cells, hRel: puz.hRel, vRel: puz.vRel }).steps;
    timerEl.textContent = '0:00';
    hintLineEl.textContent = '';
    if (state.mode === 'daily') {
      var d = new Date();
      modeKEl.textContent = 'Hôm nay';
      modeVEl.textContent = d.getDate() + '/' + (d.getMonth() + 1);
    } else {
      modeKEl.textContent = 'Chế độ'; modeVEl.textContent = 'Tự do';
    }
    layout();
    buildBoard();
    render();
  }

  // ---------------- win ----------------
  function statKey() { return state.N + '-' + state.diff; }
  function loadStats() { try { return JSON.parse(localStorage.getItem('rumba_stats') || '{}'); } catch (e) { return {}; } }
  function saveStats(s) { try { localStorage.setItem('rumba_stats', JSON.stringify(s)); } catch (e) {} }

  function win() {
    state.done = true;
    stopTimer();
    var stats = loadStats();
    stats.best = stats.best || {};
    var key = statKey();
    var prev = stats.best[key];
    var noHint = state.hints === 0;
    var isRecord = false;
    if (noHint && (prev == null || state.elapsed < prev)) { stats.best[key] = state.elapsed; isRecord = true; }
    stats.solves = (stats.solves || 0) + 1;
    if (state.mode === 'daily') {
      stats.daily = stats.daily || {};
      stats.daily[state.seed] = state.elapsed;
    }
    saveStats(stats);

    document.getElementById('winTime').textContent = fmt(state.elapsed);
    document.getElementById('winHints').textContent = String(state.hints);
    document.getElementById('winBest').textContent = stats.best[key] != null ? fmt(stats.best[key]) : '–';
    document.getElementById('winSub').textContent =
      (state.mode === 'daily' ? 'Câu đố hôm nay · ' : '') +
      state.N + '×' + state.N + ' · ' + diffLabel(state.diff) +
      (isRecord ? ' · Kỷ lục mới! 🏆' : (noHint ? '' : ' · có dùng gợi ý'));
    document.getElementById('overlay').classList.add('show');
    confetti();
  }
  function diffLabel(d) { return d === 'easy' ? 'Dễ' : d === 'medium' ? 'Vừa' : 'Khó'; }

  function confetti() {
    var host = document.createElement('div'); host.className = 'confetti';
    var cols = ['#ffce54', '#f6903d', '#7b8cff', '#4b57d6', '#4bd6a0', '#ff6b7d', '#a99bff'];
    for (var i = 0; i < 90; i++) {
      var p = document.createElement('i');
      p.style.left = Math.random() * 100 + 'vw';
      p.style.background = cols[i % cols.length];
      p.style.animationDuration = (1.6 + Math.random() * 1.6) + 's';
      p.style.animationDelay = (Math.random() * 0.4) + 's';
      p.style.transform = 'rotate(' + (Math.random() * 360) + 'deg)';
      host.appendChild(p);
    }
    document.body.appendChild(host);
    setTimeout(function () { host.remove(); }, 3600);
  }

  // ---------------- controls wiring ----------------
  document.getElementById('sizeSeg').addEventListener('click', function (e) {
    var btn = e.target.closest('button'); if (!btn) return;
    [].forEach.call(this.children, function (b) { b.classList.remove('on'); });
    btn.classList.add('on');
    state.N = +btn.dataset.size;
    newGame(state.mode);
  });
  document.getElementById('diffSeg').addEventListener('click', function (e) {
    var btn = e.target.closest('button'); if (!btn) return;
    [].forEach.call(this.children, function (b) { b.classList.remove('on'); });
    btn.classList.add('on');
    state.diff = btn.dataset.diff;
    newGame(state.mode);
  });
  document.getElementById('undoBtn').addEventListener('click', undo);
  document.getElementById('eraseBtn').addEventListener('click', erase);
  document.getElementById('hintBtn').addEventListener('click', hint);
  document.getElementById('newBtn').addEventListener('click', function () { newGame('free'); });
  document.getElementById('dailyBtn').addEventListener('click', function () { newGame('daily'); });

  document.getElementById('winReplay').addEventListener('click', function () {
    document.getElementById('overlay').classList.remove('show');
    // replay same puzzle
    state.board = Int8Array.from(state.puz.cells);
    state.history = []; state.hints = 0; state.elapsed = 0; state.started = 0; state.done = false;
    timerEl.textContent = '0:00'; hintLineEl.textContent = '';
    render();
  });
  document.getElementById('winNext').addEventListener('click', function () {
    document.getElementById('overlay').classList.remove('show');
    newGame(state.mode);
  });

  // help modal
  var help = document.getElementById('help');
  document.getElementById('helpBtn').addEventListener('click', function () { help.classList.add('show'); });
  document.getElementById('helpClose').addEventListener('click', function () { help.classList.remove('show'); });
  help.addEventListener('click', function (e) { if (e.target === help) help.classList.remove('show'); });

  window.addEventListener('resize', function () { layout(); });
  window.addEventListener('orientationchange', function () { setTimeout(layout, 200); });

  // first-run help
  try { if (!localStorage.getItem('rumba_seen')) { help.classList.add('show'); localStorage.setItem('rumba_seen', '1'); } } catch (e) {}

  // optional debug hooks (only when ?debug=1) for automated QA
  if (/[?&]debug=1/.test(location.search)) {
    window.__rumba = {
      state: state,
      solveNow: function () {
        for (var p = 0; p < state.N * state.N; p++) state.board[p] = state.puz.solution[p];
        startTimer(); render();
      },
      newGame: newGame
    };
  }

  // go
  newGame('free');
})();
