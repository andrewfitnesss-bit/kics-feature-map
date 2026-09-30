/* Rich descriptions: allowlisted HTML plus plain-text compatibility for AI/search. */
(function () {
  'use strict';
  var LIMIT = 1500000;
  var allowed = new Set('P DIV BR STRONG B EM I U S STRIKE H1 H2 H3 H4 H5 H6 UL OL LI BLOCKQUOTE PRE CODE A IMG TABLE THEAD TBODY TFOOT TR TD TH HR SPAN SUB SUP'.split(' '));
  var blocked = new Set('SCRIPT STYLE IFRAME OBJECT EMBED SVG MATH FORM INPUT BUTTON TEXTAREA SELECT LINK META BASE TEMPLATE NOSCRIPT'.split(' '));
  function url(value, image, base) {
    value = String(value || '').trim();
    if (image && /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(value) && value.length < 700000) return value;
    try { var u = new URL(value, base || undefined); if (u.username || u.password) return ''; return (image ? u.protocol === 'https:' : ['https:', 'http:', 'mailto:'].includes(u.protocol)) ? u.href : ''; } catch (_) { return ''; }
  }
  function sanitize(html, base) {
    if (String(html).length > LIMIT) throw new Error('Описание слишком большое: максимум 1,5 млн символов HTML. Используйте ссылки на крупные изображения.');
    var source = document.createElement('template'); source.innerHTML = String(html || '');
    var out = document.createElement('div');
    function copy(input, target, depth) {
      if (depth > 80) { target.appendChild(document.createTextNode(input.textContent || '')); return; }
      if (input.nodeType === 3) { target.appendChild(document.createTextNode(input.data)); return; }
      if (input.nodeType !== 1 || blocked.has(input.tagName)) return;
      if (!allowed.has(input.tagName)) { Array.from(input.childNodes).forEach(function (n) { copy(n, target, depth + 1); }); return; }
      var el = document.createElement(input.tagName.toLowerCase());
      if (input.tagName === 'A') { var href = url(input.getAttribute('href'), false, base); if (href) { el.setAttribute('href', href); el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); } }
      if (input.tagName === 'IMG') {
        var src = url(input.getAttribute('src'), true, base);
        if (!src) { target.appendChild(document.createTextNode('[Изображение: ссылка недоступна]')); return; }
        el.setAttribute('src', src); el.setAttribute('alt', (input.getAttribute('alt') || 'Изображение').slice(0, 500)); el.setAttribute('loading', 'lazy'); el.setAttribute('referrerpolicy', 'no-referrer');
      }
      ['colspan', 'rowspan', 'start'].forEach(function (a) { var v = input.getAttribute(a); if (/^\d{1,3}$/.test(v || '')) el.setAttribute(a, String(Math.max(1, Math.min(100, Number(v))))); });
      var s = input.style;
      if (s) {
        if (/^(bold|[6-9]00)$/.test(s.fontWeight)) el.style.fontWeight = 'bold';
        if (s.fontStyle === 'italic') el.style.fontStyle = 'italic';
        if (/^(underline|line-through)$/.test(s.textDecorationLine)) el.style.textDecorationLine = s.textDecorationLine;
        if (/^(left|right|center|justify)$/.test(s.textAlign)) el.style.textAlign = s.textAlign;
        if (/^(pre|pre-wrap|break-spaces)$/.test(s.whiteSpace)) el.style.whiteSpace = 'pre-wrap';
        ['marginLeft', 'paddingLeft'].forEach(function (a) { if (/^\d{1,3}(\.\d+)?(px|pt|em)$/.test(s[a])) { var amount = parseFloat(s[a]); el.style.marginLeft = Math.min(160, amount * (s[a].endsWith('em') ? 16 : s[a].endsWith('pt') ? 1.33 : 1)) + 'px'; } });
      }
      Array.from(input.childNodes).forEach(function (n) { copy(n, el, depth + 1); }); target.appendChild(el);
    }
    Array.from(source.content.childNodes).forEach(function (n) { copy(n, out, 0); }); return out.innerHTML;
  }
  function plain(html) {
    var root = document.createElement('template'); root.innerHTML = html;
    function text(n) {
      if (n.nodeType === 3) return n.data;
      if (n.nodeType !== 1 && n.nodeType !== 11) return '';
      if (n.nodeName === 'BR') return '\n';
      if (n.nodeName === 'IMG') return '[Изображение: ' + (n.getAttribute('alt') || '') + ']';
      var result = Array.from(n.childNodes).map(text).join('');
      if (n.nodeName === 'LI') result = '• ' + result;
      if (/^(TD|TH)$/.test(n.nodeName)) return result + '\t';
      if (/^(P|DIV|H[1-6]|LI|BLOCKQUOTE|PRE|TR|UL|OL|TABLE)$/.test(n.nodeName)) return result + '\n';
      return result;
    }
    return text(root.content).replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
  }
  function fromText(text) { var el = document.createElement('div'); el.textContent = String(text || ''); return el.innerHTML.replace(/\n/g, '<br>'); }
  function getHtml(node) { return node && node.noteHtmlText === node.note && typeof node.noteHtml === 'string' ? sanitize(node.noteHtml) : fromText(node && node.note); }
  function assignHtml(node, html, base) { var clean = sanitize(html, base); node.note = plain(clean); node.noteHtml = clean; node.noteHtmlText = node.note; node.noteFormat = 'html-v1'; }
  function clearRich(node) { delete node.noteHtml; delete node.noteHtmlText; delete node.noteFormat; }
  function renderDescription(el, node) { el.classList.add('rich-content'); el.innerHTML = getHtml(node); }
  var editor, hidden, session, initial = '', range, toolbar;
  function sync() { hidden.value = plain(sanitize(editor.innerHTML)); document.getElementById('descriptionCount').textContent = hidden.value.length.toLocaleString() + ' символов'; }
  function rememberRange() { var sel = window.getSelection(); if (sel.rangeCount && editor.contains(sel.anchorNode) && editor.contains(sel.focusNode)) range = sel.getRangeAt(0).cloneRange(); }
  function restoreRange() { editor.focus(); var sel = window.getSelection(); if (range && editor.contains(range.commonAncestorContainer)) { sel.removeAllRanges(); sel.addRange(range); } }
  function command(name, value) {
    restoreRange();
    if (!document.execCommand(name, false, value)) showToast('Команда не поддерживается браузером или текущим выделением', 'info');
    rememberRange(); sync();
  }
  function insert(html) { var clean = sanitize(html); if (editor.innerHTML.length + clean.length > LIMIT) throw new Error('Описание слишком большое'); command('insertHTML', clean); }
  function alive(saved) { return session && saved === session && state.mapId === session.map && state.editingNodeId === session.id && canEdit(); }
  async function askLink(image) {
    rememberRange(); var saved = session;
    var value = await KicsUI.prompt({ title: image ? 'Изображение по ссылке' : 'Вставить ссылку', inputLabel: image ? 'HTTPS URL изображения (будет загружаться с внешнего сайта)' : 'URL', defaultValue: 'https://', validate: function (v) { return !!url(v, image) || 'Введите допустимый URL'; } });
    if (value === null || !alive(saved)) return;
    if (image) { var img = document.createElement('img'); img.src = url(value, true); img.alt = 'Изображение'; insert(img.outerHTML); }
    else { restoreRange(); if (window.getSelection().isCollapsed) { var a = document.createElement('a'); a.href = url(value, false); a.textContent = value; insert(a.outerHTML); } else command('createLink', url(value, false)); }
  }
  async function imageFile(file) {
    var saved = session; rememberRange();
    if (!file || !/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return showToast('Поддерживаются PNG, JPEG, GIF и WebP', 'error');
    if (file.size > 500000) return showToast('Картинка больше 500 КБ. Используйте ссылку или уменьшите файл.', 'error');
    try { var data = await new Promise(function (resolve, reject) { var r = new FileReader(); r.onload = function () { resolve(r.result); }; r.onerror = reject; r.readAsDataURL(file); });
      if (!alive(saved)) return; var img = document.createElement('img'); img.src = data; img.alt = file.name || 'Изображение'; insert(img.outerHTML);
    } catch (e) { showToast(e.message || 'Не удалось вставить изображение', 'error'); }
  }
  function setup() {
    hidden = document.getElementById('modalNote'); editor = document.getElementById('descriptionEditor'); toolbar = document.getElementById('descriptionToolbar');
    var commands = [['B', 'Жирный · Ctrl+B', 'bold'], ['I', 'Курсив · Ctrl+I', 'italic'], ['U', 'Подчеркнуть · Ctrl+U', 'underline'], ['S', 'Зачеркнуть', 'strikeThrough'], ['• Список', 'Маркированный список', 'insertUnorderedList'], ['1. Список', 'Нумерованный список', 'insertOrderedList'], ['→', 'Увеличить отступ', 'indent'], ['←', 'Уменьшить отступ', 'outdent'], ['↶', 'Отменить', 'undo'], ['↷', 'Повторить', 'redo'], ['Очистить стиль', 'Убрать оформление выделения', 'removeFormat']];
    function button(label, title, fn) { var b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title; b.setAttribute('aria-label', title); b.onmousedown = function (e) { e.preventDefault(); }; b.onclick = fn; toolbar.appendChild(b); }
    var block = document.createElement('select'); block.setAttribute('aria-label', 'Стиль абзаца'); [['p', 'Обычный текст'], ['h2', 'Заголовок 2'], ['h3', 'Заголовок 3'], ['blockquote', 'Цитата'], ['pre', 'Код / табуляция']].forEach(function (o) { block.add(new Option(o[1], o[0])); }); block.onchange = function () { command('formatBlock', block.value); }; toolbar.appendChild(block);
    commands.forEach(function (c) { button(c[0], c[1], function () { command(c[2]); }); });
    button('Ссылка', 'Вставить ссылку', function () { askLink(false); }); button('Убрать ссылку', 'Удалить ссылку с выделения', function () { command('unlink'); }); button('Картинка URL', 'Изображение по HTTPS-ссылке', function () { askLink(true); });
    var file = document.getElementById('descriptionImage'); button('Файл', 'Вставить картинку до 500 КБ', function () { rememberRange(); file.click(); }); file.onchange = function () { imageFile(file.files[0]); file.value = ''; };
    button('Таблица', 'Вставить таблицу 2 × 3', function () { insert('<table><tbody><tr><th>Колонка 1</th><th>Колонка 2</th><th>Колонка 3</th></tr><tr><td> </td><td> </td><td> </td></tr></tbody></table><p><br></p>'); });
    button('⇥ Табуляция', 'Вставить символ табуляции', function () { command('insertText', '\t'); });
    editor.addEventListener('input', function () { try { sync(); } catch(e) { showToast(e.message, 'error'); } });
    editor.addEventListener('keyup', rememberRange); editor.addEventListener('mouseup', rememberRange); editor.addEventListener('blur', rememberRange);
    editor.addEventListener('paste', function (e) {
      e.preventDefault(); rememberRange();
      try { var html = e.clipboardData.getData('text/html'), text = e.clipboardData.getData('text/plain');
        if (html) insert(html); else if (text) insert(fromText(text)); else if (e.clipboardData.files.length) imageFile(e.clipboardData.files[0]);
      } catch (err) { showToast(err.message, 'error'); }
    });
    editor.addEventListener('dragover', function(e) { e.preventDefault(); });
    editor.addEventListener('drop', function(e) { e.preventDefault(); showToast('Вставьте текст через Ctrl+V, картинку — кнопкой «Файл»', 'info'); });
    editor.addEventListener('keydown', function(e) {
      if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); if (e.target.closest('li')) command('indent'); else command('insertText', '\t'); }
    });
    document.getElementById('modal').addEventListener('keydown', function(e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveModal(); } });
    document.getElementById('descriptionExpand').onclick = function () { document.getElementById('modal').classList.toggle('description-expanded'); };
  }
  var originalOpen = openModal, originalSave = saveModal, originalClose = closeModal, originalView = openCardView;
  openModal = function (id) {
    originalOpen(id); if (state.editingNodeId !== id || !canEdit()) return;
    session = { id: id, map: state.mapId, user: currentUser && currentUser.id, before: JSON.stringify(getNodeById(id)) };
    editor.innerHTML = getHtml(getNodeById(id)); initial = editor.innerHTML; range = null; sync();
  };
  saveModal = function () {
    if (!session || !alive(session) || (currentUser && currentUser.id) !== session.user) return showToast('Карточка или права изменились. Откройте редактор заново.', 'error');
    var node = getNodeById(session.id); if (!node) return;
    if (JSON.stringify(node) !== session.before) return showToast('Карточка изменилась во время редактирования. Закройте и откройте её заново.', 'error');
    try { var clean = sanitize(editor.innerHTML); rememberDeletion('Редактирование карточки'); assignHtml(node, clean); hidden.value = node.note; originalSave(); } catch(e) { showToast(e.message, 'error'); }
  };
  closeModal = function () { originalClose(); session = null; range = null; };
  openCardView = function(id) { originalView(id); var n = getNodeById(id), el = document.querySelector('#cardViewBody .card-view-note'); if (n && el) renderDescription(el, n); };
  function refresh(node) {
    if (!session || session.id !== node.id || session.map !== state.mapId) return;
    session.before = JSON.stringify(node); editor.innerHTML = getHtml(node); initial = editor.innerHTML; sync();
  }
  window.KicsRich = { sanitize: sanitize, plain: plain, getHtml: getHtml, assignHtml: assignHtml, clear: clearRich, render: renderDescription, refresh: refresh,
    hasDraft: function(id) { return !!session && session.id === id && editor.innerHTML !== initial; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
})();