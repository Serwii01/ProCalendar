# Pro Calendar

Cliente de calendario de escritorio (Windows) con sincronización bidireccional con **iCloud** y **Google Calendar**, más un apartado de tareas (to-do). Funciona 100 % en local: los datos viven en una base de datos embebida en tu equipo (`~/.procalendar/`), sin servicios externos.

📖 **Guía de usuario**: [español](docs/GUIA-DE-USUARIO.md) · [English](docs/USER-GUIDE.md) · [中文](docs/用户指南.md)
⬇️ **Descargas**: carpeta [`releases/`](releases/)

## Para usuarios

1. Descarga `ProCalendar-Setup-1.0.0.exe` desde [`releases/`](releases/) y ejecútalo. **No necesitas instalar Java ni ninguna base de datos**: el instalador lo lleva todo.
2. Abre la app y entra en **Ajustes > Cuentas**:
   - **iCloud**: tu Apple ID + una *contraseña de aplicación* generada en [appleid.apple.com](https://appleid.apple.com) (Inicio de sesión y seguridad > Contraseñas específicas de apps). Marca "Activar sincronización" y guarda.
   - **Google**: marca "Activar sincronización", guarda y pulsa **Conectar cuenta de Google**: se abre el navegador para autorizar. (Google no admite contraseñas de aplicación para Calendar; la autorización en el navegador es el único mecanismo que permite.)
3. La app sincroniza sola en segundo plano (intervalo configurable en Ajustes > Sincronización). Los eventos creados en tu iPhone o en Google aparecen en el portátil y viceversa.

Al crear un evento eliges a qué calendario va: uno de iCloud, uno de Google o **Solo local** (no se sube a ningún sitio).

## Stack

- **Backend**: Spring Boot 3 (Java 21) + Spring Data JPA + Spring Security OAuth2 client.
- **Persistencia**: H2 embebida en modo MySQL (por defecto, cero configuración). MySQL real opcional vía variables `PROCAL_DB_URL/USER/PASSWORD/DRIVER`.
- **Desktop**: Electron; arranca el JAR del backend con un JRE Temurin embebido.

## Estructura

```
backend/                       Spring Boot
  src/main/java/com/procalendar/
    event/                     CalendarEvent + CRUD + búsqueda + rango
    todo/                      Todo + CRUD + toggle
    settings/                  Ajustes clave/valor (tabla app_setting)
    sync/                      SyncController + AutoSyncScheduler
      google/                  GoogleCalendarSyncService + GoogleTokenStore (OAuth + refresh persistente)
      icloud/                  ICloudCalDavSyncService (CalDAV: discovery, REPORT, PUT, DELETE)
    config/                    Security + CORS + OAuth offline + client registration dinámico
desktop/                       Electron
  main.js / preload.js         Shell: lanza backend, single-instance, bridge openExternal
  renderer/                    UI (HTML/CSS/JS + i18n es/en/zh)
  scripts/                     download-jre.js, copy-jar.js
```

## Compilar y generar el instalador

Requisitos: JDK 21, Maven y Node 18+.

```bash
cd desktop
npm install
npm run dist:standalone
```

Ese único comando descarga un JRE portable, compila el backend, copia el JAR y genera en `desktop/release/`:

- `ProCalendar-Setup-1.0.0.exe` — instalador NSIS (recomendado para distribuir)
- `ProCalendar-Portable-1.0.0.exe` — ejecutable portable

## Desarrollo

```bash
# Terminal 1: backend
cd backend && mvn spring-boot:run

# Terminal 2: UI
cd desktop && npm install && npm start
```

## API

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/events?from=&to=` / `?q=texto` | Eventos por rango o búsqueda |
| POST/PUT/DELETE | `/api/events[/{id}]?cascade=` | CRUD (cascade borra también en iCloud/Google) |
| GET/POST/PUT/DELETE | `/api/todos[/{id}]` (+`/toggle`) | CRUD tareas |
| GET/PUT | `/api/settings` | Ajustes (secretos enmascarados) |
| POST | `/api/sync/{provider}?mode=pull\|push\|full` | Sincronizar google/icloud |
| GET | `/api/sync/{provider}/calendars` | Calendarios descubiertos |
| GET | `/api/sync/status` | Estado de conexión |
| POST | `/api/sync/google/disconnect` | Desconectar cuenta Google |
| GET | `/oauth2/authorization/google` | Inicia el flow OAuth |

## Puerto del backend

La app intenta usar el puerto **8080** y, si está ocupado, prueba automáticamente del **8081 al 8090** (el primero libre). El renderer recibe el puerto elegido de Electron, así que el usuario no configura nada. Si nuestro propio backend ya está corriendo (p. ej. arrancado a mano en desarrollo), la app lo detecta por `/api/health` y lo reutiliza en lugar de lanzar otro.

## OAuth de Google

La app incluye un OAuth client por defecto para que el usuario final no configure nada. **Importante**: en Google Cloud Console, ese client debe tener registrados los redirect URIs `http://localhost:PUERTO/login/oauth2/code/google` para **todos los puertos del 8080 al 8090**; si solo registras el 8080 y la app cae en otro puerto, el login con Google fallará con `redirect_uri_mismatch`. Si publicas tu propio fork, crea tu client (tipo *Web application*) con esos URIs y sustitúyelo en `application.properties` o en Ajustes > Cuentas > Avanzado. En apps de escritorio el client secret viaja dentro del binario; Google lo considera no confidencial para este tipo de aplicación.

El refresh token se persiste en la BD local, de modo que la conexión con Google sobrevive a reinicios y el access token se renueva automáticamente.

## Próximos pasos

- Eventos recurrentes (RRULE) en pull/push.
- Notificaciones nativas (Notification API de Electron).
- Almacenamiento de secretos con DPAPI/keytar en lugar de la BD.
- Firma de código del instalador (evita el aviso SmartScreen de Windows).
