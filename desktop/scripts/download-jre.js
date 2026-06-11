// Descarga JRE Temurin portable y lo descomprime en desktop/resources/jre/
// Resultado: el .exe final lleva su propio Java y el usuario no tiene que instalar nada.
//
// Uso: node scripts/download-jre.js
//
// Requiere: tar (incluido en Windows 10+), o 7z, o usar el cliente .msi de Adoptium.

const fs   = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const JRE_VERSION = '21.0.5+11';                       // versión Temurin estable
const ZIP_URL = `https://github.com/adoptium/temurin21-binaries/releases/download/jdk-${encodeURIComponent(JRE_VERSION)}/OpenJDK21U-jre_x64_windows_hotspot_21.0.5_11.zip`;

const targetDir = path.resolve(__dirname, '..', 'resources', 'jre');
const tmpZip    = path.resolve(__dirname, '..', '_jre_tmp.zip');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    console.log('[jre] descargando', url);
    const file = fs.createWriteStream(dest);
    const req = https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error('HTTP ' + res.statusCode));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    });
    req.on('error', err => { file.close(); fs.unlinkSync(dest); reject(err); });
  });
}

async function main() {
  if (fs.existsSync(path.join(targetDir, 'bin', 'java.exe'))) {
    console.log('[jre] ya está descargado en', targetDir);
    return;
  }
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  await download(ZIP_URL, tmpZip);
  console.log('[jre] descomprimiendo…');
  fs.mkdirSync(targetDir, { recursive: true });

  // tar -xf funciona en Windows 10+ para ZIPs
  try {
    execSync(`tar -xf "${tmpZip}" -C "${targetDir}" --strip-components=1`, { stdio: 'inherit' });
  } catch (e) {
    console.error('[jre] error con tar, intentando con PowerShell…');
    execSync(`powershell -Command "Expand-Archive -Path '${tmpZip}' -DestinationPath '${targetDir}' -Force"`, { stdio: 'inherit' });
    // PowerShell crea una subcarpeta extra; aplánalo
    const items = fs.readdirSync(targetDir);
    if (items.length === 1) {
      const inner = path.join(targetDir, items[0]);
      for (const f of fs.readdirSync(inner)) {
        fs.renameSync(path.join(inner, f), path.join(targetDir, f));
      }
      fs.rmdirSync(inner);
    }
  }

  fs.unlinkSync(tmpZip);
  console.log('[jre] listo en', targetDir);
}

main().catch(err => { console.error(err); process.exit(1); });
