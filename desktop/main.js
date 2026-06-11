const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

Menu.setApplicationMenu(null);

let mainWindow = null;
let backendProcess = null;

// Una sola instancia: dos copias chocarían en el puerto del backend.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// Puerto preferido y rango de respaldo si está ocupado.
// (8080 primero porque es el redirect URI registrado para el OAuth de Google;
//  los demás puertos del rango conviene registrarlos también en Google Console)
const PORT_CANDIDATES = [8080, 8081, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8089, 8090];
let BACKEND_PORT = 8080;   // se fija en ensureBackend()

/** Devuelve la ruta del JAR del backend si está empaquetado, o null si no. */
function findBackendJar() {
  const packagedJar = path.join(process.resourcesPath || '', 'backend.jar');
  if (fs.existsSync(packagedJar)) return packagedJar;
  const devJar = path.join(__dirname, 'resources', 'backend.jar');
  if (fs.existsSync(devJar)) return devJar;
  return null;
}

/** Devuelve la ruta del java.exe embebido si existe; si no, "java" (del PATH). */
function findJavaExecutable() {
  const candidates = [
    path.join(process.resourcesPath || '', 'jre', 'bin', 'java.exe'),
    path.join(__dirname, 'resources', 'jre', 'bin', 'java.exe'),
    path.join(process.resourcesPath || '', 'jre', 'bin', 'java'),
    path.join(__dirname, 'resources', 'jre', 'bin', 'java')
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return 'java';
}

/** Comprueba si NUESTRO backend responde en un puerto dado. */
function isBackendUp(port) {
  return new Promise(resolve => {
    const req = http.get(`http://localhost:${port}/api/health`, res => {
      if (res.statusCode !== 200) { res.resume(); return resolve(false); }
      let body = '';
      res.on('data', d => { body += d; });
      // Solo lo consideramos "nuestro" si /api/health devuelve {"status":"ok"}
      res.on('end', () => resolve(body.indexOf('"ok"') >= 0));
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1200, () => { req.destroy(); resolve(false); });
  });
}

/** ¿Está libre el puerto en localhost? */
function isPortFree(port) {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

/** Lanza el backend Java en el puerto indicado. Resuelve cuando responde. */
function startBackend(jarPath, port) {
  return new Promise((resolve, reject) => {
    const javaCmd = findJavaExecutable();
    console.log('[backend] starting with', javaCmd, '→', jarPath, 'on port', port);
    backendProcess = spawn(javaCmd, ['-jar', jarPath, `--server.port=${port}`], {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    backendProcess.stdout.on('data', d => process.stdout.write('[backend] ' + d));
    backendProcess.stderr.on('data', d => process.stderr.write('[backend] ' + d));
    backendProcess.on('exit', code => {
      console.log('[backend] exited with code', code);
      backendProcess = null;
    });
    backendProcess.on('error', err => {
      reject(err);
    });

    // Polling hasta 60s
    const started = Date.now();
    const poll = setInterval(async () => {
      if (await isBackendUp(port)) {
        clearInterval(poll);
        resolve();
      } else if (Date.now() - started > 60_000) {
        clearInterval(poll);
        reject(new Error('Timeout esperando al backend'));
      }
    }, 800);
  });
}

/**
 * Garantiza un backend corriendo y fija BACKEND_PORT:
 * - Si nuestro backend ya responde en algún puerto del rango → lo reutiliza.
 * - Si no, arranca el JAR en el primer puerto libre del rango.
 */
async function ensureBackend() {
  // 1) ¿Ya hay un backend nuestro corriendo? (p. ej. arrancado a mano en desarrollo)
  for (const port of PORT_CANDIDATES) {
    if (await isBackendUp(port)) {
      BACKEND_PORT = port;
      console.log('[backend] ya estaba corriendo en', port);
      return;
    }
  }

  const jar = findBackendJar();
  if (!jar) {
    console.log('[backend] no se encontró backend.jar — modo desarrollo');
    return;   // En dev se asume que el usuario lo arranca a mano (8080)
  }

  // 2) Primer puerto libre del rango
  let chosen = null;
  for (const port of PORT_CANDIDATES) {
    if (await isPortFree(port)) { chosen = port; break; }
  }
  if (chosen == null) {
    dialog.showErrorBox(
      'Pro Calendar — Sin puertos disponibles',
      'Todos los puertos 8080-8090 están ocupados por otras aplicaciones.\n' +
      'Cierra alguna y vuelve a abrir Pro Calendar.'
    );
    return;
  }
  BACKEND_PORT = chosen;

  try {
    await startBackend(jar, chosen);
  } catch (e) {
    dialog.showErrorBox(
      'Pro Calendar — Error al arrancar el backend',
      'No se pudo iniciar el servicio en segundo plano.\n\n' + e.message +
      '\n\nSi instalaste la versión sin Java embebido, necesitas Java 21 en el PATH.'
    );
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 900,
    minHeight: 600,
    title: 'Pro Calendar',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#f5f5f7',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // El renderer necesita saber en qué puerto quedó el backend
      additionalArguments: [`--procal-port=${BACKEND_PORT}`]
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // DevTools solo en desarrollo (cuando la app no está empaquetada)
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(async () => {
  if (!gotLock) return;
  await ensureBackend();
  createWindow();
});

app.on('window-all-closed', () => {
  if (backendProcess) {
    try { backendProcess.kill(); } catch (_) {}
    backendProcess = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (backendProcess) {
    try { backendProcess.kill(); } catch (_) {}
  }
});
