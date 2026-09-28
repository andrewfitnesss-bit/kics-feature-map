// Entry point only: existing authenticated sessions share the same Supabase project.
afterLogin = async function () {
  if (new URLSearchParams(location.search).has('share')) {
    location.replace('classic/index.html' + location.search);
    return;
  }
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('app').style.display = 'none';
  var old = document.getElementById('versionPicker');
  if (old) return;
  var panel = document.createElement('main');
  panel.id = 'versionPicker';
  panel.style.cssText = 'max-width:760px;margin:10vh auto;padding:32px;font:16px/1.6 system-ui';
  panel.innerHTML = '<h1>Выберите рабочее пространство</h1>' +
    '<p>Версии независимы. Таблицы новой версии не изменяют оригиналы.</p>' +
    '<p><a class="btn btn-primary" href="classic/index.html">Классическая · v65</a></p>' +
    '<p>Сохранённый интерфейс и поведение. Можно продолжать развивать отдельно.</p>' +
    '<p><a class="btn btn-secondary" href="next/index.html">Новый каталог · v66-preview</a></p>' +
    '<p>Заметки любого уровня, поиск, фильтры, сворачивание и восстановление.</p>';
  document.body.appendChild(panel);
};
var originalShowAuth = showAuth;
showAuth = function () {
  var picker = document.getElementById('versionPicker');
  if (picker) picker.remove();
  originalShowAuth();
};