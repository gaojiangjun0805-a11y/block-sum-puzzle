'use strict';

const elements = Object.fromEntries(
  [...document.querySelectorAll('[id]')].map(element => [element.id, element])
);

const rules = {
  sprint: {
    title: '目标框',
    description: '把目标框填满，框内数字恰好达到目标值即完成。双人赛以先达成为胜。'
  },
  fall: {
    title: '共享目标',
    seconds: 75,
    description: '选中并解出一个下落目标得 1 分，双方共享目标。每波结束后更换棋盘，目标逐渐增多、加快。'
  },
  score: {
    title: '独立计分',
    seconds: 90,
    description: '每位选手各有两个目标，点选其一进行挑战。完成后换入新目标，框内每个方块计 1 分。'
  }
};

const reference = {
  board: [2, 5, 15, 1, 11, 12, 6, 13, 8, 10, 9, 14, 0, 7, 4, 3],
  indices: [2, 4, 5, 6, 7, 10, 14],
  value: 80
};

const sourceShapes = [
  [[0, 0], [1, 0], [1, 1], [1, 2]],
  [[0, 1], [1, 0], [1, 1], [1, 2]],
  [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]],
  [[0, 0], [0, 1], [1, 1], [2, 1], [2, 2]],
  [[0, 2], [1, 0], [1, 1], [1, 2], [1, 3], [2, 2], [3, 2]]
];

const config = { size: 4, playerCount: 1, mode: 'sprint', seed: 0 };
let state;

function randomFrom(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let n = Math.imul(seed ^ (seed >>> 15), seed | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

const choose = (items, random) => items[Math.floor(random() * items.length)];

function neighbors(index, size) {
  const cells = [];
  if (index >= size) cells.push(index - size);
  if (index < size * (size - 1)) cells.push(index + size);
  if (index % size > 0) cells.push(index - 1);
  if (index % size < size - 1) cells.push(index + 1);
  return cells;
}

function slideStride(gap, position, size) {
  const direction = Math.sign(position - gap);
  if (Math.floor(position / size) === Math.floor(gap / size)) return direction;
  if (position % size === gap % size) return direction * size;
  return 0;
}

function walk(board, steps, random) {
  const cells = board.slice();
  let gap = cells.indexOf(0);
  let previousGap = -1;
  for (let step = 0; step < steps; step += 1) {
    const nextGap = choose(neighbors(gap, config.size).filter(index => index !== previousGap), random);
    cells[gap] = cells[nextGap];
    cells[nextGap] = 0;
    previousGap = gap;
    gap = nextGap;
  }
  return cells;
}

function newBoard(random, steps) {
  const cells = Array.from({ length: config.size ** 2 }, (_, index) => (index + 1) % (config.size ** 2));
  return walk(cells, steps, random);
}

function buildFrames(size) {
  const catalog = new Map([[4, new Map()], [5, new Map()], [7, new Map()]]);
  for (const source of sourceShapes) {
    let points = source;
    for (let turn = 0; turn < 4; turn += 1) {
      const top = Math.min(...points.map(([row]) => row));
      const left = Math.min(...points.map(([, column]) => column));
      const height = Math.max(...points.map(([row]) => row)) - top + 1;
      const width = Math.max(...points.map(([, column]) => column)) - left + 1;
      for (let row = 0; row <= size - height; row += 1) {
        for (let column = 0; column <= size - width; column += 1) {
          const indices = points.map(([y, x]) => (y - top + row) * size + x - left + column).sort((a, b) => a - b);
          catalog.get(source.length).set(indices.join(','), indices);
        }
      }
      points = points.map(([row, column]) => [column, -row]);
    }
  }
  return new Map([...catalog].map(([length, frames]) => [length, [...frames.values()]]));
}

function sumInFrame(board, indices) {
  return indices.reduce((sum, index) => sum + board[index], 0);
}

function solved(board, goal) {
  return goal.indices.every(index => board[index] !== 0) && sumInFrame(board, goal.indices) === goal.value;
}

function makeGoal(board, length, steps, random, excluded) {
  const frames = state.catalog.get(length);
  const used = new Set(excluded.map(goal => goal.key));

  function findGoal(cells) {
    const candidates = [];
    for (const indices of frames) {
      if (indices.some(index => cells[index] === 0)) continue;
      const value = sumInFrame(cells, indices);
      const key = indices.join(',') + '/' + value;
      if (used.has(key) || solved(board, { indices, value })) continue;
      candidates.push({ indices, value, key });
    }
    return candidates.length ? choose(candidates, random) : null;
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const goal = findGoal(walk(board, steps + attempt % 3, random));
    if (goal) return { ...goal, id: state.nextId++ };
  }

  // A frame containing the current gap can be completed by moving its gap outside.
  const gap = board.indexOf(0);
  for (const tile of neighbors(gap, config.size)) {
    const cells = board.slice();
    cells[gap] = cells[tile];
    cells[tile] = 0;
    const goal = findGoal(cells);
    if (goal) return { ...goal, id: state.nextId++ };
  }
  throw new Error('无法生成可达成的目标框');
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
    incompleteLabel: panel.querySelector('[data-incomplete]'),
    movesLabel: panel.querySelector('[data-moves]'),
    scoreLabel: panel.querySelector('[data-score]'),
    goalButtons: panel.querySelector('.goal-buttons')
  };
}

function currentGoals(player) {
  if (config.mode === 'sprint') return [state.goal];
  if (config.mode === 'fall') return state.wave.goals;
  return player.goals;
}

function currentGoal(player) {
  const goals = currentGoals(player);
  return goals.find(goal => goal.id === player.selected) ?? goals[0];
}

function shapeFor(goal) {
  const shape = document.createElement('div');
  shape.className = 'shape';
  shape.style.setProperty('--size', config.size);
  shape.setAttribute('role', 'img');
  const positions = goal.indices.map(index => {
    const row = Math.floor(index / config.size) + 1;
    const column = index % config.size + 1;
    return row + ' 行 ' + column + ' 列';
  });
  shape.setAttribute('aria-label', '框内位置为 ' + positions.join('、'));
  for (let index = 0; index < config.size ** 2; index += 1) {
    const cell = document.createElement('i');
    cell.classList.toggle('filled', goal.indices.includes(index));
    shape.append(cell);
  }
  return shape;
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
  container.hidden = config.mode === 'sprint' || (config.mode === 'fall' && goals.length <= 1);
  if (container.hidden) return;

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
  const canSlide = state.phase === 'playing' || (config.mode === 'sprint' && state.phase === 'ready');
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

  player.sumLabel.textContent = goal ? sumInFrame(player.board, goal.indices) : '·';
  player.incompleteLabel.textContent = goal?.indices.includes(gap) ? '（未填满）' : '';
  player.movesLabel.textContent = player.moves;
  player.scoreLabel.textContent = player.score;
  renderGoalButtons(player);
}

function renderArena() {
  const wave = state.wave;
  elements.arena.dataset.wave = wave.number;
  const lanes = document.createElement('div');
  lanes.className = 'lanes';
  lanes.style.setProperty('--lanes', wave.slots);
  for (let lane = 0; lane < wave.slots; lane += 1) {
    const column = document.createElement('div');
    column.className = 'lane';
    const goal = wave.goals.find(item => item.lane === lane);
    if (goal) {
      const card = document.createElement('div');
      card.className = 'fall-card';
      card.append(shapeFor(goal), valueFor(goal, 'fall-value'));
      column.append(card);
    }
    lanes.append(column);
  }
  elements.arena.replaceChildren(lanes);
}

function animateWave(now) {
  const progress = Math.max(0, Math.min(1, (now - state.wave.startedAt) / state.wave.duration));
  elements['wave-meter'].style.transform = 'scaleX(' + (1 - progress) + ')';
  for (const card of elements.arena.querySelectorAll('.fall-card')) {
    const distance = Math.max(0, elements.arena.clientHeight - card.offsetHeight - 12);
    card.style.transform = 'translateY(' + distance * progress + 'px)';
  }
}

function renderHeader() {
  const mode = rules[config.mode];
  const timed = Boolean(mode.seconds);
  const sprint = config.mode === 'sprint';
  const fall = config.mode === 'fall';
  elements['side-title'].textContent = mode.title;
  elements['mode-rule'].textContent = mode.description;
  elements['compact-rule'].textContent = mode.description;
  elements['clock-label'].textContent = timed ? '剩余' : '用时';
  elements.reference.hidden = !sprint;
  elements.falling.hidden = !fall;
  elements.start.hidden = !timed || state.phase !== 'ready';
  elements.game.classList.toggle('dual', config.playerCount === 2);
  elements.game.dataset.mode = config.mode;
  elements['input-help'].textContent = config.playerCount === 1
    ? '点击与空格同行同列的数字，可整段滑动。方向键每次推一格。'
    : '同屏双人 · A 用 WASD，B 用方向键，点击与空格同行同列的数字可整段滑动。';
  for (const [field, value] of Object.entries({ mode: config.mode, size: config.size, count: config.playerCount })) {
    for (const button of document.querySelectorAll('[data-' + field + ']')) {
      if (button instanceof HTMLButtonElement) button.setAttribute('aria-pressed', button.dataset[field] === String(value));
    }
  }
  if (sprint) {
    const caption = document.createElement('span');
    caption.className = 'target-label';
    caption.textContent = '目标和';
    const label = document.createElement('div');
    label.append(caption, valueFor(state.goal, 'target-number'));
    elements.reference.replaceChildren(label, shapeFor(state.goal));
  }
}

function setStatus(message, final = false) {
  elements.status.textContent = message;
  elements.status.dataset.result = final;
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
  const level = Math.min(2, Math.floor(elapsed / 25));
  const slots = level + 1;
  const goals = [];
  for (let lane = 0; lane < slots; lane += 1) {
    const length = [4, 5, 7][Math.min(level, lane)];
    const goal = makeGoal(board, length, 3 + level + lane, state.random, goals);
    goals.push({ ...goal, lane });
  }
  return {
    number: (state.wave?.number ?? 0) + 1,
    goals, slots, startedAt: now, duration: [12000, 9500, 7200][level]
  };
}

function setup() {
  const random = randomFrom(config.seed ^ (config.size << 12));
  const sample = config.mode === 'sprint' && config.size === 4 && config.seed === 0;
  const board = sample ? reference.board : newBoard(random, 40 + config.size * 5);
  state = {
    phase: 'ready', startedAt: null, nextId: 1, wave: null, random,
    catalog: buildFrames(config.size),
    players: Array.from({ length: config.playerCount }, (_, index) => createPlayer(board, index))
  };
  if (config.mode === 'sprint') {
    state.goal = sample
      ? { indices: reference.indices, value: reference.value, id: state.nextId++ }
      : makeGoal(board, config.size === 4 ? 7 : 5, config.size + 4, random, []);
  }
  if (config.mode === 'fall') state.wave = makeWave(board, performance.now(), 0);
  if (config.mode === 'score') {
    const goals = [makeGoal(board, 4, 4, random, [])];
    goals.push(makeGoal(board, 5, 5, random, goals));
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
  setStatus(config.mode === 'sprint' ? '滑动第一块数字开始计时。' : '准备就绪');
}

function begin(now) {
  state.phase = 'playing';
  state.startedAt = now;
  if (state.wave) state.wave.startedAt = now;
  elements.start.hidden = true;
  setStatus(config.mode === 'fall' ? '第 1 波' : '进行中');
  for (const player of state.players) renderPlayer(player);
}

function finish(now, message) {
  state.phase = 'finished';
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
  if (config.mode === 'sprint') {
    const message = config.playerCount === 2 ? player.title + ' 获胜' : '已达成目标 ' + goal.value;
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
  const newGoal = makeGoal(player.board, goal.indices.length, 4 + goal.indices.length % 3, player.random, remaining);
  player.goals = player.goals.map(item => item.id === goal.id ? newGoal : item);
  player.selected = newGoal.id;
  setStatus(player.title + ' 消除 ' + goal.value + '，得 ' + goal.indices.length + ' 分');
  renderPlayer(player);
  celebrate(player, goal);
}

function slide(playerIndex, position) {
  const now = performance.now();
  const waveNumber = state.wave?.number;
  updateTime(now);
  if (waveNumber !== state.wave?.number || state.phase === 'finished') return;
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
  if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
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
document.addEventListener('keydown', onKeyDown);
elements.players.addEventListener('animationend', event => {
  if (event.animationName === 'clear') event.target.classList.remove('cleared');
});
setup();

function animate(now) {
  updateTime(now);
  if (state.wave && state.phase === 'playing') animateWave(now);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
