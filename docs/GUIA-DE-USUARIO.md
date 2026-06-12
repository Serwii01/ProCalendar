# Pro Calendar — Guía de usuario

> 🇬🇧 [English version](USER-GUIDE.md) · 🇨🇳 [中文版](用户指南.md)

**Pro Calendar** es un calendario de escritorio para Windows que funciona 100 % en tu equipo y se sincroniza con **iCloud** y **Google Calendar**. Los eventos que crees en tu iPhone o en Google aparecen en tu portátil, y al revés. Incluye además un apartado de **tareas** (to-do).

Tus datos son tuyos: se guardan en una base de datos local en tu ordenador, no en servidores de terceros.

---

## 1. Instalación

1. Descarga **`ProCalendar-Setup-1.0.0.exe`** desde la carpeta [`releases/`](../releases/) del proyecto.
2. Ejecútalo. No necesitas instalar Java, MySQL ni nada más: el instalador lo lleva todo incluido.
3. Si Windows muestra el aviso azul de SmartScreen ("Windows protegió tu PC"), pulsa **Más información → Ejecutar de todas formas**. Aparece porque el instalador aún no está firmado digitalmente, no porque contenga nada malicioso.

También existe **`ProCalendar-Portable-1.0.0.exe`**: la misma app sin instalación, ideal para llevar en un USB.

> La app guarda tus datos en `C:\Users\<tu usuario>\.procalendar\`. Si la desinstalas, esa carpeta no se borra: tus eventos sobreviven a reinstalaciones.

---

## 2. Primeros pasos

Al abrir la app verás tres zonas:

- **Barra lateral izquierda**: filtros por origen (Todos / Google / iCloud), cambio entre vista Calendario y Tareas, y el botón **Sincronizar ahora**.
- **Zona central**: el calendario, con pestañas **Día / Semana / Mes** arriba. Debajo, paneles con tus prioridades, próximos plazos y un resumen de la semana.
- **Panel derecho**: tus tareas pendientes, con un formulario rápido para añadir nuevas.

### Crear un evento

Pulsa **Nuevo evento** (o haz clic directamente sobre una hora del calendario). En el formulario puedes indicar:

- **Título**, **ubicación** y **notas**.
- **Franja horaria** (inicio y fin) o la casilla **Todo el día** si ocupa la jornada completa.
- **Calendario de destino**: uno de tus calendarios de iCloud, uno de Google, o **"Solo local"** si no quieres que se suba a ningún sitio.
- **Color** del evento.

Para **editar** un evento, haz clic sobre él. Para **borrarlo**, ábrelo y pulsa Borrar: si el evento procede de iCloud o Google, la app te avisará de que también se eliminará allí.

### Tareas (to-do)

En el panel derecho (o en la vista **Tareas** de la barra lateral) puedes crear tareas con prioridad (alta / media / baja) y fecha límite. Márcalas como completadas con un clic en su círculo. También puedes **convertir un evento en tarea** desde el propio evento.

---

## 3. Sincronizar con iCloud (iPhone/iPad/Mac)

iCloud no permite usar tu contraseña normal en apps de terceros; usa una **contraseña de aplicación**, que se genera en un minuto:

1. Entra en [appleid.apple.com](https://appleid.apple.com) e inicia sesión.
2. Ve a **Inicio de sesión y seguridad → Contraseñas específicas de apps** y pulsa **Generar**. Apple te dará algo como `abcd-efgh-ijkl-mnop`.
3. En Pro Calendar, abre **Ajustes (⚙) → Cuentas**:
   - **Apple ID**: tu email de iCloud.
   - **Contraseña específica de app**: la que acabas de generar.
   - Marca **Activar sincronización con iCloud** y pulsa **Guardar cambios**.
4. Pulsa **Sincronizar ahora** en la barra lateral. La app descubre automáticamente todos tus calendarios de iCloud (Trabajo, Casa, etc.) con sus colores.

A partir de ahí la sincronización es **bidireccional**: lo que crees o edites en el iPhone aparece en el PC y viceversa.

> Puedes revocar la contraseña de aplicación en cualquier momento desde appleid.apple.com sin afectar a tu cuenta.

---

## 4. Sincronizar con Google Calendar

Google no admite contraseñas de aplicación para Calendar, así que la conexión se autoriza desde tu navegador (es el mecanismo oficial de Google):

1. En **Ajustes (⚙) → Cuentas**, marca **Activar sincronización con Google** y pulsa **Guardar cambios**.
2. Pulsa **Conectar cuenta de Google**. Se abrirá tu navegador: elige tu cuenta y acepta los permisos de calendario.
3. Verás una página de confirmación ("✓ Google conectado"). Vuelve a la app: en Ajustes aparecerá **✓ Cuenta conectada**.

La conexión se recuerda aunque cierres o reinicies la app. Si algún día quieres desvincularla, puedes revocar el acceso desde [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

---

## 5. Sincronización automática

En **Ajustes → Sincronización** puedes:

- Activar/desactivar la **sincronización automática en segundo plano**.
- Elegir el **intervalo** en minutos (5 por defecto).

Con ella activada no tienes que hacer nada: los cambios de tu iPhone o de Google van apareciendo solos.

---

## 6. Personalización

- **Tema**: claro, oscuro o automático según Windows (**Ajustes → Apariencia**).
- **Idioma**: español, inglés o chino, con cambio instantáneo (**Ajustes → Idioma**).

---

## 7. Preguntas frecuentes y problemas

**"Error iCloud: faltan apple-id / app-password"**
No has guardado las credenciales. Revisa Ajustes → Cuentas y pulsa Guardar.

**"Credenciales iCloud incorrectas"**
La contraseña de aplicación está mal copiada o fue revocada. Genera una nueva en appleid.apple.com.

**"Error Google: no hay token OAuth"**
Falta conectar la cuenta: Ajustes → Cuentas → Conectar cuenta de Google.

**La app dice que el puerto está ocupado**
Pro Calendar usa internamente los puertos 8080-8090 y elige solo el primero libre. Este aviso solo aparece si los once están ocupados, algo rarísimo: cierra alguna aplicación y vuelve a abrir.

**¿Dónde están mis datos? ¿Cómo hago copia de seguridad?**
Todo vive en `C:\Users\<tu usuario>\.procalendar\`. Copia esa carpeta y tendrás un backup completo.

**¿La app envía mis datos a algún sitio?**
Solo a los servicios que tú actives (iCloud y/o Google) y únicamente tus eventos de calendario. Sin cuentas configuradas, no sale nada de tu equipo.

**Los eventos "Solo local", ¿se suben a algún sitio?**
No. Nunca salen de tu ordenador.
