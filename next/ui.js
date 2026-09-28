(function () {
  'use strict';

  var activeDialog = null;
  var lastFocused = null;

  function ensureToastRegion() {
    var region = document.getElementById('toastRegion');
    if (region) return region;
    region = document.createElement('div');
    region.id = 'toastRegion';
    region.className = 'toast-region';
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');
    document.body.appendChild(region);
    return region;
  }

  function toast(message, type, duration) {
    var region = ensureToastRegion();
    var item = document.createElement('div');
    item.className = 'toast toast-' + (type || 'info');
    item.setAttribute('role', type === 'error' ? 'alert' : 'status');
    var icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = type === 'error' ? '!' : (type === 'success' ? '✓' : 'i');
    var text = document.createElement('span');
    text.className = 'toast-text';
    text.textContent = message;
    var close = document.createElement('button');
    close.className = 'toast-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Закрыть уведомление');
    close.textContent = '×';
    item.appendChild(icon);
    item.appendChild(text);
    item.appendChild(close);
    region.appendChild(item);
    requestAnimationFrame(function () { item.classList.add('is-visible'); });

    var timer = setTimeout(remove, duration || 4200);
    close.addEventListener('click', remove);
    function remove() {
      clearTimeout(timer);
      item.classList.remove('is-visible');
      setTimeout(function () { if (item.parentNode) item.remove(); }, 180);
    }
  }

  function closeActiveDialog(value) {
    if (!activeDialog) return;
    var current = activeDialog;
    activeDialog = null;
    document.removeEventListener('keydown', current.onKeydown);
    current.overlay.classList.remove('is-visible');
    setTimeout(function () {
      if (current.overlay.parentNode) current.overlay.remove();
      if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
      current.resolve(value);
    }, 160);
  }

  function dialog(options) {
    options = options || {};
    if (activeDialog) closeActiveDialog(null);
    lastFocused = document.activeElement;

    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'dialog-overlay';
      var panel = document.createElement('div');
      panel.className = 'dialog-panel';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');

      var header = document.createElement('div');
      header.className = 'dialog-header';
      var title = document.createElement('h3');
      title.className = 'dialog-title';
      title.textContent = options.title || 'Подтверждение';
      header.appendChild(title);
      panel.appendChild(header);

      if (options.message) {
        var message = document.createElement('p');
        message.className = 'dialog-message';
        message.textContent = options.message;
        panel.appendChild(message);
      }

      var input = null;
      var error = null;
      if (options.input) {
        var field = document.createElement('label');
        field.className = 'dialog-field';
        if (options.inputLabel) {
          var label = document.createElement('span');
          label.textContent = options.inputLabel;
          field.appendChild(label);
        }
        input = document.createElement('input');
        input.className = 'dialog-input';
        input.type = options.inputType || 'text';
        input.value = options.defaultValue || '';
        input.placeholder = options.placeholder || '';
        input.autocomplete = 'off';
        field.appendChild(input);
        error = document.createElement('span');
        error.className = 'dialog-error';
        field.appendChild(error);
        panel.appendChild(field);
      }

      var actions = document.createElement('div');
      actions.className = 'dialog-actions';
      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn btn-secondary';
      cancel.textContent = options.cancelLabel || 'Отмена';
      var confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'btn ' + (options.danger ? 'btn-danger-solid' : 'btn-primary');
      confirm.textContent = options.confirmLabel || 'Готово';
      actions.appendChild(cancel);
      actions.appendChild(confirm);
      panel.appendChild(actions);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);

      function submit() {
        var value = input ? input.value.trim() : true;
        if (options.validate) {
          var validation = options.validate(value);
          if (validation !== true) {
            error.textContent = validation || 'Проверьте значение';
            input.focus();
            return;
          }
        }
        closeActiveDialog(value);
      }

      function onKeydown(event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeActiveDialog(null);
        } else if (event.key === 'Enter' && (!event.shiftKey || input)) {
          event.preventDefault();
          submit();
        } else if (event.key === 'Tab') {
          var focusable = panel.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
          if (!focusable.length) return;
          var first = focusable[0];
          var last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }

      activeDialog = { overlay: overlay, resolve: resolve, onKeydown: onKeydown };
      cancel.addEventListener('click', function () { closeActiveDialog(null); });
      confirm.addEventListener('click', submit);
      overlay.addEventListener('mousedown', function (event) { if (event.target === overlay) closeActiveDialog(null); });
      document.addEventListener('keydown', onKeydown);
      requestAnimationFrame(function () {
        overlay.classList.add('is-visible');
        (input || confirm).focus();
        if (input) input.select();
      });
    });
  }

  function confirm(options) {
    options = options || {};
    return dialog(options).then(function (value) { return value === true; });
  }

  function prompt(options) {
    options = options || {};
    options.input = true;
    return dialog(options);
  }

  window.KicsUI = {
    toast: toast,
    dialog: dialog,
    confirm: confirm,
    prompt: prompt,
    closeDialog: function () { closeActiveDialog(null); }
  };
})();