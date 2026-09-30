/* Board branch moves share the mindmap's structural validation. */
(function () {
  'use strict';
  var dragged = null, pending = false;
  function clear() {
    document.querySelectorAll('.board-drop-valid,.board-drop-invalid,.board-dragging').forEach(function (el) {
      el.classList.remove('board-drop-valid', 'board-drop-invalid', 'board-dragging');
    });
  }
  function plan(id, parentId) {
    var tree = KicsMindmapCore.tree(state.nodes);
    var result = KicsMindmapCore.movePlan(tree, id, parentId, lastRealColIndex());
    if (tree.byId[id].parentId === result.parentId) throw new Error('Карточка уже находится у этого родителя');
    return result;
  }
  async function move(id, parentId) {
    if (!canEdit() || pending) return;
    pending = true;
    try {
      var next = plan(id, parentId), mapId = state.mapId, user = currentUser && currentUser.id;
      var before = JSON.stringify([state.nodes, state.columns]);
      var parent = parentId ? getNodeById(parentId) : null;
      var approved = await KicsUI.confirm({ title: 'Перенести ветку?',
        message: '«' + getNodeById(id).title + '» → ' + (parent ? '«' + parent.title + '»' : 'корень таблицы') + '. Карточек: ' + next.ids.length + '. Сдвиг колонок: ' + next.delta + '. Описания, заметки и дочерние карточки сохранятся.', confirmLabel: 'Перенести' });
      if (!approved) return;
      if (!canEdit() || state.mapId !== mapId || (currentUser && currentUser.id) !== user || JSON.stringify([state.nodes, state.columns]) !== before) throw new Error('Данные изменились. Повторите перенос.');
      next = plan(id, parentId);
      rememberDeletion('Перенос ветки на доске');
      getNodeById(id).parentId = next.parentId;
      next.ids.forEach(function (cid) { getNodeById(cid).colIndex += next.delta; });
      collapsedBranches.delete(parentId);
      rebuildChildren(); scheduleSave(); render();
      showToast('Ветка перенесена. Откат доступен через восстановление снимка.', 'success');
    } catch (e) { showToast(e.message, 'error'); }
    finally { pending = false; clear(); }
  }
  function wireTarget(el, parentId) {
    el.addEventListener('dragover', function (e) {
      if (!dragged || !canEdit() || dragged.map !== state.mapId || pending) return;
      e.stopPropagation();
      try { plan(dragged.id, parentId); e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('board-drop-valid'); el.classList.remove('board-drop-invalid'); }
      catch (_) { e.dataTransfer.dropEffect = 'none'; el.classList.add('board-drop-invalid'); el.classList.remove('board-drop-valid'); }
    });
    el.addEventListener('dragleave', function (e) { if (!el.contains(e.relatedTarget)) el.classList.remove('board-drop-valid', 'board-drop-invalid'); });
    el.addEventListener('drop', function (e) {
      if (!dragged) return;
      e.preventDefault(); e.stopPropagation(); var source = dragged; dragged = null; clear();
      if (source.map === state.mapId) move(source.id, parentId);
    });
  }
  var base = createCardElement;
  createCardElement = function (node) {
    var card = base(node);
    if (!canEdit() || node.type === 'comment') return card;
    var handle = document.createElement('button'); handle.type = 'button'; handle.className = 'board-drag-handle'; handle.textContent = '⠿'; handle.draggable = true;
    handle.title = 'Перетащите на нового родителя. Нажмите для выбора родителя списком.';
    handle.setAttribute('aria-label', 'Перенести ветку «' + node.title + '»');
    handle.addEventListener('click', function (e) {
      e.stopPropagation();
      var candidates = [{ value: '', label: 'В корень таблицы' }];
      state.nodes.forEach(function (n) { if (n.type !== 'comment') candidates.push({ value: n.id, label: (state.columns[n.colIndex] || {}).name + ' / ' + n.title }); });
      candidates = candidates.filter(function (c) { try { plan(node.id, c.value || null); return true; } catch (_) { return false; } });
      if (!candidates.length) return showToast('Нет допустимых родителей для этой ветки', 'info');
      openSelectMenu(handle, candidates, function (value) { move(node.id, value || null); });
    });
    handle.addEventListener('dragstart', function (e) {
      if (!canEdit() || pending) { e.preventDefault(); return; }
      dragged = { id: node.id, map: state.mapId }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/kics-board-node', node.id);
      if (e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(card, 20, 20);
      card.classList.add('board-dragging');
    });
    handle.addEventListener('dragend', function () { dragged = null; clear(); });
    card.appendChild(handle); wireTarget(card, node.id); return card;
  };
  document.addEventListener('DOMContentLoaded', function () {
    var container = document.getElementById('columnsContainer');
    if (!container) return;
    var root = document.createElement('div'); root.className = 'board-root-drop'; root.textContent = '⠿ Перенос веток: тяните за значок на карточке → на нового родителя. Для переноса в корень отпустите здесь.';
    container.parentNode.insertBefore(root, container); wireTarget(root, null);
  });
})();