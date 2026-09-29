/**
 * KICS Feature Map — Feature planning tool for PMs
 * v64 — table duplication, cloud persistence and interactive mind map
 */

const LS_KEY = 'kics_next_feature_map';
const LAST_MAP_KEY = 'kics_next_last_map_id';
const APP_VERSION = 'v81';

// ──────────────────────────────────────
// 1. Суpabase client (инициализируется в init)
// ──────────────────────────────────────
let sb = null;
let currentUser = null;
let isOwner = true;
let viewMode = false;
function canEdit() { return isOwner && !viewMode; }

// ──────────────────────────────────────
// 2. State
// ──────────────────────────────────────
let state = {
  columns: [
    { id: 'col0', name: 'Функциональная область' },
    { id: 'col1', name: 'Верхнеуровневая фича' },
    { id: 'col2', name: 'Фича' },
    { id: 'col3', name: 'Сабфича' },
    { id: 'col4', name: 'Комментарий' },
  ],
  nodes: [],
  selectedTags: {},
  searchQuery: '',
  editingNodeId: null,
  mapId: null,
  boardTitle: 'KICS — Карта фич',
  maps: [],
  availableTags: [],
  filterTag: null,
};
let nextId = 1;
let modelIndex = null;
function nid() { return 'n' + (nextId++); }

function createNode(parentId, colIndex, title, type) {
  return { id: nid(), parentId: parentId || null, colIndex, title: title || '', tags: [], status: 'none', dueDate: '', note: '', memo: '', color: 'none', type: type || 'card', targetId: null, children: [] };
}

function normalizeNode(node) {
  return window.KicsModel.normalizeNode(node);
}

function invalidateModelIndex() { modelIndex = null; }
function getModelIndex() {
  if (!modelIndex) modelIndex = window.KicsModel.createIndex(state.nodes);
  return modelIndex;
}

// ──────────────────────────────────────
// 3. Helpers
// ──────────────────────────────────────
function getNodesByCol(i) { return getModelIndex().cardsByColumn[i] || []; }
function getChildren(pid) { return getModelIndex().childrenByParent[pid] || []; }
function getNodeById(id) { return getModelIndex().byId[id]; }
function getChildrenInNextCol(node) {
  return getChildren(node.id).filter(function (c) {
    return c && c.type !== 'comment' && c.colIndex === node.colIndex + 1;
  });
}
function rebuildChildren() {
  invalidateModelIndex();
  state.nodes.forEach(function (n) { n.children = []; });
  state.nodes.forEach(function (n) {
    if (n.type === 'comment') return;
    if (n.parentId) { var p = getNodeById(n.parentId); if (p && p.children.indexOf(n.id) === -1) p.children.push(n.id); }
  });
  var leafIds = Object.create(null);
  state.nodes.forEach(function (n) {
    if (n.type !== 'comment' && isLeaf(n)) leafIds[n.id] = true;
  });
  state.nodes = state.nodes.filter(function (n) {
    return n.type !== 'comment' || state.nodes.some(function (card) { return card.type !== 'comment' && card.id === n.targetId; });
  });
  var commentTargets = Object.create(null);
  state.nodes.forEach(function (n) {
    if (n.type === 'comment' && n.targetId) commentTargets[n.targetId] = true;
  });
  Object.keys(leafIds).forEach(function (leafId) {
    if (!commentTargets[leafId]) {
      var comment = createNode(leafId, commentColIndex(), '', 'comment');
      comment.targetId = leafId;
      state.nodes.push(comment);
    }
  });
  invalidateModelIndex();
}
// Индекс колонки «Комментарий» (всегда последняя)
function commentColIndex() { return state.columns.length - 1; }
// Индекс последней «настоящей» колонки (без комментария)
function lastRealColIndex() { return state.columns.length - 2; }
// Комментарий, привязанный к карточке-листу
function getCommentFor(targetId) { return getModelIndex().commentsByTarget[targetId]; }
// Лист — узел без детей-карточек в следующей настоящей колонке
function isLeaf(node) {
  if (node.type === 'comment') return false;
  return !state.nodes.some(function (c) { return c.parentId === node.id && c.type !== 'comment' && c.colIndex === node.colIndex + 1; });
}
function nodeMatchesFilter(node) {
  if (state.searchQuery) { var q = state.searchQuery.toLowerCase(); if (node.title.toLowerCase().indexOf(q) === -1 && node.note.toLowerCase().indexOf(q) === -1 && (node.memo || '').toLowerCase().indexOf(q) === -1 && !node.tags.some(function (t) { return t.toLowerCase().indexOf(q) !== -1; })) return false; }
  var ct = state.selectedTags[node.colIndex]; if (ct && ct.size > 0 && !node.tags.some(function (t) { return ct.has(t); })) return false;
  return true;
}
function isNodeOrDescendantVisible(node) { if (nodeMatchesFilter(node)) return true; for (var i = 0; i < (node.children || []).length; i++) { var c = getNodeById(node.children[i]); if (c && isNodeOrDescendantVisible(c)) return true; } return false; }
function hasAnyFilter() { if (state.searchQuery) return true; for (var k in state.selectedTags) { if (state.selectedTags[k] && state.selectedTags[k].size > 0) return true; } return false; }
function getAllTags() { return (state.availableTags || []).slice().sort(); }

// Удаляем из списка теги, которых больше нет ни на одной карточке
function pruneUnusedTags() {
  if (!state.availableTags) return;
  var used = {};
  state.nodes.forEach(function (n) { (n.tags || []).forEach(function (t) { used[t] = true; }); });
  state.availableTags = state.availableTags.filter(function (t) { return used[t]; });
}

// Вычисляем множество видимых при фильтре-хаштеге: тег-узел + родители + дети
function computeFilterVisibleSet(tag) {
  var set = {};
  function markAncestors(id) {
    var cur = getNodeById(id);
    while (cur) {
      set[cur.id] = true;
      cur = cur.parentId ? getNodeById(cur.parentId) : null;
    }
  }
  function markDescendants(id) {
    set[id] = true;
    getChildren(id).forEach(function (c) { markDescendants(c.id); });
  }
  state.nodes.forEach(function (n) {
    if (n.tags && n.tags.indexOf(tag) !== -1) {
      markAncestors(n.id);
      markDescendants(n.id);
    }
  });
  return set;
}

function isNodeVisible(node) {
  if (state.filterTag) {
    return state.filterVisibleSet && state.filterVisibleSet[node.id] === true;
  }
  if (hasAnyFilter()) {
    return isNodeOrDescendantVisible(node);
  }
  return true;
}

var $ = function (s) { return document.querySelector(s); }, $$ = function (s) { return document.querySelectorAll(s); };
var SL = { done: 'Реализовано', wip: 'В работе', planned: 'Запланировано', none: 'Не начато' };
var CARD_COLORS = {
  none: { label: 'Без цвета', cls: '' },
  green: { label: 'Зелёный', cls: 'card-green' },
  orange: { label: 'Оранжевый', cls: 'card-orange' },
  red: { label: 'Красный', cls: 'card-red' },
  blue: { label: 'Голубой', cls: 'card-blue' }
};
var SC = { done: 'status-done', wip: 'status-wip', planned: 'status-planned', none: 'status-none' };
var SD = { done: 'status-dot-done', wip: 'status-dot-wip', planned: 'status-dot-planned', none: 'status-dot-none' };
function ht(t) { if (!state.searchQuery) return eh(t); var q = state.searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return eh(t).replace(new RegExp('(' + q + ')', 'gi'), '<mark>$1</mark>'); }
function eh(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ──────────────────────────────────────
// 4. Пустое начальное состояние (новая таблица без выдуманных карточек)
// ──────────────────────────────────────
function setEmptyState() {
  state.columns = [{ id: 'col0', name: 'Функциональная область' }, { id: 'col1', name: 'Верхнеуровневая фича' }, { id: 'col2', name: 'Фича' }, { id: 'col3', name: 'Сабфича' }, { id: 'col4', name: 'Комментарий' }];
  state.nodes = [];
  invalidateModelIndex();
  nextId = 1;
  state.availableTags = [];
  state.filterTag = null;
  state.filterVisibleSet = null;
}

// ──────────────────────────────────────
// 5. Видимая ошибка на экране
// ──────────────────────────────────────
let errorBannerTimer = null;
function showError(msg) {
  if (window.KicsUI) {
    window.KicsUI.toast('Ошибка: ' + msg, 'error', 7000);
    return;
  }
  var b = document.getElementById('errorBanner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'errorBanner';
    b.className = 'error-banner';
    b.onclick = function () { b.remove(); };
    document.body.appendChild(b);
  }
  b.textContent = 'Ошибка: ' + msg;
  clearTimeout(errorBannerTimer);
  errorBannerTimer = setTimeout(function () { if (b.parentNode) b.remove(); }, 8000);
}

function showToast(message, type) {
  if (window.KicsUI) window.KicsUI.toast(message, type || 'info');
}

// ──────────────────────────────────────
// 6. Облачное сохранение (debounced)
// ──────────────────────────────────────
let saveTimer = null;
let searchDebounce = null;

function scheduleSave() {
  if (!state.mapId || !sb) return;
  // Локальный бэкап (на случай оффлайна)
  try { localStorage.setItem(LS_KEY, JSON.stringify({ columns: state.columns, nodes: state.nodes, nextId })); } catch (e) {}
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveMapRemote, 500);
}
async function saveMapRemote() {
  if (!sb || !state.mapId) return;
  try {
    const { error } = await sb.from('maps_next').update({
      title: state.boardTitle,
      data: window.KicsModel.payload(state, nextId),
      updated_at: new Date().toISOString()
    }).eq('id', state.mapId);
    if (error) { console.error('Ошибка сохранения:', error); showError('не удалось сохранить: ' + error.message); }
  } catch (e) { console.error('Исключение при сохранении:', e); showError('сбой сети при сохранении'); }
}

// ──────────────────────────────────────
// 6. Загрузка карты из облака
// ──────────────────────────────────────
async function loadMaps() {
  if (!sb || !currentUser) return;

  // Свои карты
  let { data: owned } = await sb.from('maps_next').select('id,title,owner_id').eq('owner_id', currentUser.id).order('created_at', { ascending: false });

  // Карты, к которым есть доступ (шаринг)
  let { data: shares } = await sb.from('map_shares').select('map_id,email').eq('email', currentUser.email.toLowerCase());
  var sharedIds = (shares || []).map(function (r) { return r.map_id; });
  var sharedMaps = [];
  if (sharedIds.length) {
    let { data: sm } = await sb.from('maps_next').select('id,title,owner_id').in('id', sharedIds);
    if (sm) sharedMaps = sm;
  }

  state.maps = (owned || []).map(function (m) { return { id: m.id, title: m.title, owner_id: m.owner_id, is_owner: true }; })
    .concat((sharedMaps || []).map(function (m) { return { id: m.id, title: m.title, owner_id: m.owner_id, is_owner: false }; }));

  if (state.maps.length === 0) {
    await createFirstMap();
    return;
  }

  // Восстанавливаем последнюю выбранную таблицу, иначе — первую свою
  var lastId = null;
  try { lastId = localStorage.getItem(LAST_MAP_KEY); } catch (e) {}
  var preferred = (lastId && state.maps.find(function (m) { return m.id === lastId; }))
    || state.maps.find(function (m) { return m.is_owner; })
    || state.maps[0];
  await loadMap(preferred.id);
}

async function loadMap(mapId) {
  var meta = state.maps.find(function (m) { return m.id === mapId; });
  if (!meta) return;
  var { data, error } = await sb.from('maps_next').select('*').eq('id', mapId).maybeSingle();
  if (error || !data) { showError('не удалось загрузить таблицу'); return; }
  applyMap(data, !!meta.is_owner);
  try { localStorage.setItem(LAST_MAP_KEY, mapId); } catch (e) {}
  renderMapSelector();
  render();
}

async function createFirstMap() {
  // Миграция старых данных из localStorage
  let importData = null;
  try { var raw = localStorage.getItem(LS_KEY); if (raw) importData = JSON.parse(raw); } catch (e) {}
  if (importData && importData.nodes && importData.nodes.length) {
    state.columns = importData.columns && importData.columns.length ? importData.columns : defaultColumns();
    state.nodes = window.KicsModel.normalizeNodes(importData.nodes);
    nextId = importData.nextId || 1;
    state.availableTags = importData.availableTags || [];
    rebuildChildren();
  } else {
    setEmptyState();
  }
  var id = await insertMap('Моя карта фич');
  if (!id) return;
  state.mapId = id;
  try { localStorage.removeItem(LS_KEY); } catch (e) {}
  renderMapSelector();
  render();
}

async function insertMap(title) {
  // Вставка без select/single, чтобы не падать на ошибке PGRST116
  var { error } = await sb.from('maps_next').insert({
    owner_id: currentUser.id,
    title: title,
    data: window.KicsModel.payload(state, nextId)
  });
  if (error) { console.error('insert error:', error); showError('не удалось создать таблицу: ' + error.message); return null; }

  // Читаем id только что созданной записи
  var { data: created, error: readErr } = await sb
    .from('maps_next')
    .select('id,title,owner_id')
    .eq('owner_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (readErr) { console.error('read error:', readErr); showError('не удалось прочитать таблицу: ' + readErr.message); return null; }
  if (!created) { showError('таблица создана, но не прочиталась'); return null; }

  state.maps.unshift({ id: created.id, title: created.title, owner_id: created.owner_id, is_owner: true });
  return created.id;
}

async function newMap() {
  var title = await window.KicsUI.prompt({
    title: 'Новая таблица',
    message: 'Создайте отдельное пространство для новой карты продукта.',
    inputLabel: 'Название',
    defaultValue: 'Новая таблица',
    confirmLabel: 'Создать',
    validate: function (value) {
      if (!value) return 'Введите название таблицы';
      var duplicate = state.maps.some(function (map) { return map.title.toLowerCase() === value.toLowerCase(); });
      return duplicate ? 'Таблица с таким названием уже существует' : true;
    }
  });
  if (title === null) return;
  setEmptyState();
  var id = await insertMap(title);
  if (!id) return;
  state.mapId = id;
  state.boardTitle = title;
  isOwner = true;
  renderMapSelector();
  render();
  showToast('Таблица создана', 'success');
}

var duplicateMapPending = false;
async function duplicateMap() {
  if (duplicateMapPending) return;
  if (!isOwner) {
    showToast('Дублировать таблицу может только владелец', 'error');
    return;
  }
  if (!sb || !currentUser || !state.mapId) return;

  duplicateMapPending = true;
  var button = document.getElementById('duplicateMapBtn');
  if (button) button.disabled = true;
  try {
    var sourceId = state.mapId;
    var ownerId = currentUser.id;
    var sourceTitle = state.boardTitle || 'Моя карта фич';
    var duplicateTitle = sourceTitle + ' (копия)';
    var suffix = 2;
    while (state.maps.some(function (map) { return map.title === duplicateTitle; })) {
      duplicateTitle = sourceTitle + ' (копия ' + suffix++ + ')';
    }
    var copyState = {
      columns: JSON.parse(JSON.stringify(state.columns)),
      nodes: JSON.parse(JSON.stringify(state.nodes)),
      nextId: nextId,
      availableTags: JSON.parse(JSON.stringify(state.availableTags || []))
    };

    var bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    var hex = Array.from(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    var id = hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
    var created = {
      id: id,
      owner_id: ownerId,
      title: duplicateTitle,
      data: copyState
    };
    var { error } = await sb.from('maps_next').insert(created);
    if (error) {
      showError('не удалось дублировать таблицу: ' + error.message);
      return;
    }

    if (!currentUser || currentUser.id !== ownerId) return;
    state.maps.unshift({ id: created.id, title: created.title, owner_id: created.owner_id, is_owner: true });
    if (state.mapId === sourceId) {
      // Flush the source's pending save before changing the active map.
      clearTimeout(saveTimer);
      await saveMapRemote();
      if (state.mapId === sourceId && currentUser && currentUser.id === ownerId) {
        applyMap(created, true);
        try { localStorage.setItem(LAST_MAP_KEY, created.id); } catch (e) {}
        render();
      }
    }
    renderMapSelector();
    showToast('Таблица продублирована', 'success');
  } catch (error) {
    showError('не удалось дублировать таблицу: ' + error.message);
  } finally {
    duplicateMapPending = false;
    if (button) button.disabled = false;
  }
}

async function deleteMap() {
  if (!isOwner) { showToast('Удалять таблицу может только владелец', 'error'); return; }
  var cur = state.maps.find(function (m) { return m.id === state.mapId; });
  var approved = await window.KicsUI.confirm({
    title: 'Удалить таблицу?',
    message: 'Таблица «' + (cur ? cur.title : state.boardTitle) + '» и все её карточки будут удалены без возможности восстановления.',
    confirmLabel: 'Удалить',
    danger: true
  });
  if (!approved) return;
  var { error } = await sb.from('maps_next').delete().eq('id', state.mapId);
  if (error) { showError('не удалось удалить: ' + error.message); return; }
  state.maps = state.maps.filter(function (m) { return m.id !== state.mapId; });
  if (state.maps.length === 0) {
    setEmptyState();
    var id = await insertMap('Моя карта фич');
    if (!id) return;
    state.mapId = id;
    state.boardTitle = 'Моя карта фич';
    isOwner = true;
    renderMapSelector();
    render();
    return;
  }
  await loadMap(state.maps[0].id);
  showToast('Таблица удалена', 'success');
}

async function selectMap(mapId) {
  await loadMap(mapId);
}

// Добавить столбец перед «Комментарием»
async function addColumn() {
  if (!canEdit()) { showToast('Переключитесь в режим редактирования', 'error'); return; }
  var name = await window.KicsUI.prompt({
    title: 'Добавить колонку',
    inputLabel: 'Название колонки',
    defaultValue: 'Новый столбец',
    confirmLabel: 'Добавить',
    validate: function (value) { return value ? true : 'Введите название колонки'; }
  });
  if (name === null) return;

  // Вставляем новый столбец перед «Комментарием» (последней колонкой)
  var newCol = { id: 'col' + Date.now(), name: name };
  state.columns.splice(state.columns.length - 1, 0, newCol);

  // Перенумеровываем комментарии на новый последний индекс
  var newCommentIndex = state.columns.length - 1;
  state.nodes.forEach(function (n) {
    if (n.type === 'comment') { n.colIndex = newCommentIndex; }
  });

  rebuildChildren();
  scheduleSave();
  render();
}

// Получить все id карточек-потомков (включая сам узел), без комментариев
function collectSubtreeIds(rootId) {
  var result = {};
  (function walk(id) {
    result[id] = true;
    state.nodes.forEach(function (n) {
      if (n.parentId === id && n.type !== 'comment' && !result[n.id]) walk(n.id);
    });
  })(rootId);
  return result;
}

// Удалить столбец по индексу (кроме последнего — комментария)
async function deleteColumn(colIndex) {
  if (!canEdit()) return;
  if (colIndex < 0 || colIndex >= state.columns.length - 1) return;

  if (state.columns.length <= 2) return;
  var col = state.columns[colIndex];

  // Собираем все карточки в этом столбце + их поддерево
  var toDelete = {};
  state.nodes.forEach(function (n) {
    if (n.type !== 'comment' && n.colIndex === colIndex) {
      var ids = collectSubtreeIds(n.id);
      Object.keys(ids).forEach(function (id) { toDelete[id] = true; });
    }
  });

  // Удаляем также комментарии, привязанные к удаляемым листьям
  state.nodes.forEach(function (n) {
    if (n.type === 'comment' && n.targetId && toDelete[n.targetId]) toDelete[n.id] = true;
  });

  var count = Object.keys(toDelete).length;
  var approved = await window.KicsUI.confirm({
    title: 'Удалить колонку?',
    message: count > 0
      ? 'Колонка «' + col.name + '», ' + count + ' карточек и их дочерние ветви будут удалены.'
      : 'Колонка «' + col.name + '» будет удалена.',
    confirmLabel: 'Удалить',
    danger: true
  });
  if (!approved) return;

  // Удаляем узлы
  rememberDeletion('Column deletion');
  state.nodes = state.nodes.filter(function (n) { return !toDelete[n.id]; });

  // Удаляем сам столбец
  state.columns.splice(colIndex, 1);

  // Пересчитываем colIndex для оставшихся настоящих карточек (сжимаем)
  state.nodes.forEach(function (n) {
    if (n.type === 'comment') { n.colIndex = state.columns.length - 1; }
    else if (n.colIndex > colIndex) { n.colIndex -= 1; }
  });

  rebuildChildren();
  pruneUnusedTags();
  renderTagFilterBar();
  scheduleSave();
  render();
}

// Кастомный выпадающий список для чипов статуса/срока
function openSelectMenu(anchor, options, onSelect) {
  closeSelectMenu();

  var menu = document.createElement('div');
  menu.className = 'select-menu';
  menu.setAttribute('role', 'menu');

  options.forEach(function (opt) {
    var item = document.createElement('div');
    item.className = 'select-menu-item';
    item.setAttribute('role', 'menuitem');
    item.tabIndex = 0;
    item.textContent = opt.label;
    item.addEventListener('mousedown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      onSelect(opt.value);
      closeSelectMenu();
    });
    item.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(opt.value);
        closeSelectMenu();
      }
    });
    menu.appendChild(item);
  });

  document.body.appendChild(menu);

  var r = anchor.getBoundingClientRect();
  menu.style.left = r.left + 'px';
  menu.style.top = (r.bottom + 4) + 'px';
  menu.style.minWidth = r.width + 'px';
  // Не даём меню выйти за правый край экрана
  var mw = menu.offsetWidth || 180;
  if (r.left + mw > window.innerWidth - 8) {
    menu.style.left = Math.max(8, window.innerWidth - mw - 8) + 'px';
  }

  // Закрытие по клику вне меню
  setTimeout(function () {
    document.addEventListener('click', handler);
    document.addEventListener('scroll', handler, true);
    function handler(e) {
      if (!menu.contains(e.target)) {
        closeSelectMenu();
        document.removeEventListener('click', handler);
        document.removeEventListener('scroll', handler, true);
      }
    }
  }, 0);
}

function closeSelectMenu() {
  var m = document.querySelector('.select-menu');
  if (m) m.remove();
}

function openTagEditor(nodeId, oldTag) {
  var node = getNodeById(nodeId);
  if (!node) return;

  // Удаляем старое мини-окно, если было
  var old = document.getElementById('tagEditor');
  if (old) old.remove();

  var box = document.createElement('div');
  box.id = 'tagEditor';
  box.className = 'tag-editor';

  var head = document.createElement('div');
  head.className = 'tag-editor-head';
  head.textContent = 'Тег: ' + oldTag;
  box.appendChild(head);

  // Список всех тегов в системе для замены
  var all = getAllTags().filter(function (t) { return t !== oldTag; });
  var list = document.createElement('div');
  list.className = 'tag-editor-list';

  all.forEach(function (t) {
    var item = document.createElement('div');
    item.className = 'tag-editor-item';
    item.textContent = t;
    item.addEventListener('click', function () {
      var idx = node.tags.indexOf(oldTag);
      if (idx !== -1) { node.tags[idx] = t; }
      pruneUnusedTags();
      box.remove();
      renderTagFilterBar();
      scheduleSave();
      updateCards(); syncHeights(); alignHeaders();
    });
    list.appendChild(item);
  });

  if (all.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'tag-editor-empty';
    empty.textContent = 'Других тегов нет';
    list.appendChild(empty);
  }
  box.appendChild(list);

  // Кнопка удаления тега
  var del = document.createElement('button');
  del.className = 'tag-editor-del';
  del.textContent = 'Удалить тег';
  del.addEventListener('click', function () {
    node.tags = node.tags.filter(function (x) { return x !== oldTag; });
    pruneUnusedTags();
    box.remove();
    renderTagFilterBar();
    scheduleSave();
    updateCards(); syncHeights(); alignHeaders();
  });
  box.appendChild(del);

  // Позиционируем к тегу (просто фиксируем по центру внизу для простоты)
  document.body.appendChild(box);
  var r = box.getBoundingClientRect();
  box.style.left = Math.max(12, (window.innerWidth - r.width) / 2) + 'px';
  box.style.top = Math.max(80, (window.innerHeight - r.height) / 2) + 'px';

  // Закрытие по клику вне окна
  setTimeout(function () {
    document.addEventListener('click', function handler(e) {
      if (!box.contains(e.target)) {
        box.remove();
        document.removeEventListener('click', handler);
      }
    });
  }, 0);
}

function renderMapSelector() {
  var sel = document.getElementById('mapSelect');
  if (!sel) return;
  sel.innerHTML = '';
  state.maps.forEach(function (m) {
    var o = document.createElement('option');
    o.value = m.id;
    o.textContent = m.is_owner ? m.title : m.title + ' (общая)';
    if (m.id === state.mapId) o.selected = true;
    sel.appendChild(o);
  });
  var delBtn = document.getElementById('deleteMapBtn');
  if (delBtn) delBtn.style.display = canEdit() ? 'flex' : 'none';
  var addColumnButton = document.getElementById('addColumnBtn');
  if (addColumnButton) addColumnButton.style.display = canEdit() ? 'flex' : 'none';
  var duplicateButton = document.getElementById('duplicateMapBtn');
  if (duplicateButton) duplicateButton.style.display = isOwner ? 'flex' : 'none';
  var importButton = document.getElementById('importBtn');
  if (importButton) importButton.style.display = isOwner ? 'flex' : 'none';
}

function applyMap(map, ownerFlag) {
  isOwner = ownerFlag;
  state.mapId = map.id;
  state.boardTitle = map.title || 'KICS — Карта фич';
  var raw = map.data || {};
  state.trash = raw.trash || [];
  collapsedBranches.clear();
  state.columns = raw.columns && raw.columns.length ? raw.columns : defaultColumns();
  state.nodes = (raw.nodes || []).map(normalizeNode);
  nextId = raw.nextId || 1;
  state.availableTags = raw.availableTags || [];
  state.filterTag = null;
  state.filterVisibleSet = null;
  rebuildChildren();
}

function defaultColumns() {
  return [
    { id: 'col0', name: 'Функциональная область' },
    { id: 'col1', name: 'Верхнеуровневая фича' },
    { id: 'col2', name: 'Фича' },
    { id: 'col3', name: 'Сабфича' },
    { id: 'col4', name: 'Комментарий' },
  ];
}

async function createNewMap() {
  // Миграция тарих данных из localStorage
  let importData = null;
  try {
    let raw = localStorage.getItem(LS_KEY);
    if (raw) importData = JSON.parse(raw);
  } catch (e) {}

  if (importData && importData.nodes && importData.nodes.length) {
    state.columns = importData.columns && importData.columns.length ? importData.columns : defaultColumns();
    state.nodes = window.KicsModel.normalizeNodes(importData.nodes);
    nextId = importData.nextId || 1;
    rebuildChildren();
  } else {
    setEmptyState();
  }

  let { error } = await sb.from('maps_next').insert({
    owner_id: currentUser.id,
    title: state.boardTitle || 'Моя карта фич',
    data: window.KicsModel.payload(state, nextId)
  });

  if (error) {
    console.error('Ошибка создания карты:', error.message, error.details, error.hint);
    showError('не удалось создать карту: ' + error.message + (error.details ? ' — ' + error.details : ''));
    return;
  }

  // Читаем id созданной карты отдельным запросом
  let { data: created, error: readErr } = await sb
    .from('maps_next')
    .select('id')
    .eq('owner_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (readErr || !created) {
    showError('карта создана, но не удалось прочитать её id — обнови страницу');
    return;
  }

  state.mapId = created.id;
  isOwner = true;
  try { localStorage.removeItem(LS_KEY); } catch (e) {}
  render();
}

// ──────────────────────────────────────
// 7. Auth flow
// ──────────────────────────────────────
function showAuth() { $('#authScreen').style.display = 'flex'; $('#app').style.display = 'none'; }
function showApp() { $('#authScreen').style.display = 'none'; $('#app').style.display = 'flex'; }

function localizeAuthError(err) {
  if (!err || !err.message) return 'Что-то пошло не так. Попробуй ещё раз.';
  var m = err.message.toLowerCase();
  if (m.indexOf('invalid login credentials') !== -1) return 'Неверный email или пароль.';
  if (m.indexOf('email not confirmed') !== -1) return 'Email не подтверждён. Проверь почту.';
  if (m.indexOf('already registered') !== -1 || m.indexOf('already exists') !== -1) return 'Этот email уже зарегистрирован. Войди.';
  if (m.indexOf('password') !== -1 && m.indexOf('6') !== -1) return 'Пароль слишком короткий (минимум 6 символов).';
  return err.message;
}

async function initAuth() {
  let authMode = 'signin';
  let submitBtn = $('#authSubmit');
  let toggleBtn = $('#authToggleBtn');
  let toggleText = $('#authToggleText');
  let errorBox = $('#authError');

  function setMode(mode) {
    authMode = mode;
    if (mode === 'signin') {
      submitBtn.textContent = 'Войти';
      toggleBtn.textContent = 'Зарегистрироваться';
      toggleText.textContent = 'Нет аккаунта?';
    } else {
      submitBtn.textContent = 'Создать аккаунт';
      toggleBtn.textContent = 'Войти';
      toggleText.textContent = 'Уже есть аккаунт?';
    }
  }
  setMode('signin');
  toggleBtn.addEventListener('click', function () { setMode(authMode === 'signin' ? 'signup' : 'signin'); });

  $('#authForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    errorBox.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = '…';

    var email = $('#authEmail').value.trim();
    var password = $('#authPassword').value;

    var result;
    if (authMode === 'signin') {
      result = await sb.auth.signInWithPassword({ email, password });
    } else {
      result = await sb.auth.signUp({ email, password });
    }

    submitBtn.disabled = false;
    setMode(authMode);

    if (result.error) {
      // После успешного signup Supabase иногда возвращает session, но с warning
      if (result.data && result.data.session && authMode === 'signup') {
        // Пройдём дальше — пользователь залогинен
        currentUser = result.data.session.user;
        await afterLogin();
        return;
      }
      errorBox.textContent = localizeAuthError(result.error);
      errorBox.style.display = 'block';
      return;
    }

    // signUp без подтверждения email → session может не быть
    if (result.data && result.data.session) {
      currentUser = result.data.session.user;
      await afterLogin();
    } else {
      errorBox.textContent = 'Регистрация успешна! Проверь почту для подтверждения, затем войди.';
      errorBox.style.background = '#e6f9ed';
      errorBox.style.color = 'var(--green)';
      errorBox.style.display = 'block';
      setMode('signin');
    }
  });
}

async function afterLogin() {
  $('#userEmail').textContent = currentUser.email;
  showApp();
  // Если пришли по share-ссылке — пробуем открыть таблицу по токену
  try { await tryLoadSharedMap(); } catch (e) {}
  try {
    await loadMaps();
  } catch (e) {
    setEmptyState();
    render();
  }
}

async function tryLoadSharedMap() {
  var params = new URLSearchParams(window.location.search);
  var token = params.get('share');
  if (!token || !sb) return;
  var { data, error } = await sb.from('maps_next').select('*').eq('share_token', token).maybeSingle();
  if (error || !data) { showError('Ссылка недействительна или таблица не найдена'); return; }
  applyMap(data, false);
  viewMode = true;
  renderMapSelector();
  render();
}

// ──────────────────────────────────────
// 8. Share flow
// ──────────────────────────────────────
async function loadShareList() {
  // Загружаем текущий share_token и формируем ссылку
  var link = document.getElementById('shareLink');
  if (!link) return;
  if (!state.mapId) { link.value = ''; return; }
  var { data, error } = await sb.from('maps_next').select('share_token').eq('id', state.mapId).maybeSingle();
  if (!error && data && data.share_token) {
    link.value = window.location.origin + window.location.pathname + '?share=' + data.share_token;
  } else {
    link.value = '';
  }
}

async function generateShare() {
  if (!state.mapId) return;
  var token = 'm' + Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
  var { error } = await sb.from('maps_next').update({ share_token: token }).eq('id', state.mapId);
  if (error) { showError('не удалось создать ссылку: ' + error.message); return; }
  await loadShareList();
}

async function copyShare() {
  var link = document.getElementById('shareLink');
  if (!link || !link.value) return;
  try {
    await navigator.clipboard.writeText(link.value);
    showToast('Ссылка скопирована', 'success');
  } catch (e) {
    link.select();
    document.execCommand('copy');
    showToast('Ссылка скопирована', 'success');
  }
}

// ──────────────────────────────────────
// 9. Render
// ──────────────────────────────────────
function render() {
  var t = document.getElementById('boardTitle');
  if (t && t.textContent !== state.boardTitle) t.textContent = state.boardTitle;
  computeColWidth();
  renderTagFilterBar();
  renderColumns();
  requestAnimationFrame(function () { requestAnimationFrame(function () { syncHeights(); alignHeaders(); }); });
}

function renderTagFilterBar() {
  var bar = document.getElementById('tagFilterBar');
  if (!bar) return;
  bar.innerHTML = '';

  var tags = getAllTags();
  tags.forEach(function (tag) {
    var chip = document.createElement('span');
    chip.className = 'filter-hash' + (state.filterTag === tag ? ' active' : '');
    chip.textContent = '#' + tag;
    chip.addEventListener('click', function () {
      if (state.filterTag === tag) {
        state.filterTag = null;
        state.filterVisibleSet = null;
      } else {
        state.filterTag = tag;
        state.filterVisibleSet = computeFilterVisibleSet(tag);
      }
      render();
    });
    bar.appendChild(chip);
  });

  if (state.filterTag) {
    var clear = document.createElement('span');
    clear.className = 'filter-hash filter-clear';
    clear.textContent = '✕ показать всё';
    clear.addEventListener('click', function () {
      state.filterTag = null;
      state.filterVisibleSet = null;
      render();
    });
    bar.appendChild(clear);
  }

  if (canEdit()) {
    var add = document.createElement('span');
    add.className = 'filter-hash filter-add';
    add.textContent = '+ тег';
    add.addEventListener('click', async function () {
      var name = await window.KicsUI.prompt({
        title: 'Новый тег',
        inputLabel: 'Название',
        placeholder: 'Например: security',
        confirmLabel: 'Добавить',
        validate: function (value) { return value ? true : 'Введите название тега'; }
      });
      if (name === null) return;
      name = name.toLowerCase();
      if (!name) return;
      if (!state.availableTags) state.availableTags = [];
      if (state.availableTags.indexOf(name) === -1) state.availableTags.push(name);
      scheduleSave();
      render();
    });
    bar.appendChild(add);
  }
}

function renderColumns() {
  var c = $('#columnsContainer'); c.innerHTML = '';
  var hr = document.createElement('div'); hr.className = 'columns-headers';
  state.columns.forEach(function (col, i) {
    var h = document.createElement('div'); h.className = 'column-header';
    var sp = document.createElement('span');
    sp.textContent = col.name;
    sp.title = 'Нажми, чтобы переименовать';
    h.appendChild(sp);
    if (canEdit()) {
      sp.contentEditable = 'true';
      sp.addEventListener('blur', function () {
        var v = sp.textContent.trim();
        if (v) { col.name = v; scheduleSave(); }
        else { sp.textContent = col.name; }
      });
      sp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); sp.blur(); } });
    }
    var ha = document.createElement('div'); ha.className = 'column-header-actions';
    if (canEdit()) {
      // Кнопка удаления столбца (кроме последней — комментария)
      if (i < state.columns.length - 1) {
        var delBtn = document.createElement('button'); delBtn.className = 'column-header-btn danger'; delBtn.textContent = '\uD83D\uDDD1'; delBtn.title = 'Удалить столбец';
        (function (idx) { delBtn.addEventListener('click', function (e) { e.stopPropagation(); deleteColumn(idx); }); })(i);
        ha.appendChild(delBtn);
      }
      // Кнопка добавления карточки в колонку
      if (i < state.columns.length - 1) {
        var btn = document.createElement('button'); btn.className = 'column-header-btn'; btn.textContent = '+'; btn.title = 'Добавить карточку в эту колонку';
        (function (idx) {
          btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var n;
            if (idx === 0) { n = createNode(null, 0, 'Новая карточка'); }
            else {
              var parents = getNodesByCol(idx - 1);
              if (parents.length === 0) { showToast('Сначала создайте карточку в колонке «' + state.columns[idx - 1].name + '»', 'error'); return; }
              var parent = parents[parents.length - 1];
              n = createNode(parent.id, idx, 'Новая карточка');
            }
            state.nodes.push(n); rebuildChildren(); scheduleSave(); render(); openModal(n.id);
          });
        })(i);
        ha.appendChild(btn);
      }
    }
    h.appendChild(ha); hr.appendChild(h);
  });
  c.appendChild(hr);
  updateCardsContainer();
}

function updateCardsContainer() {
  renderContent();
}

function updateCards() {
  renderContent();
}

function renderContent() {
  var cc = $('#columnsContainer');
  var cd = cc.querySelector('.column--content');
  if (!cd) { cd = document.createElement('div'); cd.className = 'column--content'; cc.appendChild(cd); }
  cd.innerHTML = '';

  var roots = getNodesByCol(0).filter(function (n) { return !n.parentId; });
  if (roots.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'board-empty';
    var panel = document.createElement('div');
    panel.className = 'board-empty-card';
    panel.innerHTML = '<div class="board-empty-icon">＋</div><div class="board-empty-title">Начните карту продукта</div><div class="board-empty-text">Создайте первую карточку, затем раскладывайте инициативы по уровням иерархии.</div>';
    if (canEdit()) {
      var create = document.createElement('button');
      create.className = 'btn btn-primary';
      create.textContent = 'Создать карточку';
      create.addEventListener('click', function () {
        var node = createNode(null, 0, 'Новая карточка');
        state.nodes.push(node);
        rebuildChildren();
        scheduleSave();
        render();
        openModal(node.id);
      });
      panel.appendChild(create);
    }
    empty.appendChild(panel);
    cd.appendChild(empty);
    return;
  }
  roots.forEach(function (n) { cd.appendChild(renderCardBlock(n, 0)); });
}

function renderCardBlock(node, depth) {
  if (depth === undefined) depth = 0;
  var block = document.createElement('div'); block.className = 'card-block'; block.dataset.nodeId = node.id; block.dataset.depth = depth;
  if (!isNodeVisible(node)) { block.style.display = 'none'; return block; }

  block.appendChild(createCardElement(node));

  var children = (node.colIndex < lastRealColIndex()) ? getChildrenInNextCol(node) : [];
  if (collapsedBranches.has(node.id) && !catalogFiltersActive()) children = [];
  if (children.length > 0) {
    var sc = document.createElement('div'); sc.className = 'sub-column';
    children.forEach(function (ch) { sc.appendChild(renderCardBlock(ch, depth + 1)); });
    block.appendChild(sc);
  } else {
    // Строка заканчивается здесь — дотягиваем пустыми колонками до «Заметки», заметка в своём столбце
    var tail = document.createElement('div'); tail.className = 'sub-column';
    tail.appendChild(renderNoteChain(node.id, node.colIndex + 1));
    block.appendChild(tail);
  }
  return block;
}

// Дотягиваем строку-лист до колонки «Заметки»: пустые колонки-заглушки + заметка в своём столбце
function renderNoteChain(leafId, col) {
  var b = document.createElement('div'); b.className = 'card-block';
  if (col > lastRealColIndex()) {
    // Колонка «Заметки» — сама заметка (стоит напротив своей карточки)
    b.appendChild(renderCommentCell(leafId));
    return b;
  }
  var sp = document.createElement('div'); sp.className = 'note-spacer';
  b.appendChild(sp);
  var sc = document.createElement('div'); sc.className = 'sub-column';
  sc.appendChild(renderNoteChain(leafId, col + 1));
  b.appendChild(sc);
  return b;
}

// Ячейка заметки для листа (текст или пустая плашка «+ заметка»)
function renderCommentCell(leafId) {
  var existing = getCommentFor(leafId);
  if (existing) return createCommentNodeElement(existing);

  var cell = document.createElement('div');
  cell.className = 'comment-cell comment-empty';
  var s = document.createElement('span');
  if (canEdit()) {
    s.textContent = '+ заметка';
    cell.title = 'Добавить заметку';
    cell.addEventListener('click', function (e) { e.stopPropagation(); addComment(leafId); });
  } else {
    s.textContent = '\u2014';
  }
  cell.appendChild(s);
  return cell;
}

function addComment(leafId) {
  if (!canEdit()) return;
  var leaf = getNodeById(leafId);
  if (!leaf) return;
  if (leaf.type === 'comment') {
    showToast('Заметки доступны только для листовых карточек', 'error');
    return;
  }
  var existing = getCommentFor(leafId);
  if (existing) { openCommentEditor(existing.id); return; }
  var c = createNode(leaf.id, commentColIndex(), '', 'comment');
  c.targetId = leafId;
  state.nodes.push(c);
  rebuildChildren();
  scheduleSave();
  render();
  openCommentEditor(c.id);
}

function openCommentEditor(commentId) {
  var c = getNodeById(commentId);
  if (!c) return;
  var old = document.getElementById('commentEditorOverlay');
  if (old) old.remove();

  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'commentEditorOverlay';
  var modal = document.createElement('div'); modal.className = 'modal modal-wide';
  modal.innerHTML = '<div class="modal-header"><h3>Комментарий</h3></div>';
  var body = document.createElement('div'); body.className = 'modal-body';
  var ta = document.createElement('textarea'); ta.className = 'modal-textarea'; ta.rows = 6; ta.placeholder = 'Текст комментария…'; ta.value = c.note || '';
  body.appendChild(ta);
  var footer = document.createElement('div'); footer.className = 'modal-footer';
  var del = document.createElement('button'); del.className = 'btn btn-danger'; del.textContent = 'Удалить';
  var save = document.createElement('button'); save.className = 'btn btn-primary'; save.textContent = 'Сохранить';
  var cancel = document.createElement('button'); cancel.className = 'btn btn-secondary'; cancel.textContent = 'Отмена';
  cancel.addEventListener('click', function () { overlay.remove(); });
  del.addEventListener('click', function () { rememberDeletion('Deletion snapshot'); c.note = ''; overlay.remove(); scheduleSave(); render(); });
  save.addEventListener('click', function () { c.note = ta.value.trim(); overlay.remove(); scheduleSave(); render(); });
  footer.appendChild(del);
  var right = document.createElement('div'); right.className = 'modal-footer-actions';
  right.appendChild(cancel); right.appendChild(save);
  footer.appendChild(right);
  modal.appendChild(body); modal.appendChild(footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
  ta.focus();
}

// Редактор заметки карточки (жёлтый значок) — редактирует node.memo
function openNoteEditor(nodeId) {
  var n = getNodeById(nodeId);
  if (!n) return;
  var old = document.getElementById('noteEditorOverlay');
  if (old) old.remove();

  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'noteEditorOverlay';
  var modal = document.createElement('div'); modal.className = 'modal modal-wide';
  modal.innerHTML = '<div class="modal-header"><h3>Заметка</h3></div>';
  var body = document.createElement('div'); body.className = 'modal-body';
  var ta = document.createElement('textarea'); ta.className = 'modal-textarea'; ta.rows = 6; ta.placeholder = 'Текст заметки…'; ta.value = n.memo || '';
  body.appendChild(ta);
  var footer = document.createElement('div'); footer.className = 'modal-footer';
  var del = document.createElement('button'); del.className = 'btn btn-danger'; del.textContent = 'Очистить';
  var save = document.createElement('button'); save.className = 'btn btn-primary'; save.textContent = 'Сохранить';
  var cancel = document.createElement('button'); cancel.className = 'btn btn-secondary'; cancel.textContent = 'Отмена';
  cancel.addEventListener('click', function () { overlay.remove(); });
  del.addEventListener('click', function () { rememberDeletion('Deletion snapshot'); n.memo = ''; overlay.remove(); scheduleSave(); render(); });
  save.addEventListener('click', function () { n.memo = ta.value.trim(); overlay.remove(); scheduleSave(); render(); });
  footer.appendChild(del);
  var right = document.createElement('div'); right.className = 'modal-footer-actions';
  right.appendChild(cancel); right.appendChild(save);
  footer.appendChild(right);
  modal.appendChild(body); modal.appendChild(footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
  ta.focus();
}

// Рендер узла-комментария как компактной карточки комментария
function createCommentNodeElement(node) {
  var card = document.createElement('div');
  card.className = 'card comment-card';
  card.dataset.nodeId = node.id;

  var text = document.createElement('div');
  text.className = 'comment-text';
  text.textContent = node.note || '(пустой комментарий)';
  card.appendChild(text);

  if (canEdit()) {
    card.addEventListener('click', function () { openCommentEditor(node.id); });
  } else if (node.note) {
    card.addEventListener('click', function () { openCommentEditor(node.id); });
  }

  return card;
}

function createCardElement(node) {
  var card = document.createElement('div'); card.className = 'card'; card.dataset.nodeId = node.id;
  if (!canEdit()) { card.classList.add('view-mode'); }
  if (node.color && CARD_COLORS[node.color] && CARD_COLORS[node.color].cls) { card.classList.add(CARD_COLORS[node.color].cls); }

  // Действия карточки — одна кнопка-меню «⋮» справа сверху
  if (canEdit()) {
    var ac = document.createElement('div'); ac.className = 'card-actions';
    var mb = document.createElement('button'); mb.className = 'card-action-btn card-menu-btn'; mb.textContent = '\u22ee'; mb.title = 'Действия'; mb.setAttribute('aria-label', 'Действия с карточкой «' + (node.title || 'Без названия') + '»');
    mb.addEventListener('click', function (e) {
      e.stopPropagation();
      var hasChildren = getChildrenInNextCol(node).length > 0;
      var isCollapsed = hasChildren && collapsedBranches.has(node.id);
      var items = [
        { value: 'child', label: 'Добавить дочернюю карточку' },
        { value: 'edit', label: 'Редактировать' }
      ];
      // Свернуть/развернуть — только если у карточки есть дочерние (актуально для ветки)
      if (hasChildren) items.push(isCollapsed ? { value: 'expand', label: 'Развернуть' } : { value: 'collapse', label: 'Свернуть' });
      if (window.KicsAI) {
        items.push({ value: 'ai-desc', label: 'Описание AI' });
        items.push({ value: 'ai', label: 'ИИ…' });
      }
      items.push(
        { value: 'note', label: 'Заметка' },
        { value: 'delete', label: 'Удалить' }
      );
      openSelectMenu(mb, items, function (val) {
        if (val === 'child') addChildNode(node);
        else if (val === 'edit') openModal(node.id);
        else if (val === 'collapse') { collapsedBranches.add(node.id); render(); }
        else if (val === 'expand') { collapsedBranches.delete(node.id); render(); }
        else if (val === 'ai-desc') window.KicsAI.openPanel('card', node.id, 'ai-description');
        else if (val === 'ai') window.KicsAI.openPanel('card', node.id);
        else if (val === 'note') openNoteEditor(node.id);
        else if (val === 'delete') deleteNode(node.id);
      });
    });
    ac.appendChild(mb);
    card.appendChild(ac);
  }

  var t = document.createElement('div'); t.className = 'card-title'; t.innerHTML = ht(node.title || 'Без названия'); card.appendChild(t);

  var m = document.createElement('div'); m.className = 'card-meta';

  // Статус — кликабельный чип, выпадающий список
  var sb = document.createElement('span'); sb.className = 'status-badge ' + SC[node.status]; sb.innerHTML = '<span class="status-dot ' + SD[node.status] + '"></span>' + SL[node.status];
  if (canEdit()) {
    sb.classList.add('clickable-chip');
    sb.title = 'Изменить статус';
    sb.addEventListener('click', function (e) {
      e.stopPropagation();
      openSelectMenu(sb, [
        { value: 'none', label: SL.none },
        { value: 'planned', label: SL.planned },
        { value: 'wip', label: SL.wip },
        { value: 'done', label: SL.done }
      ], function (val) {
        node.status = val;
        scheduleSave(); updateCards(); syncHeights(); alignHeaders();
      });
    });
  }
  m.appendChild(sb);

  // Срок — кликабельный чип, выпадающий список
  var ds = document.createElement('span'); ds.className = 'due-chip'; ds.textContent = node.dueDate || 'срок';
  if (canEdit()) {
    ds.classList.add('clickable-chip');
    ds.title = 'Изменить срок / квартал';
    ds.addEventListener('click', function (e) {
      e.stopPropagation();
      openSelectMenu(ds, [
        { value: '', label: '(без срока)' },
        { value: 'Now', label: 'Now' },
        { value: 'Next', label: 'Next' },
        { value: 'Later', label: 'Later' },
        { value: 'Q1', label: 'Q1' },
        { value: 'Q2', label: 'Q2' },
        { value: 'Q3', label: 'Q3' },
        { value: 'Q4', label: 'Q4' }
      ], async function (val) {
        if (!val) { node.dueDate = ''; }
        else if (val.indexOf('Q') === 0) {
          var y = await window.KicsUI.prompt({
            title: 'Срок карточки',
            inputLabel: 'Год для ' + val,
            defaultValue: String(new Date().getFullYear()),
            inputType: 'number',
            confirmLabel: 'Сохранить',
            validate: function (value) { return /^\d{4}$/.test(value) ? true : 'Введите год из четырёх цифр'; }
          });
          if (y === null) return;
          node.dueDate = y + ' ' + val;
        }
        else { node.dueDate = val; }
        scheduleSave(); updateCards(); syncHeights(); alignHeaders();
      });
    });
  }
  m.appendChild(ds);

  card.appendChild(m);

  if (node.tags.length > 0) { var td = document.createElement('div'); td.className = 'card-tags'; node.tags.forEach(function (tg) { var ts = document.createElement('span'); ts.className = 'card-tag'; ts.innerHTML = ht(tg); if (canEdit()) { ts.title = 'Нажми, чтобы изменить тег'; ts.addEventListener('click', function (e) { e.stopPropagation(); openTagEditor(node.id, tg); }); } td.appendChild(ts); }); card.appendChild(td); }

  // Описание карточки — выводится на карточке (отдельно от заметки)
  if (node.note) { var h = document.createElement('div'); h.className = 'card-hint'; h.textContent = node.note; card.appendChild(h); }

  if (canEdit()) card.addEventListener('click', function () { openModal(node.id); });
  else card.addEventListener('click', function () { openCardView(node.id); });

  return card;
}

// ──────────────────────────────────────
// 10. Header alignment & height sync
// ──────────────────────────────────────
function computeColWidth() {
  var canvas = document.getElementById('mainCanvas');
  if (!canvas) return;
  var N = state.columns.length;
  if (N < 1) return;
  var avail = canvas.clientWidth - 48 - 20; // паддинги: canvas 24×2 + контент 10×2
  if (avail < 260) avail = 260;
  var W = Math.max(260, Math.floor((avail - (N - 1) * 16) / N));
  document.documentElement.style.setProperty('--col-w', W + 'px');
  document.documentElement.style.setProperty('--col-step', (W + 16) + 'px');
}

function alignHeaders() {
  // Заголовки колонок — статичная flex-раскладка (см. .columns-headers в styles.css).
  // Динамическое позиционирование отключено: заголовки больше не двигаются и не липнут при скролле.
}

var GAP = 10, DEF_H = 60;
function syncHeights() {
  // Сброс (пакетная запись)
  var cards = $$('.card');
  for (var i = 0; i < cards.length; i++) cards[i].style.minHeight = '';
  var commentCells = $$('.comment-cell');
  for (var c0 = 0; c0 < commentCells.length; c0++) commentCells[c0].style.minHeight = '';
  var emptySlots = $$('.empty-slot');
  for (var e = 0; e < emptySlots.length; e++) emptySlots[e].style.minHeight = '';

  // Кеши: id -> узел и id -> DOM-элемент
  var nodeById = {};
  var elById = {};
  state.nodes.forEach(function (n) { nodeById[n.id] = n; });
  for (var k = 0; k < cards.length; k++) {
    var cid = cards[k].getAttribute('data-node-id');
    if (cid) elById[cid] = cards[k];
  }

  // Естественные высоты карточек (без принудительного выравнивания)
  var heights = {};
  for (var id in elById) heights[id] = elById[id].offsetHeight || DEF_H;

  // Проход справа налево: родитель растягивается под сумму своих детей,
  // каждый ребёнок сохраняет свою естественную высоту
  for (var c = state.columns.length - 1; c >= 0; c--) {
    state.nodes.forEach(function (p) {
      if (p.type === 'comment' || p.colIndex !== c) return;
      var childIds = [];
      (p.children || []).forEach(function (cid) {
        var ch = nodeById[cid];
        if (ch && ch.colIndex === c + 1 && elById[cid]) childIds.push(cid);
      });

      var pc = elById[p.id];
      if (!pc) return;

      if (childIds.length === 0) {
        // Выравниваем соседнюю ячейку (пустой слот ниже / заметку у листа) по высоте карточки
        var bl = pc.closest('.card-block');
        if (bl) {
          var own = heights[p.id] || DEF_H;
          var es = bl.querySelector('.sub-column > .empty-slot');
          if (es) { es.style.minHeight = own + 'px'; }
          else {
            var cc = bl.querySelector('.comment-cell, .comment-card');
            if (cc) { cc.style.minHeight = own + 'px'; }
          }
        }
        return;
      }

      var total = 0;
      childIds.forEach(function (cid) { total += (heights[cid] || DEF_H) + GAP; });
      total -= GAP;
      var own = heights[p.id] || DEF_H;
      var nh = Math.max(own, total);
      elById[p.id].style.minHeight = nh + 'px';
      heights[p.id] = nh;
    });
  }
}

// ──────────────────────────────────────
// 11. CRUD
// ──────────────────────────────────────
function addChildNode(pn) {
  if (!canEdit()) return;
  var ni = pn.colIndex + 1;
  if (ni >= commentColIndex()) { showToast('Сначала добавьте колонку справа', 'error'); return; }
  var ch = createNode(pn.id, ni, 'Новая фича');
  state.nodes.push(ch);
  rebuildChildren();
  scheduleSave(); updateCards(); requestAnimationFrame(function () { requestAnimationFrame(function () { syncHeights(); alignHeaders(); }); }); openModal(ch.id);
}
async function deleteNode(id) {
  if (!canEdit()) return;
  var n = getNodeById(id); if (!n) return; var tr = new Set(); (function coll(x) { tr.add(x.id); getChildren(x.id).forEach(coll); })(n);
  var approved = await window.KicsUI.confirm({
    title: 'Удалить карточку?',
    message: tr.size > 1
      ? 'Карточка и ' + (tr.size - 1) + ' дочерних элементов будут удалены.'
      : 'Карточка будет удалена без возможности восстановления.',
    confirmLabel: 'Удалить',
    danger: true
  });
  if (!approved) return;
  state.nodes.forEach(function (x) {
    if (x.type === 'comment' && x.targetId && tr.has(x.targetId)) tr.add(x.id);
  });
  rememberDeletion('Deletion snapshot');
  state.nodes = state.nodes.filter(function (x) { return !tr.has(x.id); });
  state.nodes.forEach(function (x) { x.children = x.children.filter(function (cid) { return !tr.has(cid); }); });
  invalidateModelIndex();
  pruneUnusedTags();
  renderTagFilterBar();
  scheduleSave(); updateCards(); requestAnimationFrame(function () { requestAnimationFrame(function () { syncHeights(); alignHeaders(); }); });
  if (isMindmapOpen()) renderMindmap(true);
  showToast('Карточка удалена', 'success');
}
function saveModal() {
  var n = getNodeById(state.editingNodeId); if (!n) return;
  n.title = $('#modalTitle').value.trim();
  n.tags = $('#modalTags').value.split(',').map(function (t) { return t.trim().toLowerCase(); }).filter(function (t) { return t; });
  // Новые теги добавляем в общий набор таблицы
  if (!state.availableTags) state.availableTags = [];
  n.tags.forEach(function (t) { if (state.availableTags.indexOf(t) === -1) state.availableTags.push(t); });
  n.note = $('#modalNote').value.trim(); n.status = $('#modalStatus').value;
  n.color = $('#modalColor').value;
  pruneUnusedTags();
  var y = $('#modalYear').value, q = $('#modalQuarter').value;
  n.dueDate = (q === 'Now' || q === 'Next' || q === 'Later') ? q : ((y && q) ? (y + ' ' + q) : '');
  closeModal(); scheduleSave(); updateCards(); renderTagFilterBar(); requestAnimationFrame(function () { requestAnimationFrame(function () { syncHeights(); alignHeaders(); }); });
  if (isMindmapOpen()) renderMindmap(true);
}

// ──────────────────────────────────────
// 12. Modal
// ──────────────────────────────────────
function populateYearSelect() { var ys = $('#modalYear'); if (!ys) return; ys.innerHTML = '<option value="">—</option>'; var cy = new Date().getFullYear(); for (var y = cy - 2; y <= cy + 5; y++) { var o = document.createElement('option'); o.value = y; o.textContent = y; ys.appendChild(o); } }
function openCardView(id) {
  var n = getNodeById(id);
  if (!n) return;
  document.getElementById('cardViewTitle').textContent = n.title || 'Без названия';
  document.getElementById('cardViewTitle').style.whiteSpace = 'normal';
  document.getElementById('cardViewTitle').style.wordBreak = 'break-word';
  var body = document.getElementById('cardViewBody');
  body.innerHTML = '';
  body.style.whiteSpace = 'pre-wrap';
  body.style.wordBreak = 'break-word';

  // Строка мета
  var meta = document.createElement('div');
  meta.className = 'card-view-meta';
  var st = document.createElement('span');
  st.className = 'status-badge ' + SC[n.status];
  st.innerHTML = '<span class="status-dot ' + SD[n.status] + '"></span>' + SL[n.status];
  meta.appendChild(st);
  if (n.dueDate) {
    var d = document.createElement('span');
    d.className = 'due-chip';
    d.textContent = n.dueDate;
    meta.appendChild(d);
  }
  body.appendChild(meta);

  // Теги
  if (n.tags && n.tags.length) {
    var tags = document.createElement('div');
    tags.className = 'card-view-tags';
    n.tags.forEach(function (t) {
      var chip = document.createElement('span');
      chip.className = 'card-tag';
      chip.textContent = t;
      tags.appendChild(chip);
    });
    body.appendChild(tags);
  }

  // Детали (с кликабельными ссылками)
  if (n.note) {
    var note = document.createElement('div');
    note.className = 'card-view-note';
    // Преобразуем URL в кликабельные ссылки
    var html = eh(n.note).replace(/(https?:\/\/[^\s<>]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    note.innerHTML = html;
    body.appendChild(note);
  }

  document.getElementById('cardViewOverlay').style.display = 'flex';
}

function closeCardView() {
  document.getElementById('cardViewOverlay').style.display = 'none';
}

function openModal(id) {
  var n = getNodeById(id); if (!n || !canEdit()) return;
  state.editingNodeId = id; $('#modalTitle').value = n.title; $('#modalTags').value = n.tags.join(', ');
  setupTagAutocomplete();
  $('#modalNote').value = n.note; $('#modalStatus').value = n.status; $('#modalColor').value = n.color || 'none'; populateYearSelect();
  if (n.dueDate === 'Now' || n.dueDate === 'Next' || n.dueDate === 'Later') {
    $('#modalYear').value = ''; $('#modalQuarter').value = n.dueDate;
  } else {
    var m = n.dueDate.match(/^(\d{4})\s+(Q[1-4])$/);
    if (m) { $('#modalYear').value = m[1]; $('#modalQuarter').value = m[2]; } else { $('#modalYear').value = ''; $('#modalQuarter').value = ''; }
  }
  $('#modalOverlay').style.display = 'flex';
}
function closeModal() { $('#modalOverlay').style.display = 'none'; state.editingNodeId = null; var d = document.getElementById('tagAutocomplete'); if (d) d.remove(); }

function setupTagAutocomplete() {
  var input = document.getElementById('modalTags');
  if (!input || input.dataset.autocompleteReady === 'true') return;
  input.dataset.autocompleteReady = 'true';
  input.addEventListener('focus', function () { showTagAutocomplete(input); });
  input.addEventListener('input', function () { showTagAutocomplete(input); });
  input.addEventListener('blur', function () { setTimeout(function () { var d = document.getElementById('tagAutocomplete'); if (d) d.remove(); }, 200); });
}

function showTagAutocomplete(input) {
  var old = document.getElementById('tagAutocomplete');
  if (old) old.remove();

  var current = input.value.split(',').map(function (t) { return t.trim().toLowerCase(); }).filter(function (t) { return t; });
  var available = getAllTags().filter(function (t) { return current.indexOf(t) === -1; });
  if (available.length === 0) return;

  var box = document.createElement('div');
  box.id = 'tagAutocomplete';
  box.className = 'tag-autocomplete';

  available.forEach(function (t) {
    var item = document.createElement('div');
    item.className = 'tag-autocomplete-item';
    item.textContent = t;
    item.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var cur = input.value.trim();
      var tags = cur ? cur.split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x; }) : [];
      if (tags.indexOf(t) === -1) tags.push(t);
      input.value = tags.join(', ');
      box.remove();
    });
    box.appendChild(item);
  });

  document.body.appendChild(box);
  var r = input.getBoundingClientRect();
  box.style.left = r.left + 'px';
  box.style.top = (r.bottom + 4) + 'px';
  box.style.width = r.width + 'px';
}

// ──────────────────────────────────────
// 12b. Mind map (Miro-style viewer)
// ──────────────────────────────────────
var MINDMAP_COLORS = ['#4262ff', '#8a5cff', '#00a884', '#f59e0b', '#e85d75', '#168aad', '#7b61ff', '#e76f51'];
var mindmap = {
  scale: 1,
  tx: 0,
  ty: 0,
  dragging: null,
  collapsed: new Set(),
  tree: null,
  positions: {},
  nodeEls: {},
  bounds: null,
  renderToken: 0
};

function isMindmapOpen() {
  var ov = document.getElementById('mindmapOverlay');
  return !!ov && ov.style.display === 'flex';
}

function buildMindmapTree() {
  var byId = {};
  var children = {};
  var roots = [];
  state.nodes.forEach(function (node) {
    if (node.type !== 'comment') byId[node.id] = node;
  });
  state.nodes.forEach(function (node) {
    if (node.type === 'comment') return;
    if (node.parentId && byId[node.parentId]) {
      if (!children[node.parentId]) children[node.parentId] = [];
      children[node.parentId].push(node.id);
    } else {
      roots.push(node.id);
    }
  });
  return { byId: byId, children: children, roots: roots };
}

function mindmapVisibleChildren(id) {
  if (mindmap.collapsed.has(id)) return [];
  return (mindmap.tree.children[id] || []).filter(function (cid) { return !!mindmap.tree.byId[cid]; });
}

function mindmapSubtreeWeight(id) {
  var kids = mindmapVisibleChildren(id);
  if (!kids.length) return 1;
  return kids.reduce(function (sum, cid) { return sum + mindmapSubtreeWeight(cid); }, 0);
}

function splitMindmapRoots() {
  var weighted = mindmap.tree.roots.map(function (id, index) {
    return { id: id, weight: mindmapSubtreeWeight(id), index: index };
  }).sort(function (a, b) { return b.weight - a.weight || a.index - b.index; });
  var sides = { left: [], right: [] };
  var totals = { left: 0, right: 0 };
  weighted.forEach(function (item) {
    var side = totals.left < totals.right ? 'left' : 'right';
    sides[side].push(item);
    totals[side] += item.weight;
  });
  sides.left.sort(function (a, b) { return a.index - b.index; });
  sides.right.sort(function (a, b) { return a.index - b.index; });
  return sides;
}

function collectVisibleMindmapNodes() {
  var result = [];
  function walk(id, depth, side, branchIndex) {
    var node = mindmap.tree.byId[id];
    if (!node) return;
    result.push({ id: id, node: node, depth: depth, side: side, branchIndex: branchIndex });
    mindmapVisibleChildren(id).forEach(function (cid) { walk(cid, depth + 1, side, branchIndex); });
  }
  var sides = splitMindmapRoots();
  sides.left.forEach(function (item, i) { walk(item.id, 1, 'left', i); });
  sides.right.forEach(function (item, i) { walk(item.id, 1, 'right', i); });
  return { items: result, sides: sides };
}

function mindmapBranchColor(item) {
  var sideOffset = item.side === 'left' ? 0 : 4;
  return MINDMAP_COLORS[(item.branchIndex + sideOffset) % MINDMAP_COLORS.length];
}

function mindmapDescendantCount(id) {
  var count = 0;
  (mindmap.tree.children[id] || []).forEach(function countBranch(cid) {
    count++;
    (mindmap.tree.children[cid] || []).forEach(countBranch);
  });
  return count;
}

function createMindmapNodeElement(item) {
  var node = item.node;
  var el = document.createElement('div');
  el.className = 'mindmap-node side-' + item.side;
  el.dataset.nodeId = node.id;
  el.style.setProperty('--mm-branch', mindmapBranchColor(item));

  var title = document.createElement('div');
  title.className = 'mindmap-node-title';
  title.textContent = node.title || 'Без названия';
  title.title = node.title || 'Без названия';
  el.appendChild(title);

  var meta = document.createElement('div');
  meta.className = 'mindmap-node-meta';
  var color = document.createElement('span');
  color.className = 'mindmap-card-color ' + (node.color || 'none');
  color.title = 'Цвет исходной карточки';
  meta.appendChild(color);
  var status = document.createElement('span');
  status.textContent = SL[node.status] || SL.none;
  meta.appendChild(status);
  if (node.dueDate) {
    var due = document.createElement('span');
    due.textContent = '· ' + node.dueDate;
    meta.appendChild(due);
  }
  var comment = getCommentFor(node.id);
  if (comment || node.note) {
    var note = document.createElement('span');
    note.className = 'mindmap-note-icon';
    note.textContent = '📝';
    note.title = comment ? (comment.note || comment.title || 'Заметка') : node.note;
    meta.appendChild(note);
  }
  el.appendChild(meta);

  var allChildren = mindmap.tree.children[node.id] || [];
  if (allChildren.length) {
    var collapse = document.createElement('button');
    collapse.className = 'mindmap-collapse';
    var hidden = mindmap.collapsed.has(node.id);
    collapse.textContent = hidden ? '+' + allChildren.length : '−';
    collapse.title = hidden ? 'Развернуть ветку' : 'Свернуть ветку';
    collapse.addEventListener('click', function (e) {
      e.stopPropagation();
      if (mindmap.collapsed.has(node.id)) mindmap.collapsed.delete(node.id);
      else mindmap.collapsed.add(node.id);
      renderMindmap(true);
    });
    el.appendChild(collapse);
  }

  var clickTimer = null;
  el.addEventListener('click', function () {
    clearTimeout(clickTimer);
    clickTimer = setTimeout(function () { openCardView(node.id); }, 220);
  });
  el.addEventListener('dblclick', function (e) {
    e.preventDefault();
    e.stopPropagation();
    clearTimeout(clickTimer);
    if (canEdit()) openModal(node.id);
    else openCardView(node.id);
  });
  return el;
}

function renderMindmapNodes(items) {
  var layer = document.getElementById('mindmapNodes');
  layer.innerHTML = '';
  mindmap.nodeEls = {};

  var center = document.createElement('div');
  center.className = 'mindmap-node is-center';
  center.dataset.nodeId = '__center__';
  var centerTitle = document.createElement('div');
  centerTitle.className = 'mindmap-node-title';
  centerTitle.textContent = state.boardTitle;
  center.appendChild(centerTitle);
  layer.appendChild(center);
  mindmap.nodeEls.__center__ = center;

  items.forEach(function (item) {
    var el = createMindmapNodeElement(item);
    layer.appendChild(el);
    mindmap.nodeEls[item.id] = el;
  });
}

function mindmapNodeHeight(id) {
  var el = mindmap.nodeEls[id];
  return el ? Math.max(62, el.offsetHeight) : 62;
}

function layoutMindmapSide(rootItems, side, yGap) {
  var positions = {};
  var cursor = 0;
  var X_STEP = 300;

  function place(id, depth, branchIndex) {
    var kids = mindmapVisibleChildren(id);
    var h = mindmapNodeHeight(id);
    var y;
    if (!kids.length) {
      y = cursor + h / 2;
      cursor += h + yGap;
    } else {
      var childYs = [];
      kids.forEach(function (cid) { childYs.push(place(cid, depth + 1, branchIndex)); });
      y = (childYs[0] + childYs[childYs.length - 1]) / 2;
    }
    positions[id] = {
      id: id,
      x: (side === 'right' ? 1 : -1) * depth * X_STEP,
      y: y,
      side: side,
      depth: depth,
      branchIndex: branchIndex,
      width: mindmap.nodeEls[id] ? mindmap.nodeEls[id].offsetWidth : 220,
      height: h
    };
    return y;
  }

  rootItems.forEach(function (item, index) {
    place(item.id, 1, index);
    cursor += yGap * 1.5;
  });
  return { positions: positions, height: Math.max(0, cursor - yGap) };
}

function centerMindmapSide(layout) {
  var offset = -layout.height / 2;
  Object.keys(layout.positions).forEach(function (id) { layout.positions[id].y += offset; });
}

function mergeMindmapPositions(left, right) {
  var merged = { __center__: { id: '__center__', x: 0, y: 0, width: 250, height: 76, depth: 0, side: 'center' } };
  [left.positions, right.positions].forEach(function (map) {
    Object.keys(map).forEach(function (id) { merged[id] = map[id]; });
  });
  return merged;
}

function resolveMindmapCollisions() {
  ['left', 'right'].forEach(function (side) {
    var levels = {};
    Object.keys(mindmap.positions).forEach(function (id) {
      var p = mindmap.positions[id];
      if (p.side !== side) return;
      if (!levels[p.depth]) levels[p.depth] = [];
      levels[p.depth].push(p);
    });
    Object.keys(levels).forEach(function (depth) {
      var nodes = levels[depth].sort(function (a, b) { return a.y - b.y; });
      for (var i = 1; i < nodes.length; i++) {
        var prev = nodes[i - 1];
        var current = nodes[i];
        var minimumY = prev.y + prev.height / 2 + current.height / 2 + 24;
        if (current.y < minimumY) current.y = minimumY;
      }
      if (!nodes.length) return;
      var center = (nodes[0].y + nodes[nodes.length - 1].y) / 2;
      nodes.forEach(function (p) { p.y -= center; });
    });
  });
}

function applyMindmapNodePositions() {
  Object.keys(mindmap.positions).forEach(function (id) {
    var el = mindmap.nodeEls[id];
    var p = mindmap.positions[id];
    if (!el || !p) return;
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
  });
}

function mindmapEdgePath(parent, child) {
  var direction = child.side === 'left' ? -1 : 1;
  var sx = parent.x + direction * parent.width / 2;
  var sy = parent.y;
  var ex = child.x - direction * child.width / 2;
  var ey = child.y;
  var bend = Math.max(42, Math.abs(ex - sx) * 0.52);
  var c1x = sx + direction * bend;
  var c2x = ex - direction * bend;
  return 'M ' + sx + ' ' + sy + ' C ' + c1x + ' ' + sy + ', ' + c2x + ' ' + ey + ', ' + ex + ' ' + ey;
}

function renderMindmapEdges(items) {
  var svg = document.getElementById('mindmapEdges');
  svg.innerHTML = '';
  var NS = 'http://www.w3.org/2000/svg';
  var itemById = {};
  items.forEach(function (item) { itemById[item.id] = item; });
  items.forEach(function (item) {
    var child = mindmap.positions[item.id];
    if (!child) return;
    var parentId = item.node.parentId && mindmap.positions[item.node.parentId] ? item.node.parentId : '__center__';
    var parent = mindmap.positions[parentId];
    if (!parent) return;
    var path = document.createElementNS(NS, 'path');
    path.setAttribute('class', 'mindmap-edge');
    path.setAttribute('d', mindmapEdgePath(parent, child));
    path.setAttribute('stroke', mindmapBranchColor(item));
    path.setAttribute('stroke-width', item.depth === 1 ? '5' : (item.depth === 2 ? '3.5' : '2.5'));
    path.setAttribute('stroke-opacity', item.depth === 1 ? '0.95' : '0.72');
    svg.appendChild(path);
  });
}

function calculateMindmapBounds() {
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  Object.keys(mindmap.positions).forEach(function (id) {
    var p = mindmap.positions[id];
    minX = Math.min(minX, p.x - p.width / 2 - 30);
    maxX = Math.max(maxX, p.x + p.width / 2 + 30);
    minY = Math.min(minY, p.y - p.height / 2 - 30);
    maxY = Math.max(maxY, p.y + p.height / 2 + 30);
  });
  if (!isFinite(minX)) return { minX: -125, minY: -40, maxX: 125, maxY: 40 };
  return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
}

function updateMindmapZoomLabel() {
  var label = document.getElementById('mindmapZoomLabel');
  if (label) label.textContent = Math.round(mindmap.scale * 100) + '%';
}

function applyMindmapTransform() {
  var world = document.getElementById('mindmapWorld');
  if (!world) return;
  world.style.transform = 'translate(' + mindmap.tx + 'px,' + mindmap.ty + 'px) scale(' + mindmap.scale + ')';
  updateMindmapZoomLabel();
}

function centerMindmap() {
  var canvas = document.getElementById('mindmapCanvas');
  if (!canvas) return;
  mindmap.scale = 1;
  mindmap.tx = canvas.clientWidth / 2;
  mindmap.ty = canvas.clientHeight / 2;
  applyMindmapTransform();
}

function fitMindmap() {
  var canvas = document.getElementById('mindmapCanvas');
  var b = mindmap.bounds;
  if (!canvas || !b) return;
  var width = Math.max(1, b.maxX - b.minX);
  var height = Math.max(1, b.maxY - b.minY);
  var padding = 90;
  var sx = (canvas.clientWidth - padding) / width;
  var sy = (canvas.clientHeight - padding) / height;
  mindmap.scale = Math.max(0.12, Math.min(1, Math.min(sx, sy)));
  var cx = (b.minX + b.maxX) / 2;
  var cy = (b.minY + b.maxY) / 2;
  mindmap.tx = canvas.clientWidth / 2 - cx * mindmap.scale;
  mindmap.ty = canvas.clientHeight / 2 - cy * mindmap.scale;
  applyMindmapTransform();
}

function zoomMindmap(factor, viewportX, viewportY) {
  var canvas = document.getElementById('mindmapCanvas');
  if (!canvas) return;
  var cx = viewportX == null ? canvas.clientWidth / 2 : viewportX;
  var cy = viewportY == null ? canvas.clientHeight / 2 : viewportY;
  var next = Math.max(0.1, Math.min(2.5, mindmap.scale * factor));
  var ratio = next / mindmap.scale;
  mindmap.tx = cx - (cx - mindmap.tx) * ratio;
  mindmap.ty = cy - (cy - mindmap.ty) * ratio;
  mindmap.scale = next;
  applyMindmapTransform();
}

function renderMindmap(keepView) {
  if (!isMindmapOpen()) return;
  var token = ++mindmap.renderToken;
  mindmap.tree = buildMindmapTree();
  var visible = collectVisibleMindmapNodes();
  renderMindmapNodes(visible.items);

  requestAnimationFrame(function () {
    if (token !== mindmap.renderToken || !isMindmapOpen()) return;
    var left = layoutMindmapSide(visible.sides.left, 'left', 28);
    var right = layoutMindmapSide(visible.sides.right, 'right', 28);
    centerMindmapSide(left);
    centerMindmapSide(right);
    mindmap.positions = mergeMindmapPositions(left, right);
    resolveMindmapCollisions();
    applyMindmapNodePositions();
    renderMindmapEdges(visible.items);
    mindmap.bounds = calculateMindmapBounds();
    if (keepView) applyMindmapTransform();
    else centerMindmap();
  });
}

function openMindmap() {
  var overlay = document.getElementById('mindmapOverlay');
  if (!overlay) return;
  document.getElementById('mindmapTitle').textContent = state.boardTitle;
  overlay.style.display = 'flex';
  var boardButton = document.getElementById('boardViewBtn');
  var mindmapButton = document.getElementById('mindmapBtn');
  if (boardButton) { boardButton.classList.remove('is-active'); boardButton.setAttribute('aria-pressed', 'false'); }
  if (mindmapButton) { mindmapButton.classList.add('is-active'); mindmapButton.setAttribute('aria-pressed', 'true'); }
  mindmap.collapsed.clear();
  renderMindmap(false);
}

function closeMindmap() {
  var overlay = document.getElementById('mindmapOverlay');
  if (overlay) overlay.style.display = 'none';
  var boardButton = document.getElementById('boardViewBtn');
  var mindmapButton = document.getElementById('mindmapBtn');
  if (boardButton) { boardButton.classList.add('is-active'); boardButton.setAttribute('aria-pressed', 'true'); }
  if (mindmapButton) { mindmapButton.classList.remove('is-active'); mindmapButton.setAttribute('aria-pressed', 'false'); }
  mindmap.dragging = null;
}

function handleGlobalEscape() {
  if (document.querySelector('.dialog-overlay')) return;
  var actionsMenu = document.getElementById('moreActionsMenu');
  if (actionsMenu && !actionsMenu.hidden) {
    actionsMenu.hidden = true;
    var actionsButton = document.getElementById('moreActionsBtn');
    if (actionsButton) actionsButton.setAttribute('aria-expanded', 'false');
    return;
  }
  if ($('#modalOverlay').style.display === 'flex') closeModal();
  else if ($('#cardViewOverlay').style.display === 'flex') closeCardView();
  else if ($('#shareOverlay').style.display === 'flex') $('#shareOverlay').style.display = 'none';
  else if (isMindmapOpen()) closeMindmap();
  else if (state.searchQuery) {
    $('#searchInput').value = '';
    state.searchQuery = '';
    $('#clearSearch').style.display = 'none';
    updateCards();
    syncHeights();
    alignHeaders();
  }
}

// ──────────────────────────────────────
// 13. Events
// ──────────────────────────────────────
function initEvents() {
  $('#modalClose').addEventListener('click', closeModal);
  $('#modalOverlay').addEventListener('click', function (e) { if (e.target === $('#modalOverlay')) closeModal(); });
  $('#modalSave').addEventListener('click', saveModal);
  $('#modalDelete').addEventListener('click', function () { var id = state.editingNodeId; closeModal(); if (id) deleteNode(id); });

  // Просмотр карточки (read-only модалка)
  $('#cardViewClose').addEventListener('click', closeCardView);
  $('#cardViewOverlay').addEventListener('click', function (e) { if (e.target === $('#cardViewOverlay')) closeCardView(); });

  // Mind map
  var mmBtn = document.getElementById('mindmapBtn');
  if (mmBtn) mmBtn.addEventListener('click', openMindmap);
  var boardViewBtn = document.getElementById('boardViewBtn');
  if (boardViewBtn) boardViewBtn.addEventListener('click', closeMindmap);
  var mmClose = document.getElementById('mindmapBoardBtn');
  if (mmClose) mmClose.addEventListener('click', closeMindmap);
  var mmZoomIn = document.getElementById('mindmapZoomIn');
  if (mmZoomIn) mmZoomIn.addEventListener('click', function () { zoomMindmap(1.2); });
  var mmZoomOut = document.getElementById('mindmapZoomOut');
  if (mmZoomOut) mmZoomOut.addEventListener('click', function () { zoomMindmap(1 / 1.2); });
  var mmFit = document.getElementById('mindmapFit');
  if (mmFit) mmFit.addEventListener('click', fitMindmap);
  var mmCenter = document.getElementById('mindmapCenter');
  if (mmCenter) mmCenter.addEventListener('click', centerMindmap);
  var mmCanvas = document.getElementById('mindmapCanvas');
  if (mmCanvas) {
    mmCanvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var rect = mmCanvas.getBoundingClientRect();
      zoomMindmap(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });
    mmCanvas.addEventListener('mousedown', function (e) {
      if (e.button !== 0 || e.target.closest('.mindmap-node')) return;
      mindmap.dragging = { x: e.clientX, y: e.clientY, tx: mindmap.tx, ty: mindmap.ty };
      mmCanvas.classList.add('is-panning');
    });
  }

  // Compact actions menu
  var moreButton = document.getElementById('moreActionsBtn');
  var moreMenu = document.getElementById('moreActionsMenu');
  function setActionsMenu(open) {
    if (!moreButton || !moreMenu) return;
    moreMenu.hidden = !open;
    moreButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  if (moreButton && moreMenu) {
    moreButton.addEventListener('click', function (event) {
      event.stopPropagation();
      setActionsMenu(moreMenu.hidden);
    });
    moreMenu.addEventListener('click', function () { setActionsMenu(false); });
    document.addEventListener('click', function (event) {
      if (!moreMenu.hidden && !moreMenu.contains(event.target) && event.target !== moreButton) setActionsMenu(false);
    });
  }
  window.addEventListener('mousemove', function (e) {
    if (!mindmap.dragging) return;
    mindmap.tx = mindmap.dragging.tx + (e.clientX - mindmap.dragging.x);
    mindmap.ty = mindmap.dragging.ty + (e.clientY - mindmap.dragging.y);
    applyMindmapTransform();
  });
  window.addEventListener('mouseup', function () {
    if (!mindmap.dragging) return;
    mindmap.dragging = null;
    if (mmCanvas) mmCanvas.classList.remove('is-panning');
  });

  // Share
  $('#shareBtn').addEventListener('click', function () { $('#shareOverlay').style.display = 'flex'; loadShareList(); });
  $('#shareClose').addEventListener('click', function () { $('#shareOverlay').style.display = 'none'; });
  $('#shareDone').addEventListener('click', function () { $('#shareOverlay').style.display = 'none'; });
  $('#shareGenerateBtn').addEventListener('click', generateShare);
  $('#shareCopyBtn').addEventListener('click', copyShare);

  // Map selector
  var addColBtn = document.getElementById('addColumnBtn');
  if (addColBtn) addColBtn.addEventListener('click', addColumn);
  var mapSel = document.getElementById('mapSelect');
  if (mapSel) mapSel.addEventListener('change', function () { selectMap(mapSel.value); });
  var newMapBtn = document.getElementById('newMapBtn');
  if (newMapBtn) newMapBtn.addEventListener('click', function () { newMap(); });
  var delMapBtn = document.getElementById('deleteMapBtn');
  if (delMapBtn) delMapBtn.addEventListener('click', function () { deleteMap(); });
  var duplicateMapBtn = document.getElementById('duplicateMapBtn');
  if (duplicateMapBtn) duplicateMapBtn.addEventListener('click', function () { duplicateMap(); });

  // Переключатель Редактирование / Просмотр
  var vtBtn = document.getElementById('viewToggleBtn');
  if (vtBtn) vtBtn.addEventListener('click', function () {
    viewMode = !viewMode;
    if (viewMode) { vtBtn.textContent = '✏️ Редактировать'; }
    else { vtBtn.textContent = '👁 Просмотр'; }
    renderMapSelector();
    render();
    showToast(viewMode ? 'Включён режим просмотра' : 'Включён режим редактирования', 'info');
  });

  var addColumnBtn = document.getElementById('addColumnBtn');
  if (addColumnBtn) addColumnBtn.addEventListener('click', function () {
    if (!canEdit()) return;
    addColumn();
  });

  // Board title rename
  var bt = document.getElementById('boardTitle');
  if (bt) {
    bt.title = 'Нажми, чтобы переименовать доску';
    bt.addEventListener('click', function () { if (!canEdit()) return; bt.contentEditable = 'true'; bt.focus(); });
    bt.addEventListener('blur', function () {
      bt.contentEditable = 'false';
      var v = bt.textContent.trim();
      if (!v) { bt.textContent = state.boardTitle; return; }
      state.boardTitle = v;
      bt.textContent = v;
      // Синхронизируем название в списке таблиц
      var mapMeta = state.maps.find(function (m) { return m.id === state.mapId; });
      if (mapMeta) { mapMeta.title = v; }
      renderMapSelector();
      scheduleSave();
    });
    bt.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); bt.blur(); } });
  }

  // Logout — всегда перезагружаем страницу, даже если signOut упадёт
  $('#logoutBtn').addEventListener('click', function () {
    try {
      if (sb) { sb.auth.signOut(); }
    } catch (e) {}
    location.reload();
  });

  // Search
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') handleGlobalEscape();
  });
  $('#searchInput').addEventListener('input', function () {
    var v = $('#searchInput').value.trim();
    $('#clearSearch').style.display = v ? 'block' : 'none';
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(function () {
      state.searchQuery = v;
      updateCards();
      requestAnimationFrame(function () { requestAnimationFrame(function () { syncHeights(); alignHeaders(); }); });
    }, 250);
  });
  $('#clearSearch').addEventListener('click', function () {
    $('#searchInput').value = ''; state.searchQuery = '';
    $('#clearSearch').style.display = 'none';
    clearTimeout(searchDebounce);
    updateCards(); syncHeights(); alignHeaders();
  });

  // Export / import / demo
  $('#exportBtn').addEventListener('click', function () {
    var data = JSON.stringify(window.KicsModel.payload(state, nextId), null, 2);
    var blob = new Blob([data], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'kics-feature-map-' + new Date().toISOString().slice(0, 10) + '.json';
    anchor.click();
    URL.revokeObjectURL(url);
    showToast('Экспорт подготовлен', 'success');
  });
  $('#importBtn').addEventListener('click', function () { if (!isOwner) { showToast('В режиме просмотра импорт недоступен', 'error'); return; } $('#importFile').click(); });
  $('#importFile').addEventListener('change', function (e) {
    var f = e.target.files[0]; if (!f) return; var r = new FileReader();
    r.onload = function (ev) {
      try {
        var d = JSON.parse(ev.target.result);
        if (!Array.isArray(d.columns) || !Array.isArray(d.nodes)) throw new Error('bad');
        var ids = new Set();
        d.nodes.forEach(function (n) {
          if (!n || !n.id || ids.has(n.id)) throw new Error('Некорректные ID карточек');
          ids.add(n.id);
        });
        d.nodes.forEach(function (n) {
          var seen = new Set([n.id]), p = n.parentId;
          while (p) {
            if (seen.has(p) || !ids.has(p)) throw new Error('Некорректное дерево');
            seen.add(p); p = d.nodes.find(function (v) { return v.id === p; }).parentId;
          }
        });
        if (window.KicsAI) window.KicsAI.cancel();
        rememberDeletion('Импорт таблицы');
        state.columns = d.columns;
        state.nodes = d.nodes.map(normalizeNode);
        state.availableTags = Array.isArray(d.availableTags) ? d.availableTags.filter(function (t) { return typeof t === 'string'; }) : [];
        state.trash = Array.isArray(d.trash) ? d.trash.slice(-20) : [];
        nextId = Math.max(Number(d.nextId) || 1, ...d.nodes.map(function (n) { return (Number(String(n.id).replace(/^n/, '')) || 0) + 1; }));
        rebuildChildren();
        scheduleSave();
        render();
        showToast('Импорт завершён', 'success');
      } catch (ex) {
        showToast('Не удалось импортировать файл', 'error');
      }
    };
    r.readAsText(f); e.target.value = '';
  });

  window.addEventListener('resize', function () { computeColWidth(); syncHeights(); alignHeaders(); if (isMindmapOpen()) fitMindmap(); });
}

// ──────────────────────────────────────
// 14. Init
// ──────────────────────────────────────
async function init() {
  // Показываем номер версии из единой константы
  var vb = document.getElementById('versionBadge');
  if (vb) { vb.textContent = APP_VERSION; }

  var cfg = window.SUPABASE_CONFIG;
  if (!cfg || !cfg.url || cfg.url.indexOf('ВАШ_ПРОЕКТ') !== -1) {
    document.body.innerHTML = '<div style="max-width:600px;margin:80px auto;padding:24px;font-family:-apple-system,sans-serif;line-height:1.6"><h2>Нужно настроить Supabase</h2><p>Открой файл <code>config.js</code> и вставь туда <code>url</code> и <code>anonKey</code> из Supabase Dashboard → Settings → API.</p><p>Затем выполни <code>schema.sql</code> в SQL Editor Supabase.</p></div>';
    return;
  }

  sb = window.supabase.createClient(cfg.url, cfg.anonKey);
  initAuth();
  initEvents();

  var { data } = await sb.auth.getSession();
  if (data && data.session && data.session.user) {
    currentUser = data.session.user;
    await afterLogin();
  } else {
    showAuth();
  }

  // Слушаем изменения авторизации (например, на другой вкладке)
  sb.auth.onAuthStateChange(function (event, session) {
    if (session && session.user && !currentUser) { currentUser = session.user; afterLogin(); }
    if (!session) { currentUser = null; showAuth(); }
  });
}

// Глобальный ловец ошибок — любая JS‑ошибка видна красным баннером
window.addEventListener('error', function (e) {
  try { showError('JS: ' + (e.message || 'неизвестная ошибка')); } catch (err) {}
});

document.addEventListener('DOMContentLoaded', init);
