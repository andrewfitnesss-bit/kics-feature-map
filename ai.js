// AI-инструменты для KICS (гибрид: клиентский BYOK + опциональный прокси через Edge Function).
// Подключается последним после catalog.js. Экспортирует window.KicsAI.
(function () {
  'use strict';

  var LS_AI = 'kics_ai_settings_v1';

  var PROVIDERS = {
    openai:     { id: 'openai',     label: 'OpenAI',     baseURL: 'https://api.openai.com/v1',    defaultModel: 'gpt-4o-mini', needsKey: true },
    anthropic:  { id: 'anthropic',  label: 'Anthropic',  baseURL: 'https://api.anthropic.com/v1', defaultModel: 'claude-3-5-sonnet-latest', needsKey: true },
    deepseek:   { id: 'deepseek',   label: 'DeepSeek',   baseURL: 'https://api.deepseek.com', defaultModel: 'deepseek-flash', needsKey: true },
    openrouter: { id: 'openrouter', label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', defaultModel: 'openai/gpt-4o-mini', needsKey: true },
    custom:     { id: 'custom',     label: 'Свой (OpenAI-совместимый)', baseURL: '', defaultModel: '', needsKey: true }
  };

  var DEFAULTS = { provider: 'openai', model: '', baseURL: '', apiKey: '', useProxy: false };

  function loadSettings() {
    var s = {};
    try { var raw = localStorage.getItem(LS_AI); if (raw) s = JSON.parse(raw) || {}; } catch (e) {}
    var base = Object.assign({}, DEFAULTS, s);
    var p = PROVIDERS[base.provider] || PROVIDERS.openai;
    if (!base.model) base.model = p.defaultModel;
    if (!base.baseURL) base.baseURL = p.baseURL;
    return base;
  }
  function saveSettings(s) { try { localStorage.setItem(LS_AI, JSON.stringify(s)); } catch (e) {} }

  async function persistServerCredential() {
    try {
      if (typeof sb === 'undefined' || !sb || !sb.from) return false;
      if (typeof currentUser === 'undefined' || !currentUser || !currentUser.id) return false;
      var row = {
        user_id: currentUser.id,
        provider: settings.provider,
        api_key: settings.apiKey,
        model: settings.model,
        base_url: settings.baseURL,
        updated_at: new Date().toISOString()
      };
      var res = await sb.from('ai_credentials').upsert(row, { onConflict: 'user_id,provider' });
      return !res.error;
    } catch (e) { return false; }
  }

  var settings = loadSettings();

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fnURL(name) {
    var cfg = window.SUPABASE_CONFIG || {};
    return String(cfg.url || '').replace(/\/+$/, '') + '/functions/v1/' + name;
  }

  async function complete(messages, opts) {
    opts = opts || {};
    try {
      if (settings.useProxy) return await completeProxy(messages, opts);
      if (!settings.apiKey) throw new Error('Укажите API-ключ в настройках ИИ');
      return await completeDirect(messages, opts);
    } catch (e) {
      if (e instanceof TypeError && /Failed to fetch/i.test(e.message || '')) {
        throw new Error('Провайдер заблокировал запрос из браузера (CORS). Включите режим «Выполнять через сервер (прокси)» в настройках ИИ.');
      }
      throw e;
    }
  }

  async function completeDirect(messages, opts) {
    var p = PROVIDERS[settings.provider] || PROVIDERS.openai;
    var base = String(settings.baseURL || p.baseURL || '').replace(/\/+$/, '');
    var model = settings.model || p.defaultModel;
    if (!base) throw new Error('Укажите Base URL провайдера в настройках');

    if (settings.provider === 'anthropic') {
      var system = messages.filter(function (m) { return m.role === 'system'; }).map(function (m) { return m.content; }).join('\n');
      var chat = messages.filter(function (m) { return m.role !== 'system'; });
      var resp = await fetch(base + '/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': settings.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({ model: model, max_tokens: opts.maxTokens || 2048, system: system || undefined, messages: chat })
      });
      if (!resp.ok) throw new Error('Anthropic: ' + await resp.text());
      var d = await resp.json();
      return (d.content || []).map(function (c) { return c.text || ''; }).join('');
    }

    var body = { model: model, messages: messages, stream: false, temperature: opts.temperature != null ? opts.temperature : 0.4 };
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    var resp = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + settings.apiKey },
      body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error('LLM: ' + await resp.text());
    var data = await resp.json();
    var content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error('Пустой ответ модели');
    return content;
  }

  async function completeProxy(messages, opts) {
    var token = null;
    try {
      if (typeof sb !== 'undefined' && sb && sb.auth) {
        var s = await sb.auth.getSession();
        token = s && s.data && s.data.session && s.data.session.access_token;
      }
    } catch (e) {}
    if (!token) throw new Error('Нет авторизации — прокси доступен только после входа');
    var resp = await fetch(fnURL('ai-proxy'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ provider: settings.provider, model: settings.model, baseURL: settings.baseURL, messages: messages, maxTokens: opts.maxTokens || 2048 })
    });
    if (!resp.ok) throw new Error('Прокси: ' + await resp.text());
    var data = await resp.json();
    return data.content || data.text || '';
  }

  async function fetchUrl(url) {
    var resp = await fetch(fnURL('fetch-url'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url })
    });
    if (!resp.ok) throw new Error('Не удалось загрузить ссылку (HTTP ' + resp.status + ')');
    var data = await resp.json();
    if (data.error) throw new Error(data.error);
    return data; // { title, text }
  }

  // ── Контекст: сериализация таблицы в промпт ──
  function statusLabel(s) { return (window.SL && window.SL[s]) || s; }
  function nodePath(node) {
    var parts = [];
    var cur = node;
    while (cur && cur.parentId) { var p = getNodeById(cur.parentId); if (!p) break; parts.unshift(p.title || '(без названия)'); cur = p; }
    return parts;
  }
  function nodeToText(node) {
    var path = nodePath(node);
    var line = '- ' + (path.length ? path.join(' / ') + ' / ' : '') + (node.title || '(без названия)');
    if (node.note) line += '\n    Описание: ' + node.note;
    if (node.memo) line += '\n    Заметка: ' + node.memo;
    if ((node.tags || []).length) line += '\n    Теги: ' + node.tags.join(', ');
    if (node.status && node.status !== 'none') line += '\n    Статус: ' + statusLabel(node.status);
    if (node.dueDate) line += '\n    Срок: ' + node.dueDate;
    return line;
  }
  function subtreeText(id) {
    var node = getNodeById(id);
    if (!node) return '';
    var lines = [nodeToText(node)];
    getChildren(id).forEach(function (c) { if (c.type !== 'comment') lines.push(subtreeText(c.id)); });
    return lines.join('\n');
  }
  function boardText() {
    var out = ['# ' + (state.boardTitle || 'Карта фич')];
    state.columns.forEach(function (col, i) {
      var cards = (typeof getNodesByCol === 'function' ? getNodesByCol(i) : []) || [];
      out.push('\n## Колонка: ' + col.name);
      cards.forEach(function (n) { if (n.type !== 'comment') out.push(nodeToText(n)); });
    });
    return out.join('\n');
  }

  // ── Реестр действий (точка расширения) ──
  var actions = [];
  var byActionId = Object.create(null);
  function registerAction(a) { actions.push(a); byActionId[a.id] = a; }

  registerAction({
    id: 'fill-description',
    label: 'Заполнить Описание по ссылке',
    scope: 'card',
    needsUrl: true,
    buildPrompt: function (ctx, inputs) {
      return [
        { role: 'system', content: 'Ты — продуктовый аналитик. Пиши кратко и по делу, на русском языке.' },
        { role: 'user', content: 'Текст по ссылке:\n---\n' + inputs.text + '\n---\n\nКарточка фичи:\n' + ctx.card + '\n\nНапиши краткое описание этой фичи (2–4 предложения) на основе приведённого текста. Верни только текст описания, без заголовков и пояснений.' }
      ];
    },
    apply: function (result, ctx) {
      var n = getNodeById(ctx.nodeId);
      if (!n) return;
      n.note = result.trim();
      var ta = document.getElementById('modalNote');
      if (ta) ta.value = n.note;
      scheduleSave(); render();
    }
  });

  registerAction({
    id: 'compare-competitor',
    label: 'Сравнить с конкурентом',
    scope: 'board',
    needsUrl: true,
    buildPrompt: function (ctx, inputs) {
      return [
        { role: 'system', content: 'Ты — аналитик конкурентных продуктов. Отвечай на русском.' },
        { role: 'user', content: 'Наша карта фич:\n---\n' + ctx.board + '\n---\n\nОписание конкурента по ссылке:\n---\n' + inputs.text + '\n---\n\nСравни наши фичи с фичами конкурента. Выдели: 1) что есть у конкурента, но нет у нас; 2) что есть у нас, но нет у конкурента; 3) совпадения. Оформи маркдаун-таблицей.' }
      ];
    }
  });

  registerAction({
    id: 'compare-regulation',
    label: 'Сверить с регуляторкой',
    scope: 'board',
    needsUrl: true,
    buildPrompt: function (ctx, inputs) {
      return [
        { role: 'system', content: 'Ты — специалист по комплаенсу и регуляторным требованиям. Отвечай на русском.' },
        { role: 'user', content: 'Наша карта фич:\n---\n' + ctx.board + '\n---\n\nРегуляторный документ (текст по ссылке):\n---\n' + inputs.text + '\n---\n\nСделай gap-анализ: какие требования покрываются нашими фичами, а какие — нет. Перечисли пробелы и дай рекомендации.' }
      ];
    }
  });

  registerAction({
    id: 'recommend-features',
    label: 'Рекомендации по фичам',
    scope: 'board',
    needsUrl: false,
    buildPrompt: function (ctx) {
      return [
        { role: 'system', content: 'Ты — продуктовый стратег. Отвечай на русском.' },
        { role: 'user', content: 'Наша карта фич:\n---\n' + ctx.board + '\n---\n\nПредложи 5–10 конкретных новых фич или улучшений с кратким обоснованием, приоритетом (Now/Next/Later) и предлагаемыми тегами. Оформи списком.' }
      ];
    }
  });

  // ── UI: панель и меню ──
  var panelOverlay = null;
  function closePanel() { if (panelOverlay) { panelOverlay.remove(); panelOverlay = null; } }

  function overlayShell(title) {
    closePanel();
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay ai-overlay';
    var modal = document.createElement('div');
    modal.className = 'modal modal-wide ai-modal';
    var head = document.createElement('div');
    head.className = 'modal-header';
    var h = document.createElement('h3'); h.textContent = title;
    var close = document.createElement('button'); close.className = 'modal-close'; close.textContent = '✕';
    close.addEventListener('click', closePanel);
    head.appendChild(h); head.appendChild(close);
    var body = document.createElement('div'); body.className = 'modal-body ai-body';
    modal.appendChild(head); modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closePanel(); });
    panelOverlay = overlay;
    return body;
  }

  function actionList(scope, nodeId) {
    var list = actions.filter(function (a) { return a.scope === scope; });
    var body = overlayShell(scope === 'card' ? 'ИИ для карточки' : 'ИИ-инструменты');

    if (scope === 'card' && nodeId) {
      var n = getNodeById(nodeId);
      var p = document.createElement('div'); p.className = 'ai-context';
      p.textContent = 'Карточка: ' + (n ? (n.title || '(без названия)') : '');
      body.appendChild(p);
    }

    list.forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'ai-action-btn';
      b.textContent = a.label;
      b.addEventListener('click', function () { runView(a, scope, nodeId, body); });
      body.appendChild(b);
    });

    var s = document.createElement('button');
    s.type = 'button'; s.className = 'btn btn-secondary ai-settings-btn';
    s.textContent = '⚙ Настройки ИИ';
    s.addEventListener('click', function () { openSettings(); });
    body.appendChild(s);
  }

  function runView(action, scope, nodeId, body) {
    body.innerHTML = '';
    var back = document.createElement('button');
    back.type = 'button'; back.className = 'btn btn-secondary btn-sm';
    back.textContent = '← Назад';
    back.addEventListener('click', function () { actionList(scope, nodeId); });
    body.appendChild(back);

    var title = document.createElement('h4'); title.className = 'ai-run-title'; title.textContent = action.label;
    body.appendChild(title);

    var urlInput = null;
    if (action.needsUrl) {
      var lbl = document.createElement('label'); lbl.className = 'ai-label'; lbl.textContent = 'Ссылка для анализа';
      body.appendChild(lbl);
      urlInput = document.createElement('input'); urlInput.type = 'url'; urlInput.className = 'modal-input ai-url'; urlInput.placeholder = 'https://…';
      body.appendChild(urlInput);
    }

    var out = document.createElement('div'); out.className = 'ai-output';
    out.textContent = 'Нажмите «Выполнить».';
    body.appendChild(out);

    var row = document.createElement('div'); row.className = 'ai-actions';
    var run = document.createElement('button'); run.type = 'button'; run.className = 'btn btn-primary'; run.textContent = 'Выполнить';
    var apply = null;
    if (action.apply && scope === 'card') {
      apply = document.createElement('button'); apply.type = 'button'; apply.className = 'btn btn-secondary'; apply.textContent = 'Применить к карточке';
      apply.style.display = 'none';
    }
    var copy = document.createElement('button'); copy.type = 'button'; copy.className = 'btn btn-secondary'; copy.textContent = 'Копировать';
    copy.style.display = 'none';
    row.appendChild(run);
    if (apply) row.appendChild(apply);
    row.appendChild(copy);
    body.appendChild(row);

    var lastResult = '';

    run.addEventListener('click', async function () {
      if (action.needsUrl) {
        var u = (urlInput.value || '').trim();
        if (!/^https?:\/\//i.test(u)) { showToast('Введите корректную ссылку', 'error'); urlInput.focus(); return; }
      }
      run.disabled = true; run.textContent = '⏳ Загружаю…';
      out.textContent = '';
      try {
        var inputs = {};
        if (action.needsUrl) {
          inputs.url = (urlInput.value || '').trim();
          var page = await fetchUrl(inputs.url);
          inputs.text = page.text ? String(page.text).slice(0, 40000) : '';
          inputs.title = page.title || '';
          if (!inputs.text) throw new Error('Не удалось извлечь текст со страницы');
        }
        run.textContent = '⏳ Генерирую…';
        var ctx = { nodeId: nodeId, card: nodeId ? nodeToText(getNodeById(nodeId)) : '', board: boardText() };
        var prompt = action.buildPrompt(ctx, inputs);
        var result = await complete(prompt, {});
        lastResult = result;
        out.textContent = result;
        if (apply) apply.style.display = '';
        copy.style.display = '';
        showToast('Готово', 'success');
      } catch (err) {
        out.textContent = 'Ошибка: ' + (err && err.message ? err.message : err);
        showToast(err && err.message ? err.message : 'Ошибка', 'error');
      } finally {
        run.disabled = false; run.textContent = 'Выполнить';
      }
    });

    if (apply) apply.addEventListener('click', function () {
      action.apply(lastResult, { nodeId: nodeId });
      showToast('Применено к карточке', 'success');
    });
    copy.addEventListener('click', function () {
      if (!lastResult) return;
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(lastResult);
      showToast('Скопировано', 'success');
    });
  }

  function openPanel(scope, nodeId, actionId) {
    scope = scope || 'board';
    var list = actions.filter(function (a) { return a.scope === scope; });
    if (!list.length) { showToast('Нет ИИ-действий для этого контекста', 'info'); return; }
    if (actionId && byActionId[actionId]) {
      var body = overlayShell(scope === 'card' ? 'ИИ для карточки' : 'ИИ-инструменты');
      runView(byActionId[actionId], scope, nodeId, body);
      return;
    }
    actionList(scope, nodeId);
  }

  function openCardMenu(anchor, nodeId) {
    // Открываем панель с карточными действиями (модалка, не вложенное меню).
    openPanel('card', nodeId);
  }

  function fillDescriptionFromUrl(nodeId) {
    openPanel('card', nodeId, 'fill-description');
  }

  function openSettings() {
    var body = overlayShell('Настройки ИИ');

    var provLbl = document.createElement('label'); provLbl.className = 'ai-label'; provLbl.textContent = 'Провайдер';
    var sel = document.createElement('select'); sel.className = 'modal-select';
    Object.keys(PROVIDERS).forEach(function (id) {
      var o = document.createElement('option'); o.value = id; o.textContent = PROVIDERS[id].label; sel.appendChild(o);
    });
    sel.value = settings.provider;

    var keyLbl = document.createElement('label'); keyLbl.className = 'ai-label'; keyLbl.textContent = 'API-ключ (хранится в браузере)';
    var key = document.createElement('input'); key.type = 'password'; key.className = 'modal-input'; key.placeholder = 'sk-…'; key.value = settings.apiKey;

    var baseLbl = document.createElement('label'); baseLbl.className = 'ai-label'; baseLbl.textContent = 'Base URL (необязательно)';
    var base = document.createElement('input'); base.type = 'text'; base.className = 'modal-input'; base.placeholder = 'https://api.example.com/v1'; base.value = settings.baseURL;

    var modelLbl = document.createElement('label'); modelLbl.className = 'ai-label'; modelLbl.textContent = 'Модель';
    var model = document.createElement('input'); model.type = 'text'; model.className = 'modal-input'; model.placeholder = 'gpt-4o-mini'; model.value = settings.model;

    var proxyWrap = document.createElement('label'); proxyWrap.className = 'ai-check';
    var proxy = document.createElement('input'); proxy.type = 'checkbox'; proxy.checked = !!settings.useProxy;
    var proxyTxt = document.createElement('span'); proxyTxt.textContent = ' Выполнять через сервер-прокси (ключ на сервере)';
    proxyWrap.appendChild(proxy); proxyWrap.appendChild(proxyTxt);

    var hint = document.createElement('p'); hint.className = 'ai-hint';
    hint.textContent = 'OpenAI и DeepSeek блокируют прямые запросы из браузера (CORS) — для них включите прокси. OpenRouter и Anthropic работают напрямую.';

    var row = document.createElement('div'); row.className = 'ai-actions';
    var save = document.createElement('button'); save.type = 'button'; save.className = 'btn btn-primary'; save.textContent = 'Сохранить';
    var test = document.createElement('button'); test.type = 'button'; test.className = 'btn btn-secondary'; test.textContent = 'Проверить';
    var cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn btn-secondary'; cancel.textContent = 'Отмена';
    row.appendChild(save); row.appendChild(test); row.appendChild(cancel);

    body.appendChild(provLbl); body.appendChild(sel);
    body.appendChild(keyLbl); body.appendChild(key);
    body.appendChild(baseLbl); body.appendChild(base);
    body.appendChild(modelLbl); body.appendChild(model);
    body.appendChild(proxyWrap);
    body.appendChild(hint);
    body.appendChild(row);

    cancel.addEventListener('click', closePanel);
    save.addEventListener('click', async function () {
      settings.provider = sel.value;
      settings.apiKey = key.value.trim();
      settings.baseURL = base.value.trim();
      settings.model = model.value.trim();
      settings.useProxy = proxy.checked;
      saveSettings(settings);
      if (settings.useProxy && settings.apiKey) {
        var ok = await persistServerCredential();
        showToast(ok ? 'Настройки ИИ сохранены (ключ на сервере)' : 'Сохранено в браузере, но не удалось записать ключ на сервер', ok ? 'success' : 'info');
      } else {
        showToast('Настройки ИИ сохранены', 'success');
      }
      closePanel();
    });
    test.addEventListener('click', async function () {
      test.disabled = true; test.textContent = 'Проверяю…';
      var prev = Object.assign({}, settings);
      settings.provider = sel.value; settings.apiKey = key.value.trim();
      settings.baseURL = base.value.trim(); settings.model = model.value.trim(); settings.useProxy = proxy.checked;
      saveSettings(settings);
      if (settings.useProxy && settings.apiKey) await persistServerCredential();
      try {
        var r = await complete([{ role: 'user', content: 'Ответь одним словом: ОК' }], { maxTokens: 16 });
        showToast('Подключение работает: ' + r.slice(0, 60), 'success');
      } catch (e) {
        showToast('Ошибка: ' + (e && e.message ? e.message : e), 'error');
        settings = prev; saveSettings(settings);
      } finally {
        test.disabled = false; test.textContent = 'Проверить';
      }
    });
  }

  function wire() {
    var aiBtn = document.getElementById('aiBtn');
    if (aiBtn) aiBtn.addEventListener('click', function () { openPanel('board'); });

    var noteEl = document.getElementById('modalNote');
    if (noteEl && !document.getElementById('aiFillNoteBtn')) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.id = 'aiFillNoteBtn';
      btn.className = 'btn btn-secondary btn-sm ai-fill-note';
      btn.textContent = '✨ Заполнить по ссылке';
      btn.addEventListener('click', function () { if (state.editingNodeId) fillDescriptionFromUrl(state.editingNodeId); });
      noteEl.insertAdjacentElement('afterend', btn);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();

  window.KicsAI = {
    openPanel: openPanel,
    openCardMenu: openCardMenu,
    openSettings: openSettings,
    fillDescriptionFromUrl: fillDescriptionFromUrl,
    registerAction: registerAction,
    complete: complete,
    fetchUrl: fetchUrl
  };
})();
