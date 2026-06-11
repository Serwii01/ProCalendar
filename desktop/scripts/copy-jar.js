// Copia el JAR del backend a desktop/resources/backend.jar
// Funciona en Windows / macOS / Linux sin depender de copy ni cp.
const fs = require('fs');
const path = require('path');

const backendTarget = path.resolve(__dirname, '..', '..', 'backend', 'target');
const resourcesDir  = path.resolve(__dirname, '..', 'resources');
const destJar       = path.join(resourcesDir, 'backend.jar');

if (!fs.existsSync(backendTarget)) {
  console.error('[copy-jar] No existe', backendTarget, '— compila el backend primero (mvn package)');
  process.exit(1);
}

// Encuentra el JAR (ignora .original)
const candidates = fs.readdirSync(backendTarget)
  .filter(n => n.startsWith('pro-calendar-backend-') && n.endsWith('.jar') && !n.endsWith('.original'));

if (candidates.length === 0) {
  console.error('[copy-jar] No se encontró pro-calendar-backend-*.jar en', backendTarget);
  process.exit(1);
}

// Coger el más reciente si hubiese varios
candidates.sort((a, b) => {
  const ta = fs.statSync(path.join(backendTarget, a)).mtimeMs;
  const tb = fs.statSync(path.join(backendTarget, b)).mtimeMs;
  return tb - ta;
});
const src = path.join(backendTarget, candidates[0]);

fs.mkdirSync(resourcesDir, { recursive: true });
fs.copyFileSync(src, destJar);
console.log('[copy-jar] Copiado', candidates[0], '→', destJar);
