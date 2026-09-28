// Catalog extensions for the main workspace (KICS v66). Persists to maps_next.
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
deleteMap = function () { showToast('Удаление целой таблицы отключено. Карточки и колонки можно восстановить.', 'info'); };
function catalogFiltersActive() { return !!(state.searchQuery || state.filterTag || catalogStatus || catalogHorizon); }
function catalogMatches(node) {
  var comment = getCommentFor(node.id);
  var text = [node.title, node.note, node.memo, (node.tags || []).join(' '), comment && comment.note, comment && comment.title].join(' ').toLowerCase();
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
  if (!await window.KicsUI.confirm({ title: 'Откатить последнее изменение?', message: entry.label + ' · ' + entry.at + '. Вся таблица вернётся к состоянию перед удалением. Более поздние изменения будут заменены.', confirmLabel: 'Откат', cancelLabel: 'Отмена' })) return;
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
    } catch (e) { setSaveStatus('Ошибка сохранения — нажмите «Сохранить»'); showError(e.message); return false; }
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
  if (result.error) { showError('База не настроена или недоступна. Примените schema.sql. ' + result.error.message); return; }
  state.maps = (result.data || []).map(function (m) { return Object.assign(m, { is_owner: true }); });
  if (state.maps.length) {
    var lastId = null;
    try { lastId = localStorage.getItem(LAST_MAP_KEY); } catch (e) {}
    var preferred = (lastId && state.maps.find(function (m) { return m.id === lastId; })) || state.maps[0];
    await loadMap(preferred.id);
  } else { setEmptyState(); state.mapId = null; renderMapSelector(); render(); }
};
// ── Сворачивание ветки: компактный переключатель со счётчиком скрытых элементов ──
function descendantCount(id) {
  var total = 0;
  getChildren(id).forEach(function (c) { total += 1 + descendantCount(c.id); });
  return total;
}

// ── Заметка «как в MS Office»: всплывающее окно при наведении ──
function showNotePopover(anchor, text) {
  var pop = document.createElement('div');
  pop.className = 'note-popover';
  var head = document.createElement('div'); head.className = 'note-popover-head'; head.textContent = 'Заметка';
  var body = document.createElement('div'); body.className = 'note-popover-body'; body.textContent = text || '(пустая заметка)';
  pop.appendChild(head); pop.appendChild(body);
  document.body.appendChild(pop);
  var r = anchor.getBoundingClientRect();
  var w = pop.offsetWidth, h = pop.offsetHeight;
  var left = Math.min(window.innerWidth - w - 8, Math.max(8, r.right - w));
  var top = r.top - h - 8;
  if (top < 8) top = r.bottom + 8;
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  return pop;
}

var hideNotes = false;
var baseCreateCard = createCardElement;
createCardElement = function (node) {
  var card = baseCreateCard(node);
  if (node.type === 'comment') return card;

  var hasChildren = getChildren(node.id).length > 0;
  if (!hasChildren && hideNotes) return card;

  var footer = document.createElement('div');
  footer.className = 'card-footer';

  // Сворачивание — компактный переключатель со счётчиком скрытых элементов
  if (hasChildren) {
    var collapsed = collapsedBranches.has(node.id);
    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'collapse-toggle' + (collapsed ? ' is-collapsed' : '');
    toggle.setAttribute('aria-label', collapsed ? 'Развернуть ветку' : 'Свернуть ветку');
    toggle.title = collapsed ? 'Развернуть ветку' : 'Свернуть ветку';
    toggle.innerHTML = '<span class="collapse-chev">' + (collapsed ? '\u25B8' : '\u25BE') + '</span>';
    if (collapsed) {
      var count = document.createElement('span');
      count.className = 'collapse-count';
      count.textContent = String(descendantCount(node.id));
      toggle.appendChild(count);
    }
    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      if (collapsedBranches.has(node.id)) collapsedBranches.delete(node.id); else collapsedBranches.add(node.id);
      render();
    });
    footer.appendChild(toggle);
  }

  // Жёлтый значок заметки — на каждой карточке, всегда справа внизу
  if (!hideNotes) {
    var badge = document.createElement('span');
    badge.className = 'card-note-badge' + (node.memo ? ' has-note' : '');
    badge.title = node.memo || 'Добавить заметку';
    badge.setAttribute('role', 'button');
    badge.setAttribute('aria-label', node.memo ? ('Заметка: ' + node.memo) : 'Добавить заметку');
    badge.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h16a1 1 0 0 1 1 1v10l-6 6H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 14h6l-6 6z"/></svg>';
    var pop = null;
    if (node.memo) {
      badge.addEventListener('mouseenter', function () { pop = showNotePopover(badge, node.memo); });
      badge.addEventListener('mouseleave', function () { if (pop) { pop.remove(); pop = null; } });
    }
    badge.addEventListener('click', function (e) {
      e.stopPropagation();
      if (canEdit()) openNoteEditor(node.id);
      else if (node.memo) { pop = showNotePopover(badge, node.memo); }
    });
    footer.appendChild(badge);
  }

  card.appendChild(footer);
  return card;
};

document.addEventListener('DOMContentLoaded', function () {
  var statusSel = document.getElementById('catalogStatus');
  var horizonSel = document.getElementById('catalogHorizon');
  if (statusSel) Object.keys(SL).forEach(function (key) { statusSel.add(new Option(SL[key], key)); });
  if (horizonSel) ['Now','Next','Later'].forEach(function (key) { horizonSel.add(new Option(key, key)); });

  var baseRender = render;
  render = function () {
    if (horizonSel) state.nodes.forEach(function (n) { if (n.dueDate && !Array.from(horizonSel.options).some(function (o) { return o.value === n.dueDate; })) horizonSel.add(new Option(n.dueDate, n.dueDate)); });
    baseRender();
  };

  if (statusSel) statusSel.onchange = function () { catalogStatus = this.value; render(); };
  if (horizonSel) horizonSel.onchange = function () { catalogHorizon = this.value; render(); };

  var restoreBtn = document.getElementById('catalogRestore');
  if (restoreBtn) restoreBtn.onclick = restoreDeletion;
  var retryBtn = document.getElementById('catalogRetry');
  if (retryBtn) retryBtn.onclick = saveMapRemote;

  // Скрыть заметки — переключатель отображения (не удаляет данные, столбец справа не меняется)
  var hideNotesBtn = document.getElementById('hideNotesBtn');
  if (hideNotesBtn) {
    var updateHideNotesLabel = function () {
      hideNotesBtn.innerHTML = '<span>' + (hideNotes ? '👁' : '🙈') + '</span>' + (hideNotes ? 'Показать заметки' : 'Скрыть заметки');
    };
    updateHideNotesLabel();
    hideNotesBtn.onclick = function () {
      hideNotes = !hideNotes;
      updateHideNotesLabel();
      render();
    };
  }

  var shareBtn = document.getElementById('shareBtn');
  if (shareBtn) { shareBtn.disabled = true; shareBtn.title = 'Общий доступ пока не настроен'; }

  var logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', async function (event) {
    event.stopImmediatePropagation();
    if (!await flushCatalog()) return;
    var result = await sb.auth.signOut();
    if (result.error) showError(result.error.message); else location.reload();
  }, true);
});