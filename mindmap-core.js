(function (root) {
  'use strict';
  function hash(id) { return Array.from(String(id)).reduce(function (h, c) { return ((h * 31 + c.charCodeAt(0)) >>> 0); }, 0); }
  function tree(nodes) {
    var byId = Object.create(null), children = Object.create(null), roots = [];
    nodes.filter(function (n) { return n.type !== 'comment'; }).forEach(function (n) { byId[n.id] = n; children[n.id] = []; });
    Object.keys(byId).forEach(function (id) {
      var n = byId[id];
      if (byId[n.parentId] && n.parentId !== id) children[n.parentId].push(id); else roots.push(id);
    });
    return { byId: byId, children: children, roots: roots };
  }
  function descendants(t, id) {
    var seen = new Set(), stack = [id];
    while (stack.length) { var x = stack.pop(); if (seen.has(x) || !t.byId[x]) continue; seen.add(x); stack.push.apply(stack, t.children[x] || []); }
    return seen;
  }
  function project(t, opt) {
    var allowed = opt.focus ? descendants(t, opt.focus) : new Set(Object.keys(t.byId));
    var matches = [], keep = new Set(), query = (opt.query || '').toLowerCase().trim();
    allowed.forEach(function (id) {
      var n = t.byId[id];
      if ((!query || [n.title, n.note, n.memo, (n.tags || []).join(' ')].join(' ').toLowerCase().includes(query)) && (!opt.status || n.status === opt.status)) {
        matches.push(id); var cur = id, seen = new Set();
        while (cur && allowed.has(cur) && !seen.has(cur)) { seen.add(cur); keep.add(cur); cur = t.byId[cur].parentId; }
      }
    });
    var filtered = !!(query || opt.status), items = [], visited = new Set();
    function walk(id, depth, branch, side) {
      if (visited.has(id) || !allowed.has(id) || (filtered && !keep.has(id))) return;
      visited.add(id); items.push({ id: id, node: t.byId[id], depth: depth, branch: branch, side: side });
      if (!filtered && opt.collapsed.has(id)) return;
      (t.children[id] || []).forEach(function (cid) { walk(cid, depth + 1, branch, side); });
    }
    (opt.focus && t.byId[opt.focus] ? [opt.focus] : t.roots).forEach(function (id) { walk(id, 1, id, opt.layout === 'right' || hash(id) % 2 === 0 ? 'right' : 'left'); });
    return { items: items, matches: matches };
  }
  function layout(items, sizes, gap) {
    var byId = Object.create(null), kids = Object.create(null), spans = Object.create(null), positions = Object.create(null);
    items.forEach(function (i) { byId[i.id] = i; kids[i.id] = []; });
    var roots = items.filter(function (i) { if (byId[i.node.parentId]) { kids[i.node.parentId].push(i.id); return false; } return true; });
    function span(id) { return spans[id] = Math.max(sizes[id].height, kids[id].reduce(function (s, c) { return s + span(c); }, 0) + Math.max(0, kids[id].length - 1) * gap); }
    roots.forEach(function (i) { span(i.id); });
    function place(id, top) {
      var i = byId[id], size = sizes[id];
      positions[id] = { id: id, x: (i.side === 'left' ? -1 : 1) * i.depth * 320, y: top + spans[id] / 2, width: size.width, height: size.height, side: i.side, depth: i.depth };
      var total = kids[id].reduce(function (s, c) { return s + spans[c]; }, 0) + Math.max(0, kids[id].length - 1) * gap;
      var cursor = top + (spans[id] - total) / 2;
      kids[id].forEach(function (c) { place(c, cursor); cursor += spans[c] + gap; });
    }
    ['left', 'right'].forEach(function (side) {
      var list = roots.filter(function (i) { return i.side === side; });
      var cursor = -(list.reduce(function (s, i) { return s + spans[i.id]; }, 0) + Math.max(0, list.length - 1) * gap) / 2;
      list.forEach(function (i) { place(i.id, cursor); cursor += spans[i.id] + gap; });
    });
    positions.__center__ = { id: '__center__', x: 0, y: 0, width: 250, height: 76, side: 'center', depth: 0 };
    return positions;
  }
  function movePlan(t, id, parentId, lastColumn) {
    var n = t.byId[id], p = t.byId[parentId];
    if (!n || (parentId && !p)) throw new Error('Карточка не найдена');
    var ids = descendants(t, id);
    if (ids.has(parentId)) throw new Error('Нельзя перенести ветку в саму себя');
    var delta = (p ? p.colIndex + 1 : 0) - n.colIndex;
    ids.forEach(function (cid) { var col = t.byId[cid].colIndex + delta; if (col < 0 || col > lastColumn) throw new Error('Недостаточно колонок для переноса всей ветки'); });
    return { ids: Array.from(ids), delta: delta, parentId: parentId || null };
  }
  var api = { hash: hash, tree: tree, descendants: descendants, project: project, layout: layout, movePlan: movePlan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KicsMindmapCore = api;
})(typeof window !== 'undefined' ? window : globalThis);