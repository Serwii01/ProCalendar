// =============================================================================
//  Pro Calendar - renderer
//  Vista Semana / Mes / Día estilo ChronosFlow, modal de evento,
//  sincronización con Google e iCloud.
// =============================================================================
const API_BASE   = 'http://localhost:8080/api';
const API_EVENTS = `${API_BASE}/events`;
const API_TODOS  = `${API_BASE}/todos`;
const API_SYNC   = `${API_BASE}/sync`;

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
  view: 'week',                  // 'day' | 'week' | 'month'
  cursorDate: new Date(),        // anclaje temporal (un día dentro de la semana/mes)
  events: [],
  todos: [],
  editingId: null,
  selectedColor: COLORS[0].value,
  filterSource: 'all',           // 'all' | 'LOCAL' | 'GOOGLE' | 'ICLOUD'
  search: '',
};

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
  card.innerHTML = `
    <div class="ev-title">${escapeHtml(ev.title)}</div>
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
    list.innerHTML = `<div class="empty-card">No hay tareas. ¡A descansar! 🌿</div>`;
    return;
  }
  list.innerHTML = state.todos.map(t => `
    <div class="todo-row ${t.done ? 'done' : ''}" data-id="${t.id}">
      <span class="todo-checkbox ${t.done ? 'checked' : ''}" data-action="toggle">${t.done ? '✓' : ''}</span>
      <div class="todo-content">
        <div class="todo-title">${escapeHtml(t.title)}</div>
        <div class="todo-meta">
          <span class="priority-pill ${t.priority}" style="font-size:10px">${t.priority}</span>
          ${t.dueAt ? ` · ${formatDueLabel(t.dueAt)}` : ''}
        </div>
      </div>
      <div class="todo-actions">
        <button class="todo-delete" data-action="delete" title="Borrar">✕</button>
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
              <div class="dm-sub">${e.allDay ? 'Todo el día' : fmtHM(s)}${e.location ? ' · ' + escapeHtml(e.location) : ''}</div>
            </div>
          </div>`;
        }).join('');

  // Weekly goal — % de tareas completadas esta semana
  const total = state.todos.length;
  const done  = state.todos.filter(t => t.done).length;
  const pct = total === 0 ? 0 : Math.round(done / total * 100);
  document.getElementById('panel-goal-text').textContent =
      total === 0
          ? 'Añade tareas para ver tu progreso'
          : `Completa todas tus ${total} tareas esta semana.`;
  document.getElementById('panel-progress').style.width = `${pct}%`;
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
  document.getElementById('inicio').value = toLocalIso(start);
  document.getElementById('fin').value    = toLocalIso(end);
  document.getElementById('dia').value    = toLocalDate(day);
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
    document.getElementById('inicio').value = toLocalIso(parseLocal(ev.startAt));
    document.getElementById('dia').value    = toLocalDate(parseLocal(ev.startAt));
  }
  if (ev.endAt) {
    document.getElementById('fin').value = toLocalIso(parseLocal(ev.endAt));
  }
  state.selectedColor = ev.color || COLORS[0].value;
  renderColorPicker();
  document.getElementById('btn-borrar').style.display = (ev.source && ev.source !== 'LOCAL') ? 'none' : 'inline-flex';
  showModal();
}

function showModal() { document.getElementById('modal-event').classList.add('show'); }
function hideModal() { document.getElementById('modal-event').classList.remove('show'); }

function resetForm() {
  state.editingId = null;
  document.getElementById('modal-title-text').textContent = 'Crear nuevo evento';
  document.getElementById('form-evento').reset();
  document.getElementById('evento-id').value = '';
  document.getElementById('btn-borrar').style.display = 'none';
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
    const dia = document.getElementById('dia').value;
    if (!dia) throw new Error('Selecciona un día');
    startAt = `${dia}T00:00:00`;
    endAt   = `${dia}T23:59:00`;
  } else {
    startAt = document.getElementById('inicio').value;
    endAt   = document.getElementById('fin').value;
    if (!startAt || !endAt) throw new Error('Indica inicio y fin');
    if (new Date(endAt) <= new Date(startAt)) throw new Error('Fin debe ser posterior al inicio');
  }

  return {
    title,
    location:    document.getElementById('ubicacion').value.trim(),
    description: document.getElementById('descripcion').value.trim(),
    startAt, endAt, allDay,
    color: state.selectedColor,
  };
}

async function saveEvent() {
  try {
    const payload = readFormPayload();
    if (state.editingId) {
      await api(`${API_EVENTS}/${state.editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await api(API_EVENTS, { method: 'POST', body: JSON.stringify(payload) });
    }
    hideModal();
    await refreshAll();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteEvent() {
  if (!state.editingId) return;
  if (!confirm('¿Borrar este evento?')) return;
  await api(`${API_EVENTS}/${state.editingId}`, { method: 'DELETE' });
  hideModal();
  await refreshAll();
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
  setStatus(`Sincronizando con ${provider}…`, 'busy');
  try {
    const r = await api(`${API_SYNC}/${provider}?mode=full`, { method: 'POST' });
    setStatus(`${provider}: ↓${r.imported}  ✎${r.updated}  ⨯${r.deleted}  (${r.message})`, 'ok');
    await refreshAll();
  } catch (err) {
    setStatus(`${provider}: ${err.message}`, 'err');
  }
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
document.addEventListener('DOMContentLoaded', () => {
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
  document.getElementById('btn-sync-google').addEventListener('click', () => syncProvider('google'));
  document.getElementById('btn-sync-icloud').addEventListener('click', () => syncProvider('icloud'));
  document.getElementById('btn-login-google').addEventListener('click', startGoogleOAuth);

  renderColorPicker();
  refreshAll();

  // Refresh now-line periodically
  setInterval(() => { if (state.view === 'week' || state.view === 'day') renderCurrentView(); }, 60_000);
});
