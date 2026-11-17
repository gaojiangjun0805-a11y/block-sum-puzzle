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
      card.style.transform = 'translateY(' + distance * progress + 'px)';
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

  function connectRoom(onPacket, onError, credentials) {
    const query = credentials ? '?' + new URLSearchParams(credentials) : '';
    const events = new EventSource('/api/events' + query);
    events.onmessage = message => onPacket(JSON.parse(message.data));
    events.onerror = onError;
    return events;
  }

  async function post(path, data, credentials) {
    const query = credentials ? '?' + new URLSearchParams(credentials) : '';
    const response = await fetch('/api/' + path + query, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  }

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

  function show(view, elements) {
    const room = viewQuery.has('room') || view === 'host';
    document.body.dataset.view = view;
    elements['play-view'].hidden = true;
    elements[view + '-view'].hidden = false;
    const headings = { screen: '速算华容道', rank: '实时排行榜', host: '比赛控制' };
    document.querySelector('h1').textContent = headings[view];
    document.title = headings[view] + ' · 速算华容道';
    const roomQuery = room ? '&room=1' : '';
    elements['screen-rank'].href = '?view=rank' + roomQuery;
    elements['rank-back'].href = '?view=screen' + roomQuery;
    for (const button of document.querySelectorAll('[data-fullscreen]')) {
      button.addEventListener('click', () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen?.().catch(() => {});
      });
    }

    let packet;
    let sourceOffset = 0;
    let currentPage = 0;
    let arenaKey;
    let rankKey;
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
      sourceOffset = room ? next.now - Date.now() : 0;
      elements['mode-tag'].textContent = puzzle.rules[next.mode].title;
      elements['clock-label'].textContent = puzzle.rules[next.mode].seconds ? '剩余' : '用时';
      const number = next.rows.length;
      elements['seat-tag'].textContent = room ? number + ' / ' + next.capacity + ' 人' : number + ' 人练习';
      if (view === 'screen') paintScreen();
      if (view === 'rank') paintRank();
      if (view === 'host') {
        elements['host-count'].textContent = '已加入 ' + number + ' / ' + next.capacity + ' 人 · ' + puzzle.rules[next.mode].title + ' · ' + next.size + '×' + next.size;
        elements['host-status'].textContent = next.status;
      }
    }

    function disconnected() {
      const message = '等待比赛连接';
      if (view === 'screen') elements['screen-status'].textContent = message;
      if (view === 'host') elements['host-status'].textContent = message;
      if (view === 'rank') {
        elements['rank-empty'].hidden = false;
        elements['rank-empty'].textContent = message;
      }
    }

    if (room && location.protocol !== 'file:') {
      connectRoom(receive, disconnected);
    } else if (!room) {
      listenPractice(receive);
    }
    if (!packet) {
      elements['seat-tag'].textContent = '等待比赛';
      if (view === 'screen') elements['screen-status'].textContent = room ? '等待比赛连接' : '在选手端启动一局练习';
      if (view === 'rank') elements['rank-empty'].hidden = false;
    }

    if (view === 'host') {
      async function control(action) {
        try {
          const result = await post('host', {
            action, key: elements['host-key'].value,
            mode: elements['host-mode'].value, size: Number(elements['host-size'].value)
          });
          receive(result);
        } catch (error) {
          elements['host-status'].textContent = error.message;
        }
      }
      elements['host-prepare'].addEventListener('click', () => { void control('prepare'); });
      elements['host-form'].addEventListener('submit', event => {
        event.preventDefault();
        void control('start');
      });
    }

    function animate() {
      if (packet) {
        const now = Date.now() + sourceOffset;
        const clock = projectedClock(packet, now);
        if (elements.clock.textContent !== clock) elements.clock.textContent = clock;
        if (view === 'screen' && packet.wave) animateArena(elements['screen-arena'], packet.wave, packet.end ?? now);
      }
      requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
  }

  return { shape, seatLabel, drawArena, animateArena, projectedClock, connectRoom, post, publish, listenRequests, show };
})();
