'use strict';

const displays = (() => {
  const viewQuery = new URLSearchParams(location.search);
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('速算华容道-练习') : null;
  const practiceKey = '速算华容道-练习画面';
  const pageSize = 10;

  function shape(goal, size) {
    const grid = document.createElement('div');
    grid.className = 'shape';
    grid.style.setProperty('--size', size);
    grid.setAttribute('role', 'img');
    const positions = goal.indices.map(index => (Math.floor(index / size) + 1) + ' 行 ' + (index % size + 1) + ' 列');
    grid.setAttribute('aria-label', '目标框：' + positions.join('、'));
    for (let index = 0; index < size ** 2; index += 1) {
      const cell = document.createElement('i');
      cell.classList.toggle('filled', goal.indices.includes(index));
      grid.append(cell);
    }
    return grid;
  }

  function projectedClock(packet, now) {
    const limit = puzzle.rules[packet.mode].seconds;
    const elapsed = packet.start === null ? 0 : Math.max(0, Math.floor(((packet.end ?? now) - packet.start) / 1000));
    const seconds = limit ? Math.max(0, limit - elapsed) : elapsed;
    return [Math.floor(seconds / 60), seconds % 60].map(value => String(value).padStart(2, '0')).join(':');
  }

  function textNode(tag, text, className) {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function drawArena(container, wave, size) {
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
        card.classList.toggle('featured', wave.slots === 3 && lane === wave.slots - 1);
        card.dataset.lane = lane;
        const value = textNode('b', goal.value);
        value.dataset.goalValue = '';
        card.append(value, shape(goal, size));
        column.append(card);
      }
      lanes.append(column);
    }
    container.dataset.wave = wave.number;
    container.replaceChildren(lanes);
  }

  function animateArena(container, wave, now, meter) {
    const progress = wave.startedAt === null ? 0 : Math.max(0, Math.min(1, (now - wave.startedAt) / wave.duration));
    if (meter) meter.style.transform = 'scaleX(' + (1 - progress) + ')';
    for (const card of container.querySelectorAll('.fall-card')) {
      const distance = Math.max(0, container.clientHeight - card.offsetHeight - 8);
      const fall = wave.slots === 1 ? progress : progress ** (1.18 - Number(card.dataset.lane) * .18);
      card.style.transform = 'translateY(' + distance * fall + 'px)';
    }
  }

  function ranked(rows) {
    const sorted = [...rows].sort((a, b) => (b.score - a.score) || (a.number - b.number));
    let rank = 0;
    return sorted.map((row, index) => {
      if (!index || row.score !== sorted[index - 1].score) rank = index + 1;
      return { ...row, rank };
    });
  }

  const seatLabel = number => String(number).padStart(3, '0');

  function publish(packet) {
    channel?.postMessage({ type: 'state', packet });
    try {
      localStorage.setItem(practiceKey, JSON.stringify(packet));
    } catch {
      // A display can still receive the live state over BroadcastChannel.
    }
  }

  function listenPractice(onPacket) {
    function accept(response) {
      if (response?.type === 'state') onPacket(response.packet);
    }
    channel?.addEventListener('message', event => accept(event.data));
    window.addEventListener('storage', event => {
      if (event.key === practiceKey && event.newValue) onPacket(JSON.parse(event.newValue));
    });
    try {
      const saved = localStorage.getItem(practiceKey);
      if (saved) onPacket(JSON.parse(saved));
    } catch {
      // Wait for a practice tab to publish its state.
    }
    channel?.postMessage({ type: 'request' });
  }

  function listenRequests(getPacket) {
    channel?.addEventListener('message', event => {
      if (event.data?.type === 'request') channel.postMessage({ type: 'state', packet: getPacket() });
    });
  }

  function createFlashView(elements) {
    const overlay = elements['flash-overlay'];
    const figure = elements['flash-figure'];
    const countdown = elements['flash-countdown'];
    let lastAt = null;
    let painted = false;

    return (flash, goal, now) => {
      const at = flash?.at ?? null;
      if (at !== lastAt) {
        lastAt = at;
        painted = false;
        figure.replaceChildren();
        if (flash && goal) {
          const cross = shape(puzzle.reference, 4);
          cross.children[6].append(textNode('b', goal.value));
          figure.append(cross);
        }
      }
      const showCountdown = Boolean(flash && now < flash.at);
      // A 10 ms window may fall between frames. Paint the next frame before play unlocks.
      const showFigure = Boolean(flash && goal && now >= flash.at &&
        (now < flash.until || (!painted && now < flash.answerAt)));
      overlay.hidden = !showCountdown && !showFigure;
      figure.hidden = !showFigure;
      countdown.hidden = !showCountdown;
      if (showFigure) painted = true;
      if (showCountdown) {
        const digit = String(Math.ceil((flash.at - now) / 1000));
        if (countdown.textContent !== digit) countdown.textContent = digit;
      }
    };
  }

  function show(view, elements) {
    document.body.dataset.view = view;
    elements['play-view'].hidden = true;
    elements[view + '-view'].hidden = false;
    const headings = { screen: '速算华容道', rank: '实时排行榜' };
    document.querySelector('h1').textContent = headings[view];
    document.title = headings[view] + ' · 速算华容道';
    for (const button of document.querySelectorAll('[data-fullscreen]')) {
      button.addEventListener('click', () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen?.().catch(() => {});
      });
    }

    let packet;
    let currentPage = 0;
    let arenaKey;
    let rankKey;
    const showFlash = createFlashView(elements);
    const ownNumber = Number(viewQuery.get('me'));

    function paintRank() {
      if (!packet) return;
      const rows = ranked(packet.rows);
      const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
      currentPage = Math.min(currentPage, pageCount - 1);
      const first = currentPage * pageSize;
      elements['rank-empty'].hidden = Boolean(rows.length);
      elements['rank-rows'].replaceChildren(...rows.slice(first, first + pageSize).map(row => {
        const line = document.createElement('tr');
        if (row.number === ownNumber) line.dataset.mine = '';
        line.append(textNode('td', row.rank), textNode('td', seatLabel(row.number)), textNode('td', row.score));
        return line;
      }));
      const own = rows.find(row => row.number === ownNumber);
      elements['my-standing'].hidden = !own;
      if (own) elements['my-standing'].textContent = '我的名次 ' + own.rank + ' · 选手 ' + seatLabel(own.number) + ' · ' + own.score + ' 分';
      elements['rank-range'].textContent = rows.length
        ? (first + 1) + '–' + Math.min(first + pageSize, rows.length) + ' / ' + rows.length
        : '0 / ' + packet.capacity;
      if (rankKey !== pageCount) {
        rankKey = pageCount;
        elements['rank-pages'].replaceChildren(...Array.from({ length: pageCount }, (_, index) => {
          const button = textNode('button', index + 1);
          button.type = 'button';
          button.setAttribute('aria-label', '第 ' + (index + 1) + ' 页');
          button.addEventListener('click', () => {
            currentPage = index;
            paintRank();
          });
          return button;
        }));
      }
      [...elements['rank-pages'].children].forEach((button, index) => {
        if (index === currentPage) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      });
    }

    function paintScreen() {
      const rows = ranked(packet.rows).slice(0, 3);
      const arena = elements['screen-arena'];
      const feature = elements['screen-feature'];
      arena.hidden = !packet.wave;
      feature.hidden = Boolean(packet.wave);
      if (packet.wave) {
        const key = [packet.round, packet.wave.number, ...packet.wave.goals.map(goal => goal.id)].join('/');
        if (key !== arenaKey) {
          drawArena(arena, packet.wave, packet.size);
          arenaKey = key;
        }
      } else if (packet.goal) {
        feature.replaceChildren(textNode('p', '共同目标'), textNode('strong', packet.goal.value), shape(packet.goal, packet.size));
      } else if (packet.mode === 'memory') {
        const labels = { ready: '准备闪示', preview: '请看大屏', playing: '开始推盘', finished: '本题结束' };
        feature.replaceChildren(textNode('p', labels[packet.phase]));
      } else {
        const leader = rows[0];
        feature.replaceChildren(textNode('p', '独立计分'),
          textNode('strong', leader?.score ?? 0), textNode('p', leader ? '当前最高积分 · ' + seatLabel(leader.number) : '等待比赛开始'));
      }
      elements['screen-leaders'].replaceChildren(...rows.map(row => {
        const item = document.createElement('li');
        item.append(textNode('b', row.rank), textNode('b', seatLabel(row.number)), textNode('b', row.score + ' 分'));
        return item;
      }));
      const event = packet.lastEvent;
      if (event) {
        const verb = packet.mode === 'fall' ? '抢消' : '达成';
        elements['screen-event'].replaceChildren(textNode('span', seatLabel(event.number) + ' ' + verb + ' '),
          textNode('strong', '+' + event.points));
      } else {
        elements['screen-event'].textContent = '等待得分';
      }
      elements['screen-status'].textContent = packet.status;
    }

    function receive(next) {
      packet = next;
      elements['mode-tag'].textContent = puzzle.rules[next.mode].title;
      elements['clock-label'].textContent = puzzle.rules[next.mode].seconds ? '剩余' : '用时';
      elements['seat-tag'].textContent = next.rows.length + ' 人练习';
      if (view === 'screen') paintScreen();
      if (view === 'rank') paintRank();
    }

    listenPractice(receive);
    if (!packet) {
      elements['seat-tag'].textContent = '等待游戏';
      if (view === 'screen') elements['screen-status'].textContent = '在游戏页开始一局';
      if (view === 'rank') elements['rank-empty'].hidden = false;
    }

    function animate() {
      if (packet) {
        const now = Date.now();
        const clock = projectedClock(packet, now);
        if (elements.clock.textContent !== clock) elements.clock.textContent = clock;
        if (view === 'screen' && packet.wave) animateArena(elements['screen-arena'], packet.wave, packet.end ?? now);
        if (view === 'screen') {
          showFlash(packet.phase === 'preview' ? packet.flash : null, packet.flashGoal, now);
        }
      }
      requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
  }

  return { shape, drawArena, animateArena, publish, listenRequests, createFlashView, show };
})();
