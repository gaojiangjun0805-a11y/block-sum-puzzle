'use strict';

const puzzle = (() => {
  const flashLead = 3000;
  const flashGrace = 40;

  function flashMilliseconds(seconds) {
    const centiseconds = Math.round(seconds * 100);
    if (seconds < .01 || !Number.isSafeInteger(centiseconds) || Math.abs(seconds * 100 - centiseconds) > 1e-6) return null;
    return centiseconds * 10;
  }

  function flashSchedule(now, duration) {
    const at = now + flashLead;
    return { at, until: at + duration, answerAt: at + duration + flashGrace };
  }

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

  function walk(board, steps, random, size) {
    const cells = board.slice();
    let gap = cells.indexOf(0);
    let previousGap = -1;
    for (let step = 0; step < steps; step += 1) {
      const nextGap = choose(neighbors(gap, size).filter(index => index !== previousGap), random);
      cells[gap] = cells[nextGap];
      cells[nextGap] = 0;
      previousGap = gap;
      gap = nextGap;
    }
    return cells;
  }

  function newBoard(random, steps, size) {
    const cells = Array.from({ length: size ** 2 }, (_, index) => (index + 1) % (size ** 2));
    return walk(cells, steps, random, size);
  }

  function frameAt(center, size) {
    const row = Math.floor(center / size);
    const column = center % size;
    const cells = [];
    for (let index = 0; index < size ** 2; index += 1) {
      if (Math.floor(index / size) === row || index % size === column) cells.push(index);
    }
    return cells;
  }

  function sumInFrame(board, indices) {
    return indices.reduce((sum, index) => sum + board[index], 0);
  }

  function solved(board, goal) {
    return goal.indices.every(index => board[index] !== 0) && sumInFrame(board, goal.indices) === goal.value;
  }

  function generateGoal(board, steps, random, excluded, size, frames) {
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
      const goal = findGoal(walk(board, steps + attempt % 3, random, size));
      if (goal) return goal;
    }

    // A single fixed frame can repeat sums on short random walks. Search reachable states in order.
    const queue = [board];
    const visited = new Set([board.join(',')]);
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      const gap = current.indexOf(0);
      for (const tile of neighbors(gap, size)) {
        const cells = current.slice();
        cells[gap] = cells[tile];
        cells[tile] = 0;
        const key = cells.join(',');
        if (visited.has(key)) continue;
        const goal = findGoal(cells);
        if (goal) return goal;
        visited.add(key);
        queue.push(cells);
      }
    }
    throw new Error('无法生成可达成的目标框');
  }

  return { randomFrom, slideStride, newBoard, frameAt, solved, generateGoal,
    flashMilliseconds, flashSchedule };
})();

if (typeof module !== 'undefined') module.exports = puzzle;
