// =============================================================================
//  Pro Calendar - renderer
//  Local desktop client. Talks to the Spring Boot backend at http://localhost:8080
// =============================================================================
const API_BASE  = 'http://localhost:8080/api';
const API_EVENTS = `${API_BASE}/events`;
const API_TODOS  = `${API_BASE}/todos`;
const API_SYNC   = `${API_BASE}/sync`;

const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const COLORS = ['#4f46e5', '#0a84ff', '#34a853', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6'];

// ----- App state -------------------------------------------------------------
const state = {
  weekStart: startOfWeek(new Date()),
  events: [],
  todos: [],
  editingId: null,
  selectedColor: COLORS[0],
  search: '',
};

// ----- Date helpers ----------------------------------------------------------
function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1 - day); // ISO week starts Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function endOfWeek(weekStart) {
  return addDays(weekStart, 7);
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth()    === b.getMonth()
      && a.getDate()     === b.getDate();
}

function fmtDateRange(start, end) {
  const last = addDays(end, -1);
  if (start.getMonth() === last.getMonth()) {
    return `${start.getDate()} – ${last.getDate()} ${MONTH_NAMES[start.getMonth()]} ${start.getFullYear()}`;
  }
  return `${start.getDate()} ${MONTH_NAMES[start.getMonth()]} – ${last.getDate()} ${MONTH_NAMES[last.getMonth()]} ${start.getFullYear()}`;
}

function toLocalIso(date) {
  // datetime-local expects "YYYY-MM-DDTHH:MM" without TZ
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toLocalDate(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
}

function parseLocal(value) {
  // Spring returns ISO without offset. JS Date() interprets it as local — good.
  return value ? new Date(value) : null;
}

// ----- API calls -------------------------------------------------------------
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

async function loadEvents() {
  const from = toLocalIso(state.weekStart);
  const to   = toLocalIso(endOfWeek(state.weekStart));
  try {
    state.events = state.search
        ? await api(`${API_EVENTS}?q=${encodeURIComponent(state.search)}`)
        : await api(`${API_EVENTS}?from=${from}&to=${to}`);
  } catch (e) {
    console.error(e);
    state.events = [];
    renderError('No se puede contactar con el backend. Arranca Spring Boot.');
  }
}

async function loadTodos() {
  try {
    state.todos = await api(API_TODOS);
  } catch (e) {
    console.error(e);
    state.todos = [];
  }
}

// ----- Rendering -------------------------------------------------------------
function renderError(msg) {
  document.getElementById('grid-semana').innerHTML =
      `<div class="empty-card" style="grid-column:span 7;color:var(--danger)">${msg}</div>`;
}

function eventOccursOnDay(ev, day) {
  const start = parseLocal(ev.startAt);
  const end   = parseLocal(ev.endAt) || start;
  if (!start) return false;
  const dayEnd = addDays(day, 1);
  return start < dayEnd && end >= day;
}

function renderHeader() {
  document.getElementById('semana-titulo').textContent =
      `${MONTH_NAMES[state.weekStart.getMonth()]} ${state.weekStart.getFullYear()}`;
  document.getElementById('rango-semana').textContent =
      fmtDateRange(state.weekStart, endOfWeek(state.weekStart));
}

function renderGrid() {
  const grid = document.getElementById('grid-semana');
  grid.innerHTML = '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < 7; i++) {
    const day = addDays(state.weekStart, i);
    const cell = document.createElement('div');
    cell.className = 'day';
    if (sameDay(day, today)) cell.classList.add('today');
    if (i >= 5) cell.classList.add('weekend');

    cell.innerHTML = `
      <div class="day-header">${DAY_NAMES[i]}</div>
      <div class="day-date">${day.getDate()}</div>
    `;

    const eventsForDay = state.events
        .filter(e => eventOccursOnDay(e, day))
        .sort((a, b) => (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1)
                     || parseLocal(a.startAt) - parseLocal(b.startAt));

    if (eventsForDay.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'Sin eventos';
      cell.appendChild(empty);
    } else {
      eventsForDay.forEach(ev => cell.appendChild(renderEventChip(ev)));
    }

    cell.addEventListener('dblclick', () => prefillNewEvent(day));
    grid.appendChild(cell);
  }
}

function renderEventChip(ev) {
  const chip = document.createElement('div');
  chip.className = 'event-chip';
  if (ev.allDay) chip.classList.add('allday');
  if (ev.source === 'GOOGLE') chip.classList.add('google');
  if (ev.source === 'ICLOUD') chip.classList.add('icloud');
  if (ev.color && !ev.allDay) chip.style.background = ev.color;

  const start = parseLocal(ev.startAt);
  const hhmm = ev.allDay ? 'Todo el día' : `${String(start.getHours()).padStart(2,'0')}:${String(start.getMinutes()).padStart(2,'0')}`;
  chip.textContent = `${hhmm} · ${ev.title}`;
  chip.title = ev.description || ev.title;
  chip.addEventListener('click', () => populateForm(ev));
  return chip;
}

function renderUpcoming() {
  const panel = document.getElementById('panel-proximos');
  const now = new Date();
  const upcoming = state.events
      .filter(e => parseLocal(e.endAt) >= now)
      .sort((a, b) => parseLocal(a.startAt) - parseLocal(b.startAt))
      .slice(0, 4);

  if (upcoming.length === 0) {
    panel.className = 'empty-card';
    panel.textContent = 'No hay eventos próximos';
    return;
  }
  panel.className = '';
  panel.innerHTML = upcoming.map(e => {
    const s = parseLocal(e.startAt);
    const when = e.allDay
        ? `${s.getDate()}/${s.getMonth()+1}`
        : `${s.getDate()}/${s.getMonth()+1} ${String(s.getHours()).padStart(2,'0')}:${String(s.getMinutes()).padStart(2,'0')}`;
    return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line)">
              <span style="font-weight:600">${escapeHtml(e.title)}</span>
              <span class="muted" style="font-size:12px">${when}</span>
            </div>`;
  }).join('');
}

function renderSummary() {
  const total = state.events.length;
  const todosTotal = state.todos.length;
  const todosDone  = state.todos.filter(t => t.done).length;

  document.getElementById('panel-resumen').textContent =
      `${total} evento${total === 1 ? '' : 's'} esta semana · ${todosDone}/${todosTotal} tareas`;
  const pct = todosTotal === 0 ? 0 : Math.round((todosDone / todosTotal) * 100);
  document.getElementById('objetivo-bar').style.width = `${pct}%`;
}

function renderTodos() {
  const list = document.getElementById('lista-todos');
  const panel = document.getElementById('panel-todos');

  if (state.todos.length === 0) {
    list.innerHTML = '<div class="empty-card">No hay tareas. ¡A descansar!</div>';
    panel.className = 'empty-card';
    panel.textContent = 'No hay tareas activas';
    return;
  }

  list.innerHTML = state.todos.map(t => `
    <div class="todo-row ${t.done ? 'done' : ''}" data-id="${t.id}">
      <span class="todo-checkbox ${t.done ? 'checked' : ''}" data-action="toggle">${t.done ? '✓' : ''}</span>
      <span class="todo-title">${escapeHtml(t.title)}</span>
      <span class="todo-priority ${t.priority}">${t.priority}</span>
      <button class="todo-delete" data-action="delete" title="Borrar">✕</button>
    </div>
  `).join('');

  // Bottom main-panel quick view: active todos only
  const active = state.todos.filter(t => !t.done).slice(0, 4);
  if (active.length === 0) {
    panel.className = 'empty-card';
    panel.textContent = 'Todas las tareas completadas 🎉';
  } else {
    panel.className = '';
    panel.innerHTML = active.map(t => `
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line)">
        <span>${escapeHtml(t.title)}</span>
        <span class="todo-priority ${t.priority}" style="font-size:10px">${t.priority}</span>
      </div>`).join('');
  }
}

function renderColorPicker() {
  const picker = document.getElementById('picker-color');
  picker.innerHTML = COLORS.map(c =>
      `<span class="color-swatch ${c === state.selectedColor ? 'active' : ''}"
             style="background:${c}" data-color="${c}"></span>`
  ).join('');
  picker.querySelectorAll('.color-swatch').forEach(el => {
    el.addEventListener('click', () => {
      state.selectedColor = el.dataset.color;
      renderColorPicker();
    });
  });
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, s =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}

// ----- Form handling ---------------------------------------------------------
function prefillNewEvent(day) {
  resetForm();
  const start = new Date(day);
  start.setHours(9, 0, 0, 0);
  const end = new Date(day);
  end.setHours(10, 0, 0, 0);
  document.getElementById('inicio').value = toLocalIso(start);
  document.getElementById('fin').value    = toLocalIso(end);
  document.getElementById('dia').value    = toLocalDate(day);
  document.getElementById('titulo').focus();
}

function populateForm(ev) {
  state.editingId = ev.id;
  document.getElementById('form-titulo-cabecera').textContent = 'Editar evento';
  document.getElementById('evento-id').value = ev.id;
  document.getElementById('titulo').value = ev.title || '';
  document.getElementById('ubicacion').value = ev.location || '';
  document.getElementById('descripcion').value = ev.description || '';
  document.getElementById('all-day').checked = !!ev.allDay;
  toggleAllDayInputs(!!ev.allDay);
  if (ev.startAt) {
    document.getElementById('inicio').value = toLocalIso(parseLocal(ev.startAt));
    document.getElementById('dia').value    = toLocalDate(parseLocal(ev.startAt));
  }
  if (ev.endAt) {
    document.getElementById('fin').value = toLocalIso(parseLocal(ev.endAt));
  }
  state.selectedColor = ev.color || COLORS[0];
  renderColorPicker();
  document.getElementById('btn-borrar').style.display = 'block';
}

function resetForm() {
  state.editingId = null;
  document.getElementById('form-titulo-cabecera').textContent = 'Crear nuevo evento';
  document.getElementById('form-evento').reset();
  document.getElementById('evento-id').value = '';
  document.getElementById('btn-borrar').style.display = 'none';
  state.selectedColor = COLORS[0];
  renderColorPicker();
  toggleAllDayInputs(false);
}

function toggleAllDayInputs(allDay) {
  document.getElementById('campos-horarios').style.display = allDay ? 'none' : 'grid';
  document.getElementById('campos-dia').style.display      = allDay ? 'block' : 'none';
  document.getElementById('inicio').required = !allDay;
  document.getElementById('fin').required    = !allDay;
  document.getElementById('dia').required    = allDay;
}

function readFormPayload() {
  const allDay = document.getElementById('all-day').checked;
  const title = document.getElementById('titulo').value.trim();
  const location = document.getElementById('ubicacion').value.trim();
  const description = document.getElementById('descripcion').value.trim();

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
  }

  return { title, location, description, startAt, endAt, allDay, color: state.selectedColor };
}

async function submitEvent(e) {
  e.preventDefault();
  try {
    const payload = readFormPayload();
    if (state.editingId) {
      await api(`${API_EVENTS}/${state.editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await api(API_EVENTS, { method: 'POST', body: JSON.stringify(payload) });
    }
    resetForm();
    await refreshAll();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteEvent() {
  if (!state.editingId) return;
  if (!confirm('¿Borrar este evento?')) return;
  await api(`${API_EVENTS}/${state.editingId}`, { method: 'DELETE' });
  resetForm();
  await refreshAll();
}

// ----- Todos -----------------------------------------------------------------
async function submitTodo(e) {
  e.preventDefault();
  const titleInput = document.getElementById('todo-titulo');
  const priority   = document.getElementById('todo-prioridad').value;
  const title = titleInput.value.trim();
  if (!title) return;
  await api(API_TODOS, { method: 'POST', body: JSON.stringify({ title, priority }) });
  titleInput.value = '';
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

// ----- Sync ------------------------------------------------------------------
async function syncProvider(provider) {
  const status = document.getElementById('sync-status');
  status.textContent = `Sincronizando con ${provider}...`;
  try {
    const result = await api(`${API_SYNC}/${provider}?mode=full`, { method: 'POST' });
    status.textContent = `${provider}: ↓${result.imported} ✎${result.updated} ⨯${result.deleted} (${result.message})`;
    await refreshAll();
  } catch (err) {
    status.textContent = `Error con ${provider}: ${err.message}`;
  }
}

// ----- Orchestration ---------------------------------------------------------
async function refreshAll() {
  await Promise.all([loadEvents(), loadTodos()]);
  renderHeader();
  renderGrid();
  renderUpcoming();
  renderTodos();
  renderSummary();
}

async function refreshTodos() {
  await loadTodos();
  renderTodos();
  renderSummary();
}

function changeWeek(direction) {
  // direction: -1 prev, 0 today, 1 next
  if (direction === 0) {
    state.weekStart = startOfWeek(new Date());
  } else {
    state.weekStart = addDays(state.weekStart, direction * 7);
  }
  refreshAll();
}

// ----- Wiring ----------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  // Buttons
  document.getElementById('btn-prev').addEventListener('click', () => changeWeek(-1));
  document.getElementById('btn-hoy').addEventListener('click',  () => changeWeek(0));
  document.getElementById('btn-next').addEventListener('click', () => changeWeek(1));
  document.getElementById('btn-nuevo-evento').addEventListener('click', () => { resetForm(); document.getElementById('titulo').focus(); });
  document.getElementById('btn-nuevo-evento-fab').addEventListener('click', () => { resetForm(); document.getElementById('titulo').focus(); });
  document.getElementById('btn-cancelar').addEventListener('click', resetForm);
  document.getElementById('btn-borrar').addEventListener('click', deleteEvent);

  // All-day toggle
  document.getElementById('all-day').addEventListener('change', e => toggleAllDayInputs(e.target.checked));

  // Forms
  document.getElementById('form-evento').addEventListener('submit', submitEvent);
  document.getElementById('form-todo').addEventListener('submit', submitTodo);

  // Todo list (event delegation)
  document.getElementById('lista-todos').addEventListener('click', onTodoClick);

  // Search (debounced)
  let searchTimer;
  document.getElementById('buscador').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      state.search = e.target.value.trim();
      await loadEvents();
      renderGrid();
      renderUpcoming();
      renderSummary();
    }, 300);
  });

  // Sync
  document.getElementById('btn-sync-google').addEventListener('click', () => syncProvider('google'));
  document.getElementById('btn-sync-icloud').addEventListener('click', () => syncProvider('icloud'));

  renderColorPicker();
  refreshAll();
});
