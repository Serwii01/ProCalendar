# Roadmap

## MVP — hecho
- [x] Shell desktop con Electron.
- [x] Vista semanal navegable.
- [x] CRUD completo de eventos.
- [x] Soporte all-day (modelo iCloud).
- [x] Color, ubicación, descripción.
- [x] Búsqueda por texto.
- [x] Panel de To-Do con prioridades.
- [x] MySQL local con `ddl-auto=update`.
- [x] Endpoints REST `/api/events`, `/api/todos`, `/api/sync`.

## Pro — en marcha
- [x] Scaffolding de sync con Google e iCloud (interfaces, servicios, endpoints).
- [ ] Implementación real Google Calendar API (OAuth2 + syncToken).
- [ ] Implementación real iCloud CalDAV (PROPFIND/REPORT/PUT, parseo con ical4j).
- [ ] Resolución de conflictos por `lastSyncedAt` + `@Version`.
- [ ] Almacenamiento seguro de tokens y app-passwords (keytar).
- [ ] Notificaciones nativas.
- [ ] Export/import ICS.
- [ ] Migración del renderer a Angular.
- [ ] Auto-update vía electron-builder.

## Ideas futuras
- Recurring events (RRULE).
- Múltiples calendarios locales con colores propios.
- Modo vista mes / día.
- Drag & drop para mover/redimensionar eventos.
