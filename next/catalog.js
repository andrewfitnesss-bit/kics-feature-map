// Independent preview extensions; never writes to the legacy maps table.
var collapsedBranches = new Set();
var catalogStatus = '', catalogHorizon = '';
var saving = Promise.resolve();
var dirtyRevision = 0, savedRevision = 0;
window.addEventListener('beforeunload', function (event) {
  if (dirtyRevision !== savedRevision) { event.preventDefault(); event.returnValue = ''; }
});
async function flushCatalog() {
  clearTimeout(saveTimer);
  if (dirtyRevision === savedRevision) return true;
  return await saveMapRemote() && dirtyRevision === savedRevision;
}
var originalEmptyState = setEmptyState;
setEmptyState = function () { originalEmptyState(); state.trash = []; collapsedBranches.clear(); };
// Until map-level trash is implemented, do not expose irreversible map deletion.
deleteMap = function () { showToast('Удаление целой таблицы отключено в preview. Карточки и колонки можно восстановить.', 'info'); };
function catalogFiltersActive() { return !!(state.searchQuery || state.filterTag || catalogStatus || catalogHorizon); }
function catalogMatches(node) {
  var comment = getCommentFor(node.id);
  var text = [node.title, node.note, (node.tags || []).join(' '), comment && comment.note, comment && comment.title].join(' ').toLowerCase();
  return (!state.searchQuery || text.includes(state.searchQuery.toLowerCase())) &&
    (!catalogStatus || node.status === catalogStatus) &&
    (!catalogHorizon || node.dueDate === catalogHorizon) &&
    (!state.filterTag || (node.tags || []).includes(state.filterTag));
}
isNodeVisible = function (node) {
  if (!catalogFiltersActive()) return true;
  return catalogMatches(node) || getChildren(node.id).some(isNodeVisible);
};
function rememberDeletion(label) {
  var data = JSON.parse(JSON.stringify(window.KicsModel.payload(state, nextId)));
  delete data.trash;
  state.trash = (state.trash || []).concat([{ label: label, at: new Date().toISOString(), data: data }]).slice(-20);
}
async function restoreDeletion() {
  if (!canEdit()) return;
  var entry = (state.trash || []).slice(-1)[0];
  if (!entry) return showToast('Нет снимков удаления');
  if (!await window.KicsUI.confirm({ title: 'Восстановить снимок?', message: entry.label + ' · ' + entry.at + '. Вся таблица вернётся к состоянию перед удалением. Более поздние изменения будут заменены.', confirmLabel: 'Восстановить' })) return;
  var trash = state.trash.slice(0, -1);
  applyMap({ id: state.mapId, title: state.boardTitle, data: entry.data }, true);
  state.trash = trash;
  scheduleSave(); render();
}
function setSaveStatus(text) { var el = document.getElementById('catalogSave'); if (el) el.textContent = text; }
scheduleSave = function () {
  if (!isOwner) return;
  dirtyRevision++;
  if (!state.mapId) { setSaveStatus('Создайте таблицу для сохранения'); return; }
  clearTimeout(saveTimer);
  setSaveStatus('Есть несохранённые изменения');
  saveTimer = setTimeout(saveMapRemote, 500);
};
saveMapRemote = function () {
  if (!sb || !state.mapId || !isOwner) return Promise.resolve(false);
  var revision = dirtyRevision;
  var id = state.mapId;
  var payload = JSON.parse(JSON.stringify(window.KicsModel.payload(state, nextId)));
  var title = state.boardTitle;
  saving = saving.catch(function () {}).then(async function () {
    setSaveStatus('Сохраняется…');
    try {
      var result = await sb.from('maps_next').update({ title: title, data: payload, updated_at: new Date().toISOString() }).eq('id', id).select('id');
      if (result.error || !result.data || !result.data.length) throw new Error(result.error ? result.error.message : 'Нет доступа к записи');
      if (state.mapId === id) {
        savedRevision = revision;
        setSaveStatus(dirtyRevision === revision ? 'Сохранено' : 'Есть несохранённые изменения');
      }
      return true;
    } catch (e) { setSaveStatus('Ошибка сохранения — нажмите «Повторить»'); showError(e.message); return false; }
  });
  return saving;
};
selectMap = async function (id) {
  if (!await flushCatalog()) return;
  await loadMap(id);
};
newMap = async function () {
  if (!await flushCatalog()) return;
  var title = await window.KicsUI.prompt({ title: 'Новая таблица', inputLabel: 'Название', defaultValue: 'Новая таблица', validate: function (v) { return !!v || 'Введите название'; } });
  if (title === null) return;
  try {
    var result = await sb.from('maps_next').insert({ owner_id: currentUser.id, title: title, data: { columns: defaultColumns(), nodes: [], nextId: 1, availableTags: [], trash: [] } }).select('id,title,owner_id,data').single();
    if (result.error) throw result.error;
    if (!await flushCatalog()) { showError('Новая таблица создана. Сначала сохраните текущую перед переключением.'); return; }
    state.maps.unshift(Object.assign({}, result.data, { is_owner: true }));
    applyMap(result.data, true); renderMapSelector(); render();
    setSaveStatus('Сохранено');
  } catch (e) { showError(e.message); }
};
loadMaps = async function () {
  var result = await sb.from('maps_next').select('id,title,owner_id').order('created_at', { ascending: false });
  if (result.error) { showError('Новая база не настроена или недоступна. Примените next/schema.sql. ' + result.error.message); return; }
  state.maps = (result.data || []).map(function (m) { return Object.assign(m, { is_owner: true }); });
  if (state.maps.length) await loadMap(state.maps[0].id);
  else { setEmptyState(); state.mapId = null; renderMapSelector(); render(); }
};
async function copyLegacy() {
  if (!await flushCatalog()) return;
  var result = await sb.from('maps').select('id,title').eq('owner_id', currentUser.id);
  if (result.error) return showError(result.error.message);
  var maps = result.data || [];
  if (!maps.length) return showToast('Нет исходных таблиц');
  var id = await window.KicsUI.prompt({ title: 'Копировать старую таблицу', message: maps.map(function (m) { return m.id + ' — ' + m.title; }).join('\n'), inputLabel: 'ID исходной таблицы', defaultValue: maps[0].id, validate: function (v) { return maps.some(function (m) { return m.id === v; }) || 'Выберите ID из списка'; } });
  if (!id) return;
  var source = await sb.from('maps').select('title,data').eq('id', id).eq('owner_id', currentUser.id).single();
  if (source.error) return showError(source.error.message);
  var data = JSON.parse(JSON.stringify(source.data.data)); delete data.trash;
  var inserted = await sb.from('maps_next').insert({ owner_id: currentUser.id, title: source.data.title + ' (новая версия)', data: data }).select('id,title,owner_id').single();
  if (inserted.error) return showError(inserted.error.message);
  state.maps.unshift(Object.assign(inserted.data, { is_owner: true }));
  await selectMap(inserted.data.id);
}
var baseCreateCard = createCardElement;
createCardElement = function (node) {
  var card = baseCreateCard(node);
  if (node.type === 'comment') return card;
  var controls = document.createElement('div');
  function button(label, action) {
    var b = document.createElement('button'); b.className = 'btn btn-secondary'; b.textContent = label;
    b.addEventListener('click', function (e) { e.stopPropagation(); action(); }); controls.appendChild(b);
  }
  if (getChildren(node.id).length) button(collapsedBranches.has(node.id) ? 'Развернуть' : 'Свернуть', function () {
    if (collapsedBranches.has(node.id)) collapsedBranches.delete(node.id); else collapsedBranches.add(node.id);
    render();
  });
  button('Заметка', function () {
    if (canEdit()) addComment(node.id);
    else { var c = getCommentFor(node.id); showToast(c && c.note || 'Нет заметки'); }
  });
  card.appendChild(controls); return card;
};
document.addEventListener('DOMContentLoaded', function () {
  var toolbar = document.createElement('div'); toolbar.style.cssText = 'display:flex;gap:10px;padding:12px;flex-wrap:wrap;align-items:center';
  toolbar.innerHTML = '<a href="../index.html">Выбор версии</a><button id="catalogCopy" class="btn">Копировать старую таблицу</button><button id="catalogRestore" class="btn">Восстановить удалённое</button><select id="catalogStatus" aria-label="Статус"><option value="">Все статусы</option></select><select id="catalogHorizon" aria-label="Горизонт"><option value="">Все горизонты</option></select><span id="catalogSave" role="status">Новая версия · отдельные данные</span><button id="catalogRetry" class="btn">Повторить сохранение</button>';
  document.getElementById('mainCanvas').before(toolbar);
  Object.keys(SL).forEach(function (key) { document.getElementById('catalogStatus').add(new Option(SL[key], key)); });
  ['Now','Next','Later'].forEach(function (key) { document.getElementById('catalogHorizon').add(new Option(key, key)); });
  var baseRender = render;
  render = function () {
    var select = document.getElementById('catalogHorizon');
    state.nodes.forEach(function (n) { if (n.dueDate && !Array.from(select.options).some(function (o) { return o.value === n.dueDate; })) select.add(new Option(n.dueDate, n.dueDate)); });
    baseRender();
  };
  document.getElementById('catalogStatus').onchange = function () { catalogStatus = this.value; render(); };
  document.getElementById('catalogHorizon').onchange = function () { catalogHorizon = this.value; render(); };
  document.getElementById('catalogCopy').onclick = function () { copyLegacy().catch(function (e) { showError(e.message); }); };
  document.getElementById('catalogRestore').onclick = restoreDeletion;
  document.getElementById('catalogRetry').onclick = saveMapRemote;
  toolbar.querySelector('a').onclick = async function (event) {
    event.preventDefault();
    if (await flushCatalog()) location.href = '../index.html';
  };
  document.getElementById('logoutBtn').addEventListener('click', async function (event) {
    event.stopImmediatePropagation();
    if (!await flushCatalog()) return;
    var result = await sb.auth.signOut();
    if (result.error) showError(result.error.message); else location.reload();
  }, true);
  document.getElementById('shareBtn').disabled = true;
  document.getElementById('shareBtn').title = 'Общий доступ для новой версии ещё не настроен';
});