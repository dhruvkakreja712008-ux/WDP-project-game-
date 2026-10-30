'use strict';
(function () {

  /* =====================================================
     Helpers
     ===================================================== */
  const $ = (s, r = document) => r.querySelector(s);
  const rand = (a, b) => a + Math.random() * (b - a);
  const ri = (a, b) => Math.floor(rand(a, b + 1));
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = ri(0, i); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mk = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

  const store = {
    get(k, d) { try { const v = localStorage.getItem('gamezone.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('gamezone.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  };

  const COLORS = { blue: '#00d4ff', purple: '#a855f7', green: '#39ff88', pink: '#ff4fa3', gold: '#ffd23f', space: '#05060b', white: '#ffffff' };
  const DIFFS = ['easy', 'medium', 'hard'];
  const DLABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
  const MULT = { easy: 1, medium: 1.5, hard: 2 };

  const CATS = [
    { id: 'mind', icon: '🧠', name: 'Mind Games', tag: 'Train your memory, knowledge and speed of thought.' },
    { id: 'action', icon: '⚡', name: 'Action Games', tag: 'Fast reflexes, quick clicks and arcade thrills.' },
    { id: 'puzzle', icon: '🧩', name: 'Puzzle Games', tag: 'Slow down, plan ahead and crack the puzzle.' }
  ];

  /* =====================================================
     Sound (Web Audio, no files needed)
     ===================================================== */
  let soundOn = store.get('sound', true);
  let actx = null;

  function tone(freq, dur, type, vol, delay, slideTo) {
    if (!soundOn) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const t = actx.currentTime + (delay || 0);
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(vol || 0.07, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(actx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* audio not available */ }
  }

  const sfx = {
    click: () => tone(520, 0.07, 'square', 0.035),
    flip: () => tone(420, 0.06, 'sine', 0.07),
    good: () => { tone(660, 0.1, 'triangle', 0.09); tone(990, 0.14, 'triangle', 0.09, 0.09); },
    bad: () => tone(190, 0.25, 'sawtooth', 0.06, 0, 90),
    shoot: () => tone(900, 0.07, 'square', 0.02, 0, 300),
    boom: () => tone(170, 0.2, 'sawtooth', 0.05, 0, 50),
    pop: () => tone(760, 0.08, 'sine', 0.08, 0, 1100),
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 'triangle', 0.09, i * 0.11)),
    lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.2, 'sawtooth', 0.05, i * 0.14))
  };

  function paintSound() {
    const b = $('#soundBtn');
    b.textContent = 'Sound: ' + (soundOn ? 'On' : 'Off');
    b.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
  }

  /* =====================================================
     Player + leaderboard (saved in this browser)
     ===================================================== */
  let board = store.get('board', []);
  if (!Array.isArray(board)) board = [];

  const playerName = () => (store.get('player', '') || '').trim() || 'Player';
  const bestOf = id => board.filter(e => e.g === id).reduce((m, e) => Math.max(m, e.s), 0);

  function saveScore(id, diff, score) {
    if (score <= 0) return false;
    const isBest = score > bestOf(id);
    board.push({ g: id, n: playerName(), s: score, d: diff, t: Date.now() });
    board.sort((a, b) => b.s - a.s);
    board = board.slice(0, 200);
    store.set('board', board);
    return isBest;
  }

  /* =====================================================
     Game session plumbing
     ===================================================== */
  let S = null;            // running session
  let curId = null;        // game shown in the game view
  let curDiff = store.get('diff', 'medium');
  if (!DIFFS.includes(curDiff)) curDiff = 'medium';

  function stopSession() {
    if (S) { S.cleanups.forEach(f => { try { f(); } catch (e) { /* ignore */ } }); }
    S = null;
  }

  function setScoreText(n) { $('#hScore').textContent = Math.round(n); }
  function setTimerText(t) { $('#hTime').textContent = t == null ? '--' : t; }

  function makeApi(stage) {
    const s = S;
    const api = {
      root: stage,
      diff: s.diff,
      d: DIFFS.indexOf(s.diff),
      sfx,
      pick: arr => arr[api.d],
      setScore(n) { s.raw = n; setScoreText(n); },
      setTimer: setTimerText,
      cleanup(fn) { s.cleanups.push(fn); },
      on(t, ev, fn, o) { t.addEventListener(ev, fn, o); s.cleanups.push(() => t.removeEventListener(ev, fn, o)); },
      every(fn, ms) { const id = setInterval(fn, ms); s.cleanups.push(() => clearInterval(id)); return id; },
      later(fn, ms) { const id = setTimeout(fn, ms); s.cleanups.push(() => clearTimeout(id)); return id; },
      frames(fn) {
        let last = performance.now(), id = 0, on = true;
        const loop = t => {
          if (!on) return;
          const dt = Math.min(0.05, (t - last) / 1000); last = t;
          fn(dt);
          if (on) id = requestAnimationFrame(loop);
        };
        id = requestAnimationFrame(loop);
        s.cleanups.push(() => { on = false; cancelAnimationFrame(id); });
      },
      countdown(sec, onEnd, onTick) {
        const end = Date.now() + sec * 1000;
        let alive = true, lastShown = -1;
        const id = setInterval(() => {
          if (!alive) return;
          const left = end - Date.now();
          const shown = Math.max(0, Math.ceil(left / 1000));
          api.setTimer(shown);
          if (shown !== lastShown && shown <= 5 && shown > 0) sfx.click();
          lastShown = shown;
          if (onTick) onTick(left, sec * 1000);
          if (left <= 0) { alive = false; clearInterval(id); if (onEnd) onEnd(); }
        }, 100);
        api.setTimer(sec);
        const stop = () => { alive = false; clearInterval(id); };
        s.cleanups.push(stop);
        return { stop, left: () => Math.max(0, end - Date.now()) / 1000 };
      },
      end(raw, detail) { finish(raw, detail); }
    };
    return api;
  }

  function startGame() {
    const g = GAME_BY_ID[curId];
    if (!g) return;
    stopSession();
    const stage = $('#stage');
    stage.innerHTML = '';
    stage.className = 'stage';
    stage.hidden = false;
    $('#setup').hidden = true;
    $('#runbar').hidden = false;
    S = { g, diff: curDiff, cleanups: [], ended: false, raw: 0 };
    setScoreText(0);
    setTimerText(null);
    sfx.click();
    g.run(makeApi(stage));
  }

  function backToSetup() {
    stopSession();
    $('#stage').hidden = true;
    $('#stage').innerHTML = '';
    $('#runbar').hidden = true;
    $('#setup').hidden = false;
    setScoreText(0);
    setTimerText(null);
  }

  function finish(raw, detail) {
    if (!S || S.ended) return;
    S.ended = true;
    S.cleanups.forEach(f => { try { f(); } catch (e) { /* ignore */ } });
    S.cleanups = [];
    const g = S.g, diff = S.diff;
    raw = Math.max(0, Math.round(raw));
    const mult = MULT[diff];
    const final = Math.round(raw * mult);
    const isBest = saveScore(g.id, diff, final);
    setScoreText(final);
    $('#hBest').textContent = bestOf(g.id);
    $('#runbar').hidden = true;
    if (final > 0) sfx.win(); else sfx.lose();

    const o = mk('div', 'overlay',
      '<h3>Game Over</h3>' +
      '<div class="bigscore">' + final + '</div>' +
      '<p>' + esc(detail || '') + '</p>' +
      '<p class="muted">' + raw + ' &times; ' + mult + ' (' + DLABEL[diff] + ') &middot; saved as ' + esc(playerName()) + '</p>' +
      (isBest ? '<p class="newbest">New high score!</p>' : '') +
      '<div class="row"><button type="button" class="btn" data-act="again">Play Again</button>' +
      '<button type="button" class="btn ghost" data-act="level">Change Level</button>' +
      '<button type="button" class="btn ghost" data-go="leaderboard">Leaderboard</button></div>');
    $('#stage').appendChild(o);
    $('[data-act="again"]', o).addEventListener('click', startGame);
    $('[data-act="level"]', o).addEventListener('click', backToSetup);
    $('[data-act="again"]', o).focus({ preventScroll: true });
  }

  /* =====================================================
     Canvas helper
     ===================================================== */
  function makeCanvas(api, W, H) {
    api.root.classList.add('flush');
    const cv = mk('canvas', 'cv');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr;
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', 'Game area');
    api.root.appendChild(cv);
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H }; };
    return { cv, ctx, pos, W, H };
  }

  function burst(arr, x, y, col) {
    for (let k = 0; k < 10; k++) {
      const a = rand(0, 6.28), sp = rand(40, 160);
      arr.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: rand(0.3, 0.6), col });
    }
  }

  /* =====================================================
     GAME 1: Memory Match (timed)
     ===================================================== */
  function memory(api) {
    const pairs = api.pick([6, 8, 12]);
    const secs = api.pick([60, 75, 100]);
    const cols = api.pick([4, 4, 6]);
    const syms = ['◆', '●', '▲', '■', '★', '✚', '☾', '♥', '☀', '♣', '♠', '☂'].slice(0, pairs);
    const deck = shuffle(syms.concat(syms));

    api.root.innerHTML =
      '<div class="stats"><span>Moves<b id="mm">0</b></span><span>Pairs<b id="mp">0</b>/' + pairs + '</span></div>' +
      '<div class="mgrid" style="grid-template-columns:repeat(' + cols + ',1fr)"></div>';
    const grid = $('.mgrid', api.root);
    deck.forEach((s, i) => {
      const b = mk('button', 'mcard');
      b.type = 'button';
      b.dataset.s = s;
      b.setAttribute('aria-label', 'Card ' + (i + 1));
      b.innerHTML = '<span class="mi"><span class="mb"></span><span class="mf s' + (syms.indexOf(s) % 4) + '">' + s + '</span></span>';
      grid.appendChild(b);
    });

    let first = null, lock = false, moves = 0, found = 0;
    const cd = api.countdown(secs, () => api.end(found * 100, 'Time is up · ' + found + ' of ' + pairs + ' pairs'));

    api.on(grid, 'click', e => {
      const c = e.target.closest('.mcard');
      if (!c || lock || c === first || c.classList.contains('matched') || c.classList.contains('flipped')) return;
      sfx.flip();
      c.classList.add('flipped');
      if (!first) { first = c; return; }
      moves++;
      $('#mm').textContent = moves;
      if (first.dataset.s === c.dataset.s) {
        first.classList.add('matched'); c.classList.add('matched');
        first.classList.remove('flipped'); c.classList.remove('flipped');
        first = null; found++;
        $('#mp').textContent = found;
        api.setScore(found * 100);
        sfx.good();
        if (found === pairs) {
          const left = Math.ceil(cd.left());
          cd.stop();
          const bonus = left * 5 + Math.max(0, 200 - (moves - pairs) * 10);
          api.later(() => api.end(found * 100 + bonus, moves + ' moves · ' + left + 's left'), 500);
        }
      } else {
        lock = true;
        const a = first; first = null;
        api.later(() => { a.classList.remove('flipped'); c.classList.remove('flipped'); lock = false; }, 700);
      }
    });
  }

  /* =====================================================
     GAME 2: Quiz Challenge (timed per question)
     ===================================================== */
  const QUIZ = [
    ['Which planet is the largest in our solar system?', ['Mercury', 'Mars', 'Jupiter', 'Saturn'], 2],
    ['What is the capital of Australia?', ['Sydney', 'Melbourne', 'Canberra', 'Perth'], 2],
    ['What is the chemical symbol for gold?', ['Ag', 'Au', 'Gd', 'Go'], 1],
    ['How many sides does a hexagon have?', ['5', '6', '7', '8'], 1],
    ['Who wrote "Romeo and Juliet"?', ['Charles Dickens', 'William Shakespeare', 'Jane Austen', 'Leo Tolstoy'], 1],
    ['Which is the largest ocean on Earth?', ['Atlantic', 'Indian', 'Arctic', 'Pacific'], 3],
    ['What is the national animal of India?', ['Lion', 'Elephant', 'Bengal tiger', 'Peacock'], 2],
    ['Which gas do plants absorb for photosynthesis?', ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Hydrogen'], 2],
    ['What is the hardest natural substance?', ['Gold', 'Iron', 'Quartz', 'Diamond'], 3],
    ['In which year did India become independent?', ['1945', '1947', '1950', '1952'], 1],
    ['What is the smallest prime number?', ['0', '1', '2', '3'], 2],
    ['Which planet is known as the Red Planet?', ['Venus', 'Mars', 'Jupiter', 'Mercury'], 1],
    ['What is the capital of Japan?', ['Kyoto', 'Osaka', 'Tokyo', 'Nagoya'], 2],
    ['How many players are on the field for one cricket team?', ['9', '10', '11', '12'], 2],
    ['At sea level, water boils at how many degrees Celsius?', ['90', '100', '110', '120'], 1],
    ['Who painted the Mona Lisa?', ['Michelangelo', 'Pablo Picasso', 'Vincent van Gogh', 'Leonardo da Vinci'], 3],
    ['How many continents are there?', ['5', '6', '7', '8'], 2],
    ['What is the largest mammal in the world?', ['African elephant', 'Blue whale', 'Giraffe', 'Polar bear'], 1],
    ['Which organ pumps blood around the body?', ['Liver', 'Lungs', 'Kidney', 'Heart'], 3],
    ['What is the square root of 144?', ['10', '11', '12', '14'], 2]
  ];

  function quiz(api) {
    const T = api.pick([20, 15, 10]);
    const qs = shuffle(QUIZ).slice(0, 10);
    api.root.innerHTML =
      '<div class="stats"><span>Question<b id="qn">1</b>/10</span><span>Streak<b id="qk">0</b></span></div>' +
      '<div class="bar"><i id="qbar"></i></div><h3 class="qtext" id="qtext"></h3><div class="opts" id="opts"></div>';
    let i = 0, score = 0, streak = 0, right = 0, locked = false, cd = null;

    function show() {
      locked = false;
      const q = qs[i];
      $('#qn').textContent = i + 1;
      $('#qtext').textContent = q[0];
      const box = $('#opts'); box.innerHTML = '';
      shuffle(q[1].map((t, k) => ({ t, ok: k === q[2] }))).forEach(o => {
        const b = mk('button', 'opt'); b.type = 'button'; b.textContent = o.t; b.dataset.ok = o.ok ? '1' : '0';
        b.addEventListener('click', () => settle(b));
        box.appendChild(b);
      });
      if (cd) cd.stop();
      cd = api.countdown(T, () => settle(null), left => { $('#qbar').style.width = Math.max(0, left / (T * 1000) * 100) + '%'; });
    }

    function settle(chosen) {
      if (locked) return;
      locked = true;
      const left = cd ? Math.ceil(cd.left()) : 0;
      if (cd) cd.stop();
      [...$('#opts').children].forEach(b => { b.disabled = true; if (b.dataset.ok === '1') b.classList.add('ok'); });
      if (chosen && chosen.dataset.ok === '1') {
        score += 100 + left * 4 + Math.min(streak, 5) * 10;
        streak++; right++; sfx.good();
      } else {
        if (chosen) chosen.classList.add('bad');
        streak = 0; sfx.bad();
      }
      api.setScore(score);
      $('#qk').textContent = streak;
      api.later(() => {
        i++;
        if (i >= qs.length) api.end(score, right + ' of ' + qs.length + ' correct');
        else show();
      }, 1200);
    }
    show();
  }

  /* =====================================================
     GAME 3: Math Master (timed)
     ===================================================== */
  function mathMaster(api) {
    const d = api.d;
    const secs = [60, 60, 45][d];
    const ops = [['+', '-'], ['+', '-', '×'], ['+', '-', '×', '÷']][d];
    const max = [20, 50, 100][d];
    const mulMax = [0, 10, 15][d];
    const divMax = [0, 10, 15][d];

    function gen() {
      const op = ops[ri(0, ops.length - 1)];
      let a, b;
      if (op === '+') { a = ri(2, max); b = ri(2, max); return { q: a + ' + ' + b, a: a + b }; }
      if (op === '-') { a = ri(5, max); b = ri(1, a); return { q: a + ' − ' + b, a: a - b }; }
      if (op === '×') { a = ri(2, mulMax); b = ri(2, mulMax); return { q: a + ' × ' + b, a: a * b }; }
      b = ri(2, divMax); const r = ri(2, divMax); return { q: (b * r) + ' ÷ ' + b, a: r };
    }

    api.root.innerHTML =
      '<div class="stats"><span>Solved<b id="xs">0</b></span><span>Streak<b id="xk">0</b></span></div>' +
      '<div class="bar"><i id="xbar"></i></div><div class="mathq" id="xq">&nbsp;</div>' +
      '<input id="ans" class="field" type="text" inputmode="numeric" autocomplete="off" maxlength="4" aria-label="Your answer" placeholder="Type the answer">' +
      '<p class="hint" id="xh">The answer is checked as you type. Press Enter on an empty box to skip.</p>';
    const input = $('#ans');
    let cur = gen(), solved = 0, streak = 0, score = 0;

    const next = () => { cur = gen(); $('#xq').textContent = cur.q + ' = ?'; input.value = ''; };
    const wrong = () => {
      streak = 0; $('#xk').textContent = 0; sfx.bad();
      input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake');
      input.value = '';
    };
    const check = v => {
      if (Number(v) === cur.a) {
        score += 10 + Math.min(streak, 10);
        streak++; solved++;
        $('#xs').textContent = solved; $('#xk').textContent = streak;
        api.setScore(score); sfx.good(); next();
      } else wrong();
    };

    api.on(input, 'input', () => {
      const v = input.value.replace(/\D/g, '');
      input.value = v;
      if (v && v.length >= String(cur.a).length) check(v);
    });
    api.on(input, 'keydown', e => {
      if (e.key === 'Enter') { if (input.value) check(input.value); else { streak = 0; $('#xk').textContent = 0; next(); } }
    });
    api.countdown(secs, () => api.end(score, solved + ' solved'), left => { $('#xbar').style.width = Math.max(0, left / (secs * 1000) * 100) + '%'; });
    next();
    input.focus({ preventScroll: true });
  }

  /* =====================================================
     GAME 4: Space Shooter
     ===================================================== */
  function shooter(api) {
    const { cv, ctx, pos, W, H } = makeCanvas(api, 360, 520);
    const lives0 = api.pick([5, 3, 2]), spd = api.pick([0.8, 1, 1.3]), spawn0 = api.pick([1.1, 0.9, 0.7]);
    const stars = Array.from({ length: 40 }, () => ({ x: rand(0, W), y: rand(0, H), s: rand(10, 40), r: rand(0.5, 1.6) }));
    const ship = { x: W / 2, y: H - 50 };
    let target = W / 2, bullets = [], foes = [], parts = [];
    let score = 0, lives = lives0, inv = 0, fireT = 0, spawnT = 0.8, time = 0;
    const keys = { L: false, R: false };

    api.on(cv, 'pointermove', e => { target = pos(e).x; });
    api.on(cv, 'pointerdown', e => { target = pos(e).x; try { cv.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } });
    api.on(window, 'keydown', e => {
      if (e.key === 'ArrowLeft' || e.key === 'a') { keys.L = true; e.preventDefault(); }
      if (e.key === 'ArrowRight' || e.key === 'd') { keys.R = true; e.preventDefault(); }
    });
    api.on(window, 'keyup', e => {
      if (e.key === 'ArrowLeft' || e.key === 'a') keys.L = false;
      if (e.key === 'ArrowRight' || e.key === 'd') keys.R = false;
    });

    function update(dt) {
      time += dt;
      const lvl = 1 + Math.floor(score / 150);
      if (keys.L) { ship.x -= 300 * dt; target = ship.x; }
      else if (keys.R) { ship.x += 300 * dt; target = ship.x; }
      else ship.x += (target - ship.x) * Math.min(1, 12 * dt);
      ship.x = Math.max(20, Math.min(W - 20, ship.x));
      inv = Math.max(0, inv - dt);

      fireT -= dt;
      if (fireT <= 0) { bullets.push({ x: ship.x, y: ship.y - 22 }); fireT = 0.24; sfx.shoot(); }
      bullets.forEach(b => { b.y -= 520 * dt; });
      bullets = bullets.filter(b => b.y > -10);

      spawnT -= dt;
      if (spawnT <= 0) {
        const big = Math.random() < Math.min(0.3, 0.05 + lvl * 0.04);
        foes.push({ x: rand(24, W - 24), y: -24, r: big ? 24 : 15, hp: big ? 3 : 1, max: big ? 3 : 1, vy: ((big ? 55 : 80) + lvl * 10 + rand(0, 30)) * spd, vx: rand(-20, 20), pts: big ? 30 : 10 });
        spawnT = Math.max(0.3, spawn0 - lvl * 0.07);
      }
      foes.forEach(f => { f.y += f.vy * dt; f.x += f.vx * dt; if (f.x < f.r || f.x > W - f.r) f.vx *= -1; });

      bullets.forEach(b => {
        for (const f of foes) {
          if (f.hp > 0 && Math.hypot(b.x - f.x, b.y - f.y) < f.r + 3) {
            f.hp--; b.y = -100;
            if (f.hp <= 0) { score += f.pts; api.setScore(score); burst(parts, f.x, f.y, f.max > 1 ? COLORS.pink : COLORS.gold); sfx.pop(); }
            break;
          }
        }
      });
      foes = foes.filter(f => f.hp > 0 && f.y < H + 40);

      if (!inv) {
        for (const f of foes) {
          if (Math.hypot(f.x - ship.x, f.y - ship.y) < f.r + 14) {
            f.hp = 0; lives--; inv = 1.4; burst(parts, ship.x, ship.y, COLORS.blue); sfx.boom();
            if (lives <= 0) api.end(score, 'Reached level ' + lvl);
            break;
          }
        }
        foes = foes.filter(f => f.hp > 0);
      }
      parts.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.t -= dt; });
      parts = parts.filter(p => p.t > 0);
      stars.forEach(s => { s.y += s.s * dt; if (s.y > H) s.y = 0; });
    }

    function draw() {
      ctx.fillStyle = COLORS.space; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,.7)';
      stars.forEach(s => ctx.fillRect(s.x, s.y, s.r, s.r));
      ctx.fillStyle = COLORS.gold;
      bullets.forEach(b => ctx.fillRect(b.x - 2, b.y - 8, 4, 12));
      foes.forEach(f => {
        ctx.fillStyle = f.max > 1 ? COLORS.pink : COLORS.green;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; ctx.lineTo(f.x + Math.cos(a) * f.r, f.y + Math.sin(a) * f.r); }
        ctx.closePath(); ctx.fill();
        if (f.max > 1) { ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(f.x - f.r, f.y - f.r - 8, f.r * 2 * (f.hp / f.max), 4); }
      });
      if (inv <= 0 || Math.floor(time * 12) % 2 === 0) {
        ctx.fillStyle = COLORS.blue;
        ctx.beginPath();
        ctx.moveTo(ship.x, ship.y - 20); ctx.lineTo(ship.x + 17, ship.y + 16); ctx.lineTo(ship.x, ship.y + 8); ctx.lineTo(ship.x - 17, ship.y + 16);
        ctx.closePath(); ctx.fill();
      }
      parts.forEach(p => { ctx.globalAlpha = Math.max(0, p.t * 2); ctx.fillStyle = p.col; ctx.fillRect(p.x, p.y, 3, 3); });
      ctx.globalAlpha = 1;
      ctx.font = 'bold 18px sans-serif'; ctx.fillStyle = COLORS.pink; ctx.textAlign = 'left';
      for (let k = 0; k < lives; k++) ctx.fillText('♥', 12 + k * 22, 28);
      ctx.fillStyle = COLORS.white; ctx.textAlign = 'right';
      ctx.fillText('LV ' + (1 + Math.floor(score / 150)), W - 12, 28);
    }

    draw();
    api.frames(dt => { update(dt); draw(); });
  }

  /* =====================================================
     GAME 5: Speed Click (timed)
     ===================================================== */
  function speedClick(api) {
    const lifeStart = api.pick([1600, 1300, 1000]);
    const lifeMin = api.pick([900, 700, 500]);
    const sizeStart = api.pick([72, 64, 52]);
    api.root.innerHTML =
      '<div class="stats"><span>Hits<b id="ch">0</b></span><span>Misses<b id="cm">0</b></span><span>Combo<b id="cc">0</b></span></div><div class="arena" id="arena"></div>';
    const arena = $('#arena');
    let hits = 0, miss = 0, combo = 0, score = 0, tgt = null, tTimer = 0, running = true;
    api.countdown(30, () => { running = false; clearTimeout(tTimer); api.end(score, hits + ' hits · ' + (hits + miss ? Math.round(hits / (hits + miss) * 100) : 0) + '% accuracy'); });
    const upd =() => { $('#ch').textContent = hits; $('#cm').textContent = miss; $('#cc').textContent = combo; };

    function spawn() {
      if (!running) return;
      const life = Math.max(lifeMin, lifeStart - hits * 25);
      const size = Math.max(44, sizeStart - hits * 0.5);
      const w = arena.clientWidth, h = arena.clientHeight;
      const x = rand(8, Math.max(9, w - size - 8)), y = rand(8, Math.max(9, h - size - 8));
      const t = mk('button', 'tgt');
      t.type = 'button';
      t.setAttribute('aria-label', 'Target');
      t.style.cssText = 'left:' + x + 'px;top:' + y + 'px;width:' + size + 'px;height:' + size + 'px;--life:' + life + 'ms';
      const born = Date.now();
      const hit = () => {
        if (tgt !== t) return;
        clearTimeout(tTimer);
        const quick = Math.max(0, Math.round(10 * (1 - (Date.now() - born) / life)));
        combo++; hits++;
        const pts = 10 + quick + Math.min(combo, 10);
        score += pts; api.setScore(score); upd(); sfx.pop();
        const fl = mk('span', 'fl', '+' + pts); fl.style.left = x + 'px'; fl.style.top = y + 'px'; arena.appendChild(fl);
        setTimeout(() => fl.remove(), 600);
        t.classList.add('hit'); tgt = null;
        setTimeout(() => t.remove(), 120);
        setTimeout(spawn, 120);
      };
      t.addEventListener('pointerdown', e => { e.stopPropagation(); hit(); });
      t.addEventListener('click', e => { e.stopPropagation(); if (e.detail === 0) hit(); });
      arena.appendChild(t);
      tgt = t;
      tTimer = setTimeout(() => {
        if (tgt === t) { t.remove(); tgt = null; miss++; combo = 0; upd(); sfx.bad(); setTimeout(spawn, 150); }
      }, life);
    }
    api.on(arena, 'pointerdown', () => { if (running) { miss++; combo = 0; upd(); } });
    api.later(spawn, 300);
    api.cleanup(() => { running = false; clearTimeout(tTimer); });
  }

  /* =====================================================
     GAME 6: Catch the Stars (timed + lives)
     ===================================================== */
  function catchStars(api) {
    const { cv, ctx, pos, W, H } = makeCanvas(api, 360, 520);
    const lives0 = api.pick([5, 3, 2]), spd = api.pick([0.8, 1, 1.25]);
    const BY = H - 40, BW = 70;
    let bx = W / 2, target = W / 2, items = [], parts = [];
    let score = 0, lives = lives0, spawnT = 0.6, flash = 0, left = 45;
    const keys = { L: false, R: false };

    api.countdown(45, () => api.end(score, 'Time is up'), l => { left = Math.ceil(l / 1000); });
    api.on(cv, 'pointermove', e => { target = pos(e).x; });
    api.on(cv, 'pointerdown', e => { target = pos(e).x; try { cv.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } });
    api.on(window, 'keydown', e => {
      if (e.key === 'ArrowLeft' || e.key === 'a') { keys.L = true; e.preventDefault(); }
      if (e.key === 'ArrowRight' || e.key === 'd') { keys.R = true; e.preventDefault(); }
    });
    api.on(window, 'keyup', e => {
      if (e.key === 'ArrowLeft' || e.key === 'a') keys.L = false;
      if (e.key === 'ArrowRight' || e.key === 'd') keys.R = false;
    });

    function starPath(x, y, r) {
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.45 : r;
        ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath();
    }

    function update(dt) {
      if (keys.L) { bx -= 340 * dt; target = bx; } else if (keys.R) { bx += 340 * dt; target = bx; } else bx += (target - bx) * Math.min(1, 14 * dt);
      bx = Math.max(BW / 2, Math.min(W - BW / 2, bx));
      flash = Math.max(0, flash - dt);
      spawnT -= dt;
      if (spawnT <= 0) {
        const roll = Math.random();
        const type = roll < 0.2 ? 'comet' : (roll < 0.3 ? 'big' : 'star');
        items.push({ x: rand(22, W - 22), y: -20, vy: (Math.min(280, 100 + score * 0.3) + rand(0, 40)) * spd, type, dead: false });
        spawnT = Math.max(0.4, 1.05 - score / 700) / spd;
      }
      items.forEach(it => { it.y += it.vy * dt; });
      for (const it of items) {
        if (it.dead) continue;
        if (it.y >= BY - 12 && it.y <= BY + 14 && Math.abs(it.x - bx) < BW / 2 + 8) {
          it.dead = true;
          if (it.type === 'comet') { lives--; flash = 0.3; burst(parts, it.x, it.y, COLORS.pink); sfx.boom(); }
          else { score += it.type === 'big' ? 25 : 10; api.setScore(score); burst(parts, it.x, it.y, COLORS.gold); sfx.pop(); }
        } else if (it.y > H + 20) {
          it.dead = true;
          if (it.type !== 'comet') { lives--; flash = 0.3; sfx.bad(); }
        }
      }
      items = items.filter(i => !i.dead);
      parts.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.t -= dt; });
      parts = parts.filter(p => p.t > 0);
      if (lives <= 0) api.end(score, 'Out of lives');
    }

    function draw() {
      ctx.fillStyle = COLORS.space; ctx.fillRect(0, 0, W, H);
      items.forEach(it => {
        if (it.type === 'comet') {
          ctx.fillStyle = 'rgba(255,79,163,.45)';
          ctx.beginPath(); ctx.moveTo(it.x - 8, it.y - 4); ctx.lineTo(it.x, it.y - 36); ctx.lineTo(it.x + 8, it.y - 4); ctx.fill();
          ctx.fillStyle = COLORS.pink; ctx.beginPath(); ctx.arc(it.x, it.y, 10, 0, 6.29); ctx.fill();
        } else {
          ctx.fillStyle = it.type === 'big' ? COLORS.green : COLORS.gold;
          starPath(it.x, it.y, it.type === 'big' ? 19 : 13); ctx.fill();
        }
      });
      ctx.fillStyle = COLORS.purple;
      ctx.beginPath();
      ctx.moveTo(bx - BW / 2, BY - 10); ctx.lineTo(bx + BW / 2, BY - 10); ctx.lineTo(bx + BW / 2 - 10, BY + 16); ctx.lineTo(bx - BW / 2 + 10, BY + 16);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = COLORS.blue; ctx.fillRect(bx - BW / 2 - 3, BY - 14, BW + 6, 6);
      parts.forEach(p => { ctx.globalAlpha = Math.max(0, p.t * 2); ctx.fillStyle = p.col; ctx.fillRect(p.x, p.y, 3, 3); });
      ctx.globalAlpha = 1;
      if (flash > 0) { ctx.fillStyle = 'rgba(255,79,163,' + (flash * 0.5) + ')'; ctx.fillRect(0, 0, W, H); }
      ctx.font = 'bold 18px sans-serif'; ctx.fillStyle = COLORS.pink; ctx.textAlign = 'left';
      for (let k = 0; k < lives; k++) ctx.fillText('♥', 12 + k * 22, 28);
      ctx.fillStyle = COLORS.white; ctx.textAlign = 'right';
      ctx.fillText(left + 's', W - 12, 28);
    }

    draw();
    api.frames(dt => { update(dt); draw(); });
  }

  /* =====================================================
     GAME 7: Tic-Tac-Toe vs computer (5 rounds)
     ===================================================== */
  function ticTacToe(api) {
    const ROUNDS = 5;
    const randomChance = api.pick([0.7, 0.3, 0]);
    const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
    api.root.innerHTML =
      '<div class="stats"><span>Round<b id="tr">1</b>/' + ROUNDS + '</span><span>Wins<b id="tw">0</b></span><span>Draws<b id="td">0</b></span><span>Losses<b id="tl">0</b></span></div>' +
      '<p class="status" id="ts"></p><div class="ttt" id="tg"></div>' +
      '<div class="row"><button type="button" class="btn" id="tn" hidden>Next Round</button></div>';
    const tg = $('#tg'), status = $('#ts'), nextBtn = $('#tn');
    let b, turn, me, ai, over, round = 0, score = 0, w = 0, d = 0, l = 0;

    const winner = bd => {
      for (const [x, y, z] of LINES) if (bd[x] && bd[x] === bd[y] && bd[x] === bd[z]) return { p: bd[x], line: [x, y, z] };
      return bd.every(Boolean) ? { p: 'draw', line: [] } : null;
    };
    function mm(bd, p, depth) {
      const r = winner(bd);
      if (r) return r.p === ai ? 10 - depth : r.p === me ? depth - 10 : 0;
      let bestV = p === ai ? -99 : 99;
      for (let i = 0; i < 9; i++) {
        if (bd[i]) continue;
        bd[i] = p;
        const v = mm(bd, p === ai ? me : ai, depth + 1);
        bd[i] = '';
        bestV = p === ai ? Math.max(bestV, v) : Math.min(bestV, v);
      }
      return bestV;
    }
    function aiMove() {
      const empty = [];
      for (let i = 0; i < 9; i++) if (!b[i]) empty.push(i);
      if (Math.random() < randomChance) return empty[ri(0, empty.length - 1)];
      let bestV = -99, moves = [];
      for (const i of empty) {
        b[i] = ai; const v = mm(b, me, 1); b[i] = '';
        if (v > bestV) { bestV = v; moves = [i]; } else if (v === bestV) moves.push(i);
      }
      return moves[ri(0, moves.length - 1)];
    }

    const cells = [];
    for (let i = 0; i < 9; i++) {
      const c = mk('button', 'tcell'); c.type = 'button'; c.setAttribute('aria-label', 'Cell ' + (i + 1));
      c.addEventListener('click', () => { if (!over && turn === me && !b[i]) place(i, me); });
      tg.appendChild(c); cells.push(c);
    }
    function render() {
      cells.forEach((c, i) => {
        c.textContent = b[i];
        c.className = 'tcell' + (b[i] === 'X' ? ' x' : b[i] === 'O' ? ' o' : '');
        c.disabled = !!b[i] || over;
      });
    }
    function startRound() {
      b = Array(9).fill(''); over = false; turn = 'X';
      me = round % 2 === 0 ? 'X' : 'O'; ai = me === 'X' ? 'O' : 'X';
      round++;
      $('#tr').textContent = round;
      nextBtn.hidden = true;
      render();
      status.textContent = turn === me ? 'Your turn (' + me + ')' : 'Computer starts (' + ai + ')';
      if (turn === ai) api.later(aiPlay, 500);
    }
    function aiPlay() { if (!over) place(aiMove(), ai); }
    function place(i, p) {
      b[i] = p; sfx.click(); render();
      const r = winner(b);
      if (r) { endRound(r); return; }
      turn = p === 'X' ? 'O' : 'X';
      status.textContent = turn === me ? 'Your turn (' + me + ')' : 'Computer is thinking…';
      if (turn === ai) api.later(aiPlay, 450);
    }
    function endRound(r) {
      over = true; render();
      r.line.forEach(i => cells[i].classList.add('win'));
      if (r.p === me) { w++; score += 10; status.textContent = 'You win this round! +10'; sfx.good(); }
      else if (r.p === 'draw') { d++; score += 4; status.textContent = "It's a draw. +4"; sfx.pop(); }
      else { l++; status.textContent = 'Computer wins this round.'; sfx.bad(); }
      $('#tw').textContent = w; $('#td').textContent = d; $('#tl').textContent = l;
      api.setScore(score);
      if (round >= ROUNDS) api.later(() => api.end(score, w + ' wins · ' + d + ' draws · ' + l + ' losses'), 1300);
      else nextBtn.hidden = false;
    }
    api.on(nextBtn, 'click', startRound);
    startRound();
  }

  /* =====================================================
     GAME 8: 2048
     ===================================================== */
  function game2048(api) {
    const d = api.d;
    const fourChance = [0.2, 0.1, 0.1][d];
    api.root.innerHTML =
      '<div class="stats"><span>Top tile<b id="gt">2</b></span><span>Moves<b id="gm">0</b></span></div>' +
      '<div class="g2048" id="g2048"></div>' +
      '<div class="dpad"><button type="button" data-k="0" aria-label="Left">◀</button><button type="button" data-k="1" aria-label="Up">▲</button><button type="button" data-k="3" aria-label="Down">▼</button><button type="button" data-k="2" aria-label="Right">▶</button></div>' +
      '<p class="hint">Arrow keys, swipe or the buttons. Merge equal tiles to reach 2048.</p>';
    const grid = $('#g2048');
    let g = Array.from({ length: 4 }, () => Array(4).fill(0));
    let score = 0, moves = 0, fresh = -1, done = false;

    function addTile() {
      const e = [];
      g.forEach((r, y) => r.forEach((v, x) => { if (!v) e.push([y, x]); }));
      if (!e.length) return;
      const [y, x] = e[ri(0, e.length - 1)];
      g[y][x] = Math.random() < fourChance ? 4 : 2;
      fresh = y * 4 + x;
    }
    const pct = v => ({ 2: 14, 4: 22, 8: 32, 16: 42, 32: 52, 64: 62, 128: 72, 256: 80, 512: 88, 1024: 94 }[v] || 100);
    function render() {
      grid.innerHTML = '';
      let top = 0;
      g.flat().forEach((v, i) => {
        top = Math.max(top, v);
        const t = mk('div', 'tile' + (v ? '' : ' e') + (i === fresh ? ' pop' : '') + (v >= 2048 ? ' gold' : '') + (v && pct(v) >= 70 ? ' hi' : '') + ' d' + String(v).length);
        t.style.setProperty('--p', pct(v) + '%');
        t.textContent = v || '';
        grid.appendChild(t);
      });
      $('#gt').textContent = top;
      return top;
    }
    function slide(row) {
      const vals = row.filter(Boolean), out = []; let gained = 0;
      for (let i = 0; i < vals.length; i++) {
        if (vals[i] === vals[i + 1]) { out.push(vals[i] * 2); gained += vals[i] * 2; i++; } else out.push(vals[i]);
      }
      while (out.length < 4) out.push(0);
      return { row: out, gained };
    }
    const T = a => a[0].map((_, i) => a.map(r => r[i]));
    function canMove() {
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        if (!g[y][x]) return true;
        if (x < 3 && g[y][x] === g[y][x + 1]) return true;
        if (y < 3 && g[y][x] === g[y + 1][x]) return true;
      }
      return false;
    }
    function move(dir) {
      if (done) return;
      let m = g.map(r => r.slice()), gained = 0;
      if (dir === 1 || dir === 3) m = T(m);
      if (dir === 2 || dir === 3) m = m.map(r => r.reverse());
      m = m.map(r => { const s = slide(r); gained += s.gained; return s.row; });
      if (dir === 2 || dir === 3) m = m.map(r => r.reverse());
      if (dir === 1 || dir === 3) m = T(m);
      if (!m.some((r, y) => r.some((v, x) => v !== g[y][x]))) return;
      g = m; score += gained; moves++;
      $('#gm').textContent = moves;
      addTile();
      if (d === 2 && moves % 3 === 0) addTile();
      const top = render();
      api.setScore(score);
      if (gained) sfx.pop(); else sfx.click();
      if (top >= 2048) { done = true; api.later(() => api.end(score + 2000, 'You reached 2048!'), 400); return; }
      if (!canMove()) { done = true; api.later(() => api.end(score, 'No more moves · top tile ' + top), 400); }
    }

    api.on(window, 'keydown', e => {
      const k = { ArrowLeft: 0, a: 0, ArrowUp: 1, w: 1, ArrowRight: 2, d: 2, ArrowDown: 3, s: 3 }[e.key];
      if (k === undefined) return;
      e.preventDefault(); move(k);
    });
    let sx = 0, sy = 0;
    api.on(grid, 'pointerdown', e => { sx = e.clientX; sy = e.clientY; });
    api.on(grid, 'pointerup', e => {
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 2 : 0); else move(dy > 0 ? 3 : 1);
    });
    api.on($('.dpad', api.root), 'click', e => { const b = e.target.closest('button'); if (b) move(Number(b.dataset.k)); });

    addTile(); addTile(); fresh = -1; render();
  }

  /* =====================================================
     GAME 9: Word Scramble (timed per word)
     ===================================================== */
  const WORDS = {
    easy: [['MANGO', 'Fruit'], ['PLANET', 'Space'], ['GALAXY', 'Space'], ['ROCKET', 'Space'], ['JUNGLE', 'Nature'], ['GUITAR', 'Music'], ['PUZZLE', 'Games'], ['WINDOW', 'Home'], ['DOCTOR', 'Job'], ['BRIDGE', 'Place'], ['MARKET', 'Place'], ['BANANA', 'Fruit'], ['PENCIL', 'School'], ['CAMERA', 'Gadget'], ['TURTLE', 'Animal']],
    medium: [['MONSOON', 'Weather'], ['CRICKET', 'Sport'], ['PEACOCK', 'Bird'], ['DOLPHIN', 'Animal'], ['VILLAGE', 'Place'], ['LANTERN', 'Light'], ['GLACIER', 'Nature'], ['HARVEST', 'Farming'], ['PYRAMID', 'Egypt'], ['ELEPHANT', 'Animal'], ['KEYBOARD', 'Computer'], ['MOUNTAIN', 'Nature']],
    hard: [['CHOCOLATE', 'Food'], ['BUTTERFLY', 'Insect'], ['LIGHTHOUSE', 'Sea'], ['PLAYGROUND', 'Place'], ['CALCULATOR', 'Gadget'], ['UNIVERSITY', 'Education'], ['TELESCOPE', 'Space'], ['ADVENTURE', 'Journey'], ['COMPUTER', 'Technology'], ['DICTIONARY', 'Book'], ['SANDWICH', 'Food'], ['KEYBOARD', 'Computer']]
  };

  function scramble(api) {
    const T = api.pick([40, 30, 20]);
    const ws = shuffle(WORDS[api.diff]).slice(0, 10);
    api.root.innerHTML =
      '<div class="stats"><span>Word<b id="wn">1</b>/10</span><span>Solved<b id="wk">0</b></span></div>' +
      '<div class="bar"><i id="wbar"></i></div><p class="cat" id="wcat"></p><div class="letters" id="wl"></div>' +
      '<input id="wi" class="field" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Your guess" placeholder="Type the word">' +
      '<div class="row"><button type="button" class="btn ghost small" id="wh">Hint (−25)</button><button type="button" class="btn ghost small" id="wsk">Skip</button></div>' +
      '<p class="hint" id="wm">&nbsp;</p>';
    const input = $('#wi');
    let i = 0, score = 0, solved = 0, locked = false, hinted = false, word = '', cd = null;

    function show() {
      locked = false; hinted = false;
      word = ws[i][0];
      let s;
      do { s = shuffle(word.split('')).join(''); } while (s === word);
      $('#wn').textContent = i + 1;
      $('#wcat').textContent = 'Category: ' + ws[i][1] + ' · ' + word.length + ' letters';
      $('#wl').innerHTML = s.split('').map(ch => '<span class="lt">' + ch + '</span>').join('');
      $('#wm').innerHTML = '&nbsp;';
      input.value = '';
      input.focus({ preventScroll: true });
      if (cd) cd.stop();
      cd = api.countdown(T, () => resolve(false), left => { $('#wbar').style.width = Math.max(0, left / (T * 1000) * 100) + '%'; });
    }
    function resolve(ok) {
      if (locked) return;
      locked = true;
      const left = cd ? Math.ceil(cd.left()) : 0;
      if (cd) cd.stop();
      if (ok) {
        const pts = Math.max(10, 50 + left * 3 - (hinted ? 25 : 0));
        score += pts; solved++;
        api.setScore(score); $('#wk').textContent = solved;
        $('#wm').textContent = 'Correct! +' + pts; sfx.good();
      } else {
        $('#wm').textContent = 'The word was ' + word; sfx.bad();
      }
      api.later(() => { i++; if (i >= ws.length) api.end(score, solved + ' of ' + ws.length + ' solved'); else show(); }, ok ? 900 : 1500);
    }
    function check(v) {
      if (locked) return;
      if (v === word) resolve(true);
      else { sfx.bad(); input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake'); input.value = ''; }
    }
    api.on(input, 'input', () => {
      const v = input.value.toUpperCase().replace(/[^A-Z]/g, '');
      input.value = v;
      if (v.length >= word.length) check(v);
    });
    api.on(input, 'keydown', e => { if (e.key === 'Enter' && input.value) check(input.value.toUpperCase()); });
    api.on($('#wh'), 'click', () => { if (locked || hinted) return; hinted = true; $('#wm').textContent = 'Starts with ' + word[0]; sfx.click(); });
    api.on($('#wsk'), 'click', () => resolve(false));
    show();
  }

  /* =====================================================
     Game catalogue
     ===================================================== */
  const GAMES = [
    { id: 'memory', n: 1, cat: 'mind', name: 'Memory Match', desc: 'Find matching cards before time runs out.', timed: true,
      how: 'Flip two cards at a time and match every pair. Fewer moves and more time left earns a bonus.',
      levels: ['6 pairs · 60 seconds', '8 pairs · 75 seconds', '12 pairs · 100 seconds'], run: memory },
    { id: 'quiz', n: 2, cat: 'mind', name: 'Quiz Challenge', desc: 'Answer questions and earn points.', timed: true,
      how: 'Ten general knowledge questions. Answer fast and keep a streak for extra points.',
      levels: ['20 seconds per question', '15 seconds per question', '10 seconds per question'], run: quiz },
    { id: 'math', n: 3, cat: 'mind', name: 'Math Master', desc: 'Solve quick arithmetic questions.', timed: true,
      how: 'Solve as many sums as you can before the clock runs out. Streaks add bonus points.',
      levels: ['Add and subtract · 60 seconds', 'Adds multiplication · 60 seconds', 'Adds division, bigger numbers · 45 seconds'], run: mathMaster },
    { id: 'shooter', n: 4, cat: 'action', name: 'Space Shooter', desc: 'Dodge and shoot falling targets.', timed: false,
      how: 'Drag, or use the left and right arrow keys, to steer. Your ship fires on its own. Shoot the hexagons and avoid crashing.',
      levels: ['5 lives · slower targets', '3 lives · normal speed', '2 lives · fast targets'], run: shooter },
    { id: 'speed', n: 5, cat: 'action', name: 'Speed Click', desc: 'Click targets before the timer ends.', timed: true,
      how: 'Click each target before its ring closes in. You have 30 seconds. Quick hits and combos score more.',
      levels: ['Big targets · slow rings', 'Medium targets · normal rings', 'Small targets · fast rings'], run: speedClick },
    { id: 'stars', n: 6, cat: 'action', name: 'Catch the Stars', desc: 'Move a basket to catch falling stars.', timed: true,
      how: 'Catch stars for points in 45 seconds. Missing a star or catching a pink comet costs a life.',
      levels: ['5 lives · slow fall', '3 lives · normal fall', '2 lives · fast fall'], run: catchStars },
    { id: 'ttt', n: 7, cat: 'puzzle', name: 'Tic-Tac-Toe', desc: 'Play against the computer.', timed: false,
      how: 'Best of five rounds. A win scores 10, a draw scores 4. You and the computer take turns going first.',
      levels: ['Computer makes many mistakes', 'Computer makes some mistakes', 'Computer never loses'], run: ticTacToe },
    { id: 'g2048', n: 8, cat: 'puzzle', name: '2048', desc: 'Combine number tiles.', timed: false,
      how: 'Slide the tiles and merge equal numbers. Reach 2048 for a big bonus, or play until no moves are left.',
      levels: ['More 4 tiles spawn', 'Standard rules', 'An extra tile appears every third move'], run: game2048 },
    { id: 'scramble', n: 9, cat: 'puzzle', name: 'Word Scramble', desc: 'Rearrange letters to find a word.', timed: true,
      how: 'Unscramble ten words. Each has a category clue. A hint costs 25 points.',
      levels: ['Short words · 40 seconds each', 'Medium words · 30 seconds each', 'Long words · 20 seconds each'], run: scramble }
  ];
  const GAME_BY_ID = {};
  GAMES.forEach(g => { GAME_BY_ID[g.id] = g; });
  const CAT_BY_ID = {};
  CATS.forEach(c => { CAT_BY_ID[c.id] = c; });

  /* =====================================================
     Views
     ===================================================== */
  const VIEWS = ['home', 'category', 'game', 'leaderboard'];
  function showView(name) {
    VIEWS.forEach(v => { $('#view-' + v).hidden = v !== name; });
  }

  function fmtDate(t) { try { return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); } catch (e) { return ''; } }

  function renderHome() {
    $('#cats').innerHTML = CATS.map(c =>
      '<article class="catcard ' + c.id + '"><div class="caticon" aria-hidden="true">' + c.icon + '</div><h3>' + c.name + '</h3><p>' + c.tag + '</p><ul>' +
      GAMES.filter(g => g.cat === c.id).map(g => '<li><b>' + g.n + '</b>' + g.name + '</li>').join('') +
      '</ul><button type="button" class="btn" data-go="category-' + c.id + '">Play Now</button></article>').join('');
    const top = board.slice(0, 3);
    $('#topScores').innerHTML = top.length
      ? top.map((e, i) => '<li><span class="rank">' + (i + 1) + '</span><span class="who">' + esc(e.n) + '</span><span class="what">' + GAME_BY_ID[e.g].name + ' · ' + DLABEL[e.d] + '</span><span class="pts">' + e.s + '</span></li>').join('')
      : '<li class="empty">No scores yet. Play a game to be the first on the board.</li>';
    showView('home');
  }

  function renderCategory(id) {
    const c = CAT_BY_ID[id];
    const head = $('#catHead');
    head.className = 'cathead ' + c.id;
    head.innerHTML = '<p class="eyebrow">' + c.icon + ' Category</p><h2>' + c.name + '</h2><p class="lede">' + c.tag + '</p>';
    const wrap = $('#gameCards');
    wrap.className = 'gamecards ' + c.id;
    wrap.innerHTML = GAMES.filter(g => g.cat === id).map(g =>
      '<article class="gcard"><div class="gnum">' + g.n + '</div><h3>' + g.name + '</h3><p>' + g.desc + '</p>' +
      '<div class="tags"><span class="tag' + (g.timed ? ' timed' : '') + '">' + (g.timed ? 'Timed' : 'No timer') + '</span><span class="tag">Easy · Medium · Hard</span></div>' +
      '<p class="gbest">High score <b>' + bestOf(g.id) + '</b></p>' +
      '<button type="button" class="btn" data-go="game-' + g.id + '">Play Now</button></article>').join('');
    showView('category');
  }

  function paintDiff() {
    const g = GAME_BY_ID[curId];
    document.querySelectorAll('#diffSeg button').forEach(b => b.classList.toggle('on', b.dataset.d === curDiff));
    $('#hDiff').textContent = DLABEL[curDiff];
    $('#levelInfo').textContent = g.levels[DIFFS.indexOf(curDiff)];
    $('#multInfo').textContent = 'Score multiplier: ×' + MULT[curDiff];
  }

  function renderGame(id) {
    const g = GAME_BY_ID[id];
    curId = id;
    const view = $('#view-game');
    view.className = 'view ' + g.cat;
    $('#gCat').textContent = CAT_BY_ID[g.cat].name + ' · Game ' + g.n;
    $('#gTitle').textContent = g.name;
    $('#gHow').textContent = g.how + (g.timed ? ' This game is timed.' : '');
    $('#hBest').textContent = bestOf(id);
    backToSetup();
    paintDiff();
    showView('game');
  }

  function renderBoard() {
    const sel = $('#lbFilter');
    if (!sel.options.length) {
      sel.innerHTML = '<option value="all">All games</option>' + GAMES.map(g => '<option value="' + g.id + '">' + g.n + '. ' + g.name + '</option>').join('');
    }
    const f = sel.value || 'all';
    const rows = board.filter(e => f === 'all' || e.g === f).slice(0, 15);
    $('#lbBody').innerHTML = rows.length
      ? rows.map((e, i) => '<tr class="r' + (i + 1) + '"><td>' + (i + 1) + '</td><td>' + esc(e.n) + '</td><td>' + (GAME_BY_ID[e.g] ? GAME_BY_ID[e.g].name : e.g) + '</td><td>' + DLABEL[e.d] + '</td><td class="score">' + e.s + '</td><td>' + fmtDate(e.t) + '</td></tr>').join('')
      : '<tr><td colspan="6" class="none">No scores yet. Finish a game to appear here.</td></tr>';
    showView('leaderboard');
  }

  function route() {
    stopSession();
    const h = (location.hash || '#home').slice(1);
    const dash = h.indexOf('-');
    const a = dash < 0 ? h : h.slice(0, dash);
    const b = dash < 0 ? '' : h.slice(dash + 1);
    if (a === 'category' && CAT_BY_ID[b]) renderCategory(b);
    else if (a === 'game' && GAME_BY_ID[b]) renderGame(b);
    else if (a === 'leaderboard') renderBoard();
    else renderHome();
    window.scrollTo(0, 0);
  }

  function go(target) {
    if (location.hash === '#' + target) route();
    else location.hash = target;
  }

  /* =====================================================
     Wire up
     ===================================================== */
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-go]');
    if (t) { sfx.click(); go(t.dataset.go); }
  });

  $('#soundBtn').addEventListener('click', () => {
    soundOn = !soundOn;
    store.set('sound', soundOn);
    paintSound();
    sfx.click();
  });

  $('#playerName').value = store.get('player', '');
  $('#playerName').addEventListener('input', e => store.set('player', e.target.value));

  document.querySelectorAll('#diffSeg button').forEach(b => {
    b.addEventListener('click', () => { curDiff = b.dataset.d; store.set('diff', curDiff); sfx.click(); paintDiff(); });
  });
  $('#startBtn').addEventListener('click', startGame);
  $('#endBtn').addEventListener('click', () => { if (S && !S.ended) finish(S.raw, 'Ended early'); });
  $('#gameBack').addEventListener('click', () => {
    const g = GAME_BY_ID[curId];
    go('category-' + (g ? g.cat : 'mind'));
  });

  $('#lbFilter').addEventListener('change', renderBoard);
  let clearArmed = false, clearTimer = 0;
  $('#lbClear').addEventListener('click', () => {
    const b = $('#lbClear');
    if (!clearArmed) {
      clearArmed = true; b.textContent = 'Click again to confirm';
      clearTimer = setTimeout(() => { clearArmed = false; b.textContent = 'Clear scores'; }, 3000);
      return;
    }
    clearTimeout(clearTimer); clearArmed = false; b.textContent = 'Clear scores';
    board = []; store.set('board', board); renderBoard();
  });

  window.addEventListener('hashchange', route);
  paintSound();
  route();
})();
