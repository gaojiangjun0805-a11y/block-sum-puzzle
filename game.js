'use strict';

const elements = Object.fromEntries(
  [...document.querySelectorAll('[id]')].map(element => [element.id, element])
);

const { rules, reference, randomFrom, slideStride, buildFrames, sumInFrame, solved } = puzzle;
const config = { size: 4, playerCount: 1, mode: 'sprint', seed: 0 };
const viewQuery = new URLSearchParams(location.search);
const view = viewQuery.get('view');
const roomPlayer = view === 'seat';
let state;
let roomPacket;
let roomCredentials;
let roomEvents;
let roomOffset = 0;
let actionPending = false;
let practiceRound = 0;

function newBoard(random, steps) {
  return puzzle.newBoard(random, steps, config.size);
}

function makeGoal(board, steps, random, excluded) {
  const goal = puzzle.generateGoal(board, steps, random, excluded, config.size, state.catalog);
  return { ...goal, id: state.nextId++ };
}

function createPlayer(board, index) {
  const panel = elements['player-template'].content.firstElementChild.cloneNode(true);
  const title = config.playerCount === 1 ? '数字推盘' : ['选手 A', '选手 B'][index];
  panel.querySelector('h2').textContent = title;
  const caption = panel.querySelector('.controls-caption');
  caption.hidden = config.playerCount === 1;
  caption.textContent = index === 0 ? 'W A S D' : '↑ ↓ ← →';
  const grid = panel.querySelector('.board');
  grid.dataset.size = config.size;
  grid.style.setProperty('--size', config.size);
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', title + '棋盘');
  const tiles = board.map((_, position) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'tile';
    tile.dataset.cell = position;
    tile.addEventListener('click', () => slide(index, position));
    grid.append(tile);
    return tile;
  });
  panel.querySelector('[data-score-wrap]').hidden = config.mode === 'sprint';

  return {
    board: board.slice(), index, title, panel, grid, tiles,
    moves: 0, score: 0, goals: [], selected: null,
    sumLabel: panel.querySelector('[data-sum]'),
    difference: panel.querySelector('[data-difference]'),
    goalValue: panel.querySelector('[data-goal-value]'),
    goalShape: panel.querySelector('[data-goal-shape]'),
    movesLabel: panel.querySelector('[data-moves]'),
    scoreLabel: panel.querySelector('[data-score]'),
    goalButtons: panel.querySelector('.goal-buttons')
  };
}

function currentGoals(player) {
  if (roomPlayer) return player.goals;
  if (puzzle.isSingleGoal(config.mode)) return [state.goal];
  if (config.mode === 'fall') return state.wave.goals;
  return player.goals;
}

function currentGoal(player) {
  const goals = currentGoals(player);
  return goals.find(goal => goal.id === player.selected) ?? goals[0];
}

function shapeFor(goal) {
  return displays.shape(goal, config.size);
}

function valueFor(goal, className) {
  const value = document.createElement('b');
  value.className = className;
  value.dataset.goalValue = '';
  value.textContent = goal.value;
  return value;
}

function renderGoalButtons(player) {
  const goals = currentGoals(player);
  const container = player.goalButtons;
  container.hidden = puzzle.isSingleGoal(config.mode) || (config.mode === 'fall' && goals.length <= 1);
  if (container.hidden) return;
  container.style.setProperty('--goals', goals.length);

  const selected = currentGoal(player).id;
  const key = goals.map(goal => goal.id).join(',');
  if (container.dataset.goals !== key) {
    container.dataset.goals = key;
    container.replaceChildren(...goals.map((goal, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'goal-button';
      button.dataset.goalId = goal.id;
      button.setAttribute('aria-label', '选中目标 ' + (index + 1) + '，目标和 ' + goal.value);
      button.append(shapeFor(goal), valueFor(goal, 'goal-value'));
      button.addEventListener('click', () => {
        if (roomPlayer) {
          void sendRoomAction('select', { goal: goal.id });
          return;
        }
        player.selected = goal.id;
        renderPlayer(player);
        if (state.phase === 'playing') {
          const now = performance.now();
          updateTime(now);
          if (state.phase === 'playing' && currentGoal(player)?.id === goal.id) checkGoal(player, now);
        }
      });
      return button;
    }));
  }
  for (const button of container.children) {
    button.setAttribute('aria-pressed', Number(button.dataset.goalId) === selected);
  }
}

function renderPlayer(player, stride = 0) {
  const goal = currentGoal(player);
  const gap = player.board.indexOf(0);
  const canSlide = state.phase === 'playing' || (!roomPlayer && config.mode === 'sprint' && state.phase === 'ready');
  player.tiles.forEach((tile, index) => {
    const value = player.board[index];
    const marked = goal?.indices.includes(index) ?? false;
    const available = canSlide && slideStride(gap, index, config.size) !== 0;
    tile.classList.toggle('marked', marked);
    tile.classList.toggle('empty', !value);
    tile.classList.toggle('movable', available);
    tile.setAttribute('aria-disabled', !available);
    tile.tabIndex = available ? 0 : -1;
    tile.setAttribute('aria-label', [
      value || '空格', marked ? '目标框内' : '', available ? '可滑动' : ''
    ].filter(Boolean).join('，'));

    const previous = tile.firstElementChild;
    if (previous?.textContent === String(value) || (!previous && value === 0)) return;
    tile.replaceChildren();
    if (!value) return;
    const face = document.createElement('span');
    face.textContent = value;
    if (stride) {
      const x = Math.abs(stride) === 1 ? stride : 0;
      const y = Math.abs(stride) === config.size ? stride / config.size : 0;
      face.style.setProperty('--dx', x * 55 + '%');
      face.style.setProperty('--dy', y * 55 + '%');
      face.className = 'sliding';
    }
    tile.append(face);
  });

  const sum = goal ? sumInFrame(player.board, goal.indices) : null;
  player.sumLabel.textContent = sum ?? '·';
  const memory = config.mode === 'memory';
  player.goalValue.textContent = memory ? '？' : (goal?.value ?? '·');
  const shapeKey = goal && !memory ? config.size + ':' + goal.indices.join(',') : '';
  if (player.goalShape.dataset.frame !== shapeKey) {
    player.goalShape.dataset.frame = shapeKey;
    player.goalShape.replaceChildren(...(shapeKey ? [shapeFor(goal)] : []));
  }
  if (!goal || goal.indices.includes(gap)) {
    player.difference.textContent = goal ? '框内未满' : '等待目标';
  } else if (memory) {
    player.difference.textContent = state.phase === 'finished' ? '本题结束' : '回想目标和';
  } else if (sum === goal.value) {
    player.difference.textContent = '已达成';
  } else {
    const difference = document.createElement('b');
    difference.textContent = Math.abs(goal.value - sum);
    player.difference.replaceChildren(goal.value > sum ? '差 ' : '超 ', difference);
  }
  player.movesLabel.textContent = player.moves;
  player.scoreLabel.textContent = player.score;
  renderGoalButtons(player);
}

function renderArena() {
  displays.drawArena(elements.arena, state.wave, config.size);
}

function animateWave(now) {
  displays.animateArena(elements.arena, state.wave, now, elements['wave-meter']);
}

function renderHeader() {
  const mode = rules[config.mode];
  const timed = Boolean(mode.seconds);
  const memory = config.mode === 'memory';
  elements['mode-tag'].textContent = mode.title;
  elements['mode-rule'].textContent = mode.description;
  elements['clock-label'].textContent = timed ? '剩余' : '用时';
  elements['seat-tag'].textContent = roomPlayer ? '选手 ' + displays.seatLabel(roomCredentials.seat)
    : config.playerCount === 1 ? '单人练习' : '同屏双人';
  elements.falling.hidden = config.mode !== 'fall' || roomPlayer;
  elements.start.hidden = roomPlayer || (!timed && !memory) || state.phase !== 'ready';
  elements.start.textContent = memory ? '开始闪示' : '开始挑战';
  elements['practice-flash-config'].hidden = roomPlayer || !memory;
  elements['practice-flash-time'].disabled = state.phase === 'preview' || state.phase === 'playing';
  elements.game.classList.toggle('dual', config.playerCount === 2);
  elements.game.dataset.mode = config.mode;
  const utilityParent = config.playerCount === 1
    ? state.players[0].panel.querySelector('.target-side')
    : elements.falling.parentElement;
  if (elements.utility.parentElement !== utilityParent) utilityParent.append(elements.utility);
  elements['input-help'].textContent = config.playerCount === 1
    ? '方向键每次推一格。'
    : '选手 A 用 WASD，选手 B 用方向键。';
  for (const [field, value] of Object.entries({ mode: config.mode, size: config.size, count: config.playerCount })) {
    for (const button of document.querySelectorAll('button[data-' + field + ']')) {
      button.setAttribute('aria-pressed', button.dataset[field] === String(value));
    }
  }
}

function practicePacket() {
  const epoch = Date.now() - performance.now();
  const wave = state.wave ? { ...state.wave, startedAt: state.phase === 'ready' ? null : epoch + state.wave.startedAt } : null;
  return {
    round: practiceRound, phase: state.phase, mode: config.mode, size: config.size, now: Date.now(),
    start: state.startedAt === null ? null : epoch + state.startedAt,
    end: state.endedAt === undefined ? null : epoch + state.endedAt,
    goal: config.mode === 'memory' ? undefined : state.goal,
    flash: state.flash ? {
      at: epoch + state.flash.at, until: epoch + state.flash.until, answerAt: epoch + state.flash.answerAt,
    } : null,
    flashGoal: state.phase === 'preview' ? state.goal : undefined,
    wave, lastEvent: state.lastEvent, status: elements.status.textContent, capacity: config.playerCount,
    rows: state.players.map(player => ({ number: player.index + 1, score: player.score })),
  };
}

function setStatus(message, final = false) {
  elements.status.textContent = message;
  elements.status.dataset.result = final;
  if (!roomPlayer) displays.publish(practicePacket());
}

function updateClock(now) {
  const elapsed = state.startedAt === null ? 0 : (now - state.startedAt) / 1000;
  const limit = rules[config.mode].seconds;
  const seconds = limit ? Math.max(0, limit - Math.floor(elapsed)) : Math.floor(elapsed);
  const text = [Math.floor(seconds / 60), seconds % 60].map(value => String(value).padStart(2, '0')).join(':');
  if (elements.clock.textContent !== text) elements.clock.textContent = text;
  elements.clock.dateTime = 'PT' + seconds + 'S';
}

function makeWave(board, now, elapsed) {
  return puzzle.generateWave(board, now, elapsed, (state.wave?.number ?? 0) + 1,
    (cells, steps, goals) => makeGoal(cells, steps, state.random, goals));
}

function setup() {
  practiceRound += 1;
  const random = randomFrom(config.seed ^ (config.size << 12));
  const sample = config.mode === 'sprint' && config.size === 4 && config.seed === 0;
  const board = sample ? reference.board : newBoard(random, 40 + config.size * 5);
  state = {
    phase: 'ready', startedAt: null, nextId: 1, wave: null, random,
    catalog: buildFrames(config.size),
    players: Array.from({ length: config.playerCount }, (_, index) => createPlayer(board, index))
  };
  if (puzzle.isSingleGoal(config.mode)) {
    state.goal = sample
      ? { indices: reference.indices, value: reference.value, id: state.nextId++ }
      : makeGoal(board, config.size + 4, random, []);
  }
  if (config.mode === 'fall') state.wave = makeWave(board, performance.now(), 0);
  if (config.mode === 'score') {
    const goals = [makeGoal(board, 4, random, [])];
    goals.push(makeGoal(board, 5, random, goals));
    for (const player of state.players) {
      player.goals = goals.slice();
      player.random = randomFrom(config.seed ^ (config.size << 12) ^ 0xE5CE);
    }
  }

  elements.players.replaceChildren(...state.players.map(player => player.panel));
  renderHeader();
  for (const player of state.players) renderPlayer(player);
  if (state.wave) {
    renderArena();
    animateWave(state.wave.startedAt);
  }
  updateClock(performance.now());
  const status = { sprint: '滑动第一块数字开始计时。', memory: '打开观众大屏，设置时长后开始闪示。' };
  setStatus(status[config.mode] ?? '准备就绪');
}

function begin(now) {
  if (config.mode === 'memory') {
    const input = elements['practice-flash-time'];
    const duration = puzzle.flashMilliseconds(input.valueAsNumber);
    if (duration === null) {
      setStatus('闪示时长请填写 0.01 秒或以上，最多两位小数。');
      input.focus();
      return;
    }
    state.phase = 'preview';
    state.flash = puzzle.flashSchedule(now, duration);
    renderHeader();
    setStatus('请看大屏，闪示结束后开始推盘。');
    return;
  }
  state.phase = 'playing';
  state.startedAt = now;
  if (state.wave) state.wave.startedAt = now;
  elements.start.hidden = true;
  setStatus(config.mode === 'fall' ? '第 1 波' : '进行中');
  for (const player of state.players) renderPlayer(player);
}

function finish(now, message) {
  state.phase = 'finished';
  state.endedAt = now;
  elements['practice-flash-time'].disabled = false;
  updateClock(now);
  setStatus(message, true);
  for (const player of state.players) renderPlayer(player);
}

function finishTimed(now) {
  const [a, b] = state.players;
  let result = '挑战结束 · ' + a.score + ' 分';
  if (b) {
    if (a.score === b.score) {
      result = '平局 · ' + a.score + ' 比 ' + b.score;
    } else {
      result = (a.score > b.score ? a.title : b.title) + ' 获胜 · ' + a.score + ' 比 ' + b.score;
    }
  }
  finish(now, result);
}

function nextWave(now, notice) {
  const elapsed = (now - state.startedAt) / 1000;
  const board = newBoard(state.random, 24 + Math.floor(elapsed / 5));
  state.wave = makeWave(board, now, elapsed);
  for (const player of state.players) {
    player.board = board.slice();
    player.selected = null;
    for (const tile of player.tiles) tile.classList.remove('cleared');
    renderPlayer(player);
  }
  setStatus((notice ? notice + ' · ' : '') + '第 ' + state.wave.number + ' 波');
  renderArena();
  animateWave(now);
}

function updateTime(now) {
  if (state.phase === 'preview' && now >= state.flash.answerAt) {
    state.phase = 'playing';
    state.startedAt = state.flash.answerAt;
    setStatus('开始推盘');
    for (const player of state.players) renderPlayer(player);
  }
  if (state.phase !== 'playing') return;
  const limit = rules[config.mode].seconds;
  if (limit && now - state.startedAt >= limit * 1000) {
    finishTimed(now);
    return;
  }
  if (state.wave && now - state.wave.startedAt >= state.wave.duration) {
    nextWave(now, '上一波已落地');
  }
  updateClock(now);
}

function celebrate(player, goal) {
  for (const index of goal.indices) {
    const tile = player.tiles[index];
    tile.classList.add('cleared');
  }
}

function checkGoal(player, now) {
  const goal = currentGoal(player);
  if (!goal || !solved(player.board, goal)) return;
  const points = config.mode === 'score' ? goal.indices.length : 1;
  state.lastEvent = {
    number: player.index + 1, points, target: config.mode === 'memory' ? undefined : goal.value,
  };
  if (puzzle.isSingleGoal(config.mode)) {
    player.score = points;
    const message = config.playerCount === 2 ? player.title + ' 获胜'
      : config.mode === 'memory' ? '已达成目标' : '已达成目标 ' + goal.value;
    finish(now, message + ' · ' + player.moves + ' 步');
    celebrate(player, goal);
    return;
  }
  if (config.mode === 'fall') {
    player.score += 1;
    state.wave.goals = state.wave.goals.filter(item => item.id !== goal.id);
    const message = player.title + ' 抢消 ' + goal.value + '，得 1 分';
    if (!state.wave.goals.length) {
      nextWave(now, message);
    } else {
      setStatus(message);
      for (const contestant of state.players) renderPlayer(contestant);
      renderArena();
      animateWave(now);
      celebrate(player, goal);
    }
    return;
  }

  player.score += goal.indices.length;
  const remaining = player.goals.filter(item => item.id !== goal.id);
  const newGoal = makeGoal(player.board, 5, player.random, remaining);
  player.goals = player.goals.map(item => item.id === goal.id ? newGoal : item);
  player.selected = newGoal.id;
  setStatus(player.title + ' 消除 ' + goal.value + '，得 ' + goal.indices.length + ' 分');
  renderPlayer(player);
  celebrate(player, goal);
}

function slide(playerIndex, position) {
  if (roomPlayer) {
    if (state?.phase === 'playing') void sendRoomAction('move', { position });
    return;
  }
  const now = performance.now();
  const waveNumber = state.wave?.number;
  updateTime(now);
  if (waveNumber !== state.wave?.number || state.phase === 'finished' || state.phase === 'preview') return;
  if (state.phase === 'ready' && config.mode !== 'sprint') return;

  const player = state.players[playerIndex];
  const gap = player.board.indexOf(0);
  const stride = slideStride(gap, position, config.size);
  if (!stride) return;
  if (state.phase === 'ready') begin(now);

  for (let index = gap; index !== position; index += stride) {
    player.board[index] = player.board[index + stride];
  }
  player.board[position] = 0;
  player.moves += 1;
  renderPlayer(player, stride);
  checkGoal(player, now);
}

function onKeyDown(event) {
  if (!state || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
  const arrows = { ArrowLeft: [0, 1], ArrowRight: [0, -1], ArrowUp: [1, 0], ArrowDown: [-1, 0] };
  const letters = { a: [0, 1], d: [0, -1], w: [1, 0], s: [-1, 0] };
  const direction = arrows[event.key] ?? letters[event.key.toLowerCase()];
  if (!direction || state.phase === 'finished' || (state.phase === 'ready' && config.mode !== 'sprint')) return;
  const playerIndex = config.playerCount === 2 && arrows[event.key] ? 1 : 0;
  const gap = state.players[playerIndex].board.indexOf(0);
  const row = Math.floor(gap / config.size) + direction[0];
  const column = gap % config.size + direction[1];
  event.preventDefault();
  if (row >= 0 && row < config.size && column >= 0 && column < config.size) {
    slide(playerIndex, row * config.size + column);
  }
}

function showRoomSeat(next) {
  if (!next.seat) return;
  const participant = next.seat;
  const rebuild = next.round !== roomPacket?.round || !state;
  roomPacket = next;
  roomOffset = next.now - Date.now();
  config.mode = next.mode;
  config.size = next.size;
  const player = rebuild ? createPlayer(participant.board, 0) : state.players[0];
  Object.assign(player, {
    board: participant.board, moves: participant.moves, score: participant.score,
    selected: participant.selected, goals: participant.goals,
  });
  state = { ...next, players: [player] };
  if (rebuild) elements.players.replaceChildren(player.panel);
  renderHeader();
  setStatus(next.status, next.phase === 'finished');
  renderPlayer(player);
  elements['seat-form'].hidden = true;
  elements.game.hidden = false;
}

async function sendRoomAction(action, options = {}) {
  if (!roomPacket || !roomCredentials || actionPending || state.phase !== 'playing') return;
  actionPending = true;
  try {
    const next = await displays.post('action', {
      action, round: roomPacket.round, wave: roomPacket.wave?.number ?? null, ...options,
    }, roomCredentials);
    showRoomSeat(next);
  } catch (error) {
    setStatus(error.message);
  } finally {
    actionPending = false;
  }
}

async function joinRoom(number, token) {
  try {
    elements['join-status'].textContent = '连接中';
    const result = await displays.post('join', { seat: number, token });
    roomCredentials = { seat: number, token: result.token };
    try { sessionStorage.setItem('速算华容道-选手', JSON.stringify(roomCredentials)); } catch { /* Session can still play. */ }
    showRoomSeat(result.state);
    elements['open-screen'].href = '?view=screen&room=1';
    elements['open-rank'].href = '?view=rank&room=1&me=' + number;
    roomEvents?.close();
    roomEvents = displays.connectRoom(showRoomSeat, () => setStatus('比赛连接中断，正在重连'), roomCredentials);
  } catch (error) {
    elements['join-status'].textContent = '无法进入比赛 · ' + error.message;
  }
}

function installRoomSeat() {
  document.body.dataset.view = 'seat';
  document.querySelector('.toolbar').hidden = true;
  elements.game.hidden = true;
  elements.start.hidden = true;
  elements['new-game'].hidden = true;
  elements['seat-form'].hidden = false;
  elements['mode-tag'].textContent = '现场比赛';
  elements['seat-tag'].textContent = '选手端';
  const requested = Number(viewQuery.get('seat'));
  if (Number.isInteger(requested) && requested >= 1 && requested <= 50) elements['seat-number'].value = requested;
  let saved;
  try { saved = JSON.parse(sessionStorage.getItem('速算华容道-选手')); } catch { /* A seat can be entered manually. */ }
  if (saved && (!requested || saved.seat === requested)) {
    elements['seat-number'].value = saved.seat;
    void joinRoom(saved.seat, saved.token);
  }
  elements['seat-form'].addEventListener('submit', event => {
    event.preventDefault();
    const number = Number(elements['seat-number'].value);
    void joinRoom(number, saved?.seat === number ? saved.token : undefined);
  });
  elements.reset.addEventListener('click', () => { void sendRoomAction('reset'); });
}

function installPractice() {
  for (const button of document.querySelectorAll('button[data-mode], button[data-size], button[data-count]')) {
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-pressed') === 'true') return;
      config.mode = button.dataset.mode ?? config.mode;
      config.size = Number(button.dataset.size ?? config.size);
      config.playerCount = Number(button.dataset.count ?? config.playerCount);
      setup();
    });
  }
  elements.start.addEventListener('click', () => begin(performance.now()));
  elements.reset.addEventListener('click', setup);
  elements['new-game'].addEventListener('click', () => {
    config.seed = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
    setup();
  });
  elements['open-rank'].href = '?view=rank&me=1';
  elements['room-links'].hidden = !document.body.hasAttribute('data-room-server');
  setup();
  displays.listenRequests(practicePacket);
}

function animate(now) {
  if (roomPlayer && roomPacket) {
    const clock = displays.projectedClock(roomPacket, Date.now() + roomOffset);
    if (elements.clock.textContent !== clock) elements.clock.textContent = clock;
  } else if (state && !roomPlayer) {
    updateTime(now);
    if (state.wave && state.phase === 'playing') animateWave(now);
  }
  requestAnimationFrame(animate);
}

if (['screen', 'rank', 'host'].includes(view)) {
  displays.show(view, elements);
} else {
  if (roomPlayer) installRoomSeat();
  else installPractice();
  document.addEventListener('keydown', onKeyDown);
  elements.players.addEventListener('animationend', event => {
    if (event.animationName === 'clear') event.target.classList.remove('cleared');
  });
  requestAnimationFrame(animate);
}
