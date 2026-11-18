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
    let flashAt;
    let paintedFlash = false;
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
        const at = packet.phase === 'preview' ? packet.flash?.at : undefined;
        if (at !== flashAt) {
          flashAt = at;
          paintedFlash = false;
          const figure = elements['flash-figure'];
          figure.replaceChildren();
          if (at && packet.flashGoal) {
            const cross = shape(puzzle.reference, 4);
            cross.children[6].append(textNode('b', packet.flashGoal.value));
            figure.append(cross);
          }
        }
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
      const first = !packet;
      packet = next;
      sourceOffset = room ? next.now - Date.now() : 0;
      elements['mode-tag'].textContent = puzzle.rules[next.mode].title;
      elements['clock-label'].textContent = puzzle.rules[next.mode].seconds ? '剩余' : '用时';
      const number = next.rows.length;
      elements['seat-tag'].textContent = room ? number + ' / ' + next.capacity + ' 人' : number + ' 人练习';
      if (view === 'screen') paintScreen();
      if (view === 'rank') paintRank();
      if (view === 'host') {
        if (first) {
          elements['host-mode'].value = next.mode;
          elements['host-size'].value = String(next.size);
          elements['host-flash-time'].value = next.flashDuration / 1000;
          elements['host-flash-config'].hidden = next.mode !== 'memory';
        }
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
      connectRoom(receive, disconnected, view === 'screen' ? { screen: 1 } : undefined);
    } else if (!room) {
      listenPractice(receive);
    }
    if (!packet) {
      elements['seat-tag'].textContent = '等待比赛';
      if (view === 'screen') elements['screen-status'].textContent = room ? '等待比赛连接' : '在选手端启动一局练习';
      if (view === 'rank') elements['rank-empty'].hidden = false;
    }

    if (view === 'host') {
      elements['host-mode'].addEventListener('change', () => {
        elements['host-flash-config'].hidden = elements['host-mode'].value !== 'memory';
      });
      async function control(action) {
        const mode = elements['host-mode'].value;
        const size = Number(elements['host-size'].value);
        const input = elements['host-flash-time'];
        const duration = puzzle.flashMilliseconds(input.valueAsNumber);
        if (mode === 'memory' && duration === null) {
          elements['host-status'].textContent = '闪示时长请填写 0.01 秒或以上，最多两位小数。';
          input.focus();
          return;
        }
        if (action === 'start' && (mode !== packet?.mode || size !== packet?.size ||
          (mode === 'memory' && duration !== packet.flashDuration))) {
          elements['host-status'].textContent = '请先点「准备新局」应用赛制设置。';
          return;
        }
        try {
          const result = await post('host', {
            action, key: elements['host-key'].value, mode, size, flashSeconds: input.valueAsNumber,
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

    function animateFlash(now) {
      const overlay = elements['flash-overlay'];
      const figure = elements['flash-figure'];
      const countdown = elements['flash-countdown'];
      const flash = packet.phase === 'preview' ? packet.flash : null;
      const showCountdown = Boolean(flash && now < flash.at);
      // If a 10 ms window falls between display frames, paint the next frame before play unlocks.
      const showFigure = Boolean(flash && packet.flashGoal && now >= flash.at &&
        (now < flash.until || (!paintedFlash && now < flash.answerAt)));
      overlay.hidden = !showCountdown && !showFigure;
      figure.hidden = !showFigure;
      countdown.hidden = !showCountdown;
      if (showFigure) paintedFlash = true;
      if (showCountdown) {
        const digit = String(Math.ceil((flash.at - now) / 1000));
        if (countdown.textContent !== digit) countdown.textContent = digit;
      }
    }

    function animate() {
      if (packet) {
        const now = Date.now() + sourceOffset;
        const clock = projectedClock(packet, now);
        if (elements.clock.textContent !== clock) elements.clock.textContent = clock;
        if (view === 'screen' && packet.wave) animateArena(elements['screen-arena'], packet.wave, packet.end ?? now);
        if (view === 'screen') animateFlash(now);
      }
      requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
  }

  return { shape, seatLabel, drawArena, animateArena, projectedClock, connectRoom, post, publish, listenRequests, show };
})();
