// =============================================================================
//  Pro Calendar — i18n (idiomas para la app desktop)
//  Usa atributos data-i18n para HTML estático y t(key) para strings dinámicos.
// =============================================================================
(function () {
  const LS_KEY = 'procalendar.lang';

  const AVAILABLE = [
    { code: 'es',    label: 'Español', flag: '🇪🇸' },
    { code: 'en',    label: 'English', flag: '🇬🇧' },
    { code: 'zh-CN', label: '中文',    flag: '🇨🇳' }
  ];

  const dicts = {};            // {code: {key: value}}
  let current = 'es';
  let listeners = [];

  async function load(code) {
    if (dicts[code]) return dicts[code];
    try {
      const res = await fetch('./i18n/' + code + '.json');
      dicts[code] = await res.json();
    } catch (e) {
      console.error('[i18n] no se pudo cargar', code, e);
      dicts[code] = {};
    }
    return dicts[code];
  }

  function t(key, params) {
    let val = (dicts[current] && dicts[current][key]) || key;
    if (params) {
      for (const k of Object.keys(params)) {
        val = val.replace(new RegExp('\\{\\{\\s*' + k + '\\s*\\}\\}', 'g'), String(params[k]));
      }
    }
    return val;
  }

  /** Recorre el DOM y reemplaza el contenido de cualquier elemento con data-i18n="key".
   *  Soporta también data-i18n-attr="placeholder:key,title:key2" para atributos. */
  function applyTo(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    root.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      const pairs = el.getAttribute('data-i18n-attr').split(',');
      pairs.forEach(function (p) {
        const parts = p.split(':');
        if (parts.length === 2) {
          el.setAttribute(parts[0].trim(), t(parts[1].trim()));
        }
      });
    });
  }

  async function set(code) {
    if (!AVAILABLE.some(function (a) { return a.code === code; })) code = 'es';
    await load(code);
    current = code;
    document.documentElement.lang = code;
    try { localStorage.setItem(LS_KEY, code); } catch (_) {}
    applyTo(document);
    listeners.forEach(function (fn) { try { fn(code); } catch (e) { console.error(e); } });
  }

  async function init() {
    let initial = 'es';
    try { initial = localStorage.getItem(LS_KEY) || initial; } catch (_) {}
    if (!AVAILABLE.some(function (a) { return a.code === initial; })) {
      const nav = (navigator.language || '').toLowerCase();
      if (nav.startsWith('zh')) initial = 'zh-CN';
      else if (nav.startsWith('en')) initial = 'en';
      else initial = 'es';
    }
    await set(initial);
  }

  function onChange(fn) { listeners.push(fn); }

  window.I18N = {
    AVAILABLE: AVAILABLE,
    t: t,
    set: set,
    init: init,
    current: function () { return current; },
    applyTo: applyTo,
    onChange: onChange
  };
})();
