// =============================================================================
//  Pro Calendar - UI primitives (toasts, confirm, date/time pickers)
//  Sustituyen a alert() / confirm() / <input type="datetime-local"> nativos.
// =============================================================================

const MONTH_NAMES_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                          'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DOW_SHORT = ['L','M','X','J','V','S','D'];

const padN = n => String(n).padStart(2, '0');

// =============================================================================
//  TOASTS
// =============================================================================
function ensureToastContainer() {
  let c = document.getElementById('toast-container');
  if (!c) {
    c = document.createElement('div');
    c.id = 'toast-container';
    document.body.appendChild(c);
  }
  return c;
}

function toast(message, kind = 'info', ms = 3200) {
  const c = ensureToastContainer();
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  c.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 220);
  }, ms);
}

// =============================================================================
//  CONFIRM DIALOG  (returns Promise<boolean>)
// =============================================================================
function confirmDialog({ title, message, confirmText = 'Aceptar', cancelText = 'Cancelar', danger = false } = {}) {
  return new Promise(resolve => {
    const back = document.createElement('div');
    back.className = 'confirm-backdrop show';
    back.innerHTML = `
      <div class="confirm-box">
        <h3 class="confirm-title">${escapeHtml(title || '')}</h3>
        <div class="confirm-message">${escapeHtml(message || '')}</div>
        <div class="confirm-actions">
          <button class="btn ghost confirm-cancel">${escapeHtml(cancelText)}</button>
          <button class="btn ${danger ? 'danger' : ''} confirm-ok">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(back);

    const close = (v) => {
      back.classList.remove('show');
      setTimeout(() => back.remove(), 160);
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = e => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter')  close(true);
    };
    document.addEventListener('keydown', onKey);
    back.addEventListener('click', e => { if (e.target === back) close(false); });
    back.querySelector('.confirm-cancel').addEventListener('click', () => close(false));
    back.querySelector('.confirm-ok').addEventListener('click', () => close(true));
    setTimeout(() => back.querySelector('.confirm-ok').focus(), 0);
  });
}

// =============================================================================
//  DATE PICKER  (popover con calendario mensual)
//
//  Uso:  attachDatePicker(triggerButton, {
//          value: 'YYYY-MM-DD' | null,
//          onChange: (newValue) => {}
//        });
// =============================================================================
function attachDatePicker(trigger, opts = {}) {
  let current = opts.value ? parseISODate(opts.value) : new Date();
  current.setHours(0,0,0,0);

  const formatLabel = d => d ? `${d.getDate()} ${MONTH_NAMES_FULL[d.getMonth()].slice(0,3)} ${d.getFullYear()}` : 'Selecciona fecha';
  trigger.textContent = formatLabel(current);
  trigger.classList.add('picker-trigger');

  let popover = null;
  let visibleMonth = new Date(current);

  trigger.addEventListener('click', () => {
    if (popover) { hide(); return; }
    show();
  });

  function show() {
    popover = document.createElement('div');
    popover.className = 'popover popover-date';
    document.body.appendChild(popover);
    positionPopover(popover, trigger);
    renderCal();
    document.addEventListener('mousedown', outsideClick, true);
    document.addEventListener('keydown', onKey);
  }
  function hide() {
    if (!popover) return;
    popover.remove();
    popover = null;
    document.removeEventListener('mousedown', outsideClick, true);
    document.removeEventListener('keydown', onKey);
  }
  function outsideClick(e) {
    if (popover && !popover.contains(e.target) && e.target !== trigger) hide();
  }
  function onKey(e) { if (e.key === 'Escape') hide(); }

  function renderCal() {
    const y = visibleMonth.getFullYear();
    const m = visibleMonth.getMonth();
    const first = new Date(y, m, 1);
    const offset = (first.getDay() + 6) % 7; // 0 = Lunes
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const today = new Date(); today.setHours(0,0,0,0);

    const cells = [];
    for (let i = 0; i < offset; i++) cells.push(`<div class="cal-cell empty"></div>`);
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(y, m, d);
      const isToday    = dt.getTime() === today.getTime();
      const isSelected = current && dt.getTime() === current.getTime();
      cells.push(`<div class="cal-cell ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}" data-d="${d}">${d}</div>`);
    }
    popover.innerHTML = `
      <div class="cal-header">
        <button class="cal-nav" data-nav="-1" type="button">‹</button>
        <div class="cal-month">${MONTH_NAMES_FULL[m]} ${y}</div>
        <button class="cal-nav" data-nav="1" type="button">›</button>
      </div>
      <div class="cal-dow">${DOW_SHORT.map(d => `<div>${d}</div>`).join('')}</div>
      <div class="cal-grid">${cells.join('')}</div>
      <div class="cal-footer">
        <button class="btn ghost btn-sm" data-action="today">Hoy</button>
      </div>
    `;
    popover.querySelectorAll('.cal-nav').forEach(b => b.addEventListener('click', () => {
      visibleMonth.setMonth(visibleMonth.getMonth() + Number(b.dataset.nav));
      renderCal();
    }));
    popover.querySelector('[data-action="today"]').addEventListener('click', () => {
      visibleMonth = new Date();
      renderCal();
    });
    popover.querySelectorAll('.cal-cell:not(.empty)').forEach(c => c.addEventListener('click', () => {
      current = new Date(y, m, Number(c.dataset.d));
      trigger.textContent = formatLabel(current);
      opts.onChange?.(toISODate(current));
      hide();
    }));
  }

  return {
    get value() { return current ? toISODate(current) : null; },
    set value(v) {
      current = v ? parseISODate(v) : null;
      if (current) current.setHours(0,0,0,0);
      visibleMonth = current ? new Date(current) : new Date();
      trigger.textContent = formatLabel(current);
    },
  };
}

// =============================================================================
//  TIME PICKER  (popover con dos columnas: horas y minutos)
//
//  Uso:  attachTimePicker(triggerButton, {
//          value: 'HH:MM' | null,
//          minuteStep: 5,
//          onChange: (newValue) => {}
//        });
// =============================================================================
function attachTimePicker(trigger, opts = {}) {
  const step = opts.minuteStep || 5;
  let hh = 9, mm = 0;
  if (opts.value) {
    const [h, m] = opts.value.split(':').map(Number);
    if (!Number.isNaN(h)) hh = h;
    if (!Number.isNaN(m)) mm = m;
  }
  const formatLabel = () => `${padN(hh)}:${padN(mm)}`;
  trigger.textContent = formatLabel();
  trigger.classList.add('picker-trigger');

  let popover = null;
  trigger.addEventListener('click', () => { popover ? hide() : show(); });

  function show() {
    popover = document.createElement('div');
    popover.className = 'popover popover-time';
    const hours   = Array.from({length: 24}, (_, i) => i);
    const minutes = Array.from({length: Math.floor(60/step)}, (_, i) => i * step);
    popover.innerHTML = `
      <div class="time-cols">
        <div class="time-col" data-col="h">${hours.map(h => `<div class="time-cell ${h===hh?'selected':''}" data-h="${h}">${padN(h)}</div>`).join('')}</div>
        <div class="time-col" data-col="m">${minutes.map(m => `<div class="time-cell ${m===mm?'selected':''}" data-m="${m}">${padN(m)}</div>`).join('')}</div>
      </div>
    `;
    document.body.appendChild(popover);
    positionPopover(popover, trigger);

    popover.querySelectorAll('[data-h]').forEach(el => el.addEventListener('click', () => {
      hh = Number(el.dataset.h);
      popover.querySelectorAll('[data-h]').forEach(x => x.classList.toggle('selected', Number(x.dataset.h) === hh));
      trigger.textContent = formatLabel();
      opts.onChange?.(formatLabel());
    }));
    popover.querySelectorAll('[data-m]').forEach(el => el.addEventListener('click', () => {
      mm = Number(el.dataset.m);
      popover.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('selected', Number(x.dataset.m) === mm));
      trigger.textContent = formatLabel();
      opts.onChange?.(formatLabel());
    }));

    // Auto-scroll a la selección
    setTimeout(() => {
      popover.querySelector('[data-col="h"] .selected')?.scrollIntoView({block:'center'});
      popover.querySelector('[data-col="m"] .selected')?.scrollIntoView({block:'center'});
    }, 0);

    document.addEventListener('mousedown', outsideClick, true);
    document.addEventListener('keydown', onKey);
  }
  function hide() {
    if (!popover) return;
    popover.remove();
    popover = null;
    document.removeEventListener('mousedown', outsideClick, true);
    document.removeEventListener('keydown', onKey);
  }
  function outsideClick(e) { if (popover && !popover.contains(e.target) && e.target !== trigger) hide(); }
  function onKey(e) { if (e.key === 'Escape') hide(); }

  return {
    get value() { return formatLabel(); },
    set value(v) {
      if (!v) return;
      const [h, m] = v.split(':').map(Number);
      if (!Number.isNaN(h)) hh = h;
      if (!Number.isNaN(m)) mm = m;
      trigger.textContent = formatLabel();
    },
  };
}

// =============================================================================
//  Helpers
// =============================================================================
function positionPopover(pop, trigger) {
  const r = trigger.getBoundingClientRect();
  pop.style.position = 'fixed';
  pop.style.top  = `${r.bottom + 6}px`;
  pop.style.left = `${r.left}px`;
  // Si se sale por la derecha, alinear a la derecha del trigger
  requestAnimationFrame(() => {
    const w = pop.offsetWidth;
    if (r.left + w > window.innerWidth - 12) {
      pop.style.left = `${Math.max(12, r.right - w)}px`;
    }
    const h = pop.offsetHeight;
    if (r.bottom + 6 + h > window.innerHeight - 12) {
      pop.style.top = `${Math.max(12, r.top - h - 6)}px`;
    }
  });
}

function parseISODate(s) {
  // 'YYYY-MM-DD' (sin hora)
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toISODate(d) {
  return `${d.getFullYear()}-${padN(d.getMonth()+1)}-${padN(d.getDate())}`;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, s => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[s]));
}

// Export to global scope so app.js (loaded as classic script) can use them.
window.UI = { toast, confirmDialog, attachDatePicker, attachTimePicker };
