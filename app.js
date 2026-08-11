/**
 * KICS Feature Map — Feature planning tool for PMs
 * Pure HTML/CSS/JS — localStorage persistence
 * v11 — fixed header alignment on reload
 */

const LS_KEY = 'kics_feature_map';

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
};
let nextId = 1;
function nid() { return 'n' + (nextId++); }

function createNode(parentId, colIndex, title) {
  return { id: nid(), parentId: parentId || null, colIndex, title: title || '', tags: [], status: 'none', dueDate: '', note: '', children: [] };
}

function saveState() { localStorage.setItem(LS_KEY, JSON.stringify({ columns: state.columns, nodes: state.nodes, nextId })); }
function loadState() { try { var d = JSON.parse(localStorage.getItem(LS_KEY)); if (d) { state.columns = d.columns; state.nodes = d.nodes; nextId = d.nextId || 1; rebuildChildren(); return true; } } catch (e) {} return false; }
function rebuildChildren() { state.nodes.forEach(function (n) { n.children = []; }); state.nodes.forEach(function (n) { if (n.parentId) { var p = state.nodes.find(function (x) { return x.id === n.parentId; }); if (p && p.children.indexOf(n.id) === -1) p.children.push(n.id); } }); }

function loadDemoData() {
  localStorage.removeItem(LS_KEY);
  state.columns = [{ id: 'col0', name: 'Функциональная область' }, { id: 'col1', name: 'Верхнеуровневая фича' }, { id: 'col2', name: 'Фича' }, { id: 'col3', name: 'Сабфича' }, { id: 'col4', name: 'Комментарий' }];
  state.nodes = []; nextId = 1;
  function add(pid, col, title, tags, status, due, note) {
    var n = createNode(pid, col, title); n.tags = tags || []; n.status = status || 'none'; n.dueDate = due || ''; n.note = note || ''; state.nodes.push(n);
    if (pid) { var p = state.nodes.find(function (x) { return x.id === pid; }); if (p) p.children.push(n.id); } return n.id;
  }
  var d1 = add(null, 0, 'Доступ и аутентификация', ['access', 'core'], 'done', '2025 Q4', 'Центральный домен управления доступом');
  var a1 = add(d1, 1, 'Единый вход (SSO)', ['sso', 'core'], 'done', '2025 Q4', ''); add(a1, 2, 'SAML 2.0 интеграция', ['saml', 'protocol'], 'done', '2025 Q3', ''); add(a1, 2, 'OIDC / OAuth 2.0', ['oidc', 'oauth', 'protocol'], 'done', '2025 Q4', ''); add(a1, 2, 'Kerberos / SPNEGO', ['kerberos', 'windows'], 'done', '2026 Q1', '');
  var a2 = add(d1, 1, 'Многофакторная аутентификация (MFA)', ['mfa', 'security'], 'wip', '2026 Q3', ''); add(a2, 2, 'TOTP / HOTP', ['totp', 'otp'], 'done', '2025 Q4', ''); add(a2, 2, 'FIDO2 / WebAuthn', ['fido2', 'webauthn', 'passwordless'], 'wip', '2026 Q2', ''); add(a2, 2, 'Push-уведомления', ['push', 'mobile'], 'planned', '2026 Q4', ''); add(a2, 2, 'Аппаратные ключи (YubiKey)', ['yubikey', 'hardware'], 'wip', '2026 Q3', '');
  var a3 = add(d1, 1, 'Ролевая модель (RBAC/ABAC)', ['rbac', 'abac', 'authz'], 'planned', '2026 Q2', ''); add(a3, 2, 'Конструктор ролей', ['ui', 'builder'], 'planned', '2026 Q2', ''); add(a3, 2, 'Политики на основе атрибутов', ['abac', 'policy'], 'planned', '2026 Q3', '');
  var d2 = add(null, 0, 'Мониторинг и SIEM', ['monitoring', 'siem', 'core'], 'wip', '2026 Q3', '');
  var b1 = add(d2, 1, 'Сбор событий', ['events', 'collection'], 'done', '2025 Q4', ''); add(b1, 2, 'Syslog-коллектор', ['syslog', 'collector'], 'done', '2025 Q3', ''); add(b1, 2, 'Windows Event Log', ['windows', 'eventlog'], 'done', '2025 Q4', ''); add(b1, 2, 'Агент для Linux', ['agent', 'linux'], 'wip', '2026 Q1', ''); add(b1, 2, 'API-коннекторы', ['api', 'connector', 'cloud'], 'planned', '2026 Q3', '');
  var b2 = add(d2, 1, 'Корреляция событий', ['correlation', 'analytics'], 'wip', '2026 Q2', ''); add(b2, 2, 'Правила корреляции', ['rules', 'ui', 'builder'], 'wip', '2026 Q2', ''); add(b2, 2, 'ML-модели аномалий', ['ml', 'anomaly', 'ai'], 'planned', '2026 Q4', '');
  var b3 = add(d2, 1, 'Дашборды и отчёты', ['dashboards', 'reports', 'visualization'], 'wip', '2026 Q2', ''); add(b3, 2, 'Конструктор дашбордов', ['ui', 'widgets'], 'wip', '2026 Q1', ''); add(b3, 2, 'Экспорт в PDF/CSV', ['export', 'pdf', 'csv'], 'done', '2025 Q4', ''); add(b3, 2, 'Рассылка отчётов', ['schedule', 'email'], 'planned', '2026 Q3', '');
  var d3 = add(null, 0, 'Управление уязвимостями', ['vuln', 'core'], 'wip', '2026 Q4', '');
  var c1 = add(d3, 1, 'Сканирование узлов', ['scan', 'scanner'], 'wip', '2026 Q2', ''); add(c1, 2, 'Сетевой сканер', ['nmap', 'network'], 'done', '2026 Q1', ''); add(c1, 2, 'Сканер веб-приложений', ['web', 'appsec'], 'wip', '2026 Q3', ''); add(c1, 2, 'Сканер контейнеров', ['containers', 'docker'], 'planned', '2026 Q4', '');
  var c2 = add(d3, 1, 'Приоритизация уязвимостей', ['prioritization', 'risk'], 'planned', '2026 Q3', ''); add(c2, 2, 'CVSS / EPSS scoring', ['cvss', 'epss', 'scoring'], 'planned', '2026 Q2', ''); add(c2, 2, 'Asset-based приоритизация', ['asset', 'context'], 'planned', '2026 Q4', '');
  var c3 = add(d3, 1, 'Patch Management', ['patching', 'remediation'], 'planned', '2026 Q4', ''); add(c3, 2, 'Интеграция с WSUS / SCCM', ['wsus', 'sccm', 'integration'], 'planned', '2026 Q4', '');
  rebuildChildren(); saveState();
}

function getNodesByCol(i) { return state.nodes.filter(function (n) { return n.colIndex === i; }); }
function getChildren(pid) { return state.nodes.filter(function (n) { return n.parentId === pid; }); }
function getNodeById(id) { return state.nodes.find(function (n) { return n.id === id; }); }
function getChildrenInNextCol(node) { return (node.children || []).map(function (cid) { return getNodeById(cid); }).filter(function (c) { return c && c.colIndex === node.colIndex + 1; }); }
function nodeMatchesFilter(node) { if (state.searchQuery) { var q = state.searchQuery.toLowerCase(); if (node.title.toLowerCase().indexOf(q) === -1 && node.note.toLowerCase().indexOf(q) === -1 && !node.tags.some(function (t) { return t.toLowerCase().indexOf(q) !== -1; })) return false; } var ct = state.selectedTags[node.colIndex]; if (ct && ct.size > 0 && !node.tags.some(function (t) { return ct.has(t); })) return false; return true; }
function isNodeOrDescendantVisible(node) { if (nodeMatchesFilter(node)) return true; for (var i = 0; i < (node.children || []).length; i++) { var c = getNodeById(node.children[i]); if (c && isNodeOrDescendantVisible(c)) return true; } return false; }
function hasAnyFilter() { if (state.searchQuery) return true; for (var k in state.selectedTags) { if (state.selectedTags[k] && state.selectedTags[k].size > 0) return true; } return false; }

var $ = function (s) { return document.querySelector(s); }, $$ = function (s) { return document.querySelectorAll(s); };
var SL = { done: 'Реализовано', wip: 'В работе', planned: 'Запланировано', none: 'Не начато' };
var SC = { done: 'status-done', wip: 'status-wip', planned: 'status-planned', none: 'status-none' };
var SD = { done: 'status-dot-done', wip: 'status-dot-wip', planned: 'status-dot-planned', none: 'status-dot-none' };
function ht(t) { if (!state.searchQuery) return eh(t); var q = state.searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return eh(t).replace(new RegExp('(' + q + ')', 'gi'), '<mark>$1</mark>'); }
function eh(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ──────────────────────────────
// RENDER
// ──────────────────────────────
function render() { renderColumns(); requestAnimationFrame(function () { requestAnimationFrame(function () { syncHeights(); alignHeaders(); }); }); }

function renderColumns() {
  var c = $('#columnsContainer'); c.innerHTML = '';
  var hr = document.createElement('div'); hr.className = 'columns-headers';
  state.columns.forEach(function (col, i) {
    var h = document.createElement('div'); h.className = 'column-header';
    h.innerHTML = '<span>' + eh(col.name) + '</span>';
    var ha = document.createElement('div'); ha.className = 'column-header-actions';
    if (i === 0) { var btn = document.createElement('button'); btn.className = 'column-header-btn'; btn.textContent = '+'; btn.addEventListener('click', function (e) { e.stopPropagation(); var n = createNode(null, 0, 'Новая область'); state.nodes.push(n); saveState(); render(); openModal(n.id); }); ha.appendChild(btn); }
    if (i >= 5) { var db = document.createElement('button'); db.className = 'column-header-btn'; db.textContent = '\u2715'; db.style.color = 'var(--red)'; db.addEventListener('click', function (e) { e.stopPropagation(); if (confirm('Удалить "' + col.name + '"?')) { var tr = new Set(getNodesByCol(i).map(function (n) { return n.id; })); state.nodes = state.nodes.filter(function (n) { return !tr.has(n.id); }); state.nodes.forEach(function (n) { n.children = n.children.filter(function (cid) { return !tr.has(cid); }); }); state.columns = state.columns.filter(function (x) { return x.id !== col.id; }); saveState(); render(); } }); ha.appendChild(db); }
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
  if (hasAnyFilter() && !isNodeOrDescendantVisible(node)) { block.style.display = 'none'; return block; }
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
  var ac = document.createElement('div'); ac.className = 'card-actions';
  var ab = document.createElement('button'); ab.className = 'card-action-btn'; ab.textContent = '+'; ab.addEventListener('click', function (e) { e.stopPropagation(); addChildNode(node); }); ac.appendChild(ab);
  var eb = document.createElement('button'); eb.className = 'card-action-btn'; eb.textContent = '\u270e'; eb.addEventListener('click', function (e) { e.stopPropagation(); openModal(node.id); }); ac.appendChild(eb);
  var db = document.createElement('button'); db.className = 'card-action-btn danger'; db.textContent = '\u2715'; db.addEventListener('click', function (e) { e.stopPropagation(); deleteNode(node.id); }); ac.appendChild(db);
  card.appendChild(ac);
  var t = document.createElement('div'); t.className = 'card-title'; t.innerHTML = ht(node.title || 'Без названия'); card.appendChild(t);
  var m = document.createElement('div'); m.className = 'card-meta';
  var sb = document.createElement('span'); sb.className = 'status-badge ' + SC[node.status]; sb.innerHTML = '<span class="status-dot ' + SD[node.status] + '"></span>' + SL[node.status]; m.appendChild(sb);
  if (node.dueDate) { var ds = document.createElement('span'); ds.style.cssText = 'font-size:11px;color:var(--text-secondary)'; ds.textContent = node.dueDate; m.appendChild(ds); }
  card.appendChild(m);
  if (node.tags.length > 0) { var td = document.createElement('div'); td.className = 'card-tags'; node.tags.forEach(function (tg) { var ts = document.createElement('span'); ts.className = 'card-tag'; ts.innerHTML = ht(tg); td.appendChild(ts); }); card.appendChild(td); }
  if (node.note) { var h = document.createElement('div'); h.className = 'card-hint'; h.textContent = node.note.length > 80 ? node.note.substring(0, 80) + '\u2026' : node.note; card.appendChild(h); }
  card.addEventListener('click', function () { openModal(node.id); });
  return card;
}

// ──────────────────────────────
// HEADER ALIGNMENT
// ──────────────────────────────
function alignHeaders() {
  var headers = $$('.column-header'); if (!headers.length) return;
  var container = $('#columnsContainer'); if (!container) return;
  var cr = container.getBoundingClientRect();
  var prevRight = null;

  for (var ci = 0; ci < headers.length; ci++) {
    var block = container.querySelector('.card-block[data-depth="' + ci + '"]');
    if (!block) block = container.querySelector('.card-block[data-depth="' + ci + '"]');
    var cardEl = block ? block.firstElementChild : null;

    if (cardEl && cardEl.classList.contains('card')) {
      var r = cardEl.getBoundingClientRect();
      var left = r.left - cr.left;
      headers[ci].style.left = left + 'px';
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

// ──────────────────────────────
// HEIGHT SYNC
// ──────────────────────────────
var GAP = 10, DEF_H = 60;
function syncHeights() {
  $$('.card').forEach(function (c) { c.style.minHeight = ''; });
  $$('.empty-slot').forEach(function (e) { e.style.minHeight = ''; });
  for (var ci = state.columns.length - 2; ci >= 0; ci--) {
    getNodesByCol(ci).forEach(function (p) {
      var ch = getChildrenInNextCol(p); var pc = document.querySelector('.card[data-node-id="' + p.id + '"]'); if (!pc) return;
      var pn = pc.offsetHeight || DEF_H;
      if (ch.length === 0) { var bl = pc.closest('.card-block'); if (bl) { var es = bl.querySelector('.sub-column > .empty-slot'); if (es) es.style.minHeight = pn + 'px'; } }
      else { var cc = ch.map(function (c) { return document.querySelector('.card[data-node-id="' + c.id + '"]'); }).filter(function (c) { return c && c.offsetParent !== null; }); if (!cc.length) return;
        var mx = 0; cc.forEach(function (c) { var h = c.offsetHeight; if (h > mx) mx = h; }); cc.forEach(function (c) { c.style.minHeight = mx + 'px'; });
        pc.style.minHeight = Math.max(pn, cc.length * mx + (cc.length - 1) * GAP) + 'px'; }
    });
  }
  for (var ci2 = state.columns.length - 2; ci2 >= 0; ci2--) {
    getNodesByCol(ci2).forEach(function (p) {
      var ch = getChildrenInNextCol(p); if (!ch.length) return; var pc = document.querySelector('.card[data-node-id="' + p.id + '"]'); if (!pc) return;
      var cc = ch.map(function (c) { return document.querySelector('.card[data-node-id="' + c.id + '"]'); }).filter(function (c) { return c && c.offsetParent !== null; }); if (!cc.length) return;
      var mx = 0; cc.forEach(function (c) { var h = c.offsetHeight; if (h > mx) mx = h; });
      var ph = pc.offsetHeight; var ma = Math.floor((ph - (cc.length - 1) * GAP) / cc.length); var fh = Math.min(mx, ma);
      cc.forEach(function (c) { c.style.minHeight = fh + 'px'; });
      var th = cc.length * fh + (cc.length - 1) * GAP; if (th > ph) pc.style.minHeight = th + 'px';
    });
  }
}

// ── CRUD ──
function addChildNode(pn) { var ni = pn.colIndex + 1; if (ni >= state.columns.length) { alert('Сначала добавьте столбец справа'); return; } var ch = createNode(pn.id, ni, 'Новая фича'); state.nodes.push(ch); pn.children.push(ch.id); saveState(); updateCards(); requestAnimationFrame(function () { requestAnimationFrame(function () { syncHeights(); alignHeaders(); }); }); openModal(ch.id); }
function deleteNode(id) { var n = getNodeById(id); if (!n) return; var tr = new Set(); (function coll(x) { tr.add(x.id); getChildren(x.id).forEach(coll); })(n); if (tr.size > 1 && !confirm('Удалить карточку и ' + (tr.size - 1) + ' дочерних?')) return; state.nodes = state.nodes.filter(function (x) { return !tr.has(x.id); }); state.nodes.forEach(function (x) { x.children = x.children.filter(function (cid) { return !tr.has(cid); }); }); saveState(); updateCards(); requestAnimationFrame(function () { requestAnimationFrame(function () { syncHeights(); alignHeaders(); }); }); }

// ── Modal ──
function populateYearSelect() { var ys = $('#modalYear'); if (!ys) return; ys.innerHTML = '<option value="">—</option>'; var cy = new Date().getFullYear(); for (var y = cy - 2; y <= cy + 5; y++) { var o = document.createElement('option'); o.value = y; o.textContent = y; ys.appendChild(o); } }
function openModal(id) { var n = getNodeById(id); if (!n) return; state.editingNodeId = id; $('#modalTitle').value = n.title; $('#modalTags').value = n.tags.join(', '); $('#modalNote').value = n.note; $('#modalStatus').value = n.status; populateYearSelect(); var m = n.dueDate.match(/^(\d{4})\s+(Q[1-4])$/); if (m) { $('#modalYear').value = m[1]; $('#modalQuarter').value = m[2]; } else { $('#modalYear').value = ''; $('#modalQuarter').value = ''; } $('#modalOverlay').style.display = 'flex'; }
function closeModal() { $('#modalOverlay').style.display = 'none'; state.editingNodeId = null; }
function saveModal() { var n = getNodeById(state.editingNodeId); if (!n) return; n.title = $('#modalTitle').value.trim(); n.tags = $('#modalTags').value.split(',').map(function (t) { return t.trim().toLowerCase(); }).filter(function (t) { return t; }); n.note = $('#modalNote').value.trim(); n.status = $('#modalStatus').value; var y = $('#modalYear').value, q = $('#modalQuarter').value; n.dueDate = y && q ? y + ' ' + q : ''; saveState(); closeModal(); updateCards(); requestAnimationFrame(function () { requestAnimationFrame(function () { syncHeights(); alignHeaders(); }); }); }

// ── Events ──
function initEvents() {
  $('#modalClose').addEventListener('click', closeModal);
  $('#modalOverlay').addEventListener('click', function (e) { if (e.target === $('#modalOverlay')) closeModal(); });
  $('#modalSave').addEventListener('click', saveModal);
  $('#modalDelete').addEventListener('click', function () { var id = state.editingNodeId; closeModal(); if (id) deleteNode(id); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { if ($('#modalOverlay').style.display === 'flex') closeModal(); else if (state.searchQuery) { $('#searchInput').value = ''; state.searchQuery = ''; $('#clearSearch').style.display = 'none'; updateCards(); syncHeights(); alignHeaders(); } } });
  $('#searchInput').addEventListener('input', function () { state.searchQuery = $('#searchInput').value.trim(); $('#clearSearch').style.display = state.searchQuery ? 'block' : 'none'; updateCards(); syncHeights(); alignHeaders(); });
  $('#clearSearch').addEventListener('click', function () { $('#searchInput').value = ''; state.searchQuery = ''; $('#clearSearch').style.display = 'none'; updateCards(); syncHeights(); alignHeaders(); });
  $('#exportBtn').addEventListener('click', function () { var d = JSON.stringify({ columns: state.columns, nodes: state.nodes, nextId: nextId }, null, 2); var b = new Blob([d], { type: 'application/json' }); var u = URL.createObjectURL(b); var a = document.createElement('a'); a.href = u; a.download = 'kics-feature-map-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); URL.revokeObjectURL(u); });
  $('#importBtn').addEventListener('click', function () { $('#importFile').click(); });
  $('#importFile').addEventListener('change', function (e) { var f = e.target.files[0]; if (!f) return; var r = new FileReader(); r.onload = function (ev) { try { var d = JSON.parse(ev.target.result); if (!d.columns || !d.nodes) throw new Error('bad'); state.columns = d.columns; state.nodes = d.nodes; nextId = d.nextId || 1; rebuildChildren(); state.selectedTags = {}; state.searchQuery = ''; $('#searchInput').value = ''; saveState(); render(); } catch (ex) { alert('Ошибка импорта'); } }; r.readAsText(f); e.target.value = ''; });
  $('#resetDemoBtn').addEventListener('click', function () { if (confirm('Сбросить к демо?')) { state.selectedTags = {}; state.searchQuery = ''; $('#searchInput').value = ''; loadDemoData(); render(); } });
  window.addEventListener('resize', function () { syncHeights(); alignHeaders(); });
}

function init() { if (!loadState()) loadDemoData(); render(); initEvents(); window.addEventListener('load', function () { syncHeights(); alignHeaders(); }); }
document.addEventListener('DOMContentLoaded', init);