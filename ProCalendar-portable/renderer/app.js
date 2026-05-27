// Pro Calendar - renderer (clean rewrite)
window.checkpoint = 1;

window.addEventListener('error', function (e) {
  try { document.title = '[ERR] ' + (e.message || 'unknown'); } catch (_) { }
});
window.addEventListener('unhandledrejection', function (e) {
  try {
    var msg = (e.reason && e.reason.message) ? e.reason.message : String(e.reason || 'unknown');
    document.title = '[ASYNC] ' + msg;
  } catch (_) { }
});

window.checkpoint = 2;

// =============================================================================
// UI helpers from ui.js (with fallbacks)
// =============================================================================
var UI = window.UI || {};
var toast = UI.toast || function (m) { console.log('[toast]', m); };
var confirmDialog = UI.confirmDialog || function (o) { return Promise.resolve(window.confirm((o && o.message) || '¿Confirmar?')); };
var attachDatePicker = UI.attachDatePicker || function (el) { if (el) el.textContent = 'YYYY-MM-DD'; return { value: '' }; };
var attachTimePicker = UI.attachTimePicker || function (el) { if (el) el.textContent = '09:00'; return { value: '09:00' }; };

// =============================================================================
// Constants
// =============================================================================
var API_BASE     = 'http://localhost:8080/api';
var API_EVENTS   = API_BASE + '/events';
var API_TODOS    = API_BASE + '/todos';
var API_SYNC     = API_BASE + '/sync';
var API_SETTINGS = API_BASE + '/settings';

var DAY_NAMES   = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
var DAY_NAMES_L = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
var MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

var COLORS = [
  { name:'indigo', value:'#4f46e5' }, { name:'teal', value:'#14b8a6' },
  { name:'red',    value:'#ef4444' }, { name:'amber',value:'#f59e0b' },
  { name:'purple', value:'#a855f7' }, { name:'pink', value:'#ec4899' },
  { name:'blue',   value:'#0a84ff' }, { name:'green',value:'#22c55e' }
];

var HOUR_HEIGHT = 56;

window.checkpoint = 3;

// =============================================================================
// State
// =============================================================================
var state = {
  view: 'week',
  cursorDate: new Date(),
  events: [],
  todos: [],
  icloudCalendars: [],
  editingId: null,
  selectedColor: COLORS[0].value,
  filterSource: 'all',
  search: '',
  taskFilter: 'all'
};

var pickers = { startDate:null, startTime:null, endDate:null, endTime:null, allDayDate:null };

// =============================================================================
// Date helpers
// =============================================================================
function pad(n) { return String(n).padStart(2,'0'); }
function addDays(d,n) { var r = new Date(d); r.setDate(r.getDate()+n); return r; }
function addMonths(d,n) { var r = new Date(d); r.setMonth(r.getMonth()+n); return r; }
function startOfWeek(d) {
  var r = new Date(d), day = r.getDay();
  r.setDate(r.getDate() + (day === 0 ? -6 : 1 - day));
  r.setHours(0,0,0,0);
  return r;
}
function startOfMonth(d) { var r = new Date(d); r.setDate(1); r.setHours(0,0,0,0); return r; }
function startOfMonthGrid(d) { return startOfWeek(startOfMonth(d)); }
function sameDay(a,b) { return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
function toLocalIso(d) { return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes()); }
function toLocalDate(d) { return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function parseLocal(v) { return v ? new Date(v) : null; }
function fmtHM(d) { return pad(d.getHours())+':'+pad(d.getMinutes()); }
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
  });
}
function fmtWeekRange(ws) {
  var last = addDays(ws,6);
  if (ws.getMonth() === last.getMonth())
    return ws.getDate()+' – '+last.getDate()+' '+MONTH_NAMES[ws.getMonth()]+' '+ws.getFullYear();
  return ws.getDate()+' '+MONTH_NAMES[ws.getMonth()]+' – '+last.getDate()+' '+MONTH_NAMES[last.getMonth()]+' '+ws.getFullYear();
}

window.checkpoint = 4;

// =============================================================================
// API
// =============================================================================
function api(url, opts) {
  opts = opts || {};
  opts.headers = opts.headers || { 'Content-Type':'application/json' };
  return fetch(url, opts).then(function (res) {
    if (!res.ok) return res.text().then(function (t) { throw new Error(res.status+' '+res.statusText+' '+t); });
    if (res.status === 204) return null;
    return res.json();
  });
}

function activeRange() {
  if (state.view === 'day') {
    var s = new Date(state.cursorDate); s.setHours(0,0,0,0);
    return [s, addDays(s,1)];
  }
  if (state.view === 'week') {
    var sw = startOfWeek(state.cursorDate);
    return [sw, addDays(sw,7)];
  }
  var sm = startOfMonthGrid(state.cursorDate);
  return [sm, addDays(sm,42)];
}

function loadEvents() {
  var r = activeRange();
  var url = state.search
    ? API_EVENTS + '?q=' + encodeURIComponent(state.search)
    : API_EVENTS + '?from=' + toLocalIso(r[0]) + '&to=' + toLocalIso(r[1]);
  return api(url).then(function (data) { state.events = data || []; })
    .catch(function (e) { console.error('loadEvents', e); state.events = []; });
}

function loadTodos() {
  return api(API_TODOS).then(function (data) { state.todos = data || []; })
    .catch(function (e) { console.error('loadTodos', e); state.todos = []; });
}

function loadIcloudCalendars() {
  return api(API_SYNC + '/icloud/calendars').then(function (data) {
    state.icloudCalendars = data || [];
    populateCalendarSelect();
  }).catch(function () { state.icloudCalendars = []; });
}

function populateCalendarSelect() {
  var sel = document.getElementById('cal-target');
  if (!sel) return;
  var current = sel.value;
  var html = '<option value="">Solo local (sin sincronizar)</option>';
  for (var i=0; i<state.icloudCalendars.length; i++) {
    var c = state.icloudCalendars[i];
    html += '<option value="'+escapeHtml(c.url)+'" data-name="'+escapeHtml(c.name)+'">'+escapeHtml(c.name)+'</option>';
  }
  sel.innerHTML = html;
  if (current) sel.value = current;
}

function visibleEvents() {
  if (state.filterSource === 'all') return state.events;
  return state.events.filter(function (e) { return (e.source || 'LOCAL') === state.filterSource; });
}

window.checkpoint = 5;

// =============================================================================
// Header
// =============================================================================
function renderHeader() {
  var titleEl = document.getElementById('title-main');
  var subEl   = document.getElementById('title-sub');
  if (!titleEl) return;
  if (state.view === 'week') {
    var ws = startOfWeek(state.cursorDate);
    titleEl.textContent = fmtWeekRange(ws);
    if (subEl) subEl.textContent = 'Semana';
  } else if (state.view === 'month') {
    titleEl.textContent = MONTH_NAMES[state.cursorDate.getMonth()] + ' ' + state.cursorDate.getFullYear();
    if (subEl) subEl.textContent = '';
  } else {
    var d = state.cursorDate;
    titleEl.textContent = d.getDate() + ' ' + MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear();
    if (subEl) subEl.textContent = DAY_NAMES_L[(d.getDay()+6)%7];
  }
}

// =============================================================================
// Week / Day / Month rendering
// =============================================================================
function eventOccursOnDay(ev, day) {
  var s = parseLocal(ev.startAt);
  var e = parseLocal(ev.endAt) || s;
  if (!s) return false;
  var ds = new Date(day); ds.setHours(0,0,0,0);
  var de = addDays(ds,1);
  return s < de && e >= ds;
}

function chipBg(ev) { return ev.color || 'var(--accent)'; }

function buildPositionedEventCard(ev, day) {
  var s = parseLocal(ev.startAt);
  var e = parseLocal(ev.endAt) || new Date(s.getTime()+3600000);
  var startMin = s.getHours()*60 + s.getMinutes();
  var endMin   = e.getHours()*60 + e.getMinutes() + (e.getDate() !== s.getDate() ? 1440 : 0);
  var top    = (startMin/60) * HOUR_HEIGHT;
  var height = Math.max(20, ((endMin - startMin)/60) * HOUR_HEIGHT - 2);
  var card = document.createElement('div');
  card.className = 'event-card' + (height < 38 ? ' short' : '');
  card.dataset.id = ev.id;
  card.style.top = top+'px';
  card.style.height = height+'px';
  card.style.background = chipBg(ev);
  card.style.color = '#fff';
  var calBadge = ev.calendarName ? '<span class="cal-pill">'+escapeHtml(ev.calendarName)+'</span>' : '';
  card.innerHTML = '<div class="ev-title">'+escapeHtml(ev.title)+calBadge+'</div>'
                 + '<div class="ev-meta">'+fmtHM(s)+' – '+fmtHM(e)+(ev.location ? ' · '+escapeHtml(ev.location) : '')+'</div>';
  card.addEventListener('click', function (event) {
    event.stopPropagation();
    openModalForEdit(Number(card.dataset.id));
  });
  return card;
}

function renderWeekView() {
  var weekStart = startOfWeek(state.cursorDate);
  var today = new Date(); today.setHours(0,0,0,0);

  var head = document.getElementById('week-header');
  if (head) {
    var hh = '<div class="tz-cell"></div>';
    for (var i=0; i<7; i++) {
      var d = addDays(weekStart,i);
      var cls = sameDay(d,today) ? ' today' : '';
      hh += '<div class="dow-cell'+cls+'"><div class="dow-name">'+DAY_NAMES[i]+'</div><div class="dow-num">'+d.getDate()+'</div></div>';
    }
    head.innerHTML = hh;
  }

  var allDay = document.getElementById('allday-row');
  if (allDay) {
    var ah = '<div class="allday-label">Todo el día</div>';
    for (var j=0; j<7; j++) {
      var dd = addDays(weekStart,j);
      var ev = visibleEvents().filter(function (e) { return e.allDay && eventOccursOnDay(e,dd); });
      var chips = '';
      for (var k=0; k<ev.length; k++) {
        chips += '<div class="event-card allday-chip" data-id="'+ev[k].id+'" style="background:'+chipBg(ev[k])+';color:#fff">'+escapeHtml(ev[k].title)+'</div>';
      }
      ah += '<div class="allday-cell" data-day="'+toLocalDate(dd)+'">'+chips+'</div>';
    }
    allDay.innerHTML = ah;
    allDay.querySelectorAll('.event-card[data-id]').forEach(function (el) {
      el.addEventListener('click', function (e) { e.stopPropagation(); openModalForEdit(Number(el.dataset.id)); });
    });
  }

  var grid = document.getElementById('week-grid');
  if (!grid) return;
  grid.innerHTML = '';
  var timeCol = document.createElement('div');
  timeCol.className = 'time-col';
  for (var h=0; h<24; h++) {
    var c = document.createElement('div');
    c.className = 'time-cell';
    c.textContent = pad(h)+':00';
    timeCol.appendChild(c);
  }
  grid.appendChild(timeCol);

  for (var ci=0; ci<7; ci++) {
    var day = addDays(weekStart, ci);
    var col = document.createElement('div');
    col.className = 'day-col' + (sameDay(day,today) ? ' today-col' : '');
    for (var sh=0; sh<24; sh++) {
      var slot = document.createElement('div');
      slot.className = 'hour-slot';
      (function (dayCopy, hourCopy) {
        slot.addEventListener('click', function () { openModalForNew(dayCopy, hourCopy); });
      })(day, sh);
      col.appendChild(slot);
    }
    var evs = visibleEvents().filter(function (e) { return !e.allDay && eventOccursOnDay(e, day); });
    for (var ei=0; ei<evs.length; ei++) col.appendChild(buildPositionedEventCard(evs[ei], day));
    grid.appendChild(col);
  }

  // Auto-scroll to 07:00 first time
  var wrap = document.getElementById('week-body-wrap');
  if (wrap && !wrap.dataset.scrolled) { wrap.scrollTop = 7 * HOUR_HEIGHT; wrap.dataset.scrolled = '1'; }
}

function renderDayView() {
  var day = state.cursorDate;
  var grid = document.getElementById('day-grid');
  if (!grid) return;
  grid.innerHTML = '';
  var timeCol = document.createElement('div');
  timeCol.className = 'time-col';
  for (var h=0; h<24; h++) {
    var c = document.createElement('div');
    c.className = 'time-cell';
    c.textContent = pad(h)+':00';
    timeCol.appendChild(c);
  }
  grid.appendChild(timeCol);
  var col = document.createElement('div');
  col.className = 'day-col today-col';
  for (var sh=0; sh<24; sh++) {
    var slot = document.createElement('div');
    slot.className = 'hour-slot';
    (function (h) { slot.addEventListener('click', function () { openModalForNew(day, h); }); })(sh);
    col.appendChild(slot);
  }
  var evs = visibleEvents().filter(function (e) { return !e.allDay && eventOccursOnDay(e, day); });
  for (var ei=0; ei<evs.length; ei++) col.appendChild(buildPositionedEventCard(evs[ei], day));
  grid.appendChild(col);
}

function renderMonthView() {
  var dowEl = document.getElementById('month-dow');
  if (dowEl) {
    var h = '';
    for (var i=0; i<7; i++) h += '<div>'+DAY_NAMES[i]+'</div>';
    dowEl.innerHTML = h;
  }
  var grid = document.getElementById('month-grid');
  if (!grid) return;
  var gridStart = startOfMonthGrid(state.cursorDate);
  var month = state.cursorDate.getMonth();
  var today = new Date(); today.setHours(0,0,0,0);
  var html = '';
  for (var i=0; i<42; i++) {
    var day = addDays(gridStart, i);
    var isOther = day.getMonth() !== month;
    var isToday = sameDay(day, today);
    var evs = visibleEvents().filter(function (e) { return eventOccursOnDay(e, day); });
    var chips = '';
    var shown = Math.min(evs.length, 3);
    for (var j=0; j<shown; j++) {
      var ev = evs[j];
      var time = ev.allDay ? '' : (pad(parseLocal(ev.startAt).getHours())+':'+pad(parseLocal(ev.startAt).getMinutes())+' ');
      chips += '<div class="mc-event" data-id="'+ev.id+'" style="background:'+chipBg(ev)+'">'+time+escapeHtml(ev.title)+'</div>';
    }
    if (evs.length > 3) chips += '<div class="mc-more">+'+(evs.length-3)+' más</div>';
    html += '<div class="month-cell '+(isOther?'other-month':'')+' '+(isToday?'today':'')+'" data-date="'+toLocalDate(day)+'">'
          + '<div class="mc-date">'+day.getDate()+'</div>'+chips+'</div>';
  }
  grid.innerHTML = html;
  grid.querySelectorAll('.month-cell').forEach(function (cell) {
    cell.addEventListener('click', function (e) {
      if (e.target.dataset.id) openModalForEdit(Number(e.target.dataset.id));
      else openModalForNew(new Date(cell.dataset.date));
    });
  });
}

window.checkpoint = 6;

// =============================================================================
// Right panel + bottom panels
// =============================================================================
function formatDueLabel(s) {
  var d = parseLocal(s);
  var today = new Date(); today.setHours(0,0,0,0);
  var dd = new Date(d); dd.setHours(0,0,0,0);
  var diff = Math.round((dd - today)/86400000);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  if (diff === -1) return 'Ayer';
  return d.getDate()+'/'+(d.getMonth()+1);
}

function renderRightPanel() {
  var list = document.getElementById('todo-list');
  var label = document.getElementById('rp-today-label');
  var now = new Date();
  if (label) label.textContent = DAY_NAMES_L[(now.getDay()+6)%7] + ', ' + now.getDate() + ' de ' + MONTH_NAMES[now.getMonth()];
  if (!list) return;
  if (state.todos.length === 0) {
    list.innerHTML = '<div class="empty-card">Sin tareas</div>';
    return;
  }
  var checkSvg = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  var html = '';
  for (var i=0; i<state.todos.length; i++) {
    var t = state.todos[i];
    html += '<div class="todo-row '+(t.done?'done':'')+'" data-id="'+t.id+'">'
          + '<span class="todo-checkbox '+(t.done?'checked':'')+'" data-action="toggle">'+checkSvg+'</span>'
          + '<div class="todo-content"><div class="todo-title">'+escapeHtml(t.title)+'</div>'
          + '<div class="todo-meta"><span class="priority-pill '+t.priority+'">'+t.priority+'</span>'
          + (t.dueAt ? '<span>'+formatDueLabel(t.dueAt)+'</span>' : '') + '</div></div>'
          + '<div class="todo-actions"><button class="todo-delete" data-action="delete" title="Borrar">×</button></div>'
          + '</div>';
  }
  list.innerHTML = html;
}

function renderBottomPanels() {
  var pEl = document.getElementById('panel-priorities');
  var prio = state.todos.filter(function (t) { return !t.done && t.priority === 'HIGH'; }).slice(0,4);
  if (pEl) {
    if (!prio.length) pEl.innerHTML = '<div class="empty-card">No hay prioridades</div>';
    else {
      var ph = '';
      for (var i=0; i<prio.length; i++) ph += '<div class="priority-row"><div class="pr-title">'+escapeHtml(prio[i].title)+'</div><span class="priority-pill HIGH">High</span></div>';
      pEl.innerHTML = ph;
    }
  }
  var dEl = document.getElementById('panel-deadlines');
  if (dEl) {
    var now = new Date();
    var upcoming = state.events.filter(function (e) { var s = parseLocal(e.startAt); return s && s >= now; })
                               .sort(function (a,b) { return parseLocal(a.startAt) - parseLocal(b.startAt); })
                               .slice(0,4);
    if (!upcoming.length) dEl.innerHTML = '<div class="empty-card">Sin próximos eventos</div>';
    else {
      var dh = '';
      for (var j=0; j<upcoming.length; j++) {
        var e = upcoming[j], s = parseLocal(e.startAt);
        dh += '<div class="deadline-row"><div class="deadline-date"><div class="dd-mon">'+MONTH_NAMES[s.getMonth()].slice(0,3).toUpperCase()+'</div><div class="dd-day">'+s.getDate()+'</div></div>'
            + '<div class="deadline-meta"><div class="dm-title">'+escapeHtml(e.title)+'</div><div class="dm-sub">'+(e.allDay?'Todo el día':fmtHM(s))+(e.calendarName?' · '+escapeHtml(e.calendarName):'')+'</div></div></div>';
      }
      dEl.innerHTML = dh;
    }
  }
  var stats = document.getElementById('panel-stats');
  if (stats) {
    var totalE = state.events.length;
    var totalT = state.todos.length;
    var doneT  = state.todos.filter(function (t){ return t.done; }).length;
    var busyMin = 0;
    for (var k=0; k<state.events.length; k++) {
      var ev = state.events[k];
      if (ev.allDay) continue;
      var s = parseLocal(ev.startAt), e = parseLocal(ev.endAt);
      if (s && e) busyMin += Math.max(0, (e-s)/60000);
    }
    var busyH = (busyMin/60).toFixed(1);
    stats.innerHTML = '<div class="stat"><div class="stat-label">Eventos</div><div class="stat-value">'+totalE+'</div></div>'
                    + '<div class="stat"><div class="stat-label">Horas</div><div class="stat-value">'+busyH+'h</div></div>'
                    + '<div class="stat"><div class="stat-label">Tareas</div><div class="stat-value">'+doneT+'/'+totalT+'</div></div>'
                    + '<div class="stat"><div class="stat-label">Estado</div><div class="stat-value" style="font-size:13px">Activo</div></div>';
  }
}

window.checkpoint = 7;

// =============================================================================
// Modal: create/edit event
// =============================================================================
function openModalForNew(day, hour) {
  resetForm();
  var s = new Date(day);
  s.setHours(hour != null ? hour : 9, 0, 0, 0);
  var e = new Date(s); e.setHours(s.getHours()+1);
  if (pickers.startDate) pickers.startDate.value = toLocalDate(s);
  if (pickers.startTime) pickers.startTime.value = fmtHM(s);
  if (pickers.endDate)   pickers.endDate.value   = toLocalDate(e);
  if (pickers.endTime)   pickers.endTime.value   = fmtHM(e);
  if (pickers.allDayDate) pickers.allDayDate.value = toLocalDate(day);
  showModal();
  var t = document.getElementById('titulo'); if (t) t.focus();
}

function openModalForEdit(id) {
  var ev = null;
  for (var i=0; i<state.events.length; i++) if (state.events[i].id === id) { ev = state.events[i]; break; }
  if (!ev) return;
  resetForm();
  state.editingId = id;
  setText('modal-title-text', 'Editar evento');
  setVal('evento-id', id);
  setVal('titulo', ev.title || '');
  setVal('ubicacion', ev.location || '');
  setVal('descripcion', ev.description || '');
  var allDayEl = document.getElementById('all-day');
  if (allDayEl) allDayEl.checked = !!ev.allDay;
  toggleAllDayInputs(!!ev.allDay);
  if (ev.startAt) {
    var sd = parseLocal(ev.startAt);
    if (pickers.startDate) pickers.startDate.value = toLocalDate(sd);
    if (pickers.startTime) pickers.startTime.value = fmtHM(sd);
    if (pickers.allDayDate) pickers.allDayDate.value = toLocalDate(sd);
  }
  if (ev.endAt) {
    var ed = parseLocal(ev.endAt);
    if (pickers.endDate) pickers.endDate.value = toLocalDate(ed);
    if (pickers.endTime) pickers.endTime.value = fmtHM(ed);
  }
  state.selectedColor = ev.color || COLORS[0].value;
  renderColorPicker();
  var sel = document.getElementById('cal-target');
  if (sel) sel.value = ev.externalCalendarId || '';
  show('btn-borrar');
  show('btn-to-todo');
  showModal();
}

function setText(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }
function setVal(id, v)  { var el = document.getElementById(id); if (el) el.value = v; }
function show(id, disp) { var el = document.getElementById(id); if (el) el.style.display = disp || 'inline-flex'; }
function hide(id)       { var el = document.getElementById(id); if (el) el.style.display = 'none'; }

function showModal() { var m = document.getElementById('modal-event'); if (m) m.classList.add('show'); }
function hideModal() { var m = document.getElementById('modal-event'); if (m) m.classList.remove('show'); }

function resetForm() {
  state.editingId = null;
  setText('modal-title-text', 'Nuevo evento');
  setVal('titulo', '');
  setVal('ubicacion', '');
  setVal('descripcion', '');
  setVal('evento-id', '');
  var ad = document.getElementById('all-day'); if (ad) ad.checked = false;
  hide('btn-borrar');
  hide('btn-to-todo');
  var sel = document.getElementById('cal-target'); if (sel) sel.value = '';
  state.selectedColor = COLORS[0].value;
  renderColorPicker();
  toggleAllDayInputs(false);
}

function toggleAllDayInputs(allDay) {
  var h = document.getElementById('campos-horarios'); if (h) h.style.display = allDay ? 'none' : 'block';
  var d = document.getElementById('campos-dia');      if (d) d.style.display = allDay ? 'block' : 'none';
}

function renderColorPicker() {
  var p = document.getElementById('picker-color');
  if (!p) return;
  var html = '';
  for (var i=0; i<COLORS.length; i++) {
    var c = COLORS[i];
    html += '<span class="color-swatch '+(c.value===state.selectedColor?'active':'')+'" style="background:'+c.value+'" data-color="'+c.value+'"></span>';
  }
  p.innerHTML = html;
  p.querySelectorAll('.color-swatch').forEach(function (sw) {
    sw.addEventListener('click', function () { state.selectedColor = sw.dataset.color; renderColorPicker(); });
  });
}

function readFormPayload() {
  var ad = document.getElementById('all-day');
  var allDay = ad && ad.checked;
  var title = (document.getElementById('titulo') || {}).value || '';
  title = title.trim();
  if (!title) throw new Error('El título es obligatorio');
  var startAt, endAt;
  if (allDay) {
    var dia = pickers.allDayDate ? pickers.allDayDate.value : '';
    if (!dia) throw new Error('Selecciona un día');
    startAt = dia + 'T00:00:00';
    endAt   = dia + 'T23:59:00';
  } else {
    var sd = pickers.startDate ? pickers.startDate.value : '';
    var st = pickers.startTime ? pickers.startTime.value : '';
    var ed = pickers.endDate   ? pickers.endDate.value   : '';
    var et = pickers.endTime   ? pickers.endTime.value   : '';
    if (!sd || !st || !ed || !et) throw new Error('Indica inicio y fin');
    startAt = sd + 'T' + st + ':00';
    endAt   = ed + 'T' + et + ':00';
    if (new Date(endAt) <= new Date(startAt)) throw new Error('Fin debe ser posterior al inicio');
  }
  var sel = document.getElementById('cal-target');
  var targetUrl = sel ? sel.value : '';
  var targetName = (sel && sel.selectedOptions[0]) ? (sel.selectedOptions[0].dataset.name || null) : null;
  return {
    title: title,
    location: (document.getElementById('ubicacion') || {}).value || '',
    description: (document.getElementById('descripcion') || {}).value || '',
    startAt: startAt, endAt: endAt, allDay: !!allDay,
    color: state.selectedColor,
    externalCalendarId: targetUrl || null,
    calendarName: targetName
  };
}

function saveEvent() {
  try {
    var payload = readFormPayload();
    var url = state.editingId ? API_EVENTS + '/' + state.editingId : API_EVENTS;
    var method = state.editingId ? 'PUT' : 'POST';
    api(url, { method: method, body: JSON.stringify(payload) })
      .then(function () { hideModal(); refreshAll(); toast('Evento guardado','ok'); })
      .catch(function (err) { toast(err.message,'err'); });
  } catch (err) { toast(err.message,'err'); }
}

function deleteEvent() {
  if (!state.editingId) return;
  var ev = null;
  for (var i=0; i<state.events.length; i++) if (state.events[i].id === state.editingId) { ev = state.events[i]; break; }
  var cascade = false;
  var p;
  if (ev && ev.source === 'ICLOUD') {
    p = confirmDialog({ title:'Borrar evento de iCloud', message:'Se borrará también en tu iPhone tras la próxima sincronización.', confirmText:'Borrar en iCloud', danger:true });
    cascade = true;
  } else {
    p = confirmDialog({ title:'¿Borrar este evento?', confirmText:'Borrar', danger:true });
  }
  p.then(function (ok) {
    if (!ok) return;
    api(API_EVENTS + '/' + state.editingId + '?cascade=' + cascade, { method:'DELETE' })
      .then(function () { hideModal(); refreshAll(); toast('Evento borrado','ok'); })
      .catch(function (err) { toast('No se pudo borrar: '+err.message,'err'); });
  });
}

window.checkpoint = 8;

// =============================================================================
// Todos
// =============================================================================
function submitTodo(e) {
  e.preventDefault();
  var titleEl = document.getElementById('todo-titulo');
  var title = titleEl ? titleEl.value.trim() : '';
  if (!title) return;
  var prio = document.getElementById('todo-prioridad');
  var due  = document.getElementById('todo-due');
  var payload = { title: title, priority: prio ? prio.value : 'MEDIUM' };
  if (due && due.value) payload.dueAt = due.value + 'T09:00:00';
  api(API_TODOS, { method:'POST', body: JSON.stringify(payload) })
    .then(function () { if (titleEl) titleEl.value = ''; if (due) due.value = ''; refreshTodos(); });
}

function onTodoClick(e) {
  var row = e.target.closest('.todo-row');
  if (!row) return;
  var id = row.dataset.id;
  var action = e.target.dataset.action;
  if (action === 'toggle') {
    api(API_TODOS + '/' + id + '/toggle', { method:'POST' }).then(refreshTodos);
  } else if (action === 'delete') {
    api(API_TODOS + '/' + id, { method:'DELETE' }).then(refreshTodos);
  }
}

window.checkpoint = 9;

// =============================================================================
// Sync
// =============================================================================
function setStatus(msg, kind) {
  var el = document.getElementById('sync-status');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.remove('ok','err','busy');
  if (msg) el.classList.add(kind || 'busy');
}

function syncIcloud() {
  setStatus('Sincronizando…','busy');
  api(API_SYNC + '/icloud?mode=full', { method:'POST' })
    .then(function (r) {
      r = r || {};
      var msg = (r.message || '').toLowerCase();
      var bad = msg.indexOf('error') >= 0 || msg.indexOf('deshabilitado') >= 0 || msg.indexOf('faltan') >= 0;
      if (bad) {
        setStatus('Error: ' + (r.message || 'sync falló'), 'err');
      } else {
        var imp = r.imported || 0, upd = r.updated || 0;
        if (imp + upd === 0) setStatus('Sincronizado (sin cambios)', 'ok');
        else                 setStatus('Sincronizado: '+imp+' nuevos, '+upd+' actualizados', 'ok');
      }
      return loadIcloudCalendars().then(refreshAll);
    })
    .catch(function (e) { setStatus('Error: '+e.message,'err'); });
}

function startGoogleOAuth() {
  var url = 'http://localhost:8080/oauth2/authorization/google';
  if (window.electronAPI && window.electronAPI.openExternal) window.electronAPI.openExternal(url);
  else window.open(url, '_blank');
}

window.checkpoint = 10;

// =============================================================================
// Navigation / View switching
// =============================================================================
function setView(view) {
  state.view = view;
  document.querySelectorAll('.view-tab').forEach(function (t) { t.classList.toggle('active', t.dataset.view === view); });
  showOnly(view);
  refreshAll();
}

function showOnly(view) {
  var tasksOn = (view === 'tasks');
  setDisplay('view-tasks', tasksOn ? 'flex' : 'none');
  setDisplay('view-week',  (!tasksOn && view==='week')  ? 'flex' : 'none');
  setDisplay('view-month', (!tasksOn && view==='month') ? 'flex' : 'none');
  setDisplay('view-day',   (!tasksOn && view==='day')   ? 'flex' : 'none');
  var bp = document.querySelector('.bottom-panels'); if (bp) bp.style.display = tasksOn ? 'none' : 'grid';
  var tr = document.querySelector('.title-row');     if (tr) tr.style.display = tasksOn ? 'none' : 'flex';
}
function setDisplay(id, val) { var el = document.getElementById(id); if (el) el.style.display = val; }

function changeRange(dir) {
  if (dir === 0) state.cursorDate = new Date();
  else if (state.view === 'month') state.cursorDate = addMonths(state.cursorDate, dir);
  else if (state.view === 'week')  state.cursorDate = addDays(state.cursorDate, dir*7);
  else state.cursorDate = addDays(state.cursorDate, dir);
  refreshAll();
}

function setSourceFilter(src) {
  state.filterSource = src;
  document.querySelectorAll('.cal-list .nav-item').forEach(function (el) { el.classList.toggle('active', el.dataset.cal === src); });
  renderCurrentView();
}

function renderCurrentView() {
  if (state.view === 'week')  renderWeekView();
  if (state.view === 'month') renderMonthView();
  if (state.view === 'day')   renderDayView();
}

function refreshAll() {
  return Promise.all([loadEvents(), loadTodos()]).then(function () {
    renderHeader();
    renderCurrentView();
    renderRightPanel();
    renderBottomPanels();
  });
}

function refreshTodos() {
  return loadTodos().then(function () { renderRightPanel(); renderBottomPanels(); });
}

window.checkpoint = 11;

// =============================================================================
// Tasks view
// =============================================================================
function renderTasksView() {
  var list = document.getElementById('tasks-list-main');
  var title = document.getElementById('tasks-list-title');
  var count = document.getElementById('tasks-count');
  if (!list) return;
  var filter = state.taskFilter || 'all';
  var today = new Date(); today.setHours(0,0,0,0);
  var tomorrow = addDays(today,1);
  var items = state.todos.slice();
  if (filter === 'today')    items = items.filter(function (t){ return t.dueAt && new Date(t.dueAt) >= today && new Date(t.dueAt) < tomorrow; });
  if (filter === 'upcoming') items = items.filter(function (t){ return !t.done && (!t.dueAt || new Date(t.dueAt) >= today); });
  if (filter === 'done')     items = items.filter(function (t){ return t.done; });
  var titles = { all:'Todas las tareas', today:'Hoy', upcoming:'Próximas', done:'Completadas' };
  if (title) title.textContent = titles[filter] || 'Tareas';
  if (count) count.textContent = items.length + ' tarea' + (items.length===1?'':'s');
  if (!items.length) { list.innerHTML = '<div class="empty-card">Sin tareas</div>'; return; }
  var checkSvg = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  var html = '';
  for (var i=0; i<items.length; i++) {
    var t = items[i];
    html += '<div class="todo-row '+(t.done?'done':'')+'" data-id="'+t.id+'">'
          + '<span class="todo-checkbox '+(t.done?'checked':'')+'" data-action="toggle">'+checkSvg+'</span>'
          + '<div class="todo-content"><div class="todo-title">'+escapeHtml(t.title)+'</div>'
          + '<div class="todo-meta"><span class="priority-pill '+t.priority+'">'+t.priority+'</span>'
          + (t.dueAt?'<span>'+formatDueLabel(t.dueAt)+'</span>':'') + '</div></div></div>';
  }
  list.innerHTML = html;
  list.querySelectorAll('.todo-row').forEach(function (row) {
    row.addEventListener('click', function (e) {
      var id = Number(row.dataset.id);
      if (e.target.dataset.action === 'toggle') api(API_TODOS+'/'+id+'/toggle',{method:'POST'}).then(refreshTodos).then(renderTasksView);
      else renderTaskDetail(id);
    });
  });
}

function renderTaskDetail(id) {
  var t = null;
  for (var i=0; i<state.todos.length; i++) if (state.todos[i].id === id) { t = state.todos[i]; break; }
  var det = document.getElementById('tasks-detail');
  if (!t || !det) return;
  det.innerHTML = '<h3 style="margin:0 0 12px;font-size:16px;font-weight:600">'+escapeHtml(t.title)+'</h3>'
                + '<div class="task-detail-field"><div class="field-label">Estado</div><div>'+(t.done?'Completada':'Pendiente')+'</div></div>'
                + '<div class="task-detail-field"><div class="field-label">Prioridad</div><div><span class="priority-pill '+t.priority+'">'+t.priority+'</span></div></div>'
                + (t.dueAt ? '<div class="task-detail-field"><div class="field-label">Vence</div><div>'+formatDueLabel(t.dueAt)+'</div></div>' : '')
                + (t.notes ? '<div class="task-detail-field"><div class="field-label">Notas</div><div style="font-size:13px">'+escapeHtml(t.notes)+'</div></div>' : '')
                + '<button class="btn danger btn-sm" id="td-delete" style="margin-top:12px">Borrar</button>';
  document.getElementById('td-delete').addEventListener('click', function () {
    confirmDialog({ title:'Borrar tarea', message:t.title, confirmText:'Borrar', danger:true }).then(function (ok) {
      if (!ok) return;
      api(API_TODOS+'/'+id, { method:'DELETE' }).then(refreshTodos).then(function () {
        renderTasksView();
        det.innerHTML = '<div class="empty-card">Selecciona una tarea para ver detalles</div>';
      });
    });
  });
}

window.checkpoint = 12;

// =============================================================================
// Theme + Settings
// =============================================================================
function applyTheme(t) {
  localStorage.setItem('theme', t);
  if (t === 'auto') {
    var dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } else {
    document.documentElement.dataset.theme = t;
  }
  document.querySelectorAll('#theme-segmented button').forEach(function (b) {
    b.classList.toggle('active', b.dataset.theme === t);
  });
}

function openSettings() {
  api(API_SETTINGS).then(function (s) {
    s = s || {};
    setVal('s-icloud-id',  s['icloud.appleId']     || '');
    setVal('s-icloud-pwd', s['icloud.appPassword'] || '');
    setVal('s-icloud-url', s['icloud.calendarUrl'] || '');
    var en = document.getElementById('s-icloud-enabled'); if (en) en.checked = s['icloud.enabled'] === 'true';
    setVal('s-google-id',     s['google.clientId']    || '');
    setVal('s-google-secret', s['google.clientSecret']|| '');
    var ge = document.getElementById('s-google-enabled'); if (ge) ge.checked = s['google.enabled'] === 'true';
    var ae = document.getElementById('s-autosync-enabled'); if (ae) ae.checked = s['sync.autoEnabled'] !== 'false';
    setVal('s-autosync-minutes', s['sync.autoMinutes'] || '5');
  }).catch(function () {}).then(function () {
    var m = document.getElementById('modal-settings'); if (m) m.classList.add('show');
  });
}

function hideSettings() { var m = document.getElementById('modal-settings'); if (m) m.classList.remove('show'); }

function saveSettings() {
  var patch = {
    'icloud.appleId':      (document.getElementById('s-icloud-id') || {}).value || '',
    'icloud.appPassword':  (document.getElementById('s-icloud-pwd') || {}).value || '',
    'icloud.calendarUrl':  (document.getElementById('s-icloud-url') || {}).value || '',
    'icloud.enabled':      String((document.getElementById('s-icloud-enabled') || {}).checked || false),
    'google.clientId':     (document.getElementById('s-google-id') || {}).value || '',
    'google.clientSecret': (document.getElementById('s-google-secret') || {}).value || '',
    'google.enabled':      String((document.getElementById('s-google-enabled') || {}).checked || false),
    'sync.autoEnabled':    String((document.getElementById('s-autosync-enabled') || {}).checked || false),
    'sync.autoMinutes':    (document.getElementById('s-autosync-minutes') || {}).value || '5'
  };
  api(API_SETTINGS, { method:'PUT', body: JSON.stringify(patch) })
    .then(function () { toast('Ajustes guardados','ok'); hideSettings(); })
    .catch(function (err) { toast('Error al guardar: '+err.message,'err'); });
}

window.checkpoint = 13;

// =============================================================================
// Bind helpers
// =============================================================================
function bind(id, ev, fn) {
  var el = document.getElementById(id);
  if (!el) { console.warn('[bind] missing #'+id); return; }
  el.addEventListener(ev, function (e) { try { fn(e); } catch (err) { console.error('[handler:'+id+']', err); } });
}
function bindAll(sel, ev, fn) {
  document.querySelectorAll(sel).forEach(function (el) {
    el.addEventListener(ev, function (e) { try { fn(e, el); } catch (err) { console.error('[handler:'+sel+']', err); } });
  });
}

// =============================================================================
// Boot
// =============================================================================
function measureScrollbarWidth() {
  try {
    var outer = document.createElement('div');
    outer.style.cssText = 'visibility:hidden;overflow:scroll;width:100px;height:100px;position:absolute;top:-9999px;';
    var inner = document.createElement('div');
    inner.style.cssText = 'width:100%;height:100%;';
    outer.appendChild(inner);
    document.body.appendChild(outer);
    var w = outer.offsetWidth - inner.offsetWidth;
    outer.parentNode.removeChild(outer);
    document.documentElement.style.setProperty('--scrollbar-w', w + 'px');
  } catch (e) {}
}

function boot() {
  console.log('[boot] start');
  measureScrollbarWidth();

  // Pickers
  try {
    pickers.startDate  = attachDatePicker(document.getElementById('pick-start-date'));
    pickers.startTime  = attachTimePicker(document.getElementById('pick-start-time'));
    pickers.endDate    = attachDatePicker(document.getElementById('pick-end-date'));
    pickers.endTime    = attachTimePicker(document.getElementById('pick-end-time'));
    pickers.allDayDate = attachDatePicker(document.getElementById('pick-allday-date'));
  } catch (e) { console.error('[pickers]', e); }

  // Top tabs
  bindAll('.view-tab', 'click', function (_e, t) { setView(t.dataset.view); });

  // Calendar source filter
  bindAll('.cal-list .nav-item', 'click', function (_e, el) { setSourceFilter(el.dataset.cal); });

  // Section switch (Calendario / Tareas)
  bindAll('[data-section]', 'click', function (_e, el) {
    document.querySelectorAll('[data-section]').forEach(function (x) { x.classList.toggle('active', x === el); });
    if (el.dataset.section === 'tasks') { showOnly('tasks'); renderTasksView(); }
    else { showOnly(state.view); }
  });

  // Navigation
  bind('btn-prev', 'click', function () { changeRange(-1); });
  bind('btn-hoy',  'click', function () { changeRange(0); });
  bind('btn-next', 'click', function () { changeRange(1); });

  // New event
  bind('btn-nuevo-evento',     'click', function () { openModalForNew(new Date()); });
  bind('btn-nuevo-evento-fab', 'click', function () { openModalForNew(new Date()); });

  // Modal
  bind('btn-modal-close', 'click', hideModal);
  bind('btn-cancelar',    'click', hideModal);
  bind('btn-guardar',     'click', saveEvent);
  bind('btn-borrar',      'click', deleteEvent);
  bind('all-day',         'change', function (e) { toggleAllDayInputs(e.target.checked); });
  bind('modal-event',     'click', function (e) { if (e.target.id === 'modal-event') hideModal(); });
  bind('form-evento',     'submit', function (e) { e.preventDefault(); saveEvent(); });

  // Esc cierra modales
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    hideModal();
    hideSettings();
  });

  // Todos
  bind('form-todo', 'submit', submitTodo);
  bind('todo-list', 'click',  onTodoClick);

  // Search
  var searchTimer;
  bind('buscador', 'input', function (e) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.search = e.target.value.trim();
      loadEvents().then(function () { renderCurrentView(); renderBottomPanels(); });
    }, 300);
  });

  // Sync
  bind('btn-sync-icloud', 'click', syncIcloud);

  // Color picker
  renderColorPicker();

  // Settings
  bind('btn-settings',         'click', openSettings);
  bind('btn-settings-close',   'click', hideSettings);
  bind('btn-settings-cancel',  'click', hideSettings);
  bind('btn-settings-save',    'click', saveSettings);
  bind('modal-settings',       'click', function (e) { if (e.target.id === 'modal-settings') hideSettings(); });
  bindAll('#settings-tabs .tab', 'click', function (_e, t) {
    document.querySelectorAll('#settings-tabs .tab').forEach(function (x) { x.classList.toggle('active', x === t); });
    document.querySelectorAll('.tab-pane').forEach(function (p) { p.hidden = p.dataset.pane !== t.dataset.tab; });
  });
  bindAll('#theme-segmented button', 'click', function (_e, b) {
    document.querySelectorAll('#theme-segmented button').forEach(function (x) { x.classList.toggle('active', x === b); });
    applyTheme(b.dataset.theme);
  });
  bind('btn-google-connect', 'click', startGoogleOAuth);

  // Tasks form
  bind('form-todo-main', 'submit', function (e) {
    e.preventDefault();
    var t = document.getElementById('todo-titulo-main');
    var title = t ? t.value.trim() : '';
    if (!title) return;
    var pr = document.getElementById('todo-prioridad-main');
    var du = document.getElementById('todo-due-main');
    var payload = { title: title, priority: pr ? pr.value : 'MEDIUM' };
    if (du && du.value) payload.dueAt = du.value + 'T09:00:00';
    api(API_TODOS, { method:'POST', body: JSON.stringify(payload) }).then(function () {
      if (t) t.value = ''; if (du) du.value = '';
      refreshTodos().then(renderTasksView);
    });
  });
  bindAll('[data-list]', 'click', function (_e, el) {
    document.querySelectorAll('[data-list]').forEach(function (x) { x.classList.toggle('active', x === el); });
    state.taskFilter = el.dataset.list;
    renderTasksView();
  });

  // Convert event → todo
  bind('btn-to-todo', 'click', function () {
    if (!state.editingId) return;
    api(API_EVENTS+'/'+state.editingId+'/to-todo', { method:'POST' })
      .then(function () { toast('Tarea creada','ok'); return refreshTodos(); })
      .catch(function (err) { toast('No se pudo crear la tarea: '+err.message,'err'); });
  });

  // Tema
  try { applyTheme(localStorage.getItem('theme') || 'auto'); } catch (_) {}

  // Now line + initial data
  loadIcloudCalendars();
  refreshAll();
  setInterval(function () { if (state.view === 'week' || state.view === 'day') renderCurrentView(); }, 60000);

  // Auto-refresh data each 30s so events synced in background by AutoSyncScheduler
  // appear in the UI without manual reload.
  setInterval(function () {
    if (document.hidden) return;          // no refresh if window not visible
    refreshAll().catch(function () {});
  }, 30000);


  console.log('[boot] complete');
}

window.bootOnce = function () {
  if (window._booted) return;
  window._booted = true;
  try {
    var t = document.getElementById('title-main');
    if (t) t.textContent = 'Arrancando...';
  } catch (eA) {}
  try {
    boot();
  } catch (eB) {
    console.error('[boot] crashed', eB);
    try { document.title = '[BOOT CRASH] ' + eB.message; } catch (eC) {}
  }
};

window.checkpoint = 14;

if (document.readyState !== 'loading') {
  window.bootOnce();
} else {
  document.addEventListener('DOMContentLoaded', window.bootOnce);
}
window.addEventListener('load', window.bootOnce);
