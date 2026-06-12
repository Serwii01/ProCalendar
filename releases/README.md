# Releases

Aquí se publican los ejecutables listos para usar. Descarga siempre la versión más reciente:

| Archivo | Qué es |
|---|---|
| `ProCalendar-Setup-X.Y.Z.exe` | **Instalador** (recomendado). Crea accesos directos y desinstalador. |
| `ProCalendar-Portable-X.Y.Z.exe` | Versión **portable**, sin instalación. |

No necesitas instalar Java ni ninguna base de datos: todo va incluido.

📖 Guía de uso: [español](../docs/GUIA-DE-USUARIO.md) · [English](../docs/USER-GUIDE.md) · [中文](../docs/用户指南.md)

---

*Para desarrolladores: `build.bat` (en la raíz) compila todo y copia los `.exe` a esta carpeta automáticamente.*

> ⚠️ **Nota sobre GitHub**: los instaladores con JRE embebido superan fácilmente los 100 MB y GitHub rechaza ficheros de ese tamaño en un push normal. Opciones:
> 1. **Git LFS** (ya configurado en `.gitattributes`): instala [git-lfs](https://git-lfs.com), ejecuta `git lfs install` una vez, y los `.exe` de esta carpeta se subirán vía LFS automáticamente.
> 2. O publica los `.exe` como **GitHub Release** (pestaña Releases del repo, admite hasta 2 GB por fichero) y deja esta carpeta solo para uso local.
