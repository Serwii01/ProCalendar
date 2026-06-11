# Construir el ejecutable .exe

## Dos modos de distribución

### 🟢 Modo Standalone (recomendado para usuarios finales)
El `.exe` incluye Java embebido + base de datos H2 file-based.
El usuario **NO necesita** Java ni MySQL — solo doble-click y funciona.

```powershell
npm install
npm run dist:standalone
```

Esto:
1. Descarga el JRE Temurin 21 portable (~50 MB) → `desktop/resources/jre/`
2. Compila el backend Spring → JAR copiado a `desktop/resources/backend.jar`
3. Empaqueta Electron + JAR + JRE con electron-builder
4. Genera en `desktop/release/`:
   - `ProCalendar-Setup-0.2.0.exe` (instalador NSIS, ~200 MB)
   - `ProCalendar-Portable-0.2.0.exe` (portable, ~200 MB)

### 🟡 Modo Light (el usuario instala Java por su cuenta)
Sin JRE embebido. El .exe pesa ~70 MB pero requiere Java 21.

```powershell
npm run dist:all
```

## Base de datos

Por defecto la app usa **H2 embebido** (file-based). El archivo vive en:
- Windows: `%USERPROFILE%\.procalendar\data.mv.db`
- macOS: `~/.procalendar/data.mv.db`
- Linux: `~/.procalendar/data.mv.db`

Si el usuario prefiere MySQL, puede definir variables de entorno antes de
arrancar la app:

```powershell
set PROCAL_DB_URL=jdbc:mysql://localhost:3306/calendario?useSSL=false&serverTimezone=UTC&createDatabaseIfNotExist=true
set PROCAL_DB_USER=root
set PROCAL_DB_PASSWORD=tu_password
set PROCAL_DB_DRIVER=com.mysql.cj.jdbc.Driver
```

## Build paso a paso

```powershell
# 1. Descargar JRE portable (una sola vez, queda en resources/jre/)
npm run download:jre

# 2. Compilar el backend
npm run build:backend

# 3. Empaquetar
npm run dist
```

## Resolución de problemas

**"Cannot create symbolic link"** durante `electron-builder`:
- Activa **Modo Desarrollador** en Windows (Settings → For developers).
- O ejecuta PowerShell como administrador.

**"mvn no se reconoce"**:
- Instala Maven: descarga https://maven.apache.org/download.cgi y añade
  `apache-maven-*\bin` al PATH.

**"java no se reconoce" en modo Light**:
- El usuario final necesita Java 21. Usa el modo Standalone para evitarlo.

**Tamaño del .exe muy grande (~200 MB)**:
- Es normal con JRE embebido. Si quieres reducir, usa `jlink` para hacer un
  JRE mínimo (~30 MB) en lugar de Temurin completo. Es otra iteración.
