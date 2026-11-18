'use strict';

const boardElement = document.querySelector('#board');
const form = document.querySelector('#settings');
const duration = document.querySelector('#duration');
const boardSize = document.querySelector('#board-size');
const questionCount = document.querySelector('#question-count');
const tabs = document.querySelector('#question-tabs');
const flashOrder = document.querySelector('#flash-order');
const verify = document.querySelector('#verify');
const verificationResult = document.querySelector('#verification-result');
const questionNames = ['题目一', '题目二', '题目三'];
const countdownLength = 3000;
const flashGap = 80;
const start = document.querySelector('#start');
const screenLabel = document.querySelector('#screen-label');
const screenCross = document.querySelector('#screen-cross');
const elapsed = document.querySelector('#elapsed');
const status = document.querySelector('#status');

let size;
let questions = [];
let activeIndex = 0;
let phase = 'ready';
let playStartedAt;
let timerFrame = null;
let tiles;
let targetCells;

const targetValue = document.createElement('b');

function setupBoard() {
  size = Number(boardSize.value);
  for (const grid of [boardElement, screenCross]) {
    grid.style.setProperty('--size', size);
    grid.dataset.size = size;
  }
  targetCells = Array.from({ length: size ** 2 }, () => {
    const cell = document.createElement('div');
    cell.className = 'cross-cell';
    return cell;
  });
  screenCross.replaceChildren(...targetCells);
  tiles = Array.from({ length: size ** 2 }, (_, position) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'tile';
    tile.addEventListener('click', () => slide(position));
    return tile;
  });
  boardElement.replaceChildren(...tiles);

  stopTimer();
  showElapsed(0);
  phase = 'ready';
  screenLabel.hidden = false;
  screenLabel.textContent = '等待开始';
  start.textContent = '开始测试';
  status.textContent = '闪示结束后开始推盘。';
  newQuestions();
  paintBoard();
}

function paintBoard(stride = 0) {
  const { board } = questions[activeIndex];
  const name = questions.length > 1 ? questionNames[activeIndex] + ' ' : '';
  boardElement.setAttribute('aria-label', name + size + '×' + size + ' 推盘');
  const blank = board.indexOf(0);
  for (const [index, tile] of tiles.entries()) {
    const value = board[index];
    const movable = phase === 'playing' && Boolean(puzzle.slideStride(blank, index, size));
    tile.classList.toggle('empty', !value);
    tile.classList.toggle('movable', movable);
    tile.setAttribute('aria-disabled', String(!movable));
    tile.tabIndex = movable ? 0 : -1;
    tile.setAttribute('aria-label', value ? String(value) : '空格');

    if ((tile.firstElementChild?.textContent ?? '') === (value ? String(value) : '')) continue;
    tile.replaceChildren();
    if (value) {
      const face = document.createElement('span');
      face.textContent = value;
      if (stride) {
        const x = Math.abs(stride) === 1 ? stride * 55 : 0;
        const y = Math.abs(stride) === size ? stride / size * 55 : 0;
        face.style.setProperty('--dx', x + '%');
        face.style.setProperty('--dy', y + '%');
        face.className = 'sliding';
      }
      tile.append(face);
    }
  }
}

function newQuestions() {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const random = puzzle.randomFrom(seed);
  const used = questions.map(question => question.goal);
  questions = Array.from({ length: Number(questionCount.value) }, () => {
    const center = Math.floor(random() * size ** 2);
    const board = puzzle.newBoard(size);
    const frame = puzzle.frameAt(center, size);
    const goal = puzzle.generateGoal(board, 6, random, used, size, [frame]);
    used.push(goal);
    return { board, center, goal };
  });
  activeIndex = 0;
  verificationResult.hidden = true;
  tabs.hidden = questions.length === 1;
  tabs.replaceChildren(...questions.map((_, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = questionNames[index];
    button.addEventListener('click', () => {
      activeIndex = index;
      syncAnswerControls();
      paintBoard();
    });
    return button;
  }));
  syncAnswerControls();
}

function syncAnswerControls() {
  const canAnswer = phase === 'playing';
  for (const [index, button] of [...tabs.children].entries()) {
    button.setAttribute('aria-pressed', String(index === activeIndex));
    button.disabled = !canAnswer && phase !== 'finished';
  }
  verify.hidden = questions.length === 1;
  verify.disabled = !canAnswer;
}

function showElapsed(milliseconds) {
  const seconds = (Math.max(0, milliseconds) / 1000).toFixed(2);
  if (elapsed.textContent === seconds) return;
  elapsed.textContent = seconds;
  elapsed.dateTime = 'PT' + seconds + 'S';
}

function updateTimer(now) {
  showElapsed(now - playStartedAt);
  timerFrame = requestAnimationFrame(updateTimer);
}

function stopTimer() {
  if (timerFrame !== null) cancelAnimationFrame(timerFrame);
  timerFrame = null;
}

function slide(position) {
  if (phase !== 'playing') return;
  const question = questions[activeIndex];
  const { board } = question;
  const blank = board.indexOf(0);
  const stride = puzzle.slideStride(blank, position, size);
  if (!stride) return;
  for (let index = blank; index !== position; index += stride) {
    board[index] = board[index + stride];
  }
  board[position] = 0;
  verificationResult.hidden = true;
  if (questions.length === 1 && puzzle.solved(board, question.goal)) finish();
  paintBoard(stride);
}

function finish() {
  phase = 'finished';
  stopTimer();
  showElapsed(performance.now() - playStartedAt);
  const message = questions.length === 1 ? '答对了' : '全部答对了';
  status.textContent = message;
  screenLabel.hidden = false;
  screenLabel.textContent = message;
  verificationResult.hidden = true;
  syncAnswerControls();
}

verify.addEventListener('click', () => {
  if (phase !== 'playing') return;
  const incomplete = questions.flatMap((question, index) =>
    puzzle.solved(question.board, question.goal) ? [] : [questionNames[index]]
  );
  if (!incomplete.length) {
    finish();
    paintBoard();
    return;
  }
  verificationResult.textContent = incomplete.join('、') + '未通过。';
  verificationResult.hidden = false;
});

function showQuestion(index) {
  const { center, goal } = questions[index];
  targetCells.forEach((cell, position) => cell.classList.toggle('active', goal.indices.includes(position)));
  targetCells[center].append(targetValue);
  targetValue.textContent = goal.value;
  flashOrder.textContent = questionNames[index];
  flashOrder.hidden = questions.length === 1;
  screenCross.hidden = false;
}

function beginAnswering() {
  targetValue.textContent = '';
  phase = 'playing';
  playStartedAt = performance.now();
  timerFrame = requestAnimationFrame(updateTimer);
  duration.disabled = false;
  boardSize.disabled = false;
  questionCount.disabled = false;
  start.disabled = false;
  start.textContent = questions.length === 1 ? '下一题' : '下一组';
  status.textContent = '开始推盘';
  syncAnswerControls();
  paintBoard();
}

form.addEventListener('submit', event => {
  event.preventDefault();
  if (phase === 'preview') return;
  const milliseconds = puzzle.flashMilliseconds(duration.valueAsNumber);
  if (milliseconds === null) {
    status.textContent = '请输入 0.01 秒以上，最多两位小数。';
    return;
  }
  const restart = phase !== 'ready';
  phase = 'preview';
  if (restart) newQuestions();
  else syncAnswerControls();
  stopTimer();
  showElapsed(0);
  duration.disabled = true;
  boardSize.disabled = true;
  questionCount.disabled = true;
  start.disabled = true;
  status.textContent = '记住交叉格的位置和数字。';
  screenLabel.hidden = false;
  screenLabel.classList.add('countdown');
  paintBoard();

  let showAt = performance.now() + countdownLength;
  let hideAt = null;
  let index = 0;

  function paint(now) {
    if (now < showAt) {
      if (index === 0) screenLabel.textContent = String(Math.ceil((showAt - now) / 1000));
    } else if (hideAt === null) {
      screenLabel.hidden = true;
      screenLabel.classList.remove('countdown');
      showQuestion(index);
      hideAt = now + milliseconds;
    } else if (now >= hideAt) {
      screenCross.hidden = true;
      flashOrder.hidden = true;
      index += 1;
      if (index === questions.length) {
        beginAnswering();
        return;
      }
      showAt = now + flashGap;
      hideAt = null;
    }

    requestAnimationFrame(paint);
  }
  requestAnimationFrame(paint);
});

const directions = { ArrowLeft: [0, 1], ArrowRight: [0, -1], ArrowUp: [1, 0], ArrowDown: [-1, 0] };
document.addEventListener('keydown', event => {
  if (phase !== 'playing' || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement ||
      event.ctrlKey || event.altKey || event.metaKey) return;
  const direction = directions[event.key];
  if (!direction) return;
  const blank = questions[activeIndex].board.indexOf(0);
  const row = Math.floor(blank / size) + direction[0];
  const column = blank % size + direction[1];
  event.preventDefault();
  if (row >= 0 && row < size && column >= 0 && column < size) slide(row * size + column);
});

boardSize.addEventListener('change', setupBoard);
questionCount.addEventListener('change', setupBoard);
setupBoard();
