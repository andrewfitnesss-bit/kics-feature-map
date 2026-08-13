/**
 * KICS Feature Map — Feature planning tool for PMs
 * v12 — Supabase auth + cloud persistence
 */

const LS_KEY = 'kics_feature_map';
const APP_VERSION = 'v34';

// ──────────────────────────────────────
// 1. Суpabase client (инициализируется в init)
// ──────────────────────────────────────
let sb = null;
let currentUser = null;
let isOwner = true;

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
function nid() { return 'n' + (nextId++); }

function createNode(parentId, colIndex, title) {
  return { id: nid(), parentId: parentId || null, colIndex, title: title || '', tags: [], status: 'none', dueDate: '', note: '', children: [] };
}

// ──────────────────────────────────────
// 3. Helpers
// ──────────────────────────────────────
function getNodesByCol(i) { return state.nodes.filter(function (n) { return n.colIndex === i; }); }
function getChildren(pid) { return state.nodes.filter(function (n) { return n.parentId === pid; }); }
function getNodeById(id) { return state.nodes.find(function (n) { return n.id === id; }); }
function getChildrenInNextCol(node) { return (node.children || []).map(function (cid) { return getNodeById(cid); }).filter(function (c) { return c && c.colIndex === node.colIndex + 1; }); }
function rebuildChildren() {
  state.nodes.forEach(function (n) { n.children = []; });
  state.nodes.forEach(function (n) {
    if (n.parentId) { var p = getNodeById(n.parentId); if (p && p.children.indexOf(n.id) === -1) p.children.push(n.id); }
  });
}
function nodeMatchesFilter(node) {
  if (state.searchQuery) { var q = state.searchQuery.toLowerCase(); if (node.title.toLowerCase().indexOf(q) === -1 && node.note.toLowerCase().indexOf(q) === -1 && !node.tags.some(function (t) { return t.toLowerCase().indexOf(q) !== -1; })) return false; }
  var ct = state.selectedTags[node.colIndex]; if (ct && ct.size > 0 && !node.tags.some(function (t) { return ct.has(t); })) return false;
  return true;
}
function isNodeOrDescendantVisible(node) { if (nodeMatchesFilter(node)) return true; for (var i = 0; i < (node.children || []).length; i++) { var c = getNodeById(node.children[i]); if (c && isNodeOrDescendantVisible(c)) return true; } return false; }
function hasAnyFilter() { if (state.searchQuery) return true; for (var k in state.selectedTags) { if (state.selectedTags[k] && state.selectedTags[k].size > 0) return true; } return false; }
function getAllTags() { return (state.availableTags || []).slice().sort(); }

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
  var b = document.getElementById('errorBanner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'errorBanner';
    b.style.cssText = 'position:fixed;top:64px;left:50%;transform:translateX(-50%);background:#ff3b30;color:#fff;padding:10px 18px;border-radius:10px;z-index:3000;font-size:13px;max-width:85%;box-shadow:0 4px 12px rgba(0,0,0,.25);cursor:pointer;line-height:1.4;';
    b.onclick = function () { b.remove(); };
    document.body.appendChild(b);
  }
  b.textContent = 'Ошибка: ' + msg;
  clearTimeout(errorBannerTimer);
  errorBannerTimer = setTimeout(function () { if (b.parentNode) b.remove(); }, 8000);
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
    const { error } = await sb.from('maps').update({
      title: state.boardTitle,
      data: { columns: state.columns, nodes: state.nodes, nextId: nextId, availableTags: state.availableTags },
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
  let { data: owned } = await sb.from('maps').select('id,title,owner_id').eq('owner_id', currentUser.id).order('created_at', { ascending: false });

  // Карты, к которым есть доступ (шаринг)
  let { data: shares } = await sb.from('map_shares').select('map_id,email').eq('email', currentUser.email.toLowerCase());
  var sharedIds = (shares || []).map(function (r) { return r.map_id; });
  var sharedMaps = [];
  if (sharedIds.length) {
    let { data: sm } = await sb.from('maps').select('id,title,owner_id').in('id', sharedIds);
    if (sm) sharedMaps = sm;
  }

  state.maps = (owned || []).map(function (m) { return { id: m.id, title: m.title, owner_id: m.owner_id, is_owner: true }; })
    .concat((sharedMaps || []).map(function (m) { return { id: m.id, title: m.title, owner_id: m.owner_id, is_owner: false }; }));

  if (state.maps.length === 0) {
    await createFirstMap();
    return;
  }

  var preferred = state.maps.find(function (m) { return m.is_owner; }) || state.maps[0];
  await loadMap(preferred.id);
}

async function loadMap(mapId) {
  var meta = state.maps.find(function (m) { return m.id === mapId; });
  if (!meta) return;
  var { data, error } = await sb.from('maps').select('*').eq('id', mapId).maybeSingle();
  if (error || !data) { showError('не удалось загрузить таблицу'); return; }
  applyMap(data, !!meta.is_owner);
  renderMapSelector();
  render();
}

async function createFirstMap() {
  // Миграция старых данных из localStorage
  let importData = null;
  try { var raw = localStorage.getItem(LS_KEY); if (raw) importData = JSON.parse(raw); } catch (e) {}
  if (importData && importData.nodes && importData.nodes.length) {
    state.columns = importData.columns && importData.columns.length ? importData.columns : defaultColumns();
    state.nodes = importData.nodes;
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
  var { error } = await sb.from('maps').insert({
    owner_id: currentUser.id,
    title: title,
    data: { columns: state.columns, nodes: state.nodes, nextId: nextId, availableTags: state.availableTags }
  });
  if (error) { console.error('insert error:', error); showError('не удалось создать таблицу: ' + error.message); return null; }

  // Читаем id только что созданной записи
  var { data: created, error: readErr } = await sb
    .from('maps')
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
  // Проверка на дубликат имени
  var title;
  while (true) {
    title = prompt('Название таблицы:', 'Новая таблица');
    if (title === null) return;
    title = title.trim();
    if (!title) { alert('Имя не может быть пустым'); continue; }
    var dupe = state.maps.some(function (m) { return m.title.toLowerCase() === title.toLowerCase(); });
    if (dupe) { alert('Таблица с таким именем уже есть. Введи другое имя'); continue; }
    break;
  }
  setEmptyState();
  var id = await insertMap(title);
  if (!id) return;
  state.mapId = id;
  state.boardTitle = title;
  isOwner = true;
  renderMapSelector();
  render();
}

async function deleteMap() {
  if (!isOwner) { alert('Удалять может только владелец таблицы'); return; }
  var cur = state.maps.find(function (m) { return m.id === state.mapId; });
  if (!confirm('Удалить таблицу «' + (cur ? cur.title : state.boardTitle) + '»? Это действие необратимо.')) return;
  var { error } = await sb.from('maps').delete().eq('id', state.mapId);
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
}

async function selectMap(mapId) {
  await loadMap(mapId);
}

// Кастомный выпадающий список для чипов статуса/срока
function openSelectMenu(anchor, options, onSelect) {
  closeSelectMenu();

  var menu = document.createElement('div');
  menu.className = 'select-menu';

  options.forEach(function (opt) {
    var item = document.createElement('div');
    item.className = 'select-menu-item';
    item.textContent = opt.label;
    item.addEventListener('mousedown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      onSelect(opt.value);
      closeSelectMenu();
    });
    menu.appendChild(item);
  });

  document.body.appendChild(menu);

  var r = anchor.getBoundingClientRect();
  menu.style.left = r.left + 'px';
  menu.style.top = (r.bottom + 4) + 'px';
  menu.style.minWidth = r.width + 'px';

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
      box.remove();
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
    box.remove();
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
  if (delBtn) delBtn.style.display = isOwner ? 'flex' : 'none';
}

function applyMap(map, ownerFlag) {
  isOwner = ownerFlag;
  state.mapId = map.id;
  state.boardTitle = map.title || 'KICS — Карта фич';
  var raw = map.data || {};
  state.columns = raw.columns && raw.columns.length ? raw.columns : defaultColumns();
  state.nodes = raw.nodes || [];
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
    state.nodes = importData.nodes;
    nextId = importData.nextId || 1;
    rebuildChildren();
  } else {
    setEmptyState();
  }

  let { error } = await sb.from('maps').insert({
    owner_id: currentUser.id,
    title: state.boardTitle || 'Моя карта фич',
    data: { columns: state.columns, nodes: state.nodes, nextId: nextId, availableTags: state.availableTags }
  });

  if (error) {
    console.error('Ошибка создания карты:', error.message, error.details, error.hint);
    showError('не удалось создать карту: ' + error.message + (error.details ? ' — ' + error.details : ''));
    return;
  }

  // Читаем id созданной карты отдельным запросом
  let { data: created, error: readErr } = await sb
    .from('maps')
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
  try {
    await loadMaps();
  } catch (e) {
    setEmptyState();
    render();
  }
}

// ──────────────────────────────────────
// 8. Share flow
// ──────────────────────────────────────
async function loadShareList() {
  var list = $('#shareList');
  if (!state.mapId) { list.innerHTML = ''; return; }
  var { data, error } = await sb.from('map_shares').select('*').eq('map_id', state.mapId).order('created_at');
  list.innerHTML = '';
  if (error) return;
  if (!data || data.length === 0) {
    list.innerHTML = '<div class="share-hint">Пока никого нет.</div>';
    return;
  }
  data.forEach(function (s) {
    var item = document.createElement('div');
    item.className = 'share-item';

    var email = document.createElement('span'); email.className = 'share-item-email'; email.textContent = s.email;
    var role = document.createElement('span'); role.className = 'share-item-role'; role.textContent = s.role === 'editor' ? 'редактирование' : 'просмотр';
    var rm = document.createElement('button'); rm.className = 'share-item-remove'; rm.textContent = '\u2715';
    rm.addEventListener('click', function () { removeShare(s.id); });

    item.appendChild(email); item.appendChild(role); item.appendChild(rm);
    list.appendChild(item);
  });
}
async function addShare() {
  var email = $('#shareEmail').value.trim().toLowerCase();
  var role = $('#shareRole').value;
  if (!email || email.indexOf('@') === -1) { alert('Введи корректный email'); return; }
  if (!state.mapId) return;
  var { error } = await sb.from('map_shares').upsert({ map_id: state.mapId, owner_id: currentUser.id, email, role }, { onConflict: 'map_id,email' });
  if (error) { alert('Не удалось добавить доступ: ' + error.message); return; }
  $('#shareEmail').value = '';
  await loadShareList();
}
async function removeShare(id) {
  var { error } = await sb.from('map_shares').delete().eq('id', id);
  if (!error) await loadShareList();
}

// ──────────────────────────────────────
// 9. Render
// ──────────────────────────────────────
function render() {
  var t = document.getElementById('boardTitle');
  if (t && t.textContent !== state.boardTitle) t.textContent = state.boardTitle;
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

  if (isOwner) {
    var add = document.createElement('span');
    add.className = 'filter-hash filter-add';
    add.textContent = '+ тег';
    add.addEventListener('click', function () {
      var name = prompt('Название тега:');
      if (!name) return;
      name = name.trim().toLowerCase();
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
    if (isOwner) {
      sp.contentEditable = 'true';
      sp.addEventListener('blur', function () {
        var v = sp.textContent.trim();
        if (v) { col.name = v; scheduleSave(); }
        else { sp.textContent = col.name; }
      });
      sp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); sp.blur(); } });
    }
    var ha = document.createElement('div'); ha.className = 'column-header-actions';
    if (isOwner) { var btn = document.createElement('button'); btn.className = 'column-header-btn'; btn.textContent = '+'; btn.title = 'Добавить карточку в эту колонку'; btn.addEventListener('click', function (e) { e.stopPropagation(); var n; if (i === 0) { n = createNode(null, 0, 'Новая карточка'); } else { var parents = getNodesByCol(i - 1); if (parents.length === 0) { alert('Сначала создай карточку в колонке «' + state.columns[i - 1].name + '»'); return; } var parent = parents[parents.length - 1]; n = createNode(parent.id, i, 'Новая карточка'); } state.nodes.push(n); rebuildChildren(); scheduleSave(); render(); openModal(n.id); }); ha.appendChild(btn); }
    h.appendChild(ha); hr.appendChild(h);
  });
  c.appendChild(hr);
  updateCardsContainer();
}

function updateCardsContainer() {
  var cd = document.querySelector('.column--content');
  if (!cd) { cd = document.createElement('div'); cd.className = 'column--content'; $('#columnsContainer').appendChild(cd); }
  cd.innerHTML = '';
  var roots = getNodesByCol(0).filter(function (n) { return !n.parentId; });
  roots.forEach(function (n) { cd.appendChild(renderCardBlock(n, 0)); });
}

function updateCards() {
  var existing = document.querySelector('.column--content');
  if (!existing) { updateCardsContainer(); return; }
  existing.innerHTML = '';
  var roots = getNodesByCol(0).filter(function (n) { return !n.parentId; });
  roots.forEach(function (n) { existing.appendChild(renderCardBlock(n, 0)); });
}

function renderCardBlock(node, depth) {
  if (depth === undefined) depth = 0;
  var block = document.createElement('div'); block.className = 'card-block'; block.dataset.nodeId = node.id; block.dataset.depth = depth;
  if (!isNodeVisible(node)) { block.style.display = 'none'; return block; }
  block.appendChild(createCardElement(node));
  var children = getChildrenInNextCol(node);
  if (node.colIndex + 1 < state.columns.length) {
    var sc = document.createElement('div'); sc.className = 'sub-column';
    if (children.length > 0) { children.forEach(function (ch) { sc.appendChild(renderCardBlock(ch, depth + 1)); }); }
    else { var e = document.createElement('div'); e.className = 'empty-slot'; e.textContent = '\u2014'; sc.appendChild(e); }
    block.appendChild(sc);
  }
  return block;
}

function createCardElement(node) {
  var card = document.createElement('div'); card.className = 'card'; card.dataset.nodeId = node.id;

  // Кнопки действий — сверху справа (вариант Б), текст заголовка сдвинут
  if (isOwner) {
    var ac = document.createElement('div'); ac.className = 'card-actions';
    var ab = document.createElement('button'); ab.className = 'card-action-btn'; ab.textContent = '+'; ab.title = 'Добавить дочернюю карточку'; ab.addEventListener('click', function (e) { e.stopPropagation(); addChildNode(node); }); ac.appendChild(ab);
    var eb = document.createElement('button'); eb.className = 'card-action-btn'; eb.textContent = '\u270e'; eb.title = 'Редактировать'; eb.addEventListener('click', function (e) { e.stopPropagation(); openModal(node.id); }); ac.appendChild(eb);
    var db = document.createElement('button'); db.className = 'card-action-btn danger'; db.textContent = '\u2715'; db.title = 'Удалить'; db.addEventListener('click', function (e) { e.stopPropagation(); deleteNode(node.id); }); ac.appendChild(db);
    card.appendChild(ac);
  }

  var t = document.createElement('div'); t.className = 'card-title'; t.innerHTML = ht(node.title || 'Без названия'); card.appendChild(t);

  var m = document.createElement('div'); m.className = 'card-meta';

  // Статус — кликабельный чип, выпадающий список
  var sb = document.createElement('span'); sb.className = 'status-badge ' + SC[node.status]; sb.innerHTML = '<span class="status-dot ' + SD[node.status] + '"></span>' + SL[node.status];
  if (isOwner) {
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
  if (isOwner) {
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
      ], function (val) {
        if (!val) { node.dueDate = ''; }
        else if (val.indexOf('Q') === 0) { var y = prompt('Год (например 2026):', new Date().getFullYear()); if (!y) return; node.dueDate = y + ' ' + val; }
        else { node.dueDate = val; }
        scheduleSave(); updateCards(); syncHeights(); alignHeaders();
      });
    });
  }
  m.appendChild(ds);

  card.appendChild(m);

  if (node.tags.length > 0) { var td = document.createElement('div'); td.className = 'card-tags'; node.tags.forEach(function (tg) { var ts = document.createElement('span'); ts.className = 'card-tag'; ts.innerHTML = ht(tg); if (isOwner) { ts.title = 'Нажми, чтобы изменить тег'; ts.addEventListener('click', function (e) { e.stopPropagation(); openTagEditor(node.id, tg); }); } td.appendChild(ts); }); card.appendChild(td); }

  if (node.note) { var h = document.createElement('div'); h.className = 'card-hint'; h.textContent = node.note.length > 80 ? node.note.substring(0, 80) + '\u2026' : node.note; card.appendChild(h); }

  if (isOwner) card.addEventListener('click', function () { openModal(node.id); });

  return card;
}

// ──────────────────────────────────────
// 10. Header alignment & height sync
// ──────────────────────────────────────
function alignHeaders() {
  var headers = $$('.column-header'); if (!headers.length) return;
  var container = $('#columnsContainer'); if (!container) return;
  var cr = container.getBoundingClientRect();
  var prevRight = null;
  for (var ci = 0; ci < headers.length; ci++) {
    var block = container.querySelector('.card-block[data-depth="' + ci + '"]');
    var cardEl = block ? block.firstElementChild : null;
    if (cardEl && cardEl.classList.contains('card')) {
      var r = cardEl.getBoundingClientRect();
      headers[ci].style.left = (r.left - cr.left) + 'px';
      headers[ci].style.width = r.width + 'px';
      prevRight = r.right - cr.left;
    } else if (prevRight !== null) {
      headers[ci].style.left = prevRight + 'px';
      headers[ci].style.width = '260px';
      prevRight = prevRight + 268;
    } else {
      headers[ci].style.left = (ci * 268) + 'px';
      headers[ci].style.width = '260px';
      prevRight = ci * 268 + 268;
    }
  }
}

var GAP = 10, DEF_H = 60;
function syncHeights() {
  // Сброс (пакетная запись)
  var cards = $$('.card');
  for (var i = 0; i < cards.length; i++) cards[i].style.minHeight = '';
  var emptySlots = $$('.empty-slot');
  for (var e = 0; e < emptySlots.length; e++) emptySlots[e].style.minHeight = '';

  // Кеши: id -> узел и id -> DOM-элемент (убираем O(n²) поиски)
  var nodeById = {};
  var elById = {};
  state.nodes.forEach(function (n) { nodeById[n.id] = n; });
  for (var k = 0; k < cards.length; k++) {
    var cid = cards[k].getAttribute('data-node-id');
    if (cid) elById[cid] = cards[k];
  }

  // Пакетное чтение естественных высот (один раз, без thrash)
  var heights = {};
  for (var id in elById) heights[id] = elById[id].offsetHeight || DEF_H;

  // Проход справа налево
  for (var ci = state.columns.length - 2; ci >= 0; ci--) {
    state.nodes.forEach(function (p) {
      if (p.colIndex !== ci) return;
      var childIds = [];
      (p.children || []).forEach(function (cid) {
        var c = nodeById[cid];
        if (c && c.colIndex === ci + 1 && elById[cid]) childIds.push(cid);
      });
      var pc = elById[p.id];
      if (childIds.length === 0) {
        if (pc && pc.closest) {
          var bl = pc.closest('.card-block');
          if (bl) {
            var es = bl.querySelector('.sub-column > .empty-slot');
            if (es) es.style.minHeight = (heights[p.id] || DEF_H) + 'px';
          }
        }
        return;
      }
      var mx = 0;
      childIds.forEach(function (cid) { if (heights[cid] > mx) mx = heights[cid]; });
      childIds.forEach(function (cid) { elById[cid].style.minHeight = mx + 'px'; heights[cid] = mx; });
      var total = childIds.length * mx + (childIds.length - 1) * GAP;
      var own = heights[p.id] || DEF_H;
      var nh = Math.max(own, total);
      elById[p.id].style.minHeight = nh + 'px';
      heights[p.id] = nh;
    });
  }

  // Второй проход: дочка не выше родителя
  for (var ci2 = state.columns.length - 2; ci2 >= 0; ci2--) {
    state.nodes.forEach(function (p) {
      if (p.colIndex !== ci2) return;
      var childIds = [];
      (p.children || []).forEach(function (cid) {
        var c = nodeById[cid];
        if (c && c.colIndex === ci2 + 1 && elById[cid]) childIds.push(cid);
      });
      if (childIds.length === 0) return;
      var mx = 0;
      childIds.forEach(function (cid) { if (heights[cid] > mx) mx = heights[cid]; });
      var ph = heights[p.id] || DEF_H;
      var ma = Math.floor((ph - (childIds.length - 1) * GAP) / childIds.length);
      var fh = Math.max(DEF_H, Math.min(mx, ma));
      childIds.forEach(function (cid) { elById[cid].style.minHeight = fh + 'px'; heights[cid] = fh; });
      var total = childIds.length * fh + (childIds.length - 1) * GAP;
      if (total > ph) { elById[p.id].style.minHeight = total + 'px'; heights[p.id] = total; }
    });
  }
}

// ──────────────────────────────────────
// 11. CRUD
// ──────────────────────────────────────
function addChildNode(pn) {
  if (!isOwner) return;
  var ni = pn.colIndex + 1;
  if (ni >= state.columns.length) { alert('Сначала добавьте столбец справа'); return; }
  var ch = createNode(pn.id, ni, 'Новая фича'); state.nodes.push(ch); pn.children.push(ch.id);
  scheduleSave(); updateCards(); requestAnimationFrame(function () { requestAnimationFrame(function () { syncHeights(); alignHeaders(); }); }); openModal(ch.id);
}
function deleteNode(id) {
  if (!isOwner) return;
  var n = getNodeById(id); if (!n) return; var tr = new Set(); (function coll(x) { tr.add(x.id); getChildren(x.id).forEach(coll); })(n);
  if (tr.size > 1 && !confirm('Удалить карточку и ' + (tr.size - 1) + ' дочерних?')) return;
  state.nodes = state.nodes.filter(function (x) { return !tr.has(x.id); });
  state.nodes.forEach(function (x) { x.children = x.children.filter(function (cid) { return !tr.has(cid); }); });
  scheduleSave(); updateCards(); requestAnimationFrame(function () { requestAnimationFrame(function () { syncHeights(); alignHeaders(); }); });
}
function saveModal() {
  var n = getNodeById(state.editingNodeId); if (!n) return;
  n.title = $('#modalTitle').value.trim();
  n.tags = $('#modalTags').value.split(',').map(function (t) { return t.trim().toLowerCase(); }).filter(function (t) { return t; });
  // Новые теги добавляем в общий набор таблицы
  if (!state.availableTags) state.availableTags = [];
  n.tags.forEach(function (t) { if (state.availableTags.indexOf(t) === -1) state.availableTags.push(t); });
  n.note = $('#modalNote').value.trim(); n.status = $('#modalStatus').value;
  var y = $('#modalYear').value, q = $('#modalQuarter').value;
  n.dueDate = (q === 'Now' || q === 'Next' || q === 'Later') ? q : ((y && q) ? (y + ' ' + q) : '');
  closeModal(); scheduleSave(); updateCards(); renderTagFilterBar(); requestAnimationFrame(function () { requestAnimationFrame(function () { syncHeights(); alignHeaders(); }); });
}

// ──────────────────────────────────────
// 12. Modal
// ──────────────────────────────────────
function populateYearSelect() { var ys = $('#modalYear'); if (!ys) return; ys.innerHTML = '<option value="">—</option>'; var cy = new Date().getFullYear(); for (var y = cy - 2; y <= cy + 5; y++) { var o = document.createElement('option'); o.value = y; o.textContent = y; ys.appendChild(o); } }
function openModal(id) {
  var n = getNodeById(id); if (!n || !isOwner) return;
  state.editingNodeId = id; $('#modalTitle').value = n.title; $('#modalTags').value = n.tags.join(', ');
  setupTagAutocomplete();
  $('#modalNote').value = n.note; $('#modalStatus').value = n.status; populateYearSelect();
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
  if (!input) return;
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
// 13. Events
// ──────────────────────────────────────
function initEvents() {
  $('#modalClose').addEventListener('click', closeModal);
  $('#modalOverlay').addEventListener('click', function (e) { if (e.target === $('#modalOverlay')) closeModal(); });
  $('#modalSave').addEventListener('click', saveModal);
  $('#modalDelete').addEventListener('click', function () { var id = state.editingNodeId; closeModal(); if (id) deleteNode(id); });

  // Share
  $('#shareBtn').addEventListener('click', function () { $('#shareOverlay').style.display = 'flex'; loadShareList(); });
  $('#shareClose').addEventListener('click', function () { $('#shareOverlay').style.display = 'none'; });
  $('#shareDone').addEventListener('click', function () { $('#shareOverlay').style.display = 'none'; });
  $('#shareAddBtn').addEventListener('click', addShare);

  // Map selector
  var mapSel = document.getElementById('mapSelect');
  if (mapSel) mapSel.addEventListener('change', function () { selectMap(mapSel.value); });
  var newMapBtn = document.getElementById('newMapBtn');
  if (newMapBtn) newMapBtn.addEventListener('click', function () { newMap(); });
  var delMapBtn = document.getElementById('deleteMapBtn');
  if (delMapBtn) delMapBtn.addEventListener('click', function () { deleteMap(); });

  // Board title rename
  var bt = document.getElementById('boardTitle');
  if (bt && isOwner) {
    bt.title = 'Нажми, чтобы переименовать доску';
    bt.addEventListener('click', function () { bt.contentEditable = 'true'; bt.focus(); });
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
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { if ($('#modalOverlay').style.display === 'flex') closeModal(); else if ($('#shareOverlay').style.display === 'flex') $('#shareOverlay').style.display = 'none'; else if (state.searchQuery) { $('#searchInput').value = ''; state.searchQuery = ''; $('#clearSearch').style.display = 'none'; updateCards(); syncHeights(); alignHeaders(); } } });
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
  $('#exportBtn').addEventListener('click', function () { var d = JSON.stringify({ columns: state.columns, nodes: state.nodes, nextId: nextId }, null, 2); var b = new Blob([d], { type: 'application/json' }); var u = URL.createObjectURL(b); var a = document.createElement('a'); a.href = u; a.download = 'kics-feature-map-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); URL.revokeObjectURL(u); });
  $('#importBtn').addEventListener('click', function () { if (!isOwner) { alert('У тебя режим просмотра — редактирование недоступно'); return; } $('#importFile').click(); });
  $('#importFile').addEventListener('change', function (e) {
    var f = e.target.files[0]; if (!f) return; var r = new FileReader();
    r.onload = function (ev) { try { var d = JSON.parse(ev.target.result); if (!d.columns || !d.nodes) throw new Error('bad'); state.columns = d.columns; state.nodes = d.nodes; nextId = d.nextId || 1; rebuildChildren(); scheduleSave(); render(); } catch (ex) { alert('Ошибка импорта'); } };
    r.readAsText(f); e.target.value = '';
  });

  window.addEventListener('resize', function () { syncHeights(); alignHeaders(); });
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
