(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const mapCanvas = $('#city-map');
  const chartCanvas = $('#depth-chart');
  const mapContext = mapCanvas.getContext('2d');
  const chartContext = chartCanvas.getContext('2d');
  const sizePresets = { compact: [44, 28], district: [64, 40], regional: [88, 54] };
  const sizeLabels = { compact: '44 × 28', district: '64 × 40', regional: '88 × 54' };
  const cell = { width: 64, height: 40 };
  let world;
  let seed = 42;
  let tick = 0;
  let rain = 38;
  let tide = 0.8;
  let layer = 'flood';
  let activeTool = 'pump';
  let running = false;
  let timer = 0;
  let defenses = [];
  let history = [];
  let baselineResult = null;
  let comparisonResult = null;
  let resizeFrame = 0;
  const maxTicks = 24;

  function randomGenerator(value) {
    let state = value >>> 0;
    return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function hash(x, y) { const n = Math.sin(x * 127.1 + y * 311.7 + seed * 17.17) * 43758.5453; return n - Math.floor(n); }
  function smoothNoise(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return (hash(x0, y0) * (1 - sx) + hash(x0 + 1, y0) * sx) * (1 - sy) + (hash(x0, y0 + 1) * (1 - sx) + hash(x0 + 1, y0 + 1) * sx) * sy;
  }
  function terrainHeight(x, y) {
    const coast = Math.max(0, Math.min(1, (x / cell.width - 0.73) * 4.4));
    const broad = smoothNoise(x / 9, y / 9) * 0.43 + smoothNoise(x / 4, y / 4) * 0.2 + smoothNoise(x / 1.6, y / 1.6) * 0.07;
    const ridge = Math.max(0, 1 - Math.abs(y / cell.height - (0.43 + Math.sin(x / 10) * 0.08)) * 7) * 0.17;
    return Math.max(0.025, Math.min(1, 0.09 + coast * 0.46 + broad + ridge));
  }
  function makeWorld() {
    const rand = randomGenerator(seed);
    world = Array.from({ length: cell.height }, (_, y) => Array.from({ length: cell.width }, (_, x) => ({ x, y, height: terrainHeight(x, y), water: 0, kind: 'ground', population: 0, permeability: 0.3 + rand() * 0.56, safe: false })));
    const roadX = Math.floor(cell.width * 0.23), roadY = Math.floor(cell.height * 0.58);
    for (let y = 0; y < cell.height; y++) for (let x = 0; x < cell.width; x++) {
      const c = world[y][x];
      if (x > cell.width * 0.76 && c.height < 0.63) c.kind = 'water';
      else if ((x % 12 >= 2 && x % 12 <= 3) || (y % 10 >= 2 && y % 10 <= 3)) c.kind = 'road';
      else if (x < cell.width * 0.7 && ((x + y * 3) % 17 < 8) && c.height > 0.28) { c.kind = 'building'; c.population = 24 + Math.floor(rand() * 108); }
      else if ((x * 7 + y * 11 + seed) % 113 < 5) c.kind = 'park';
      if (x === roadX || y === roadY || (x > roadX && y === roadY - 5 && x % 7 < 4)) c.kind = 'road';
      if (x === Math.floor(cell.width * 0.17) && y === Math.floor(cell.height * 0.19)) c.kind = 'shelter';
      if (x === Math.floor(cell.width * 0.57) && y === Math.floor(cell.height * 0.83)) c.kind = 'shelter';
    }
    const buildings = world.flat().filter(c => c.kind === 'building');
    for (const c of world.flat()) c.safe = c.kind === 'shelter';
    defenses = [];
    tick = 0;
    history = [0];
    $('[data-map-label]').textContent = `· сетка ${cell.width} × ${cell.height}`;
    $('[data-seed]').textContent = String(seed).padStart(4, '0');
    $('[data-total-buildings]').textContent = buildings.length;
    $('[data-defense-count]').textContent = '0';
    $('#map-hint').textContent = 'Карта готова · выберите слой';
    $('#event-log').replaceChildren(makeEvent('00:00', 'Сценарий готов к запуску.'));
    stop();
    updateMetrics();
    drawAll();
  }
  function makeEvent(time, message) {
    const item = document.createElement('li');
    const stamp = document.createElement('time'); stamp.textContent = time;
    const text = document.createElement('span'); text.textContent = message;
    item.append(stamp, text); return item;
  }
  function addEvent(message) {
    const log = $('#event-log');
    log.prepend(makeEvent(`${String(tick).padStart(2, '0')}:00`, message));
    while (log.children.length > 7) log.lastElementChild.remove();
  }
  function colorMix(a, b, t) {
    const parseColor = value => value.startsWith('rgb') ? value.match(/[\d.]+/g).slice(0, 3).map(Number) : value.match(/[a-f\d]{2}/gi).map(v => parseInt(v, 16));
    const pa = parseColor(a), pb = parseColor(b);
    return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
  }
  function resizeCanvas(canvas, context) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(rect.width * ratio), height = Math.round(rect.height * ratio);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  function drawMap() {
    const rect = mapCanvas.getBoundingClientRect(); if (!rect.width || !rect.height || !world) return;
    resizeCanvas(mapCanvas, mapContext);
    const ctx = mapContext, w = rect.width, h = rect.height, cw = w / cell.width, ch = h / cell.height;
    ctx.clearRect(0, 0, w, h);
    for (const c of world.flat()) {
      let fill;
      if (layer === 'terrain') fill = colorMix('#dce8de', '#526f62', c.height);
      else if (layer === 'streets') fill = c.kind === 'road' ? '#e9dfc9' : c.kind === 'water' ? '#95c4c1' : c.kind === 'building' ? '#c7d3c9' : '#d9e5da';
      else if (layer === 'people') fill = c.kind === 'building' ? colorMix('#eedcbd', '#ce735f', Math.min(1, c.population / 135)) : c.kind === 'water' ? '#a5c9c5' : c.kind === 'road' ? '#e4dfd0' : '#d8e5d9';
      else fill = c.kind === 'water' ? '#86bdc1' : colorMix('#dbe8d9', '#d6ad76', Math.min(.72, c.height * .55));
      if (c.kind === 'building' && layer !== 'people' && layer !== 'terrain') fill = '#eee4d2';
      if (c.kind === 'park' && layer !== 'terrain') fill = '#c5dabb';
      if (c.kind === 'shelter') fill = '#86ae8d';
      if (layer === 'flood' && c.water > 0.015) fill = colorMix(fill, '#398c9b', Math.min(.88, .26 + c.water * 2.3));
      ctx.fillStyle = fill; ctx.fillRect(c.x * cw, c.y * ch, cw + .45, ch + .45);
      if (layer === 'terrain' && (Math.round(c.height * 10) % 2 === 0)) { ctx.strokeStyle = '#415d4b2a'; ctx.lineWidth = .5; ctx.strokeRect(c.x * cw + cw * .18, c.y * ch + ch * .18, cw * .64, ch * .64); }
      if (c.kind === 'road') { ctx.fillStyle = layer === 'flood' && c.water > .03 ? '#f1e8d48c' : '#f8f2df9c'; ctx.fillRect(c.x * cw + cw * .39, c.y * ch + ch * .39, cw * .22, ch * .22); }
      if (c.kind === 'building') { ctx.fillStyle = layer === 'flood' && c.water > .025 ? '#9d5249' : '#536f68'; ctx.fillRect(c.x * cw + cw * .19, c.y * ch + ch * .17, cw * .62, ch * .66); }
      if (c.kind === 'shelter') { ctx.fillStyle = '#f4f5e9'; ctx.fillRect(c.x * cw + cw * .16, c.y * ch + ch * .16, cw * .68, ch * .68); ctx.fillStyle = '#36765e'; ctx.fillRect(c.x * cw + cw * .44, c.y * ch + ch * .28, cw * .12, ch * .44); ctx.fillRect(c.x * cw + cw * .28, c.y * ch + ch * .44, cw * .44, ch * .12); }
    }
    for (const d of defenses) {
      const x = (d.x + .5) * cw, y = (d.y + .5) * ch;
      ctx.beginPath(); ctx.arc(x, y, Math.max(5, Math.min(cw, ch) * .7), 0, Math.PI * 2); ctx.fillStyle = '#f3f5ee'; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = d.type === 'pump' ? '#327c80' : d.type === 'garden' ? '#4e8b59' : '#b48645'; ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle; ctx.font = `bold ${Math.max(8, Math.min(12, cw * .72))}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(d.type === 'pump' ? '↓' : d.type === 'garden' ? '✳' : '╱', x, y);
    }
  }
  function drawChart() {
    const rect = chartCanvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    resizeCanvas(chartCanvas, chartContext);
    const ctx = chartContext, w = rect.width, h = rect.height, max = Math.max(.02, ...history) * 1.15;
    ctx.clearRect(0, 0, w, h); ctx.strokeStyle = '#d7dfd8'; ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) { const y = h * i / 4; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    if (history.length < 2) return;
    ctx.beginPath(); history.forEach((v, i) => { const x = i * w / (maxTicks - 1), y = h - v / max * (h - 8) - 4; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.lineTo((history.length - 1) * w / (maxTicks - 1), h); ctx.lineTo(0, h); ctx.closePath(); ctx.fillStyle = '#78ae9260'; ctx.fill();
    ctx.beginPath(); history.forEach((v, i) => { const x = i * w / (maxTicks - 1), y = h - v / max * (h - 8) - 4; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.strokeStyle = '#438d70'; ctx.lineWidth = 2; ctx.stroke();
  }
  function drawAll() { drawMap(); drawChart(); }
  function nearestShelterRoute() {
    const roads = world.flat().filter(c => c.kind === 'road' || c.kind === 'shelter');
    const buildings = world.flat().filter(c => c.kind === 'building');
    if (!buildings.length) return 0;
    const shelters = world.flat().filter(c => c.kind === 'shelter');
    let safe = 0;
    for (const b of buildings) {
      let nearest = Infinity;
      for (const s of shelters) nearest = Math.min(nearest, Math.abs(s.x - b.x) + Math.abs(s.y - b.y));
      const corridor = Math.max(1, nearest * .45);
      const nearby = roads.filter(r => Math.abs(r.x - b.x) + Math.abs(r.y - b.y) < corridor + 4);
      const blocked = nearby.some(r => r.water > .09);
      if (!blocked && b.water < .12) safe += b.population;
    }
    return Math.round(safe / Math.max(1, buildings.reduce((n, b) => n + b.population, 0)) * 100);
  }
  function updateMetrics() {
    const buildings = world.flat().filter(c => c.kind === 'building');
    const flooded = buildings.filter(c => c.water > .045);
    const totalPeople = buildings.reduce((n, b) => n + b.population, 0);
    const atRisk = flooded.reduce((n, b) => n + b.population, 0);
    const roads = world.flat().filter(c => c.kind === 'road');
    const blocked = roads.filter(c => c.water > .08).length;
    $('[data-metric="people"]').textContent = atRisk.toLocaleString('ru-RU');
    $('[data-metric="buildings"]').textContent = String(flooded.length);
    $('[data-metric="roads"]').textContent = `${roads.length ? Math.round(blocked / roads.length * 100) : 0}%`;
    $('[data-metric="routes"]').textContent = `${nearestShelterRoute()}%`;
    $('[data-total-buildings]').textContent = buildings.length;
    $('[data-tick]').textContent = String(tick).padStart(2, '0');
    $('[data-progress]').style.width = `${tick / maxTicks * 100}%`;
    if (running) $('[data-run-label]').textContent = 'Приостановить сценарий';
    else $('[data-run-label]').textContent = tick >= maxTicks ? 'Сценарий завершён' : tick ? 'Продолжить сценарий' : 'Запустить сценарий';
    $('[data-defense-count]').textContent = defenses.length;
    $('[data-defense-count]').parentElement.style.opacity = defenses.length >= 12 ? '.65' : '1';
    const avg = world.flat().reduce((n, c) => n + c.water, 0) / world.length / cell.width * 100;
    if (tick === history.length - 1) history[tick] = avg;
    else if (tick < history.length) history[tick] = avg;
    else history.push(avg);
    drawChart();
  }
  function captureOutcome() {
    const buildings = world.flat().filter(c => c.kind === 'building');
    const flooded = buildings.filter(c => c.water > .045);
    const roads = world.flat().filter(c => c.kind === 'road');
    const blocked = roads.filter(c => c.water > .08).length;
    const averageDepth = world.flat().reduce((sum, c) => sum + c.water, 0) / world.length / cell.width * 100;
    return {
      people: flooded.reduce((sum, c) => sum + c.population, 0),
      buildings: flooded.length,
      roads: roads.length ? Math.round(blocked / roads.length * 100) : 0,
      routes: nearestShelterRoute(),
      averageDepth: Math.round(averageDepth * 100) / 100,
      defenses: defenses.map(item => item.type),
      rain,
      tide,
      seed,
      width: cell.width,
      height: cell.height,
      tick
    };
  }
  function outcomeSummary(outcome) {
    return `Людей в зоне риска — ${outcome.people}; зданий с водой — ${outcome.buildings}; затоплено дорог — ${outcome.roads}%; доступность укрытий — ${outcome.routes}%.`;
  }
  function renderComparison() {
    if (!baselineResult) return;
    const current = captureOutcome();
    const sameConditions = current.seed === baselineResult.seed && current.width === baselineResult.width && current.height === baselineResult.height && current.rain === baselineResult.rain && current.tide === baselineResult.tide;
    const delta = (before, after, lowerIsBetter = true) => {
      const change = after - before;
      if (!change) return 'без изменений';
      const improved = lowerIsBetter ? change < 0 : change > 0;
      return `${improved ? 'лучше' : 'хуже'} на ${Math.abs(change)}`;
    };
    comparisonResult = { baseline: baselineResult, current, sameConditions };
    const lines = [
      `Люди в зоне риска: ${baselineResult.people} → ${current.people} (${delta(baselineResult.people, current.people)}).`,
      `Здания с водой: ${baselineResult.buildings} → ${current.buildings} (${delta(baselineResult.buildings, current.buildings)}).`,
      `Затоплено дорог: ${baselineResult.roads}% → ${current.roads}% (${delta(baselineResult.roads, current.roads)} п. п.).`,
      `Доступность укрытий: ${baselineResult.routes}% → ${current.routes}% (${delta(baselineResult.routes, current.routes, false)} п. п.).`
    ];
    $('#comparison-status').textContent = `${sameConditions ? 'Условия совпадают.' : 'Условия или территория отличаются — сравнивайте осторожно.'} ${lines.join(' ')}`;
    $('#download-brief').disabled = false;
  }
  function simulateStep() {
    if (tick >= maxTicks) { stop(); return; }
    tick++;
    const previousWater = world.map(row => row.map(c => c.water));
    const nextWater = Array.from({ length: cell.height }, () => Array(cell.width).fill(0));
    const delta = Array.from({ length: cell.height }, () => Array(cell.width).fill(0));
    const hours = .25;
    for (const c of world.flat()) {
      if (c.kind === 'water') { nextWater[c.y][c.x] = Math.max(previousWater[c.y][c.x], tide * .12 + .04); continue; }
      let amount = previousWater[c.y][c.x] + rain / 1000 * hours * (1 - c.permeability * .62);
      if (c.kind === 'park') amount -= .012;
      for (const d of defenses) if (d.type === 'garden' && Math.abs(c.x - d.x) + Math.abs(c.y - d.y) <= 2) amount *= .72;
      for (const d of defenses) if (d.type === 'pump' && Math.abs(c.x - d.x) + Math.abs(c.y - d.y) <= 3) amount -= .045;
      const seaEdge = c.x >= cell.width * .75;
      if (seaEdge) amount += tide * .006;
      const surface = c.height + amount;
      let lowest = null;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = c.x + dx, ny = c.y + dy;
        if (nx < 0 || ny < 0 || nx >= cell.width || ny >= cell.height) continue;
        const next = world[ny][nx];
        if (next.kind === 'water') { amount -= Math.min(amount * .22, .014 + tide * .008); continue; }
        const wall = defenses.some(d => d.type === 'barrier' && d.x === nx && d.y === ny);
        if (!wall && (!lowest || next.height + previousWater[ny][nx] < lowest.height + previousWater[lowest.y][lowest.x])) lowest = next;
      }
      if (lowest && surface > lowest.height + previousWater[lowest.y][lowest.x] + .014) {
        const transfer = Math.min(Math.max(0, amount) * .17, (surface - lowest.height - previousWater[lowest.y][lowest.x]) * .12);
        amount -= transfer; delta[lowest.y][lowest.x] += transfer;
      }
      nextWater[c.y][c.x] = Math.max(0, amount);
    }
    for (let y = 0; y < cell.height; y++) for (let x = 0; x < cell.width; x++) world[y][x].water = Math.min(.65, nextWater[y][x] + delta[y][x]);
    const avgDepth = world.flat().reduce((sum, c) => sum + c.water, 0) / world.length;
    history.push(avgDepth * 100);
    updateMetrics(); drawMap();
    if (tick === 1) addEvent('Ливневый сток начинает заполнять низины.');
    if (tick === 7) addEvent(tide > 1.4 ? 'Штормовой нагон мешает сбросу воды в море.' : 'Прилив повышает уровень у береговой линии.');
    if (tick === 14 && defenses.length) addEvent(`Защита работает: ${defenses.length} объектов меняют сток.`);
    if (tick === maxTicks) {
      stop();
      addEvent('Прогон завершён. Сравните зоны риска и маршруты.');
      if (baselineResult) renderComparison();
    }
  }
  function start() {
    if (tick >= maxTicks) return;
    if (running) { stop(); return; }
    running = true; updateMetrics();
    timer = window.setInterval(simulateStep, 360);
  }
  function stop() {
    running = false; window.clearInterval(timer); timer = 0;
    if ($('#run-simulation')) updateMetrics();
  }
  function setTool(tool) {
    activeTool = tool;
    document.querySelectorAll('.defense-option').forEach(button => { const selected = button.dataset.tool === tool; button.classList.toggle('is-selected', selected); button.setAttribute('aria-pressed', String(selected)); });
    const names = { pump: 'насос', garden: 'дождевой сад', barrier: 'защитный вал' };
    $('#placement-tip').textContent = `Нажмите на карту, чтобы разместить ${names[tool]}.`;
    $('#map-hint').textContent = `Размещение · ${names[tool]}`;
    mapCanvas.style.cursor = 'crosshair';
  }
  mapCanvas.addEventListener('click', event => {
    if (defenses.length >= 12) { $('#placement-tip').textContent = 'Лимит вмешательств достигнут. Уберите лишнее сбросом сценария.'; return; }
    const rect = mapCanvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(cell.width - 1, Math.floor((event.clientX - rect.left) / rect.width * cell.width)));
    const y = Math.max(0, Math.min(cell.height - 1, Math.floor((event.clientY - rect.top) / rect.height * cell.height)));
    const target = world[y][x];
    if (target.kind === 'water' || target.kind === 'building' || target.kind === 'shelter') { $('#placement-tip').textContent = 'Выберите свободную клетку, дорогу или парк.'; return; }
    if (defenses.some(d => d.x === x && d.y === y)) { $('#placement-tip').textContent = 'В этой клетке уже есть защита.'; return; }
    stop(); defenses.push({ x, y, type: activeTool });
    const labels = { pump: 'Насос размещён: зона откачки — 3 клетки.', garden: 'Сад размещён: почва впитывает больше стока.', barrier: 'Вал размещён: поток обходит перекрытую клетку.' };
    $('#placement-tip').textContent = labels[activeTool];
    addEvent(labels[activeTool]); updateMetrics(); drawMap();
  });
  document.querySelectorAll('[data-layer]').forEach(button => button.addEventListener('click', () => {
    layer = button.dataset.layer;
    document.querySelectorAll('[data-layer]').forEach(other => { const active = other === button; other.classList.toggle('is-active', active); other.setAttribute('aria-pressed', String(active)); });
    const names = { flood: 'ЗАТОПЛЕНИЕ', terrain: 'ВЫСОТА', streets: 'УЛИЦЫ', people: 'НАСЕЛЕНИЕ' };
    $('[data-layer-name]').textContent = names[layer]; $('#map-hint').textContent = `Слой · ${names[layer].toLowerCase()}`; drawMap();
  }));
  document.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => setTool(button.dataset.tool)));
  $('#rainfall').addEventListener('input', event => { rain = Number(event.target.value); $('#rain-value').textContent = `${rain} мм/ч`; event.target.style.setProperty('--range-fill', `${rain / 120 * 100}%`); updateScenario(); });
  $('#tide').addEventListener('input', event => { tide = Number(event.target.value); $('#tide-value').textContent = `+${tide.toFixed(1).replace('.', ',')} м`; event.target.style.setProperty('--range-fill', `${tide / 2.4 * 100}%`); updateScenario(); });
  function updateScenario() {
    const weather = rain < 15 ? 'Небольшие осадки' : rain < 55 ? 'Устойчивый ливень' : 'Экстремальный ливень';
    const sea = tide < .8 ? 'при обычном приливе' : tide < 1.7 ? 'на фоне высокого прилива' : 'во время штормового нагона';
    $('#scenario-copy').textContent = `${weather} ${sea}.`;
    $('#rainfall').style.setProperty('--range-fill', `${rain / 120 * 100}%`);
    $('#tide').style.setProperty('--range-fill', `${tide / 2.4 * 100}%`);
  }
  $('#run-simulation').addEventListener('click', start);
  $('#step-simulation').addEventListener('click', () => { stop(); simulateStep(); });
  $('#reset-simulation').addEventListener('click', () => { makeWorld(); updateScenario(); });
  $('#save-baseline').addEventListener('click', () => {
    if (tick < maxTicks) {
      $('#comparison-status').textContent = 'Сначала завершите исходный прогон: так сравнение будет опираться на полный сценарий.';
      return;
    }
    baselineResult = captureOutcome();
    comparisonResult = null;
    $('#download-brief').disabled = true;
    $('#comparison-status').textContent = `Исходный вариант сохранён. ${outcomeSummary(baselineResult)} Теперь сбросьте карту, разместите защиту и завершите новый прогон.`;
  });
  $('#download-brief').addEventListener('click', () => {
    if (!comparisonResult) return;
    const { baseline, current, sameConditions } = comparisonResult;
    const report = [
      '# Waterline — сравнение сценариев',
      '',
      `Дата: ${new Date().toLocaleDateString('ru-RU')}`,
      `Исходный вариант: сетка ${baseline.width} × ${baseline.height}, seed ${baseline.seed}; осадки ${baseline.rain} мм/ч; прилив +${baseline.tide.toFixed(1)} м.`,
      `Текущий вариант: сетка ${current.width} × ${current.height}, seed ${current.seed}; осадки ${current.rain} мм/ч; прилив +${current.tide.toFixed(1)} м.`,
      `Условия совпадают: ${sameConditions ? 'да' : 'нет, сравнивайте осторожно'}`,
      '',
      '## Исходный прогон',
      outcomeSummary(baseline),
      `Средняя глубина: ${baseline.averageDepth} см; мер защиты: ${baseline.defenses.length}.`,
      '',
      '## Текущий прогон',
      outcomeSummary(current),
      `Средняя глубина: ${current.averageDepth} см; мер защиты: ${current.defenses.length}.`,
      '',
      '## Изменения',
      `Люди в зоне риска: ${baseline.people} → ${current.people} (Δ ${current.people - baseline.people}).`,
      `Здания с водой: ${baseline.buildings} → ${current.buildings} (Δ ${current.buildings - baseline.buildings}).`,
      `Затоплено дорог: ${baseline.roads}% → ${current.roads}% (Δ ${current.roads - baseline.roads} п. п.).`,
      `Доступность укрытий: ${baseline.routes}% → ${current.routes}% (Δ ${current.routes - baseline.routes} п. п.).`,
      '',
      '> Учебная модель показывает относительный эффект внутри сгенерированной территории. Это не прогноз наводнения и не основание для реальных решений по безопасности.'
    ].join('\n');
    const blob = new Blob([report], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `waterline-scenario-${new Date().toISOString().slice(0, 10)}.md`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('#new-scenario').addEventListener('click', () => { seed = Math.floor(Math.random() * 8999) + 1000; makeWorld(); addEvent('Создан новый участок с другим рельефом и планировкой.'); });
  $('#map-size').addEventListener('change', event => { [cell.width, cell.height] = sizePresets[event.target.value]; makeWorld(); });
  $('#open-guide').addEventListener('click', () => $('#guide-dialog').showModal());
  ['close-guide','guide-done'].forEach(id => $(`#${id}`).addEventListener('click', () => $('#guide-dialog').close()));
  const resizeObserver = new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(drawAll); });
  resizeObserver.observe($('#map-frame')); resizeObserver.observe(chartCanvas.parentElement);
  window.addEventListener('beforeunload', stop);
  updateScenario();
  makeWorld();
  requestAnimationFrame(drawAll);
})();
