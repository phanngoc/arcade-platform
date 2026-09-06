/*
 * Rumba engine — Binairo / Tohu-wa-Vohu (LinkedIn "Tango" family) puzzle logic.
 *
 * Rules on an N x N grid (N even), two symbols 0 (SUN) and 1 (MOON):
 *   1. Each row and each column has exactly N/2 of each symbol (balance).
 *   2. No three of the same symbol consecutive in any row or column.
 *   3. "=" between two orthogonally-adjacent cells => they must be equal.
 *      "x" between two adjacent cells => they must differ.
 *
 * A puzzle is: fixed cell givens + a subset of edge constraints, with a
 * unique solution.
 *
 * This file works both in the browser (defines global `Rumba`) and in Node
 * (module.exports), so the generator/solver can be unit-tested with `node`.
 */
(function (root) {
  'use strict';

  var EQ = 1;   // "=" constraint
  var NE = 2;   // "x" constraint

  // ---- seedable PRNG (mulberry32) so "daily" puzzles are reproducible ----
  function makeRng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  // ---------------------------------------------------------------------
  // Full-solution generator: random valid completed grid.
  // ---------------------------------------------------------------------
  function generateSolution(N, rng) {
    var half = N / 2;
    var board = new Int8Array(N * N).fill(-1);
    var rowCount = [new Int16Array(N), new Int16Array(N)]; // rowCount[v][r]
    var colCount = [new Int16Array(N), new Int16Array(N)];

    function idx(r, c) { return r * N + c; }

    // would placing v at (r,c) keep the partial grid legal (balance + no-3)?
    function ok(r, c, v) {
      if (rowCount[v][r] >= half) return false;
      if (colCount[v][c] >= half) return false;
      // horizontal triple: (r,c-2)(r,c-1)(r,c)
      if (c >= 2 && board[idx(r, c - 1)] === v && board[idx(r, c - 2)] === v) return false;
      // vertical triple
      if (r >= 2 && board[idx(r - 1, c)] === v && board[idx(r - 2, c)] === v) return false;
      return true;
    }

    function solve(pos) {
      if (pos === N * N) return true;
      var r = (pos / N) | 0, c = pos % N;
      var vals = rng() < 0.5 ? [0, 1] : [1, 0];
      for (var k = 0; k < 2; k++) {
        var v = vals[k];
        if (!ok(r, c, v)) continue;
        board[idx(r, c)] = v;
        rowCount[v][r]++; colCount[v][c]++;
        if (solve(pos + 1)) return true;
        board[idx(r, c)] = -1;
        rowCount[v][r]--; colCount[v][c]--;
      }
      return false;
    }

    solve(0);
    return board;
  }

  // ---------------------------------------------------------------------
  // Backtracking solver — counts solutions up to `limit` (default 2).
  // puzzle: { N, cells:Int8Array(-1 empty / 0 / 1), hRel, vRel }
  //   hRel[r*(N-1)+c] : constraint between (r,c)-(r,c+1), 0/EQ/NE
  //   vRel[r*N+c]     : constraint between (r,c)-(r+1,c), 0/EQ/NE
  // ---------------------------------------------------------------------
  function countSolutions(puzzle, limit) {
    limit = limit || 2;
    var N = puzzle.N, half = N / 2;
    var board = Int8Array.from(puzzle.cells);
    var hRel = puzzle.hRel, vRel = puzzle.vRel;
    var rowCount = [new Int16Array(N), new Int16Array(N)];
    var colCount = [new Int16Array(N), new Int16Array(N)];
    var order = [];

    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) {
        var v = board[r * N + c];
        if (v >= 0) { rowCount[v][r]++; colCount[v][c]++; }
        else order.push(r * N + c);
      }
    }

    function relOk(r, c, v) {
      // check the (up to 4) constraints touching (r,c) against already-set neighbours
      var i;
      if (c > 0) { i = board[r * N + (c - 1)]; if (i >= 0) { var rel = hRel[r * (N - 1) + (c - 1)]; if (rel === EQ && i !== v) return false; if (rel === NE && i === v) return false; } }
      if (c < N - 1) { i = board[r * N + (c + 1)]; if (i >= 0) { var rel2 = hRel[r * (N - 1) + c]; if (rel2 === EQ && i !== v) return false; if (rel2 === NE && i === v) return false; } }
      if (r > 0) { i = board[(r - 1) * N + c]; if (i >= 0) { var rel3 = vRel[(r - 1) * N + c]; if (rel3 === EQ && i !== v) return false; if (rel3 === NE && i === v) return false; } }
      if (r < N - 1) { i = board[(r + 1) * N + c]; if (i >= 0) { var rel4 = vRel[r * N + c]; if (rel4 === EQ && i !== v) return false; if (rel4 === NE && i === v) return false; } }
      return true;
    }

    function noTriple(r, c, v) {
      if (c >= 2 && board[r * N + c - 1] === v && board[r * N + c - 2] === v) return false;
      if (c <= N - 3 && board[r * N + c + 1] === v && board[r * N + c + 2] === v) return false;
      if (c >= 1 && c <= N - 2 && board[r * N + c - 1] === v && board[r * N + c + 1] === v) return false;
      if (r >= 2 && board[(r - 1) * N + c] === v && board[(r - 2) * N + c] === v) return false;
      if (r <= N - 3 && board[(r + 1) * N + c] === v && board[(r + 2) * N + c] === v) return false;
      if (r >= 1 && r <= N - 2 && board[(r - 1) * N + c] === v && board[(r + 1) * N + c] === v) return false;
      return true;
    }

    function legal(r, c, v) {
      if (rowCount[v][r] >= half) return false;
      if (colCount[v][c] >= half) return false;
      if (!noTriple(r, c, v)) return false;
      if (!relOk(r, c, v)) return false;
      return true;
    }

    var found = 0;
    function search(k) {
      if (found >= limit) return;
      if (k === order.length) { found++; return; }
      var pos = order[k];
      var r = (pos / N) | 0, c = pos % N;
      for (var v = 0; v < 2; v++) {
        if (!legal(r, c, v)) continue;
        board[pos] = v; rowCount[v][r]++; colCount[v][c]++;
        search(k + 1);
        board[pos] = -1; rowCount[v][r]--; colCount[v][c]--;
        if (found >= limit) return;
      }
    }
    search(0);
    return found;
  }

  // ---------------------------------------------------------------------
  // Logic solver — deduction only (no guessing). Returns how far pure logic
  // gets. Used for hints and difficulty grading.
  // Returns { board, solved, steps } where steps lists forced fills in order.
  // ---------------------------------------------------------------------
  function logicSolve(puzzle) {
    var N = puzzle.N, half = N / 2;
    var board = Int8Array.from(puzzle.cells);
    var hRel = puzzle.hRel, vRel = puzzle.vRel;
    var steps = [];

    function get(r, c) { return (r < 0 || c < 0 || r >= N || c >= N) ? -2 : board[r * N + c]; }
    function set(r, c, v, reason) {
      if (board[r * N + c] === -1) { board[r * N + c] = v; steps.push({ r: r, c: c, v: v, reason: reason }); return true; }
      return false;
    }
    function rel(r1, c1, r2, c2) {
      if (r1 === r2) { var c = Math.min(c1, c2); return hRel[r1 * (N - 1) + c]; }
      var rr = Math.min(r1, r2); return vRel[rr * N + c1];
    }

    var changed = true, guard = 0;
    while (changed && guard++ < 10000) {
      changed = false;

      // Rule A: constraint propagation (= / x)
      for (var r = 0; r < N; r++) {
        for (var c = 0; c < N; c++) {
          var v = board[r * N + c];
          if (v < 0) continue;
          // horizontal edge to the right
          if (c < N - 1) {
            var hr = hRel[r * (N - 1) + c];
            if (hr === EQ && set(r, c + 1, v, 'eq')) changed = true;
            else if (hr === NE && set(r, c + 1, 1 - v, 'ne')) changed = true;
          }
          if (c > 0) {
            var hl = hRel[r * (N - 1) + (c - 1)];
            if (hl === EQ && set(r, c - 1, v, 'eq')) changed = true;
            else if (hl === NE && set(r, c - 1, 1 - v, 'ne')) changed = true;
          }
          if (r < N - 1) {
            var vd = vRel[r * N + c];
            if (vd === EQ && set(r + 1, c, v, 'eq')) changed = true;
            else if (vd === NE && set(r + 1, c, 1 - v, 'ne')) changed = true;
          }
          if (r > 0) {
            var vu = vRel[(r - 1) * N + c];
            if (vu === EQ && set(r - 1, c, v, 'eq')) changed = true;
            else if (vu === NE && set(r - 1, c, 1 - v, 'ne')) changed = true;
          }
        }
      }

      // Rule B: no-three (fill the forced opposite)
      for (var r2 = 0; r2 < N; r2++) {
        for (var c2 = 0; c2 < N; c2++) {
          // horizontal patterns around (r2,c2)
          // pair XX -> flanks are 1-X
          if (c2 < N - 1) {
            var a = get(r2, c2), b = get(r2, c2 + 1);
            if (a >= 0 && a === b) {
              if (get(r2, c2 - 1) === -1 && set(r2, c2 - 1, 1 - a, 'no3')) changed = true;
              if (get(r2, c2 + 2) === -1 && set(r2, c2 + 2, 1 - a, 'no3')) changed = true;
            }
          }
          // gap X_X -> middle is 1-X
          if (c2 < N - 2) {
            var l = get(r2, c2), m = get(r2, c2 + 1), rr2 = get(r2, c2 + 2);
            if (l >= 0 && l === rr2 && m === -1) { if (set(r2, c2 + 1, 1 - l, 'no3')) changed = true; }
          }
          // vertical pair
          if (r2 < N - 1) {
            var a2 = get(r2, c2), b2 = get(r2 + 1, c2);
            if (a2 >= 0 && a2 === b2) {
              if (get(r2 - 1, c2) === -1 && set(r2 - 1, c2, 1 - a2, 'no3')) changed = true;
              if (get(r2 + 2, c2) === -1 && set(r2 + 2, c2, 1 - a2, 'no3')) changed = true;
            }
          }
          if (r2 < N - 2) {
            var u = get(r2, c2), mm = get(r2 + 1, c2), d = get(r2 + 2, c2);
            if (u >= 0 && u === d && mm === -1) { if (set(r2 + 1, c2, 1 - u, 'no3')) changed = true; }
          }
        }
      }

      // Rule C: balance (a line that already has N/2 of a symbol -> rest are opposite)
      for (var line = 0; line < N; line++) {
        var cnt0 = 0, cnt1 = 0, i;
        for (i = 0; i < N; i++) { var vv = board[line * N + i]; if (vv === 0) cnt0++; else if (vv === 1) cnt1++; }
        if (cnt0 === half && cnt0 + cnt1 < N) for (i = 0; i < N; i++) { if (board[line * N + i] === -1 && set(line, i, 1, 'balance')) changed = true; }
        if (cnt1 === half && cnt0 + cnt1 < N) for (i = 0; i < N; i++) { if (board[line * N + i] === -1 && set(line, i, 0, 'balance')) changed = true; }
        cnt0 = 0; cnt1 = 0;
        for (i = 0; i < N; i++) { var wv = board[i * N + line]; if (wv === 0) cnt0++; else if (wv === 1) cnt1++; }
        if (cnt0 === half && cnt0 + cnt1 < N) for (i = 0; i < N; i++) { if (board[i * N + line] === -1 && set(i, line, 1, 'balance')) changed = true; }
        if (cnt1 === half && cnt0 + cnt1 < N) for (i = 0; i < N; i++) { if (board[i * N + line] === -1 && set(i, line, 0, 'balance')) changed = true; }
      }
    }

    var solved = true;
    for (var q = 0; q < N * N; q++) if (board[q] < 0) { solved = false; break; }
    return { board: board, solved: solved, steps: steps };
  }

  // ---------------------------------------------------------------------
  // Puzzle generator.
  //   opts: { N, difficulty: 'easy'|'medium'|'hard', seed }
  // Returns { N, solution, cells, given, hRel, vRel, difficulty, stats }
  //
  // Strategy: start from a fully-clued board (all cells given + all edge
  // constraints) and greedily remove clues. The removal *predicate* is what
  // sets difficulty:
  //   hard   -> keep only uniqueness (result may require guessing)
  //   medium -> keep uniqueness AND pure-logic solvability
  //   easy   -> like medium, then reveal a handful of extra given cells
  // ---------------------------------------------------------------------
  function generate(opts) {
    opts = opts || {};
    var N = opts.N || 6;
    var difficulty = opts.difficulty || 'medium';
    var seed = (opts.seed == null) ? (Math.floor(Math.random() * 2147483647)) : opts.seed;
    var rng = makeRng(seed);

    var sol = generateSolution(N, rng);

    // full edge-constraint tables derived from the solution
    var r, c, i;
    var hFull = new Int8Array(N * (N - 1));
    var vTable = new Int8Array((N - 1) * N);
    for (r = 0; r < N; r++)
      for (c = 0; c < N - 1; c++)
        hFull[r * (N - 1) + c] = (sol[r * N + c] === sol[r * N + c + 1]) ? EQ : NE;
    for (r = 0; r < N - 1; r++)
      for (c = 0; c < N; c++)
        vTable[r * N + c] = (sol[r * N + c] === sol[(r + 1) * N + c]) ? EQ : NE;

    var hRel = Int8Array.from(hFull);
    var vRel = Int8Array.from(vTable);
    var cells = Int8Array.from(sol);
    var given = new Uint8Array(N * N).fill(1);

    function puzzleView() { return { N: N, cells: cells, hRel: hRel, vRel: vRel }; }

    // build removal order; try edges/cells interleaved but cells first so the
    // finished puzzle leans on constraints (Tango-style, fewer fixed cells)
    var clues = [];
    for (i = 0; i < N * N; i++) clues.push({ t: 'c', i: i });
    for (i = 0; i < hRel.length; i++) clues.push({ t: 'h', i: i });
    for (i = 0; i < vRel.length; i++) clues.push({ t: 'v', i: i });
    shuffle(clues, rng);
    clues.sort(function (a, b) { return (a.t === 'c' ? 0 : 1) - (b.t === 'c' ? 0 : 1); });

    var requireLogic = (difficulty !== 'hard');

    for (var k = 0; k < clues.length; k++) {
      var cl = clues[k], saved;
      if (cl.t === 'h') { saved = hRel[cl.i]; if (!saved) continue; hRel[cl.i] = 0; }
      else if (cl.t === 'v') { saved = vRel[cl.i]; if (!saved) continue; vRel[cl.i] = 0; }
      else { saved = cells[cl.i]; if (saved < 0) continue; cells[cl.i] = -1; given[cl.i] = 0; }

      var keepRemoved = countSolutions(puzzleView(), 2) === 1;
      if (keepRemoved && requireLogic) keepRemoved = logicSolve(puzzleView()).solved;

      if (!keepRemoved) { // revert
        if (cl.t === 'h') hRel[cl.i] = saved;
        else if (cl.t === 'v') vRel[cl.i] = saved;
        else { cells[cl.i] = saved; given[cl.i] = 1; }
      }
    }

    // easy: reveal extra given cells on top of the logic-solvable core
    if (difficulty === 'easy') {
      var empties = [];
      for (i = 0; i < N * N; i++) if (cells[i] < 0) empties.push(i);
      shuffle(empties, rng);
      var extra = Math.round(N * N * 0.18);
      for (i = 0; i < empties.length && extra > 0; i++, extra--) {
        cells[empties[i]] = sol[empties[i]];
        given[empties[i]] = 1;
      }
    }

    var nGiven = 0, nCon = 0;
    for (i = 0; i < cells.length; i++) if (cells[i] >= 0) nGiven++;
    for (i = 0; i < hRel.length; i++) if (hRel[i]) nCon++;
    for (i = 0; i < vRel.length; i++) if (vRel[i]) nCon++;
    var logicSolvable = logicSolve(puzzleView()).solved;

    return {
      N: N, difficulty: difficulty, seed: seed,
      solution: sol, cells: cells, given: given, hRel: hRel, vRel: vRel,
      stats: { givens: nGiven, constraints: nCon, logicSolvable: logicSolvable }
    };
  }

  var Rumba = {
    EQ: EQ, NE: NE,
    makeRng: makeRng, shuffle: shuffle,
    generateSolution: generateSolution,
    countSolutions: countSolutions,
    logicSolve: logicSolve,
    generate: generate
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Rumba;
  root.Rumba = Rumba;
})(typeof window !== 'undefined' ? window : globalThis);
