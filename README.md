# Pro Calendar Desktop

Cliente local de calendario y tareas (estilo ChronosFlow / Apple Calendar) con sincronización Google Calendar e iCloud (CalDAV).

## Stack
- Backend: Spring Boot 3 (Java 21) + Spring Data JPA + Spring Security + OAuth2 client.
- Persistencia: MySQL.
- Desktop: Electron (renderer en HTML/CSS/JS — UI ya diseñada para migrar a Angular).

## UI
Layout fijo a pantalla completa con 3 columnas (sidebar, calendario, panel de tareas), top-bar con switcher Día/Semana/Mes, modal de creación de eventos y panel de prioridades / próximos plazos / progreso semanal. Plenamente responsive: en <1000 px se oculta el panel derecho, en <768 px también la sidebar y aparece un FAB.

Vista semana hora-a-hora con eventos posicionados absolutamente, línea “now” en rojo, fila de all-day separada arriba (modelo iCloud) y filtro por origen (Local / Google / iCloud) desde la sidebar.

## Estructura
```
backend/                       Spring Boot
  src/main/java/com/procalendar/
    event/                     CalendarEvent + CRUD + búsqueda + rango
    todo/                      Todo + CRUD + toggle
    sync/                      SyncController + SyncResult + interfaces
      google/                  GoogleCalendarSyncService (OAuth2 + Calendar API v3)
      icloud/                  ICloudCalDavSyncService  (CalDAV REPORT + VEVENT)
    config/                    Spring Security + CORS
    health/                    /api/health
desktop/                       Electron
  main.js / preload.js         Shell + bridge (openExternal para OAuth)
  renderer/
    index.html                 Top-bar + sidebar + 3 vistas + modal
    styles.css                 Sistema de diseño (tokens, responsive)
    app.js                     Vistas, modal, time-grid, sync
```

## API
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/events?from=&to=` | Eventos del rango (ISO local) |
| GET | `/api/events?q=texto` | Buscar |
| POST/PUT/DELETE | `/api/events[/{id}]` | CRUD |
| GET/POST/PUT/DELETE | `/api/todos[/{id}]` | CRUD tareas |
| POST | `/api/todos/{id}/toggle` | Alternar done |
| GET | `/oauth2/authorization/google` | Inicia flow OAuth Google |
| GET | `/api/sync/oauth-done` | Página de éxito tras login |
| GET | `/api/sync/status` | Estado de autenticación |
| POST | `/api/sync/{provider}?mode=pull\|push\|full` | Sincronizar |

## Configuración Google (OAuth2)
1. Crea un OAuth client en Google Cloud Console (tipo Web).
2. Añade `http://localhost:8080/login/oauth2/code/google` como redirect URI.
3. En `backend/src/main/resources/application.properties`:
   ```properties
   procalendar.sync.google.enabled=true
   spring.security.oauth2.client.registration.google.client-id=TU_CLIENT_ID
   spring.security.oauth2.client.registration.google.client-secret=TU_SECRET
   ```
4. En la app, pulsa **Conectar Google (OAuth)** — se abre el navegador, autorizas y vuelves.
5. Pulsa **Sincronizar Google** — trae los eventos y los marca con `source=GOOGLE`.

## Configuración iCloud (CalDAV)
1. Genera una *app-specific password* en https://appleid.apple.com.
2. Averigua tu URL de calendario (suele ser `https://pXX-caldav.icloud.com/<userId>/calendars/home/`).
3. En `application.properties`:
   ```properties
   procalendar.sync.icloud.enabled=true
   procalendar.sync.icloud.apple-id=tu@icloud.com
   procalendar.sync.icloud.app-password=xxxx-xxxx-xxxx-xxxx
   procalendar.sync.icloud.calendar-url=https://pXX-caldav.icloud.com/.../calendars/home/
   ```
4. Pulsa **Sincronizar iCloud** — REPORT CalDAV, parseo de VEVENT y upsert por UID.

## Run
```bash
# Backend
backend/mvnw.cmd spring-boot:run
# Desktop
cd desktop && npm install && npm run dev
```

## Atajos
- **Click en una hora** del calendario semana/día → crea evento a esa hora.
- **Click en un día** del mes → crea evento ese día.
- **Click en un evento** → edita.
- **Esc** → cierra el modal.
- **Buscador** (top-bar) → filtra eventos por título/descr/ubicación.

## Próximos pasos
- Filtro multi-calendario combinado (varios orígenes a la vez).
- Recurring events (RRULE) en pull/push.
- Notificaciones nativas con la Notification API de Electron.
- Almacenamiento seguro de tokens (keytar).
- Empaquetado con electron-builder.
