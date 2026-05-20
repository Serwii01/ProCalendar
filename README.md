# Pro Calendar Desktop

Cliente local de calendario y tareas, con sincronización planificada a Google Calendar e iCloud (CalDAV).

## Stack
- Backend: Spring Boot 3 (Java 21) + Spring Data JPA + Spring Security + OAuth2 client.
- Persistencia: MySQL.
- Desktop: Electron (renderer en HTML/CSS/JS — preparado para migrar a Angular).

## Estructura
```
backend/                       Spring Boot
  src/main/java/com/procalendar/
    event/                     CalendarEvent + CRUD + búsqueda + rango
    todo/                      Todo + CRUD + toggle
    sync/                      Sync providers (Google y iCloud) + endpoints
    config/                    Spring Security
    health/                    /api/health
desktop/                       Electron
  renderer/
    index.html / styles.css    UI
    app.js                     Vista semanal, todos, edición y sincronización
```

## API
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/events?from=&to=` | Eventos que solapan el rango |
| GET | `/api/events?q=texto` | Buscar por título / descripción / ubicación |
| POST | `/api/events` | Crear evento |
| PUT | `/api/events/{id}` | Actualizar |
| DELETE | `/api/events/{id}` | Borrar |
| GET/POST/PUT/DELETE | `/api/todos[/{id}]` | CRUD tareas |
| POST | `/api/todos/{id}/toggle` | Alternar done |
| GET | `/api/sync/providers` | Lista de proveedores |
| POST | `/api/sync/{provider}?mode=pull\|push\|full` | Disparar sync |

## Funciones
- Vista semanal con navegación (semana anterior / hoy / siguiente).
- Crear / editar / borrar eventos.
- Eventos con título, descripción, ubicación, color, franja horaria.
- Flag *Todo el día* siguiendo el modelo iCloud.
- Búsqueda en vivo (debounced).
- Panel de tareas con prioridades (LOW / MEDIUM / HIGH) y toggle de completado.
- Botones de sincronización con Google e iCloud (scaffolding listo, conectores reales pendientes).

## Run
- Backend: `backend/mvnw.cmd spring-boot:run`
- Desktop: `cd desktop && npm install && npm run dev`

## Configuración de sincronización
En `backend/src/main/resources/application.properties`:

```properties
# Google
procalendar.sync.google.enabled=true
spring.security.oauth2.client.registration.google.client-id=...
spring.security.oauth2.client.registration.google.client-secret=...

# iCloud (CalDAV con app-specific password)
procalendar.sync.icloud.enabled=true
procalendar.sync.icloud.apple-id=tu@icloud.com
procalendar.sync.icloud.app-password=xxxx-xxxx-xxxx-xxxx
procalendar.sync.icloud.calendar-url=https://caldav.icloud.com/
```

## Próximos pasos
- Implementar llamadas reales a la API de Google Calendar (incremental syncToken).
- Implementar PROPFIND / REPORT / PUT contra caldav.icloud.com (parseo de VEVENT con ical4j).
- Resolución de conflictos por `lastSyncedAt` + `@Version`.
- Migrar el renderer a Angular dentro de Electron.
- Notificaciones nativas (Electron Notification API).
- Empaquetado con electron-builder.
