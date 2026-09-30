/* Mindmap workspace: shared catalog data, isolated view state and guarded commands. */
(function () {
  'use strict';
  var core = window.KicsMindmapCore;
  var view = { focus: '', query: '', status: '', layout: 'right', gap: 28, selected: new Set() };
  var key = '', history = [], future = [], projected, panel, tools, mini, persistTimer;
  var baseOpen = openMindmap, baseClose = closeMindmap, baseRender = render;
  function storageKey() { return 'kics_mindmap_v84:' + (currentUser ? currentUser.id : 'guest') + ':' + (state.mapId || 'local'); }
  function persist() {
    if (!key) return;
    try { localStorage.setItem(key, JSON.stringify({ focus: view.focus, layout: view.layout, gap: view.gap, collapsed: Array.from(mindmap.collapsed), scale: mindmap.scale, tx: mindmap.tx, ty: mindmap.ty })); } catch (_) {}
  }
  function restore() {
    key = storageKey(); history = []; future = []; view.selected.clear(); view.query = ''; view.status = '';
    var saved = {}; try { saved = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (_) {}
    view.focus = typeof saved.focus === 'string' ? saved.focus : '';
    view.layout = saved.layout === 'both' ? 'both' : 'right'; view.gap = [16, 28, 48].includes(saved.gap) ? saved.gap : 28;
    mindmap.collapsed = new Set(Array.isArray(saved.collapsed) ? saved.collapsed : []);
    if (Number.isFinite(saved.scale) && Number.isFinite(saved.tx) && Number.isFinite(saved.ty)) { mindmap.scale = Math.max(.1, Math.min(2.5, saved.scale)); mindmap.tx = saved.tx; mindmap.ty = saved.ty; return true; }
    return false;
  }
  function element(tag, text, parent) { var el = document.createElement(tag); if (text != null) el.textContent = text; if (parent) parent.appendChild(el); return el; }
  function button(text, fn, parent) { var b = element('button', text, parent); b.type = 'button'; b.className = 'mm-button'; b.addEventListener('click', fn); return b; }
  function select(options, value, fn, parent, label) {
    var s = element('select', null, parent); s.setAttribute('aria-label', label);
    options.forEach(function (o) { var e = element('option', o[1], s); e.value = o[0]; }); s.value = value; s.onchange = function () { fn(s.value); }; return s;
  }
  function snapshot() { return JSON.stringify({ nodes: state.nodes, columns: state.columns, tags: state.availableTags }); }
  function command(label, fn) {
    if (!canEdit()) return;
    var before = snapshot();
    try { fn(); rebuildChildren(); } catch (e) { var old = JSON.parse(before); state.nodes = old.nodes; state.columns = old.columns; invalidateModelIndex(); showToast(e.message, 'error'); return; }
    var after = snapshot(); if (before === after) return;
    history.push({ before: before, after: after, label: label }); history = history.slice(-30); future = [];
    scheduleSave(); render();
  }
  function travel(redo) {
    if (!canEdit()) return;
    var from = redo ? future : history, to = redo ? history : future, entry = from[from.length - 1]; if (!entry) return;
    if (snapshot() !== (redo ? entry.before : entry.after)) { history = []; future = []; showToast('Данные изменены вне редактора карты. История карты сброшена.', 'info'); return; }
    var data = JSON.parse(redo ? entry.after : entry.before); from.pop(); to.push(entry);
    state.nodes = data.nodes; state.columns = data.columns; state.availableTags = data.tags; invalidateModelIndex(); scheduleSave(); render();
  }
  function active() { return getNodeById(Array.from(view.selected).slice(-1)[0]); }
  function choose(id, multiple) {
    if (!multiple) view.selected.clear();
    if (multiple && view.selected.has(id)) view.selected.delete(id); else view.selected.add(id);
    decorate(); showPanel();
  }
  function decorate() {
    Object.keys(mindmap.nodeEls).forEach(function (id) { var el = mindmap.nodeEls[id]; el.classList.toggle('mm-selected', view.selected.has(id)); if (id !== '__center__') el.setAttribute('aria-selected', String(view.selected.has(id))); });
  }
  function centerOn(id) { var p = mindmap.positions[id], canvas = document.getElementById('mindmapCanvas'); if (!p) return; mindmap.tx = canvas.clientWidth / 2 - p.x * mindmap.scale; mindmap.ty = canvas.clientHeight / 2 - p.y * mindmap.scale; applyMindmapTransform(); }
  async function rename() {
    var n = active(); if (!n || !canEdit()) return;
    var map = state.mapId, id = n.id, previous = n.title;
    var title = await KicsUI.prompt({ title: 'Название карточки', inputLabel: 'Название', defaultValue: previous, validate: function (v) { return !!v.trim() || 'Введите название'; } });
    if (title === null || state.mapId !== map || !getNodeById(id) || getNodeById(id).title !== previous) return;
    command('Название', function () { getNodeById(id).title = title.trim(); });
  }
  async function add(child) {
    if (!canEdit()) return;
    var n = active(), parentId = n ? (child ? n.id : n.parentId) : null, col = n ? n.colIndex + (child ? 1 : 0) : 0;
    if (col > lastRealColIndex()) return showToast('Добавьте колонку на доске перед созданием следующего уровня', 'info');
    var map = state.mapId;
    var title = await KicsUI.prompt({ title: child ? 'Дочерняя фича' : 'Новая фича', inputLabel: 'Название', defaultValue: '', validate: function (v) { return !!v.trim() || 'Введите название'; } });
    if (title === null || state.mapId !== map || (parentId && !getNodeById(parentId))) return;
    command('Создание', function () { var node = createNode(parentId, col, title.trim()); state.nodes.push(node); view.selected = new Set([node.id]); mindmap.collapsed.delete(parentId); });
  }
  async function move(id, parentId) {
    if (!canEdit()) return;
    var t = core.tree(state.nodes), plan;
    try { plan = core.movePlan(t, id, parentId, lastRealColIndex()); } catch (e) { return showToast(e.message, 'error'); }
    if (t.byId[id].parentId === plan.parentId) return;
    var before = snapshot(), map = state.mapId;
    if (!await KicsUI.confirm({ title: 'Перенести ветку?', message: plan.ids.length + ' карточек → ' + (parentId ? t.byId[parentId].title : 'корень') + '. Сдвиг колонок: ' + plan.delta + '.', confirmLabel: 'Перенести' })) return;
    if (state.mapId !== map || snapshot() !== before) return showToast('Данные изменились. Повторите перенос.', 'info');
    command('Перенос', function () { getNodeById(id).parentId = plan.parentId; plan.ids.forEach(function (cid) { getNodeById(cid).colIndex += plan.delta; }); mindmap.collapsed.delete(parentId); });
  }
  async function removeSelected() {
    if (!canEdit() || !view.selected.size) return;
    var ids = new Set(), t = core.tree(state.nodes); view.selected.forEach(function (id) { core.descendants(t, id).forEach(function (cid) { ids.add(cid); }); });
    var map = state.mapId, before = snapshot();
    if (!await KicsUI.confirm({ title: 'Удалить выбранные ветки?', message: 'Карточек: ' + ids.size + '. Доступна отмена в редакторе карты.', confirmLabel: 'Удалить', danger: true })) return;
    if (state.mapId !== map || snapshot() !== before) return;
    command('Удаление', function () { rememberDeletion('Удаление веток майндкарты'); state.nodes = state.nodes.filter(function (n) { return !ids.has(n.id) && !ids.has(n.targetId); }); view.selected.clear(); });
  }
  function focusBranch(id) { view.focus = id || ''; view.query = ''; view.status = ''; renderMindmap(false); refreshTools(); }
  function showPanel() {
    panel.replaceChildren(); var n = active();
    button('Скрыть панель', function () { panel.hidden = true; }, panel);
    if (!n) { element('h3', 'Рабочая майндкарта', panel); element('p', 'Выберите карточку. Shift + клик — несколько. Перетащите карточку на нового родителя для переноса ветки.', panel); button('+ Корневая фича', function () { add(false); }, panel); return; }
    panel.hidden = false;
    var path = [], cur = n, visited = new Set(); while (cur && !visited.has(cur.id)) { visited.add(cur.id); path.unshift(cur); cur = getNodeById(cur.parentId); }
    var crumbs = element('nav', null, panel); crumbs.className = 'mm-crumbs'; button('Вся карта', function () { focusBranch(''); }, crumbs);
    path.forEach(function (p) { button(p.title || 'Без названия', function () { focusBranch(p.id); }, crumbs); });
    element('h3', view.selected.size > 1 ? 'Выбрано: ' + view.selected.size : n.title, panel);
    var branch = core.descendants(core.tree(state.nodes), n.id), done = 0, empty = 0;
    branch.forEach(function (id) { var c = getNodeById(id); if (c.status === 'done') done++; if (!(c.note || '').trim()) empty++; });
    element('p', 'В ветке: ' + branch.size + ' · Готово: ' + done + ' · Без описания: ' + empty, panel);
    if (canEdit()) {
      element('label', 'Статус выбранных', panel);
      select([['none', 'Без статуса'], ['planned', 'Запланировано'], ['wip', 'В работе'], ['done', 'Готово']], n.status, function (value) { command('Статус', function () { view.selected.forEach(function (id) { var c = getNodeById(id); if (c) c.status = value; }); }); }, panel, 'Статус выбранных');
      button('Переименовать · F2', rename, panel); button('Дочерняя · Tab', function () { add(true); }, panel); button('Соседняя · Enter', function () { add(false); }, panel);
      button('Редактировать все поля', function () { openModal(n.id); }, panel);
      element('label', 'Горизонт выбранных', panel);
      select([['', 'Не задан'], ['Now', 'Now'], ['Next', 'Next'], ['Later', 'Later']], n.dueDate, function (value) { command('Горизонт', function () { view.selected.forEach(function (id) { var c = getNodeById(id); if (c) c.dueDate = value; }); }); }, panel, 'Горизонт выбранных');
      button('AI: пустые описания ветки', function () { if (window.KicsAI) KicsAI.openGenerateDescriptions(Array.from(branch)); }, panel);
      button('Перенести в корень', function () { move(n.id, null); }, panel);
      button('Удалить выбранные', removeSelected, panel);
    }
    button('Фокус на ветке', function () { focusBranch(n.id); }, panel);
    button('ИИ для карточки', function () { if (window.KicsAI) KicsAI.openCardMenu(n.id); }, panel);
    button('Показать на доске', function () { var id = n.id; closeMindmap(); openCardView(id); var card = Array.from(document.querySelectorAll('.card[data-node-id]')).find(function (el) { return el.dataset.nodeId === id; }); if (card) card.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, panel);
    element('h4', 'Описание', panel); var text = element('div', n.note || 'Описание пока не заполнено', panel); text.className = 'mm-description';
    if (n.note && window.KicsRich) window.KicsRich.render(text, n);
    element('h4', 'Заметка', panel); element('div', n.memo || '—', panel).className = 'mm-description';
    element('p', (n.tags || []).join(' · '), panel);
  }
  function refreshTools() {
    tools.replaceChildren();
    var search = element('input', null, tools); search.type = 'search'; search.placeholder = 'Название, описание, тег…'; search.value = view.query; search.setAttribute('aria-label', 'Поиск в майндкарте');
    var debounce; search.oninput = function () { clearTimeout(debounce); debounce = setTimeout(function () { if (search.isConnected) { view.query = search.value; renderMindmap(false); } }, 180); };
    button('Следующее совпадение', function () { if (!projected || !projected.matches.length) return; var n = active(), index = projected.matches.indexOf(n && n.id); var id = projected.matches[(index + 1) % projected.matches.length]; choose(id, false); centerOn(id); }, tools);
    select([['', 'Все статусы'], ['none', 'Без статуса'], ['planned', 'Запланировано'], ['wip', 'В работе'], ['done', 'Готово']], view.status, function (v) { view.status = v; renderMindmap(false); }, tools, 'Фильтр статуса');
    select([['right', 'Дерево вправо'], ['both', 'Двусторонняя карта']], view.layout, function (v) { view.layout = v; renderMindmap(false); }, tools, 'Раскладка');
    select([['16', 'Компактно'], ['28', 'Обычно'], ['48', 'Свободно']], String(view.gap), function (v) { view.gap = Number(v); renderMindmap(true); }, tools, 'Плотность');
    [1, 2, 3, Infinity].forEach(function (level) { button(level === Infinity ? 'Все уровни' : 'Уровень ' + level, function () {
      mindmap.collapsed.clear(); var t = core.tree(state.nodes), all = core.project(t, { collapsed: new Set(), focus: view.focus, layout: view.layout });
      all.items.forEach(function (i) { if (i.depth >= level) mindmap.collapsed.add(i.id); }); renderMindmap(true);
    }, tools); });
    button('Вся карта', function () { focusBranch(''); }, tools); button('Карточка', function () { panel.hidden = false; showPanel(); }, tools);
    button('↶ Отмена', function () { travel(false); }, tools); button('↷ Повтор', function () { travel(true); }, tools);
    button('SVG', exportSvg, tools);
    var count = element('span', '', tools); count.id = 'mmCount'; count.setAttribute('aria-live', 'polite');
  }
  function drawMini() {
    if (!mini || !mindmap.bounds) return;
    var ctx = mini.getContext('2d'); if (!ctx) return;
    ctx.clearRect(0, 0, 200, 120); var b = mindmap.bounds, s = Math.min(190 / (b.maxX - b.minX), 110 / (b.maxY - b.minY));
    mini._view = { x: b.minX, y: b.minY, s: s };
    ctx.fillStyle = '#6b7fa3'; Object.keys(mindmap.positions).forEach(function (id) { var p = mindmap.positions[id]; ctx.fillRect(5 + (p.x - p.width / 2 - b.minX) * s, 5 + (p.y - p.height / 2 - b.minY) * s, Math.max(2, p.width * s), Math.max(2, p.height * s)); });
    var canvas = document.getElementById('mindmapCanvas'); ctx.strokeStyle = '#0071e3'; ctx.lineWidth = 2;
    ctx.strokeRect(5 + (-mindmap.tx / mindmap.scale - b.minX) * s, 5 + (-mindmap.ty / mindmap.scale - b.minY) * s, canvas.clientWidth / mindmap.scale * s, canvas.clientHeight / mindmap.scale * s);
  }
  function exportSvg() {
    var ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'), b = mindmap.bounds; if (!b) return;
    svg.setAttribute('xmlns', ns); svg.setAttribute('viewBox', [b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY].join(' '));
    Array.from(document.getElementById('mindmapEdges').children).forEach(function (p) { var copy = p.cloneNode(true); copy.setAttribute('fill', 'none'); svg.appendChild(copy); });
    Object.keys(mindmap.positions).forEach(function (id) {
      var p = mindmap.positions[id], rect = document.createElementNS(ns, 'rect');
      [['x', p.x - p.width / 2], ['y', p.y - p.height / 2], ['width', p.width], ['height', p.height], ['rx', 10], ['fill', '#fff'], ['stroke', '#64748b']].forEach(function (a) { rect.setAttribute(a[0], a[1]); }); svg.appendChild(rect);
      var title = id === '__center__' ? state.boardTitle : getNodeById(id).title;
      var lines = String(title).match(/.{1,27}/gu) || ['']; lines.slice(0, 4).forEach(function (line, index) { var text = document.createElementNS(ns, 'text'); text.setAttribute('x', p.x - p.width / 2 + 12); text.setAttribute('y', p.y - p.height / 2 + 20 + index * 14); text.setAttribute('font-size', '12'); text.setAttribute('font-family', 'sans-serif'); text.textContent = line; svg.appendChild(text); });
    });
    var url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' })); var link = document.createElement('a'); link.href = url; link.download = 'mindmap.svg'; link.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function setup() {
    if (tools) return;
    var overlay = document.getElementById('mindmapOverlay'), canvas = document.getElementById('mindmapCanvas');
    tools = element('div', null); tools.className = 'mm-tools'; overlay.insertBefore(tools, canvas);
    var workspace = element('div', null, overlay); workspace.className = 'mm-workspace'; workspace.appendChild(canvas);
    panel = element('aside', null, workspace); panel.className = 'mm-panel'; panel.setAttribute('aria-label', 'Свойства карточки');
    mini = element('canvas', null, canvas); mini.width = 200; mini.height = 120; mini.className = 'mm-mini'; mini.setAttribute('aria-label', 'Миникарта');
    mini.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    mini.onclick = function (e) { var m = mini._view; if (!m) return; var r = mini.getBoundingClientRect(); mindmap.tx = canvas.clientWidth / 2 - (((e.clientX - r.left) * 200 / r.width - 5) / m.s + m.x) * mindmap.scale; mindmap.ty = canvas.clientHeight / 2 - (((e.clientY - r.top) * 120 / r.height - 5) / m.s + m.y) * mindmap.scale; applyMindmapTransform(); };
    canvas.tabIndex = 0; canvas.setAttribute('role', 'tree'); canvas.setAttribute('aria-label', 'Редактор майндкарты'); canvas.setAttribute('aria-multiselectable', 'true');
    canvas.querySelector('.mindmap-help').textContent = 'Клик — выбор · Shift — несколько · F2 — название · Tab/Enter — создать · Стрелки — навигация · Ctrl+Z — отмена';
    canvas.addEventListener('keydown', function (e) {
      if (e.target !== canvas && !e.target.classList.contains('mindmap-node')) return;
      var n = active(), handled = true;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') travel(e.shiftKey);
      else if (e.key === 'F2') rename();
      else if (e.key === 'Tab' && !e.shiftKey && n && canEdit()) add(true);
      else if (e.key === 'Enter' && canEdit()) add(false);
      else if (e.key === 'Delete') removeSelected();
      else if (e.key.startsWith('Arrow') && projected.items.length) {
        var items = projected.items, index = items.findIndex(function (i) { return n && i.id === n.id; }), id;
        if (e.key === 'ArrowLeft' && n) id = n.parentId;
        else if (e.key === 'ArrowRight' && n) { mindmap.collapsed.delete(n.id); renderMindmap(true); id = (mindmap.tree.children[n.id] || [])[0]; }
        else id = items[Math.max(0, Math.min(items.length - 1, index + (e.key === 'ArrowUp' ? -1 : 1)))].id;
        if (id) { choose(id, false); requestAnimationFrame(function () { centerOn(id); }); }
      } else handled = false;
      if (handled) { e.preventDefault(); e.stopPropagation(); }
    });
    window.addEventListener('mouseup', function () { if (isMindmapOpen()) persist(); });
    window.addEventListener('beforeunload', persist);
    window.addEventListener('resize', function () { if (isMindmapOpen()) drawMini(); });
  }
  var originalTransform = applyMindmapTransform;
  applyMindmapTransform = function () { originalTransform(); drawMini(); clearTimeout(persistTimer); persistTimer = setTimeout(persist, 250); };
  mindmapBranchColor = function (item) { return MINDMAP_COLORS[core.hash(item.branch || item.id) % MINDMAP_COLORS.length]; };
  renderMindmap = function (keepView) {
    if (!isMindmapOpen()) return; setup();
    if (key !== storageKey()) { restore(); refreshTools(); keepView = false; }
    var token = ++mindmap.renderToken, old = active() && mindmap.positions[active().id];
    mindmap.tree = core.tree(state.nodes); if (!mindmap.tree.byId[view.focus]) view.focus = '';
    projected = core.project(mindmap.tree, { focus: view.focus, query: view.query, status: view.status, layout: view.layout, collapsed: mindmap.collapsed });
    var layer = document.getElementById('mindmapNodes'); layer.replaceChildren(); mindmap.nodeEls = {};
    var center = element('div', state.boardTitle, layer); center.className = 'mindmap-node is-center'; mindmap.nodeEls.__center__ = center;
    center.ondragover = function (e) { if (canEdit()) e.preventDefault(); }; center.ondrop = function (e) { e.preventDefault(); move(e.dataTransfer.getData('text/kics-node'), null); };
    projected.items.forEach(function (item) {
      var n = item.node, el = element('div', null, layer); el.className = 'mindmap-node side-' + item.side; el.dataset.nodeId = n.id; el.style.setProperty('--mm-branch', mindmapBranchColor(item)); el.setAttribute('role', 'treeitem'); el.setAttribute('aria-level', item.depth); el.tabIndex = -1;
      element('div', n.title || 'Без названия', el).className = 'mindmap-node-title';
      element('div', (SL[n.status] || SL.none) + (n.dueDate ? ' · ' + n.dueDate : '') + (n.note ? ' · 📝' : ''), el).className = 'mindmap-node-meta';
      var kids = mindmap.tree.children[n.id] || [];
      if (kids.length) { el.setAttribute('aria-expanded', String(!mindmap.collapsed.has(n.id) || !!view.query || !!view.status)); var collapse = button(mindmap.collapsed.has(n.id) ? '+' + kids.length : '−', function (e) { e.stopPropagation(); if (mindmap.collapsed.has(n.id)) mindmap.collapsed.delete(n.id); else mindmap.collapsed.add(n.id); renderMindmap(true); }, el); collapse.className = 'mindmap-collapse'; collapse.setAttribute('aria-label', 'Свернуть или раскрыть ветку'); }
      el.onclick = function (e) { choose(n.id, e.shiftKey); document.getElementById('mindmapCanvas').focus({ preventScroll: true }); }; el.ondblclick = function () { choose(n.id, false); rename(); };
      el.draggable = canEdit(); el.ondragstart = function (e) { e.dataTransfer.setData('text/kics-node', n.id); e.dataTransfer.effectAllowed = 'move'; };
      el.ondragover = function (e) { if (canEdit()) { e.preventDefault(); el.classList.add('mm-drop'); } }; el.ondragleave = function () { el.classList.remove('mm-drop'); };
      el.ondrop = function (e) { e.preventDefault(); e.stopPropagation(); el.classList.remove('mm-drop'); move(e.dataTransfer.getData('text/kics-node'), n.id); };
      mindmap.nodeEls[n.id] = el;
    });
    decorate(); showPanel();
    var count = document.getElementById('mmCount'); if (count) count.textContent = 'Показано ' + projected.items.length + ' / ' + Object.keys(mindmap.tree.byId).length + ((view.query || view.status) ? ' · Совпадений ' + projected.matches.length : '');
    requestAnimationFrame(function () {
      if (token !== mindmap.renderToken || !isMindmapOpen()) return;
      var sizes = {}; projected.items.forEach(function (i) { sizes[i.id] = { width: mindmap.nodeEls[i.id].offsetWidth, height: mindmapNodeHeight(i.id) }; });
      mindmap.positions = core.layout(projected.items, sizes, view.gap); applyMindmapNodePositions(); renderMindmapEdges(projected.items); mindmap.bounds = calculateMindmapBounds();
      var p = active() && mindmap.positions[active().id]; if (keepView && old && p) { mindmap.tx += (old.x - p.x) * mindmap.scale; mindmap.ty += (old.y - p.y) * mindmap.scale; }
      if (keepView) applyMindmapTransform(); else fitMindmap();
    });
  };
  openMindmap = function () { setup(); var same = key === storageKey(), saved = same || restore(); refreshTools(); baseOpen(); if (saved) renderMindmap(true); };
  closeMindmap = function () { persist(); baseClose(); };
  render = function () { baseRender(); if (isMindmapOpen()) renderMindmap(true); };
})();