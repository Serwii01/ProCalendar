// =============================================================================
//  Pro Calendar - renderer
//  Vista Semana / Mes / Día, modal de evento, sync Google/iCloud,
//  toasts y pickers personalizados.
// =============================================================================
// Defensive load from window.UI (set by ui.js). Fallback to native primitives
// so the rest of the app still works if ui.js fails for any reason.
const _UI = window.UI || {};
const toast            = _UI.toast            || ((m, k) => console.log(`[${k||'info'}] ${m}`));
const confirmDialog    = _UI.confirmDialog    || (({message}) => Promise.resolve(window.confirm(message || '¿Confirmar?')));
const attachDatePicker = _UI.attachDatePicker || ((el) => { el.textContent = 'YYYY-MM-DD'; return { value: '' }; });
const attachTimePicker = _UI.attachTimePicker || ((el) => { el.textContent = '09:00';      return { value: '09:00' }; });
if (!window.UI) console.error('[boot] window.UI no está definido — revisa ui.js');

const API_BASE     = 'http://localhost:8080/api';
const API_EVENTS   = `${API_BASE}/events`;
const API_TODOS    = `${API_BASE}/todos`;
const API_SYNC     = `${API_BASE}/sync`;
const API_SETTINGS = `${API_BASE}/settings`;

const DAY_NAMES   = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DAY_NAMES_L = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const MONTH_DOW   = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const COLORS = [
  { name: 'indigo', value: '#4f46e5' },
  { name: 'teal',   value: '#14b8a6' },
  { name: 'red',    value: '#ef4444' },
  { name: 'amber',  value: '#f59e0b' },
  { name: 'purple', value: '#a855f7' },
  { name: 'pink',   value: '#ec4899' },
  { name: 'blue',   value: '#0a84ff' },
  { name: 'green',  value: '#22c55e' },
];

const HOUR_HEIGHT = 64;
const DAY_HOUR_START = 0;   // mostrar 24h
const DAY_HOUR_END   = 24;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  view: 'week',
  cursorDate: new Date(),
  events: [],
  todos: [],
  icloudCalendars: [],
  editingId: null,
  selectedColor: COLORS[0].value,
  filterSource: 'all',
  search: '',
};

// Pickers (initialized after DOMContentLoaded)
const pickers = { startDate: null, startTime: null, endDate: null, endTime: null, allDayDate: null };

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day); // ISO: lunes
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfWeek(weekStart) { return addDays(weekStart, 7); }

function startOfMonth(date) {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonthGrid(date) { return startOfWeek(startOfMonth(date)); }

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth()    === b.getMonth()
      && a.getDate()     === b.getDate();
}

function pad(n) { return String(n).padStart(2, '0'); }

function toLocalIso(date) {
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toLocalDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
}

function parseLocal(value) {
  return value ? new Date(value) : null;
}

function fmtHM(date) { return `${pad(date.getHours())}:${pad(date.getMinutes())}`; }

function fmtWeekRange(weekStart) {
  const last = addDays(weekStart, 6);
  if (weekStart.getMonth() === last.getMonth()) {
    return `${weekStart.getDate()} – ${last.getDate()} ${MONTH_NAMES[weekStart.getMonth()]} ${weekStart.getFullYear()}`;
  }
  return `${weekStart.getDate()} ${MONTH_NAMES[weekStart.getMonth()]} – ${last.getDate()} ${MONTH_NAMES[last.getMonth()]} ${weekStart.getFullYear()}`;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, s => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[s]));
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} — ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function activeRange() {
  if (state.view === 'day') {
    const s = new Date(state.cursorDate); s.setHours(0,0,0,0);
    return [s, addDays(s, 1)];
  }
  if (state.view === 'week') {
    const s = startOfWeek(state.cursorDate);
    return [s, addDays(s, 7)];
  }
  // month: covers visible grid (always 6 weeks = 42 days)
  const s = startOfMonthGrid(state.cursorDate);
  return [s, addDays(s, 42)];
}

async function loadEvents() {
  const [from, to] = activeRange();
  try {
    state.events = state.search
        ? await api(`${API_EVENTS}?q=${encodeURIComponent(state.search)}`)
        : await api(`${API_EVENTS}?from=${toLocalIso(from)}&to=${toLocalIso(to)}`);
  } catch (e) {
    console.error(e);
    state.events = [];
    setStatus(`Backend no disponible (${e.message})`, 'err');
  }
}

async function loadTodos() {
  try { state.todos = await api(API_TODOS); }
  catch (e) { console.error(e); state.todos = []; }
}

async function loadIcloudCalendars() {
  try {
    state.icloudCalendars = await api(`${API_SYNC}/icloud/calendars`);
    populateCalendarSelect();
  } catch (e) {
    console.warn('No se pudieron obtener calendarios iCloud:', e.message);
    state.icloudCalendars = [];
  }
}

function populateCalendarSelect() {
  const sel = document.getElementById('cal-target');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">— Solo local (sin sincronizar) —</option>'
    + state.icloudCalendars.map(c =>
        `<option value="${escapeHtml(c.url)}" data-name="${escapeHtml(c.name)}" data-color="${escapeHtml(c.color || '')}">${escapeHtml(c.name)}</option>`
      ).join('');
  if (current) sel.value = current;
}

function visibleEvents() {
  if (state.filterSource === 'all') return state.events;
  return state.events.filter(e => (e.source || 'LOCAL') === state.filterSource);
}

// ---------------------------------------------------------------------------
// View switcher
// ---------------------------------------------------------------------------
function setView(view) {
  state.view = view;
  document.querySelectorAll('.view-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.view === view));
  document.getElementById('view-week').style.display  = view === 'week'  ? 'flex' : 'none';
  document.getElementById('view-month').style.display = view === 'month' ? 'flex' : 'none';
  document.getElementById('view-day').style.display   = view === 'day'   ? 'flex' : 'none';
  refreshAll();
}

function changeRange(direction) {
  if (direction === 0) {
    state.cursorDate = new Date();
  } else if (state.view === 'month') {
    state.cursorDate = addMonths(state.cursorDate, direction);
  } else if (state.view === 'week') {
    state.cursorDate = addDays(state.cursorDate, direction * 7);
  } else {
    state.cursorDate = addDays(state.cursorDate, direction);
  }
  refreshAll();
}

// ---------------------------------------------------------------------------
// Header (title + sub)
// ---------------------------------------------------------------------------
function renderHeader() {
  const titleEl = document.getElementById('title-main');
  const subEl   = document.getElementById('title-sub');
  if (state.view === 'week') {
    titleEl.textContent = fmtWeekRange(startOfWeek(state.cursorDate));
    subEl.textContent = `Semana ${weekNumber(startOfWeek(state.cursorDate))}`;
  } else if (state.view === 'month') {
    titleEl.textContent = `${MONTH_NAMES[state.cursorDate.getMonth()]} ${state.cursorDate.getFullYear()}`;
    subEl.textContent = '';
  } else {
    const d = state.cursorDate;
    titleEl.textContent = `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
    subEl.textContent = DAY_NAMES_L[(d.getDay() + 6) % 7];
  }
}

function weekNumber(d) {
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  return 1 + Math.ceil((firstThursday - target) / 604800000);
}

// ---------------------------------------------------------------------------
// Week view
// ---------------------------------------------------------------------------
function renderWeekView() {
  const weekStart = startOfWeek(state.cursorDate);
  const today = new Date(); today.setHours(0,0,0,0);

  // Header
  const headerEl = document.getElementById('week-header');
  headerEl.innerHTML = `<div class="tz-cell">GMT${tzOffsetLabel()}</div>` + Array.from({length:7}, (_,i) => {
    const d = addDays(weekStart, i);
    const isToday = sameDay(d, today);
    return `<div class="dow-cell ${isToday ? 'today' : ''}">
              <div class="dow-name">${DAY_NAMES[i]}</div>
              <div class="dow-num">${d.getDate()}</div>
            </div>`;
  }).join('');

  // All-day row
  const allDayRow = document.getElementById('allday-row');
  allDayRow.innerHTML = `<div class="allday-label">Todo el día</div>` + Array.from({length:7}, (_,i) => {
    const d = addDays(weekStart, i);
    const allDayEvents = visibleEvents().filter(ev => ev.allDay && eventOccursOnDay(ev, d));
    const chips = allDayEvents.map(ev => `
      <div class="event-card allday-chip" data-id="${ev.id}" data-source="${ev.source || 'LOCAL'}"
           style="background:${chipBg(ev)};color:${chipFg(ev)};">
        <div class="ev-title">${escapeHtml(ev.title)}</div>
      </div>`).join('');
    return `<div class="allday-cell" data-day="${toLocalDate(d)}">${chips}</div>`;
  }).join('');

  // Time grid
  const gridEl = document.getElementById('week-grid');
  gridEl.innerHTML = '';

  // Time column
  const timeCol = document.createElement('div');
  timeCol.className = 'time-col';
  for (let h = DAY_HOUR_START; h < DAY_HOUR_END; h++) {
    const c = document.createElement('div');
    c.className = 'time-cell';
    c.textContent = `${pad(h)}:00`;
    timeCol.appendChild(c);
  }
  gridEl.appendChild(timeCol);

  // Day columns
  for (let i = 0; i < 7; i++) {
    const day = addDays(weekStart, i);
    const col = document.createElement('div');
    col.className = 'day-col';
    if (sameDay(day, today)) col.classList.add('today-col');
    if (i >= 5) col.classList.add('weekend-col');

    for (let h = DAY_HOUR_START; h < DAY_HOUR_END; h++) {
      const slot = document.createElement('div');
      slot.className = 'hour-slot';
      slot.addEventListener('click', () => openModalForNew(day, h));
      col.appendChild(slot);
    }

    // Positioned events
    visibleEvents()
        .filter(ev => !ev.allDay && eventOccursOnDay(ev, day))
        .forEach(ev => col.appendChild(buildPositionedEventCard(ev, day)));

    gridEl.appendChild(col);
  }

  // Now indicator
  const now = new Date();
  const inWeek = now >= weekStart && now < addDays(weekStart, 7);
  if (inWeek) {
    const dayIdx = (now.getDay() + 6) % 7;
    const minutes = (now.getHours() - DAY_HOUR_START) * 60 + now.getMinutes();
    const top = (minutes / 60) * HOUR_HEIGHT;
    const line = document.createElement('div');
    line.className = 'now-line';
    line.style.top = `${top}px`;
    const colWidth = `calc((100% - 60px) / 7)`;
    line.style.left = `calc(60px + ${dayIdx} * ${colWidth})`;
    line.style.width = colWidth;
    gridEl.appendChild(line);
  }

  // Scroll to ~7am on first render
  const wrap = document.getElementById('week-body-wrap');
  if (!wrap.dataset.scrolled) {
    wrap.scrollTop = 7 * HOUR_HEIGHT;
    wrap.dataset.scrolled = '1';
  }

  // Click handlers for events
  gridEl.querySelectorAll('.event-card[data-id]').forEach(el => {
    el.addEventListener('click', e => { e.stopPropagation(); openModalForEdit(Number(el.dataset.id)); });
  });
  allDayRow.querySelectorAll('.event-card[data-id]').forEach(el => {
    el.addEventListener('click', e => { e.stopPropagation(); openModalForEdit(Number(el.dataset.id)); });
  });
  allDayRow.querySelectorAll('.allday-cell').forEach(cell => {
    cell.addEventListener('dblclick', () => {
      const day = new Date(cell.dataset.day);
      openModalForNew(day, null, true);
    });
  });
}

function buildPositionedEventCard(ev, day) {
  const start = parseLocal(ev.startAt);
  const end   = parseLocal(ev.endAt) || new Date(start.getTime() + 60*60*1000);
  const dayStart = new Date(day); dayStart.setHours(DAY_HOUR_START, 0, 0, 0);
  const dayEnd   = new Date(day); dayEnd.setHours(DAY_HOUR_END, 0, 0, 0);
  const s = start < dayStart ? dayStart : start;
  const e = end   > dayEnd   ? dayEnd   : end;
  const startMin = (s.getHours() - DAY_HOUR_START) * 60 + s.getMinutes();
  const endMin   = (e.getHours() - DAY_HOUR_START) * 60 + e.getMinutes() + (e.getDate() !== s.getDate() ? 24*60 : 0);
  const top    = (startMin / 60) * HOUR_HEIGHT;
  const height = Math.max(22, ((endMin - startMin) / 60) * HOUR_HEIGHT - 2);

  const card = document.createElement('div');
  card.className = 'event-card';
  if (height < 38) card.classList.add('short');
  card.dataset.id = ev.id;
  card.dataset.source = ev.source || 'LOCAL';
  card.style.top    = `${top}px`;
  card.style.height = `${height}px`;
  card.style.background = chipBg(ev);
  card.style.color      = chipFg(ev);
  const calBadge = ev.calendarName
      ? `<span style="display:inline-block;padding:1px 6px;border-radius:6px;background:rgba(255,255,255,.22);font-size:10px;font-weight:600;margin-left:4px">${escapeHtml(ev.calendarName)}</span>`
      : '';
  card.innerHTML = `
    <div class="ev-title">${escapeHtml(ev.title)}${calBadge}</div>
    <div class="ev-meta">${fmtHM(start)} – ${fmtHM(end)}${ev.location ? ' · ' + escapeHtml(ev.location) : ''}</div>
  `;
  return card;
}

function chipBg(ev) {
  if (ev.color) {
    // Soften background for readability — use color as bar via inset shadow,
    // and a tinted bg derived from same hue.
    return ev.color;
  }
  return 'var(--primary)';
}

function chipFg(ev) {
  // Always white for now — colors are saturated enough.
  return '#fff';
}

function eventOccursOnDay(ev, day) {
  const start = parseLocal(ev.startAt);
  const end   = parseLocal(ev.endAt) || start;
  if (!start) return false;
  const dayStart = new Date(day); dayStart.setHours(0,0,0,0);
  const dayEnd = addDays(dayStart, 1);
  return start < dayEnd && end >= dayStart;
}

function tzOffsetLabel() {
  const min = -new Date().getTimezoneOffset();
  const sign = min >= 0 ? '+' : '-';
  const h = Math.floor(Math.abs(min) / 60);
  return `${sign}${h}`;
}

// ---------------------------------------------------------------------------
// Month view
// ---------------------------------------------------------------------------
function renderMonthView() {
  const dowEl = document.getElementById('month-dow');
  dowEl.innerHTML = MONTH_DOW.map(d => `<div>${d}</div>`).join('');

  const gridEl = document.getElementById('month-grid');
  gridEl.innerHTML = '';

  const gridStart = startOfMonthGrid(state.cursorDate);
  const month = state.cursorDate.getMonth();
  const today = new Date(); today.setHours(0,0,0,0);

  for (let i = 0; i < 42; i++) {
    const day = addDays(gridStart, i);
    const isOther  = day.getMonth() !== month;
    const isToday  = sameDay(day, today);
    const dayEvents = visibleEvents().filter(ev => eventOccursOnDay(ev, day));
    const visibleChips = dayEvents.slice(0, 3);
    const overflow = dayEvents.length - visibleChips.length;

    const cell = document.createElement('div');
    cell.className = `month-cell ${isOther ? 'other-month' : ''} ${isToday ? 'today' : ''}`;
    cell.innerHTML = `
      <div class="mc-date">${day.getDate()}</div>
      ${visibleChips.map(ev => `
        <div class="mc-event" data-id="${ev.id}" style="background:${tintBg(ev)};color:${ev.color || 'var(--primary-strong)'}">
          ${ev.allDay ? '' : pad(parseLocal(ev.startAt).getHours()) + ':' + pad(parseLocal(ev.startAt).getMinutes()) + ' '}${escapeHtml(ev.title)}
        </div>`).join('')}
      ${overflow > 0 ? `<div class="mc-more">+${overflow} más</div>` : ''}
    `;
    cell.addEventListener('click', e => {
      if (e.target.dataset.id) {
        openModalForEdit(Number(e.target.dataset.id));
      } else {
        openModalForNew(day);
      }
    });
    gridEl.appendChild(cell);
  }
}

function tintBg(ev) {
  const c = ev.color || '#4f46e5';
  // 16% alpha background, full color text/border = mock through rgba via hex.
  const r = parseInt(c.slice(1,3),16), g = parseInt(c.slice(3,5),16), b = parseInt(c.slice(5,7),16);
  return `rgba(${r},${g},${b},.16)`;
}

// ---------------------------------------------------------------------------
// Day view
// ---------------------------------------------------------------------------
function renderDayView() {
  const day = state.cursorDate;
  const gridEl = document.getElementById('day-grid');
  gridEl.innerHTML = '';

  const timeCol = document.createElement('div');
  timeCol.className = 'time-col';
  for (let h = DAY_HOUR_START; h < DAY_HOUR_END; h++) {
    const c = document.createElement('div');
    c.className = 'time-cell';
    c.textContent = `${pad(h)}:00`;
    timeCol.appendChild(c);
  }
  gridEl.appendChild(timeCol);

  const col = document.createElement('div');
  col.className = 'day-col today-col';
  for (let h = DAY_HOUR_START; h < DAY_HOUR_END; h++) {
    const slot = document.createElement('div');
    slot.className = 'hour-slot';
    slot.addEventListener('click', () => openModalForNew(day, h));
    col.appendChild(slot);
  }
  visibleEvents()
      .filter(ev => !ev.allDay && eventOccursOnDay(ev, day))
      .forEach(ev => col.appendChild(buildPositionedEventCard(ev, day)));

  gridEl.appendChild(col);

  col.querySelectorAll('.event-card[data-id]').forEach(el =>
      el.addEventListener('click', e => { e.stopPropagation(); openModalForEdit(Number(el.dataset.id)); }));
}

// ---------------------------------------------------------------------------
// Right panel (Tasks for Today)
// ---------------------------------------------------------------------------
function renderRightPanel() {
  const now = new Date();
  document.getElementById('rp-today-label').textContent =
      `${DAY_NAMES_L[(now.getDay() + 6) % 7]}, ${now.getDate()} de ${MONTH_NAMES[now.getMonth()]}`;

  const list = document.getElementById('todo-list');
  if (state.todos.length === 0) {
    list.innerHTML = `<div class="empty-card">Sin tareas</div>`;
    return;
  }
  const checkSvg = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
  const trashSvg = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
  list.innerHTML = state.todos.map(t => `
    <div class="todo-row ${t.done ? 'done' : ''}" data-id="${t.id}">
      <span class="todo-checkbox ${t.done ? 'checked' : ''}" data-action="toggle">${checkSvg}</span>
      <div class="todo-content">
        <div class="todo-title">${escapeHtml(t.title)}</div>
        <div class="todo-meta">
          <span class="priority-pill ${t.priority}">${t.priority}</span>
          ${t.dueAt ? `<span>${formatDueLabel(t.dueAt)}</span>` : ''}
        </div>
      </div>
      <div class="todo-actions">
        <button class="todo-delete" data-action="delete" title="Borrar">${trashSvg}</button>
      </div>
    </div>
  `).join('');
}

function formatDueLabel(dueAt) {
  const d = parseLocal(dueAt);
  const today = new Date(); today.setHours(0,0,0,0);
  const dd = new Date(d); dd.setHours(0,0,0,0);
  const diff = Math.round((dd - today) / 86400000);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  if (diff === -1) return 'Ayer';
  return `${d.getDate()}/${d.getMonth()+1}`;
}

// ---------------------------------------------------------------------------
// Bottom panels
// ---------------------------------------------------------------------------
function renderBottomPanels() {
  // Priorities — tareas con prioridad HIGH no completadas
  const priorities = state.todos.filter(t => !t.done && t.priority === 'HIGH').slice(0, 4);
  const pEl = document.getElementById('panel-priorities');
  pEl.innerHTML = priorities.length === 0
      ? `<div class="empty-card">No hay tareas con prioridad alta</div>`
      : priorities.map(t => `
          <div class="priority-row">
            <div class="pr-title">${escapeHtml(t.title)}</div>
            <span class="priority-pill HIGH">High</span>
          </div>`).join('');

  // Upcoming deadlines — próximos eventos no all-day en los próximos 14 días
  const now = new Date();
  const next14 = new Date(now); next14.setDate(now.getDate() + 14);
  const upcoming = state.events
      .filter(e => { const s = parseLocal(e.startAt); return s >= now && s <= next14; })
      .sort((a, b) => parseLocal(a.startAt) - parseLocal(b.startAt))
      .slice(0, 4);
  const dEl = document.getElementById('panel-deadlines');
  dEl.innerHTML = upcoming.length === 0
      ? `<div class="empty-card">No hay eventos próximos</div>`
      : upcoming.map(e => {
          const s = parseLocal(e.startAt);
          return `<div class="deadline-row">
            <div class="deadline-date">
              <div class="dd-mon">${MONTH_NAMES[s.getMonth()].slice(0,3).toUpperCase()}</div>
              <div class="dd-day">${s.getDate()}</div>
            </div>
            <div class="deadline-meta">
              <div class="dm-title">${escapeHtml(e.title)}</div>
              <div class="dm-sub">${e.allDay ? 'Todo el día' : fmtHM(s)}${e.location ? ' · ' + escapeHtml(e.location) : ''}${e.calendarName ? ' · ' + escapeHtml(e.calendarName) : ''}</div>
            </div>
          </div>`;
        }).join('');

  // Esta semana — métricas reales
  const stats = document.getElementById('panel-stats');
  if (stats) {
    const totalEvents = state.events.length;
    const totalTodos  = state.todos.length;
    const doneTodos   = state.todos.filter(t => t.done).length;
    // Horas ocupadas (eventos no all-day en la semana visible)
    let busyMin = 0;
    state.events.forEach(e => {
      if (e.allDay) return;
      const s = parseLocal(e.startAt), en = parseLocal(e.endAt);
      if (s && en) busyMin += Math.max(0, (en - s) / 60000);
    });
    const busyH = (busyMin / 60).toFixed(1);
    const byCal = state.events.reduce((m, e) => { const k = e.calendarName || e.source || 'Local'; m[k] = (m[k]||0)+1; return m; }, {});
    const topCal = Object.entries(byCal).sort((a,b) => b[1]-a[1])[0];
    stats.innerHTML = `
      <div class="stat"><div class="stat-label">Eventos</div><div class="stat-value">${totalEvents}</div></div>
      <div class="stat"><div class="stat-label">Horas ocupadas</div><div class="stat-value">${busyH}h</div></div>
      <div class="stat"><div class="stat-label">Tareas</div><div class="stat-value">${doneTodos}/${totalTodos}</div></div>
      <div class="stat"><div class="stat-label">Top calendario</div><div class="stat-value" style="font-size:13px;font-weight:500">${topCal ? escapeHtml(topCal[0]) : '—'}</div><div class="stat-sub">${topCal ? topCal[1] + ' eventos' : ''}</div></div>
    `;
  }
}

// ---------------------------------------------------------------------------
// Modal (create / edit event)
// ---------------------------------------------------------------------------
function openModalForNew(day, hour = null, allDay = false) {
  resetForm();
  const start = new Date(day);
  if (hour !== null) start.setHours(hour, 0, 0, 0);
  else start.setHours(9, 0, 0, 0);
  const end = new Date(start); end.setHours(start.getHours() + 1);
  pickers.startDate.value = toLocalDate(start);
  pickers.startTime.value = fmtHM(start);
  pickers.endDate.value   = toLocalDate(end);
  pickers.endTime.value   = fmtHM(end);
  pickers.allDayDate.value = toLocalDate(day);
  document.getElementById('all-day').checked = allDay;
  toggleAllDayInputs(allDay);
  showModal();
  document.getElementById('titulo').focus();
}

function openModalForEdit(id) {
  const ev = state.events.find(e => e.id === id);
  if (!ev) return;
  resetForm();
  state.editingId = id;
  document.getElementById('modal-title-text').textContent = 'Editar evento';
  document.getElementById('evento-id').value = id;
  document.getElementById('titulo').value      = ev.title || '';
  document.getElementById('ubicacion').value   = ev.location || '';
  document.getElementById('descripcion').value = ev.description || '';
  document.getElementById('all-day').checked   = !!ev.allDay;
  toggleAllDayInputs(!!ev.allDay);
  if (ev.startAt) {
    const s = parseLocal(ev.startAt);
    pickers.startDate.value  = toLocalDate(s);
    pickers.startTime.value  = fmtHM(s);
    pickers.allDayDate.value = toLocalDate(s);
  }
  if (ev.endAt) {
    const e = parseLocal(ev.endAt);
    pickers.endDate.value = toLocalDate(e);
    pickers.endTime.value = fmtHM(e);
  }
  state.selectedColor = ev.color || COLORS[0].value;
  renderColorPicker();
  // Preselect the iCloud calendar this event belongs to (if any).
  const sel = document.getElementById('cal-target');
  if (sel) sel.value = ev.externalCalendarId || '';
  // Allow deletion of any event (local or remote). For remote we ask cascade.
  document.getElementById('btn-borrar').style.display = 'inline-flex';
  document.getElementById('btn-to-todo').style.display = 'inline-flex';
  showModal();
}

function showModal() { document.getElementById('modal-event').classList.add('show'); }
function hideModal() { document.getElementById('modal-event').classList.remove('show'); }

function resetForm() {
  state.editingId = null;
  document.getElementById('modal-title-text').textContent = 'Nuevo evento';
  document.getElementById('titulo').value = '';
  document.getElementById('ubicacion').value = '';
  document.getElementById('descripcion').value = '';
  document.getElementById('all-day').checked = false;
  document.getElementById('evento-id').value = '';
  document.getElementById('btn-borrar').style.display = 'none';
  const btnToTodo = document.getElementById('btn-to-todo');
  if (btnToTodo) btnToTodo.style.display = 'none';
  const sel = document.getElementById('cal-target');
  if (sel) sel.value = '';
  state.selectedColor = COLORS[0].value;
  renderColorPicker();
  toggleAllDayInputs(false);
}

function toggleAllDayInputs(allDay) {
  document.getElementById('campos-horarios').style.display = allDay ? 'none' : 'block';
  document.getElementById('campos-dia').style.display      = allDay ? 'block' : 'none';
}

function renderColorPicker() {
  const picker = document.getElementById('picker-color');
  picker.innerHTML = COLORS.map(c =>
      `<span class="color-swatch ${c.value === state.selectedColor ? 'active' : ''}"
             style="background:${c.value}" data-color="${c.value}" title="${c.name}"></span>`
  ).join('');
  picker.querySelectorAll('.color-swatch').forEach(el => {
    el.addEventListener('click', () => {
      state.selectedColor = el.dataset.color;
      renderColorPicker();
    });
  });
}

function readFormPayload() {
  const allDay = document.getElementById('all-day').checked;
  const title = document.getElementById('titulo').value.trim();
  if (!title) throw new Error('El título es obligatorio');

  let startAt, endAt;
  if (allDay) {
    const dia = pickers.allDayDate.value;
    if (!dia) throw new Error('Selecciona un día');
    startAt = `${dia}T00:00:00`;
    endAt   = `${dia}T23:59:00`;
  } else {
    const sd = pickers.startDate.value, st = pickers.startTime.value;
    const ed = pickers.endDate.value,   et = pickers.endTime.value;
    if (!sd || !st || !ed || !et) throw new Error('Indica inicio y fin');
    startAt = `${sd}T${st}:00`;
    endAt   = `${ed}T${et}:00`;
    if (new Date(endAt) <= new Date(startAt)) throw new Error('Fin debe ser posterior al inicio');
  }

  // Calendario destino iCloud (opcional). Si se elige, el evento se enviará a
  // ese calendario en el próximo Sincronizar iCloud.
  const sel = document.getElementById('cal-target');
  const targetUrl  = sel ? sel.value : '';
  const targetName = sel && sel.selectedOptions[0]
      ? sel.selectedOptions[0].dataset.name || null
      : null;

  return {
    title,
    location:    document.getElementById('ubicacion').value.trim(),
    description: document.getElementById('descripcion').value.trim(),
    startAt, endAt, allDay,
    color: state.selectedColor,
    externalCalendarId: targetUrl || null,
    calendarName: targetName,
  };
}

async function saveEvent() {
  try {
    const payload = readFormPayload();
    if (state.editingId) {
      await api(`${API_EVENTS}/${state.editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      toast('Evento actualizado', 'ok');
    } else {
      await api(API_EVENTS, { method: 'POST', body: JSON.stringify(payload) });
      toast('Evento creado', 'ok');
    }
    hideModal();
    await refreshAll();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function deleteEvent() {
  if (!state.editingId) return;
  const ev = state.events.find(e => e.id === state.editingId);
  let cascade = false;

  if (ev && ev.source === 'ICLOUD') {
    const ok = await confirmDialog({
      title: 'Borrar evento de iCloud',
      message: `Este evento pertenece a iCloud${ev.calendarName ? ' · ' + ev.calendarName : ''}.\n\nSe borrará también en tu iPhone tras la próxima sincronización.`,
      confirmText: 'Borrar en iCloud',
      cancelText: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    cascade = true;
  } else {
    const ok = await confirmDialog({
      title: '¿Borrar este evento?',
      message: 'Esta acción no se puede deshacer.',
      confirmText: 'Borrar',
      danger: true,
    });
    if (!ok) return;
  }

  try {
    await api(`${API_EVENTS}/${state.editingId}?cascade=${cascade}`, { method: 'DELETE' });
    hideModal();
    await refreshAll();
    toast('Evento borrado', 'ok');
  } catch (err) {
    toast('No se pudo borrar: ' + err.message, 'err');
  }
}

// ---------------------------------------------------------------------------
// Todos
// ---------------------------------------------------------------------------
async function submitTodo(e) {
  e.preventDefault();
  const titleEl = document.getElementById('todo-titulo');
  const prio    = document.getElementById('todo-prioridad').value;
  const due     = document.getElementById('todo-due').value;
  const title = titleEl.value.trim();
  if (!title) return;
  const payload = { title, priority: prio };
  if (due) payload.dueAt = `${due}T09:00:00`;
  await api(API_TODOS, { method: 'POST', body: JSON.stringify(payload) });
  titleEl.value = '';
  document.getElementById('todo-due').value = '';
  await refreshTodos();
}

async function onTodoClick(e) {
  const row = e.target.closest('.todo-row');
  if (!row) return;
  const id = row.dataset.id;
  const action = e.target.dataset.action;
  if (action === 'toggle') {
    await api(`${API_TODOS}/${id}/toggle`, { method: 'POST' });
    await refreshTodos();
  } else if (action === 'delete') {
    await api(`${API_TODOS}/${id}`, { method: 'DELETE' });
    await refreshTodos();
  }
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------
function setStatus(msg, kind = 'busy') {
  const el = document.getElementById('sync-status');
  el.textContent = msg;
  el.classList.remove('ok','err','busy');
  if (msg) el.classList.add(kind);
}

async function syncProvider(provider) {
  setStatus('Sincronizando…', 'busy');
  try {
    const r = await api(`${API_SYNC}/${provider}?mode=full`, { method: 'POST' });
    const errish = (r.message || '').toLowerCase();
    const hasError = errish.includes('error') || errish.includes('fail');
    if (hasError) {
      setStatus('Error en la sincronización', 'err');
    } else {
      setStatus('Sincronizado', 'ok');
    }
    if (provider === 'icloud') await loadIcloudCalendars();
    await refreshAll();
  } catch (err) {
    setStatus('Error en la sincronización', 'err');
  }
}

async function syncAll() {
  setStatus('Sincronizando…', 'busy');
  try {
    const r = await api(`${API_SYNC}/icloud?mode=full`, { method: 'POST' });
    await loadIcloudCalendars();
    setStatus(r.message?.toLowerCase().includes('error') ? 'Error en la sincronización' : 'Sincronizado',
              r.message?.toLowerCase().includes('error') ? 'err' : 'ok');
    await refreshAll();
  } catch (err) { setStatus('Error en la sincronización', 'err'); }
}

function startGoogleOAuth() {
  // Spring Security expone /oauth2/authorization/google que arranca el flow.
  // En Electron abrimos esa URL en el navegador del sistema.
  const url = `${API_BASE.replace('/api','')}/oauth2/authorization/google`;
  if (window.electronAPI?.openExternal) {
    window.electronAPI.openExternal(url);
  } else {
    window.open(url, '_blank');
  }
  setStatus('Abierto navegador para login Google. Luego pulsa Sincronizar Google.', 'busy');
}

// ---------------------------------------------------------------------------
// Source filter
// ---------------------------------------------------------------------------
function setSourceFilter(src) {
  state.filterSource = src;
  document.querySelectorAll('.cal-list .nav-item').forEach(el =>
      el.classList.toggle('active', el.dataset.cal === src));
  renderCurrentView();
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function renderCurrentView() {
  if (state.view === 'week')  renderWeekView();
  if (state.view === 'month') renderMonthView();
  if (state.view === 'day')   renderDayView();
}

async function refreshAll() {
  await Promise.all([loadEvents(), loadTodos()]);
  renderHeader();
  renderCurrentView();
  renderRightPanel();
  renderBottomPanels();
}

async function refreshTodos() {
  await loadTodos();
  renderRightPanel();
  renderBottomPanels();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function boot() {
  // Wrap each wiring step so a single failure doesn't abort the rest.
  const safe = (label, fn) => { try { fn(); } catch (e) { console.error(`[boot:${label}]`, e); } };
  safe('main', () => mainInit());
}
function mainInit() {
  // View tabs
  document.querySelectorAll('.view-tab').forEach(t =>
      t.addEventListener('click', () => setView(t.dataset.view)));

  // Calendar source filter
  document.querySelectorAll('.cal-list .nav-item').forEach(el =>
      el.addEventListener('click', () => setSourceFilter(el.dataset.cal)));

  // Navigation
  document.getElementById('btn-prev').addEventListener('click', () => changeRange(-1));
  document.getElementById('btn-hoy').addEventListener('click',  () => changeRange(0));
  document.getElementById('btn-next').addEventListener('click', () => changeRange(1));

  // New event
  document.getElementById('btn-nuevo-evento').addEventListener('click',     () => openModalForNew(new Date()));
  document.getElementById('btn-nuevo-evento-fab').addEventListener('click', () => openModalForNew(new Date()));

  // Modal
  document.getElementById('btn-modal-close').addEventListener('click', hideModal);
  document.getElementById('btn-cancelar').addEventListener('click',    hideModal);
  document.getElementById('btn-guardar').addEventListener('click',     saveEvent);
  document.getElementById('btn-borrar').addEventListener('click',      deleteEvent);
  document.getElementById('all-day').addEventListener('change', e => toggleAllDayInputs(e.target.checked));
  document.getElementById('modal-event').addEventListener('click', e => {
    if (e.target.id === 'modal-event') hideModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideModal();
  });
  document.getElementById('form-evento').addEventListener('submit', e => { e.preventDefault(); saveEvent(); });

  // Todos
  document.getElementById('form-todo').addEventListener('submit', submitTodo);
  document.getElementById('todo-list').addEventListener('click', onTodoClick);

  // Search
  let searchTimer;
  document.getElementById('buscador').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      state.search = e.target.value.trim();
      await loadEvents();
      renderCurrentView();
      renderBottomPanels();
    }, 300);
  });

  // Sync
  document.getElementById('btn-sync-google')?.addEventListener('click', () => syncProvider('google'));
  document.getElementById('btn-sync-icloud').addEventListener('click', () => syncProvider('icloud'));
  document.getElementById('btn-login-google')?.addEventListener('click', startGoogleOAuth);

  // Pickers
  pickers.startDate  = attachDatePicker(document.getElementById('pick-start-date'));
  pickers.startTime  = attachTimePicker(document.getElementById('pick-start-time'));
  pickers.endDate    = attachDatePicker(document.getElementById('pick-end-date'));
  pickers.endTime    = attachTimePicker(document.getElementById('pick-end-time'));
  pickers.allDayDate = attachDatePicker(document.getElementById('pick-allday-date'));

  renderColorPicker();
  loadIcloudCalendars();
  refreshAll();

  // Refresh now-line periodically
  setInterval(() => { if (state.view === 'week' || state.view === 'day') renderCurrentView(); }, 60_000);

  // ---------- Tema ----------
  applyTheme(localStorage.getItem('theme') || 'auto');

  // ---------- Switch Calendar / Tasks view ----------
  document.querySelectorAll('[data-section]').forEach(el => el.addEventListener('click', () => {
    document.querySelectorAll('[data-section]').forEach(x => x.classList.toggle('active', x === el));
    const isTasks = el.dataset.section === 'tasks';
    document.getElementById('view-tasks').style.display = isTasks ? 'flex' : 'none';
    document.getElementById('view-week').style.display  = isTasks ? 'none' : (state.view==='week' ? 'flex' : 'none');
    document.getElementById('view-month').style.display = isTasks ? 'none' : (state.view==='month'? 'flex' : 'none');
    document.getElementById('view-day').style.display   = isTasks ? 'none' : (state.view==='day'  ? 'flex' : 'none');
    document.querySelector('.bottom-panels').style.display = isTasks ? 'none' : 'grid';
    document.querySelector('.title-row').style.display = isTasks ? 'none' : 'flex';
    if (isTasks) renderTasksView();
  }));

  // ---------- Settings modal ----------
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-settings-close').addEventListener('click', () => hideSettings());
  document.getElementById('btn-settings-cancel').addEventListener('click', () => hideSettings());
  document.getElementById('btn-settings-save').addEventListener('click', saveSettings);
  document.getElementById('modal-settings').addEventListener('click', e => {
    if (e.target.id === 'modal-settings') hideSettings();
  });
  document.querySelectorAll('#settings-tabs .tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('#settings-tabs .tab').forEach(x => x.classList.toggle('active', x === t));
    document.querySelectorAll('.tab-pane').forEach(p => p.hidden = p.dataset.pane !== t.dataset.tab);
  }));
  document.querySelectorAll('#theme-segmented button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#theme-segmented button').forEach(x => x.classList.toggle('active', x === b));
    applyTheme(b.dataset.theme);
  }));
  document.getElementById('btn-google-connect').addEventListener('click', startGoogleOAuth);

  // ---------- Sync button (sidebar) ----------
  document.getElementById('btn-sync-icloud').addEventListener('click', syncAll);

  // ---------- Tasks view form ----------
  document.getElementById('form-todo-main').addEventListener('submit', async e => {
    e.preventDefault();
    const title = document.getElementById('todo-titulo-main').value.trim();
    if (!title) return;
    const priority = document.getElementById('todo-prioridad-main').value;
    const due      = document.getElementById('todo-due-main').value;
    const payload  = { title, priority };
    if (due) payload.dueAt = `${due}T09:00:00`;
    await api(API_TODOS, { method: 'POST', body: JSON.stringify(payload) });
    document.getElementById('todo-titulo-main').value = '';
    document.getElementById('todo-due-main').value    = '';
    await refreshTodos();
    renderTasksView();
  });
  document.querySelectorAll('[data-list]').forEach(el => el.addEventListener('click', () => {
    document.querySelectorAll('[data-list]').forEach(x => x.classList.toggle('active', x === el));
    state.taskFilter = el.dataset.list;
    renderTasksView();
  }));

  // ---------- Convert event → todo ----------
  document.getElementById('btn-to-todo').addEventListener('click', async () => {
    if (!state.editingId) return;
    try {
      await api(`${API_EVENTS}/${state.editingId}/to-todo`, { method: 'POST' });
      toast('Tarea creada desde el evento', 'ok');
      await refreshTodos();
    } catch (err) { toast('No se pudo crear la tarea: ' + err.message, 'err'); }
  });
}

// Boot: arrancar inmediatamente si el DOM ya está listo, o esperar a DOMContentLoaded.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

// =============================================================================
//  Tasks view rendering
// =============================================================================
function renderTasksView() {
  const list  = document.getElementById('tasks-list-main');
  const title = document.getElementById('tasks-list-title');
  const count = document.getElementById('tasks-count');
  if (!list) return;

  const filter = state.taskFilter || 'all';
  const today = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1);

  let items = state.todos.slice();
  if (filter === 'today')    items = items.filter(t => t.dueAt && new Date(t.dueAt) >= today && new Date(t.dueAt) < tomorrow);
  if (filter === 'upcoming') items = items.filter(t => !t.done && (!t.dueAt || new Date(t.dueAt) >= today));
  if (filter === 'done')     items = items.filter(t => t.done);

  title.textContent = { all:'Todas las tareas', today:'Hoy', upcoming:'Próximas', done:'Completadas' }[filter];
  count.textContent = `${items.length} tarea${items.length===1?'':'s'}`;

  if (items.length === 0) {
    list.innerHTML = `<div class="empty-card">Sin tareas en esta lista</div>`;
    return;
  }
  const checkSvg = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
  list.innerHTML = items.map(t => `
    <div class="todo-row ${t.done ? 'done' : ''}" data-id="${t.id}">
      <span class="todo-checkbox ${t.done ? 'checked' : ''}" data-action="toggle">${checkSvg}</span>
      <div class="todo-content">
        <div class="todo-title">${escapeHtml(t.title)}</div>
        <div class="todo-meta">
          <span class="priority-pill ${t.priority}">${t.priority}</span>
          ${t.dueAt ? `<span>${formatDueLabel(t.dueAt)}</span>` : ''}
        </div>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.todo-row').forEach(row => {
    row.addEventListener('click', async e => {
      const id = Number(row.dataset.id);
      if (e.target.dataset.action === 'toggle') {
        await api(`${API_TODOS}/${id}/toggle`, { method: 'POST' });
        await refreshTodos();
        renderTasksView();
      } else {
        renderTaskDetail(id);
      }
    });
  });
}

function renderTaskDetail(id) {
  const t = state.todos.find(x => x.id === id);
  const det = document.getElementById('tasks-detail');
  if (!t || !det) return;
  det.innerHTML = `
    <h3 style="margin:0 0 12px;font-size:16px;font-weight:600">${escapeHtml(t.title)}</h3>
    <div class="task-detail-field">
      <div class="field-label">Estado</div>
      <div>${t.done ? 'Completada' : 'Pendiente'}</div>
    </div>
    <div class="task-detail-field">
      <div class="field-label">Prioridad</div>
      <div><span class="priority-pill ${t.priority}">${t.priority}</span></div>
    </div>
    ${t.dueAt ? `<div class="task-detail-field"><div class="field-label">Vence</div><div>${formatDueLabel(t.dueAt)}</div></div>` : ''}
    ${t.notes ? `<div class="task-detail-field"><div class="field-label">Notas</div><div style="font-size:13px;line-height:1.5">${escapeHtml(t.notes)}</div></div>` : ''}
    <button class="btn danger btn-sm" id="td-delete" style="margin-top:12px">Borrar</button>
  `;
  document.getElementById('td-delete').addEventListener('click', async () => {
    const ok = await confirmDialog({ title:'Borrar tarea', message:t.title, confirmText:'Borrar', danger:true });
    if (!ok) return;
    await api(`${API_TODOS}/${id}`, { method:'DELETE' });
    await refreshTodos();
    renderTasksView();
    det.innerHTML = `<div class="empty-card">Selecciona una tarea para ver detalles</div>`;
  });
}

// =============================================================================
//  Theme
// =============================================================================
function applyTheme(t) {
  localStorage.setItem('theme', t);
  if (t === 'auto') {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } else {
    document.documentElement.dataset.theme = t;
  }
  document.querySelectorAll('#theme-segmented button').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === t));
}

// =============================================================================
//  Settings modal
// =============================================================================
async function openSettings() {
  try {
    const s = await api(API_SETTINGS);
    document.getElementById('s-icloud-id').value      = s['icloud.appleId']     || '';
    document.getElementById('s-icloud-pwd').value     = s['icloud.appPassword'] || '';
    document.getElementById('s-icloud-url').value     = s['icloud.calendarUrl'] || '';
    document.getElementById('s-icloud-enabled').checked = s['icloud.enabled'] === 'true';
    document.getElementById('s-google-id').value      = s['google.clientId']    || '';
    document.getElementById('s-google-secret').value  = s['google.clientSecret']|| '';
    document.getElementById('s-google-enabled').checked = s['google.enabled'] === 'true';
    document.getElementById('s-autosync-enabled').checked = s['sync.autoEnabled'] !== 'false';
    document.getElementById('s-autosync-minutes').value   = s['sync.autoMinutes'] || '5';
  } catch (e) { /* settings empty on first run */ }
  document.getElementById('modal-settings').classList.add('show');
}
function hideSettings() { document.getElementById('modal-settings').classList.remove('show'); }

async function saveSettings() {
  const patch = {
    'icloud.appleId':       document.getElementById('s-icloud-id').value.trim(),
    'icloud.appPassword':   document.getElementById('s-icloud-pwd').value,
    'icloud.calendarUrl':   document.getElementById('s-icloud-url').value.trim(),
    'icloud.enabled':       String(document.getElementById('s-icloud-enabled').checked),
    'google.clientId':      document.getElementById('s-google-id').value.trim(),
    'google.clientSecret':  document.getElementById('s-google-secret').value,
    'google.enabled':       String(document.getElementById('s-google-enabled').checked),
    'sync.autoEnabled':     String(document.getElementById('s-autosync-enabled').checked),
    'sync.autoMinutes':     document.getElementById('s-autosync-minutes').value,
  };
  try {
    await api(API_SETTINGS, { method: 'PUT', body: JSON.stringify(patch) });
    toast('Ajustes guardados', 'ok');
    hideSettings();
  } catch (err) { toast('Error al guardar: ' + err.message, 'err'); }
}
ssList.remove('show'); }
async function saveSettings() {
  const patch = {
    'icloud.appleId':       document.getElementById('s-icloud-id').value.trim(),
    'icloud.appPassword':   document.getElementById('s-icloud-pwd').value,
    'icloud.calendarUrl':   document.getElementById('s-icloud-url').value.trim(),
    'icloud.enabled':       String(document.getElementById('s-icloud-enabled').checked),
    'google.clientId':      document.getElementById('s-google-id').value.trim(),
    'google.clientSecret':  document.getElementById('s-google-secret').value,
    'google.enabled':       String(document.getElementById('s-google-enabled').checked),
    'sync.autoEnabled':     String(document.getElementById('s-autosync-enabled').checked),
    'sync.autoMinutes':     document.getElementById('s-autosync-minutes').value,
  };
  try { await api(API_SETTINGS, { method:'PUT', body: JSON.stringify(patch) }); toast('Ajustes guardados', 'ok'); hideSettings(); }
  catch (err) { toast('Error al guardar: ' + err.message, 'err'); }
}
, 'err'); }
}
