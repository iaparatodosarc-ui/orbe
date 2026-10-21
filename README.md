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

Está hecho para **Claude** (API de Anthropic), con directrices escritas a medida para que Claude responda claro y simple, incluso a quien nunca ha usado IA.

## Novedades en la 3.3

- **👁 Baja reels con un parpadeo (Android):** en Instagram, Facebook, TikTok o YouTube, cierra los ojos medio segundo y Orbe pasa al siguiente reel (también puedes elegir *doble parpadeo*). Los parpadeos normales no cuentan. La cámara frontal solo se enciende mientras una de esas apps está en pantalla y todo se analiza **en el teléfono**: no se guardan ni se envían imágenes. Viene apagado; se activa en el paso 5, con su propio permiso «Orbe · parpadeo».
- **🖐 Orbe Motion (Windows, beta):** controla el PC con gestos de la mano usando solo la cámara web: mover el cursor con el índice, clic con una pinza, arrastrar, desplazar, volumen, pausa/reproducir y activar Orbe abriendo la mano. Incluye un asistente de calibración para tu mano y tu cámara. 100% local y gratis. Descarga `OrbeMotion` en [Releases](../../releases/latest) o mira la carpeta [`orbe-motion`](orbe-motion/).

## Novedades en la 3.1

- **Orbe entiende tus carpetas y archivos (Windows):** suelta el orbe sobre una carpeta o archivo del escritorio o del Explorador y pregúntale qué hay dentro: lista, tamaños, tipos, lo más pesado, cómo ordenarlo. Con **Leer contenido** activado puede leer y resumir el archivo (PDF, Word, Excel, PowerPoint, texto, imágenes). Solo se envía a Claude cuando tú preguntas.
- **Orbe dibuja:** pídele "dibújame un gato astronauta" y te hace un dibujo original y sencillo. Con un toque lo pega en Paint (o la ventana bajo el orbe), lo copia o lo guarda. Pídele "para colorear" y te deja solo los contornos para pintarlos.

## Novedades en la 3.0

- **Nuevo look (3.0.1):** Orbe ahora es una esfera de vidrio negro con un gran ojo naranja incandescente y una **aureola flotante**. Refleja la ciudad, flota suave y parpadea. La aureola muestra lo que hace: brilla fija cuando mira una ventana, gira punteada cuando piensa y late cuando responde.

- **Un orbe con vida:** cada vez que lo tocas reacciona distinto (salta, gira, se ríe, se marea, se enamora…), con sonidos que nunca suenan igual. Todo sintetizado, sin archivos de audio. Se pueden apagar.
- **Responde por ti, solo si tú lo autorizas:** pídele "respóndele" sobre un chat o correo y te muestra el borrador en una tarjeta. Puedes editarlo. Solo lo escribe en la app si tocas **Autorizar** estando frente al equipo o con el teléfono desbloqueado, y **nunca lo envía**: el botón Enviar lo tocas tú. Viene apagado; se activa en Configuración.
- **Solo Claude:** usa la herramienta (*tool use*) y la caché de prompt de la API de Claude, así las preguntas siguientes salen más baratas.
- Mensajes de error claros (key inválida, sin saldo, Claude ocupado) y botón para probar la API key.

¿Quieres usarlo gratis? Está **Orbe Libre**, la misma app con APIs gratis (NVIDIA, Gemini, Groq u Ollama).

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
1. Abre Orbe. La primera vez te pide tu API key de Claude: créala en [console.anthropic.com](https://console.anthropic.com/settings/keys) y pégala. Toca **Probar key**.
2. **Arrastra el orbe** sobre la ventana que quieras. El anillo se pone naranja.
3. **Clic en el orbe** → pregunta. O usa **Ctrl + Shift + Espacio** para que mire la ventana activa.
4. Clic derecho sobre el orbe → sonidos, configuración o salir.
5. (Opcional) En ⚙ activa **Orbe puede escribir respuestas por mí**.

### Android
1. Instala el APK y ábrelo.
2. Pega tu API key, da el permiso para "mostrar sobre otras apps" y toca **Iniciar Orbe**.
3. Acepta que Orbe vea tu pantalla. Abre cualquier app, toca el orbe y pregunta.
4. (Opcional) Activa **Orbe puede escribir respuestas por mí** y da el permiso de accesibilidad *Orbe · escribir respuestas*. Orbe solo lo usa cuando tocas Autorizar.

## Privacidad

- Orbe **solo envía una captura cuando tú preguntas** con "Ver" activado. Puedes desactivarlo.
- Tu API key se guarda en tu dispositivo (cifrada en el PC). Orbe no tiene servidores propios: habla directo con el proveedor de IA que elijas.
- "Responder por ti" está apagado por defecto. Aun activado, cada respuesta necesita tu toque en **Autorizar**, y Orbe nunca la envía.

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
  main.js       Ventanas, captura, detección de ventanas, Claude, responder por ti
  guidelines.js Directrices de Orbe para Claude (personalidad, reglas, herramienta)
  bubble.html   El orbe flotante (reacciones y sonidos)
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

- Built for **Claude** (bring your own Anthropic API key). Tap it and it reacts differently every time, with sounds.
- Can type replies for you **only when you tap Authorize** while present; it never sends them.
- Screenshots are sent **only when you ask**, straight to the AI provider you choose. No Orbe servers.
- Downloads: see [Releases](../../releases/latest). Desktop shortcut: **Ctrl + Shift + Space**.
- Build: `npm install && npm run dist` (desktop), `gradle -p android assembleRelease` (Android).

MIT licensed. Independent project, not affiliated with Anthropic.
