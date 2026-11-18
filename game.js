'use strict';

const size = 4;
const boardElement = document.querySelector('#board');
const form = document.querySelector('#settings');
const duration = document.querySelector('#duration');
const start = document.querySelector('#start');
const screenLabel = document.querySelector('#screen-label');
const screenCross = document.querySelector('#screen-cross');
const status = document.querySelector('#status');

let board;
let goal;
let phase = 'ready';

const targetCells = Array.from({ length: size ** 2 }, () => {
  const cell = document.createElement('div');
  cell.className = 'cross-cell';
  return cell;
});
const targetValue = document.createElement('b');
screenCross.append(...targetCells);

const tiles = Array.from({ length: size ** 2 }, (_, position) => {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'tile';
  tile.addEventListener('click', () => slide(position));
  return tile;
});
boardElement.append(...tiles);

function paintBoard(stride = 0) {
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

function newQuestion() {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const random = puzzle.randomFrom(seed);
  const center = Math.floor(random() * size ** 2);
  board = puzzle.newBoard(size);
  const frame = puzzle.frameAt(center, size);
  const question = puzzle.generateGoal(board, 6, random, goal ? [goal] : [], size, [frame]);
  goal = { ...question, center };
}

function slide(position) {
  if (phase !== 'playing') return;
  const blank = board.indexOf(0);
  const stride = puzzle.slideStride(blank, position, size);
  if (!stride) return;
  for (let index = blank; index !== position; index += stride) {
    board[index] = board[index + stride];
  }
  board[position] = 0;
  if (puzzle.solved(board, goal)) {
    phase = 'finished';
    status.textContent = '答对了';
    screenLabel.hidden = false;
    screenLabel.textContent = '答对了';
  }
  paintBoard(stride);
}

form.addEventListener('submit', event => {
  event.preventDefault();
  if (phase === 'preview') return;
  const milliseconds = puzzle.flashMilliseconds(duration.valueAsNumber);
  if (milliseconds === null) {
    status.textContent = '请输入 0.01 秒以上，最多两位小数。';
    return;
  }
  if (phase !== 'ready') newQuestion();
  phase = 'preview';
  duration.disabled = true;
  start.disabled = true;
  status.textContent = '记住交叉格的位置和数字。';
  screenLabel.hidden = false;
  screenLabel.classList.add('countdown');
  targetCells.forEach((cell, index) => cell.classList.toggle('active', goal.indices.includes(index)));
  targetCells[goal.center].append(targetValue);
  targetValue.textContent = goal.value;
  paintBoard();

  const flash = puzzle.flashSchedule(performance.now(), milliseconds);
  let shown = false;

  function paint(now) {
    const counting = now < flash.at;
    // Let one frame through when the 10 ms interval lands between refreshes.
    const show = !counting && (now < flash.until || (!shown && now < flash.answerAt));
    screenLabel.hidden = !counting;
    if (counting) screenLabel.textContent = String(Math.ceil((flash.at - now) / 1000));
    screenCross.hidden = !show;
    if (show) shown = true;

    if (now < flash.answerAt) {
      requestAnimationFrame(paint);
      return;
    }
    screenLabel.classList.remove('countdown');
    targetValue.textContent = '';
    phase = 'playing';
    duration.disabled = false;
    start.disabled = false;
    start.textContent = '下一题';
    status.textContent = '开始推盘';
    paintBoard();
  }
  requestAnimationFrame(paint);
});

const directions = { ArrowLeft: [0, 1], ArrowRight: [0, -1], ArrowUp: [1, 0], ArrowDown: [-1, 0] };
document.addEventListener('keydown', event => {
  if (phase !== 'playing' || event.target instanceof HTMLInputElement || event.ctrlKey || event.altKey || event.metaKey) return;
  const direction = directions[event.key];
  if (!direction) return;
  const blank = board.indexOf(0);
  const row = Math.floor(blank / size) + direction[0];
  const column = blank % size + direction[1];
  event.preventDefault();
  if (row >= 0 && row < size && column >= 0 && column < size) slide(row * size + column);
});

newQuestion();
paintBoard();
