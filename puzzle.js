'use strict';

const puzzle = (() => {
  const rules = {
    sprint: {
      title: '单题竞速',
      description: '把目标框填满，框内数字恰好达到目标值即完成。双人赛以先达成为胜。'
    },
    fall: {
      title: '弹幕抢消',
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

  function generateGoal(board, length, steps, random, excluded, size, catalog) {
    const frames = catalog.get(length);
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

    // A frame containing the current gap can be completed by moving its gap outside.
    const gap = board.indexOf(0);
    for (const tile of neighbors(gap, size)) {
      const cells = board.slice();
      cells[gap] = cells[tile];
      cells[tile] = 0;
      const goal = findGoal(cells);
      if (goal) return goal;
    }
    throw new Error('无法生成可达成的目标框');
  }

  function generateWave(board, now, elapsed, number, goalFor) {
    const level = Math.min(2, Math.floor(elapsed / 25));
    const slots = level + 1;
    const goals = [];
    for (let lane = 0; lane < slots; lane += 1) {
      const length = [4, 5, 7][Math.min(level, lane)];
      const goal = goalFor(board, length, 3 + level + lane, goals);
      goals.push({ ...goal, lane });
    }
    return {
      number,
      goals, slots, startedAt: now, duration: [12000, 9500, 7200][level]
    };
  }

  return { rules, reference, randomFrom, slideStride, newBoard, buildFrames, sumInFrame, solved, generateGoal, generateWave };
})();

if (typeof module !== 'undefined') module.exports = puzzle;
