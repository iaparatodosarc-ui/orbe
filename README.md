<p align="center"><img src="build/icon.png" width="120" alt="Orbe"></p>

<h1 align="center">Orbe</h1>
<p align="center"><b>Tu asistente de IA flotante, en tiempo real.</b><br>
Ponlo sobre cualquier ventana, pestaña o app, y pregúntale lo que quieras sobre lo que ves.</p>

<p align="center">
  <a href="../../releases/latest"><b>⬇ Descargar</b></a> ·
  <a href="#cómo-se-usa">Cómo se usa</a> ·
  <a href="#english">English</a>
</p>

---

## ¿Qué es?

Orbe es un pequeño orbe con un ojo que vive encima de todo en tu pantalla.

- **En el PC:** lo arrastras sobre una ventana (Chrome, Excel, un error en VS Code, un correo…) y queda "mirando" esa ventana. Haces clic, preguntas, y responde viendo exactamente lo que tienes delante.
- **En Android:** flota sobre cualquier app. Lo tocas, preguntas, y ve tu pantalla para ayudarte.

Funciona con **Claude** (API de Anthropic) o, en el PC, con **modelos locales gratis vía Ollama**.

## Descargar

| Plataforma | Archivo | |
|---|---|---|
| Windows 10/11 | `Orbe-Setup-x.y.z.exe` | [Releases](../../releases/latest) |
| Android 8+ | `Orbe-Android-x.y.z.apk` | [Releases](../../releases/latest) |
| Linux | `Orbe-x.y.z.AppImage` | [Releases](../../releases/latest) |

> **Windows** puede mostrar "Windows protegió tu PC" porque la app aún no tiene firma de código pagada. Toca **Más información → Ejecutar de todas formas**.
> **Android:** al abrir el APK, permite "instalar apps de origen desconocido" para tu navegador o administrador de archivos.

## Cómo se usa

### PC
1. Abre Orbe. La primera vez te pide el motor de IA:
   - **Claude:** pega tu API key de [console.anthropic.com](https://console.anthropic.com/settings/keys).
   - **Ollama (gratis, local):** instala [Ollama](https://ollama.com) y `ollama pull qwen2.5vl`.
2. **Arrastra el orbe** sobre la ventana que quieras. El anillo se pone naranja.
3. **Clic en el orbe** → pregunta. O usa **Ctrl + Shift + Espacio** para que mire la ventana activa.
4. Clic derecho sobre el orbe → configuración o salir.

### Android
1. Instala el APK y ábrelo.
2. Pega tu API key, da el permiso para "mostrar sobre otras apps" y toca **Iniciar Orbe**.
3. Acepta que Orbe vea tu pantalla. Abre cualquier app, toca el orbe y pregunta.

## Privacidad

- Orbe **solo envía una captura cuando tú preguntas** con "Ver" activado. Puedes desactivarlo.
- Tu API key se guarda en tu dispositivo (cifrada en el PC). Orbe no tiene servidores propios: habla directo con el proveedor de IA que elijas.
- Con Ollama, nada sale de tu PC.

## Para desarrolladores

```bash
# PC (Windows/Linux)
npm install
npm start            # ejecutar en modo desarrollo
npm run dist         # crear instalador en dist/

# Android (requiere Android SDK + JDK 17)
gradle -p android assembleRelease
```

Estructura:

```
src/            App de escritorio (Electron)
  main.js       Ventanas, captura, detección de ventanas, IA (Claude/Ollama)
  bubble.html   El orbe flotante
  panel.html    El chat
  winutil.ps1   Ayudante de Windows para saber qué ventana hay bajo el orbe
android/        App de Android (Kotlin, sin dependencias externas)
docs/           Página web de descarga (GitHub Pages)
.github/        Publicación automática: al subir una etiqueta vX.Y.Z se arman y publican todos los instaladores
```

¿Ideas o errores? Abre un *issue*. Los *pull requests* son bienvenidos.

## Licencia

[MIT](LICENSE) — libre para usar, modificar y compartir. Orbe es un proyecto independiente y no está afiliado a Anthropic.

---

## English

**Orbe** is a floating, always-on-top AI orb. Drag it onto any window (desktop) or tap it over any app (Android), ask a question, and it answers looking at what's on your screen.

- Works with **Claude** (bring your own Anthropic API key) or **local models via Ollama** on desktop.
- Screenshots are sent **only when you ask**, straight to the AI provider you choose. No Orbe servers.
- Downloads: see [Releases](../../releases/latest). Desktop shortcut: **Ctrl + Shift + Space**.
- Build: `npm install && npm run dist` (desktop), `gradle -p android assembleRelease` (Android).

MIT licensed. Independent project, not affiliated with Anthropic.
