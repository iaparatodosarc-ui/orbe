// Orbe Claude — asistente de IA flotante que ve la ventana donde lo pones. Funciona solo con la API de Claude.
// MIT License. Ver README.
const { app, BrowserWindow, ipcMain, screen, desktopCapturer, globalShortcut, Menu, shell, safeStorage, systemPreferences, clipboard, powerMonitor, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { SYSTEM, REPLY_TOOL, DRAW_TOOL, MODELS } = require('./guidelines');
const { describeFolder, describeFile } = require('./files');

if (!app.requestSingleInstanceLock()) { app.quit(); }
// El orbe hace sonidos al tocarlo: se permite el audio sin esperar otro gesto.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const IS_WIN = process.platform === 'win32', IS_MAC = process.platform === 'darwin';
const BUBBLE = { w: 300, h: 175, orb: 84, ox: 18, oy: 63 };  // el orbe con su aureola arriba
let bubbleWin, panelWin;
let target = null;    // { hwnd, wid, title, proc, x, y, w, h, physical:bool, item?:{name,path,kind,where} }
let history = [];
let busy = false, abortCtl = null;
const proposals = new Map(); // id -> { text, target, created, decided }
const drawings = new Map();  // id -> { svg, title, target, decided }

// ---------------- configuración ----------------
const cfgPath = () => path.join(app.getPath('userData'), 'config.json');
const DEFAULT_CFG = {
  apiKeyEnc: '', apiKeyPlain: '',
  model: 'claude-opus-5-5',
  voice: false, maxTokens: 1500, ttsVoice: '', ttsRate: 1.0, convo: true, allowTalk: false, voiceHotkey: 'Control+Alt+Space',
  sounds: true, volume: 0.6,
  allowReply: false,           // "Orbe puede escribir respuestas por mí" (cada respuesta igual pide autorización)
  allowFiles: false,           // "Orbe puede ver mis carpetas y archivos" (apagado hasta que el usuario lo active)
  hotkey: IS_MAC ? 'Command+Shift+Space' : 'Control+Shift+Space',
  onboarded: false,
};
let cfg = { ...DEFAULT_CFG };
function loadCfg() { try { cfg = { ...DEFAULT_CFG, ...JSON.parse(fs.readFileSync(cfgPath(), 'utf8')) }; } catch { cfg = { ...DEFAULT_CFG }; } }
function saveCfg() { fs.mkdirSync(path.dirname(cfgPath()), { recursive: true }); fs.writeFileSync(cfgPath(), JSON.stringify(cfg, null, 2)); }
function getKey() {
  if (cfg.apiKeyEnc && safeStorage.isEncryptionAvailable()) { try { return safeStorage.decryptString(Buffer.from(cfg.apiKeyEnc, 'base64')); } catch {} }
  return cfg.apiKeyPlain || '';
}
function setKey(k) {
  k = (k || '').trim();
  if (safeStorage.isEncryptionAvailable()) { cfg.apiKeyEnc = k ? safeStorage.encryptString(k).toString('base64') : ''; cfg.apiKeyPlain = ''; }
  else { cfg.apiKeyPlain = k; cfg.apiKeyEnc = ''; }
}
const ready = () => !!getKey();

// ---------------- detección de ventanas (por sistema) ----------------
const res = p => app.isPackaged ? p.replace('app.asar', 'app.asar.unpacked') : p;
// Ayudante de Windows (PowerShell). Hay dos: uno para ventanas/pegar y otro para íconos (que puede tardar más),
// así una búsqueda lenta nunca bloquea a la otra. Cada pedido lleva un id y su respuesta vuelve con el mismo id.
class PsWorker {
  constructor(script = 'winutil.ps1') { this.script = script; this.timeouts = 0; this.p = null; this.buf = ''; this.pending = new Map(); this.seq = 0; }
  start() {
    if (!IS_WIN) return;
    const proc = this.p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', res(path.join(__dirname, this.script))], { windowsHide: true });
    this.buf = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', d => {
      if (this.p !== proc) return;
      this.buf += d; let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
        const sp = line.indexOf(' '); if (sp < 0) continue;
        const done = this.pending.get(line.slice(0, sp)); if (!done) continue;   // respuesta tardía de un pedido ya vencido: se ignora
        let o = null; try { o = JSON.parse(line.slice(sp + 1)); } catch {}
        done(o);
      }
    });
    proc.on('exit', () => { if (this.p !== proc) return; this.p = null; for (const d of [...this.pending.values()]) d(null); });
    proc.on('error', () => { if (this.p === proc) this.p = null; });
  }
  ask(cmd, ms = 6000) {
    return new Promise(resolve => {
      if (!this.p) this.start(); if (!this.p) return resolve(null);
      const id = String(++this.seq);
      const done = v => { clearTimeout(timer); this.pending.delete(id); if (v) this.timeouts = 0; resolve(v); };
      // si un pedido se demora demasiado, el PowerShell se reinicia: así un atasco nunca deja a Orbe sin ver ventanas
      const timer = setTimeout(() => { done(null); if (++this.timeouts >= 2) { this.timeouts = 0; this.kill(); this.p = null; } }, ms);
      this.pending.set(id, done);
      try { this.p.stdin.write(id + ' ' + cmd + '\n'); } catch { done(null); }
    });
  }
  kill() { try { this.p?.kill(); } catch {} }
}
const psMain = new PsWorker(), psItems = new PsWorker();
// voz: uno escucha y otro prepara el audio, así hablar y escuchar nunca se bloquean entre sí
const psListen = new PsWorker('voice.ps1'), psSpeak = new PsWorker('voice.ps1'), psKeys = new PsWorker();
function startPs() { psMain.start(); psItems.start(); psSpeak.start(); psKeys.start(); }
const psRaw = (cmd, ms) => psMain.ask(cmd, ms);
async function psWin(cmd) { const o = await psRaw(cmd); return o && o.title !== undefined ? { ...o, physical: true } : null; }
function run(cmd, args, input) {
  return new Promise(r => {
    const p = execFile(cmd, args, { timeout: 4000 }, (e, out) => r(e ? null : String(out)));
    if (input != null) { p.stdin.end(input); }
  });
}
async function macFront() {
  const s = await run('osascript', ['-e', 'tell application "System Events" to tell (first application process whose frontmost is true) to get {name, name of front window, position of front window, size of front window}']);
  if (!s) return null; const p = s.trim().split(', ');
  if (p.length < 6) return null;
  const n = p.length; return { proc: p[0], title: p.slice(1, n - 4).join(', ') || p[0], x: +p[n - 4], y: +p[n - 3], w: +p[n - 2], h: +p[n - 1], physical: false };
}
async function linuxFront() {
  const id = await run('xdotool', ['getactivewindow']); if (!id) return null;
  const g = await run('xdotool', ['getwindowgeometry', '--shell', id.trim()]); if (!g) return null;
  const v = Object.fromEntries(g.trim().split('\n').map(l => l.split('=')));
  const name = (await run('xdotool', ['getwindowname', id.trim()])) || 'Ventana';
  return { wid: id.trim(), title: name.trim(), proc: '', x: +v.X, y: +v.Y, w: +v.WIDTH, h: +v.HEIGHT, physical: false };
}
async function windowAtDip(pt) {
  if (IS_WIN) { const p = screen.dipToScreenPoint(pt); return psWin(`point ${Math.round(p.x)} ${Math.round(p.y)} ${process.pid}`); }
  return foregroundWindow(); // macOS/Linux: la ventana activa (el orbe no roba el foco)
}
async function foregroundWindow() {
  if (IS_WIN) return psWin(`fg ${process.pid}`);
  if (IS_MAC) return macFront();
  return linuxFront();
}
const orbCenter = () => { const b = bubbleWin.getBounds(); return { x: b.x + BUBBLE.ox + BUBBLE.orb / 2, y: b.y + BUBBLE.oy + BUBBLE.orb / 2 }; };

// ---------------- captura ----------------
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function capture(t) {
  if (t && (t.desktop || t.w == null)) t = null;   // escritorio: pantalla completa
  let dip = null;
  if (t) dip = t.physical && IS_WIN ? screen.screenToDipRect(null, { x: t.x, y: t.y, width: t.w, height: t.h }) : { x: t.x, y: t.y, width: t.w, height: t.h };
  const d = dip ? screen.getDisplayMatching(dip) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const sf = d.scaleFactor;
  const wins = [bubbleWin, panelWin].filter(w => w && !w.isDestroyed() && w.isVisible());
  wins.forEach(w => w.setOpacity(0)); await sleep(140);
  let src;
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(d.size.width * sf), height: Math.round(d.size.height * sf) } });
    src = sources.find(s => String(s.display_id) === String(d.id)) || sources[0];
  } catch (e) { src = null; }
  finally { wins.forEach(w => w.setOpacity(1)); }
  if (!src || src.thumbnail.isEmpty()) return null;
  let img = src.thumbnail; const sz = img.getSize();
  if (dip) {
    let x = Math.round((dip.x - d.bounds.x) * sf), y = Math.round((dip.y - d.bounds.y) * sf);
    const x2 = Math.min(sz.width, x + Math.round(dip.width * sf)), y2 = Math.min(sz.height, y + Math.round(dip.height * sf));
    x = Math.max(0, x); y = Math.max(0, y);
    if (x2 - x > 20 && y2 - y > 20) img = img.crop({ x, y, width: x2 - x, height: y2 - y });
  }
  // Claude trabaja mejor con imágenes de hasta ~1568 px por lado (más grande solo cuesta más y se reduce igual).
  const s2 = img.getSize(), maxSide = 1568;
  if (Math.max(s2.width, s2.height) > maxSide) { const k = maxSide / Math.max(s2.width, s2.height); img = img.resize({ width: Math.round(s2.width * k), height: Math.round(s2.height * k), quality: 'best' }); }
  const b64 = img.toJPEG(82).toString('base64');
  return { b64, dataUrl: 'data:image/jpeg;base64,' + b64 };
}

// ---------------- ventanas ----------------
const webPreferences = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false };
function createBubble() {
  const wa = screen.getPrimaryDisplay().workArea;
  bubbleWin = new BrowserWindow({
    width: BUBBLE.w, height: BUBBLE.h, x: wa.x + wa.width - BUBBLE.w - 20, y: wa.y + Math.round(wa.height * 0.55),
    frame: false, transparent: true, resizable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
    focusable: false, backgroundColor: '#00000000', webPreferences,
  });
  bubbleWin.setAlwaysOnTop(true, 'screen-saver');
  bubbleWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  bubbleWin.setIgnoreMouseEvents(true, { forward: true });
  bubbleWin.loadFile(path.join(__dirname, 'bubble.html'));
  bubbleWin.webContents.on('did-finish-load', pushSound);
}
function createPanel() {
  panelWin = new BrowserWindow({
    width: 440, height: 660, show: false, frame: false, transparent: true, resizable: true, minWidth: 360, minHeight: 420,
    alwaysOnTop: true, backgroundColor: '#00000000', title: 'Orbe', webPreferences: { ...webPreferences, backgroundThrottling: false },   // sigue hablando aunque el chat esté cerrado
  });
  panelWin.setAlwaysOnTop(true, 'floating');
  panelWin.loadFile(path.join(__dirname, 'panel.html'));
  panelWin.on('close', e => { if (!app.isQuitting) { e.preventDefault(); panelWin.hide(); } });
  panelWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  panelWin.webContents.on('will-navigate', e => e.preventDefault());
}
function placePanel() {
  const b = bubbleWin.getBounds(), p = panelWin.getBounds(), d = screen.getDisplayMatching(b).workArea;
  const orbX = b.x + BUBBLE.ox;
  let x = orbX - p.width - 12; if (x < d.x) x = orbX + BUBBLE.orb + 12;
  x = Math.max(d.x, Math.min(x, d.x + d.width - p.width));
  const y = Math.max(d.y, Math.min(Math.round(b.y + BUBBLE.h / 2 - p.height / 2), d.y + d.height - p.height));
  panelWin.setPosition(Math.round(x), Math.round(y));
}
function showPanel(focusInput = true) { placePanel(); panelWin.show(); panelWin.focus(); if (focusInput) panelWin.webContents.send('focus-input'); }
function setState(s) { bubbleWin?.webContents.send('state', s); }
function react(kind) { bubbleWin?.webContents.send('react', kind); }
function pushSound() { bubbleWin?.webContents.send('sound', { on: cfg.sounds, volume: cfg.volume }); }
const targetInfo = () => (target ? { title: target.title, proc: target.proc, item: target.item || null } : null);
function pushTarget() { const i = targetInfo(); bubbleWin?.webContents.send('target', i); panelWin?.webContents.send('target', i); }

// ---------------- IPC ----------------
let dragStart = null;
ipcMain.on('mouse-ignore', (_e, v) => bubbleWin.setIgnoreMouseEvents(!!v, { forward: true }));
ipcMain.on('drag-start', () => { const c = screen.getCursorScreenPoint(), b = bubbleWin.getBounds(); dragStart = { cx: c.x, cy: c.y, bx: b.x, by: b.y }; });
ipcMain.on('drag-move', () => {
  if (!dragStart) return; const c = screen.getCursorScreenPoint();
  bubbleWin.setPosition(dragStart.bx + c.x - dragStart.cx, dragStart.by + c.y - dragStart.cy);
  if (panelWin.isVisible()) placePanel();
});
ipcMain.handle('drag-end', async (_e, moved) => { dragStart = null; return moved ? lockUnderBubble() : null; });
let lockSeq = 0;
async function lockUnderBubble() {
  const my = ++lockSeq;
  setState('scanning');
  const c = orbCenter();
  let t = await windowAtDip(c);
  // primero la ventana (inmediato); el ícono/carpeta se busca aparte y se agrega cuando llega
  target = t; pushTarget(); setState(t ? 'locked' : 'idle');
  if (IS_WIN && cfg.allowFiles) findItemUnder(c, t, my);   // solo si el usuario activó "ver carpetas y archivos"   // también sobre el escritorio, donde no hay "ventana" normal
  return targetInfo();
}
async function findItemUnder(c, t, my) {
  const p = screen.dipToScreenPoint(c);
  bubbleWin.setIgnoreMouseEvents(true, { forward: true }); bubbleWin.setOpacity(0);   // que el orbe no tape el ícono
  const restore = setTimeout(() => { bubbleWin.setOpacity(1); bubbleWin.setIgnoreMouseEvents(false); }, 700);
  await sleep(60);
  const it = await psItems.ask(`item ${Math.round(p.x)} ${Math.round(p.y)}`, 5000);
  clearTimeout(restore); bubbleWin.setOpacity(1); bubbleWin.setIgnoreMouseEvents(false);
  if (my !== lockSeq || !it || !it.name) return;   // el orbe ya se movió o no hay ícono
  if (!t) t = { title: it.where || 'Escritorio', proc: 'explorer', desktop: true };  // escritorio: la captura es la pantalla completa
  t.item = it; target = t; pushTarget(); setState('locked'); react('gasp');
}
let voiceActive = false;
ipcMain.on('bubble-click', () => {
  if (hf) { bubbleWin.webContents.send('sink-stop'); endHandsFree(); panelWin.webContents.send('voice-stop'); return; }
  if (voiceActive || listening) { panelWin.webContents.send('voice-stop'); return; }   // tocar el orbe lo hace callar o dejar de escuchar
  if (panelWin.isVisible()) panelWin.hide(); else showPanel();
});
ipcMain.on('bubble-menu', () => {
  const es = app.getLocale().startsWith('es');
  Menu.buildFromTemplate([
    { label: es ? 'Abrir chat' : 'Open chat', click: () => showPanel() },
    ...(IS_WIN && cfg.allowTalk ? [{ label: es ? '🎤 Hablarle (Ctrl + Alt + Espacio)' : '🎤 Talk (Ctrl + Alt + Space)', click: () => voiceEntry() }] : []),
    { label: es ? 'Fijar ventana bajo el orbe' : 'Lock window under orb', click: () => lockUnderBubble() },
    { label: es ? 'Olvidar ventana o archivo (pantalla completa)' : 'Forget window or file (full screen)', click: () => { target = null; pushTarget(); setState('idle'); } },
    { type: 'separator' },
    { label: es ? 'Sonidos' : 'Sounds', type: 'checkbox', checked: cfg.sounds, click: m => { cfg.sounds = m.checked; saveCfg(); pushSound(); } },
    { label: es ? 'Configuración' : 'Settings', click: () => { showPanel(false); panelWin.webContents.send('open-settings'); } },
    { label: es ? 'Salir de Orbe' : 'Quit Orbe', click: () => { app.isQuitting = true; app.quit(); } },
  ]).popup({ window: bubbleWin });
});
ipcMain.handle('get-cfg', () => {
  const k = getKey();
  return { model: cfg.model, models: MODELS, voice: cfg.voice, sounds: cfg.sounds, volume: cfg.volume, allowReply: cfg.allowReply, allowFiles: cfg.allowFiles,
    hotkey: cfg.hotkey, ttsVoice: cfg.ttsVoice, ttsRate: cfg.ttsRate, convo: cfg.convo, allowTalk: cfg.allowTalk, voiceHotkey: cfg.voiceHotkey, apiKey: k ? '••••' + k.slice(-4) : '', ready: ready(), onboarded: cfg.onboarded, platform: process.platform, version: app.getVersion() };
});
ipcMain.handle('set-cfg', (_e, c) => {
  if (typeof c.apiKey === 'string' && c.apiKey && !c.apiKey.startsWith('••••')) setKey(c.apiKey);
  if (typeof c.model === 'string' && /^claude-[a-z0-9.\-]+$/i.test(c.model.trim())) cfg.model = c.model.trim();
  for (const k of ['voice', 'sounds', 'allowReply', 'allowFiles', 'onboarded', 'convo', 'allowTalk']) if (typeof c[k] === 'boolean') cfg[k] = c[k];
  if (typeof c.volume === 'number' && c.volume >= 0 && c.volume <= 1) cfg.volume = c.volume;
  if (typeof c.ttsVoice === 'string' && c.ttsVoice.length < 100) cfg.ttsVoice = c.ttsVoice;
  if (typeof c.ttsRate === 'number' && c.ttsRate >= 0.6 && c.ttsRate <= 1.8) cfg.ttsRate = c.ttsRate;
  if (!cfg.allowFiles && target && target.item) { delete target.item; if (target.desktop) target = null; pushTarget(); }
  saveCfg(); registerHotkey(); pushSound(); return true;
});
ipcMain.handle('get-target', () => targetInfo());
ipcMain.handle('recapture', async () => { const s = await capture(target); return s ? s.dataUrl : null; });
ipcMain.on('panel-hide', () => panelWin.hide());
ipcMain.on('new-chat', () => { history = []; proposals.clear(); drawings.clear(); });
ipcMain.on('stop', () => abortCtl?.abort());
ipcMain.on('open-url', (_e, u) => { if (/^https:\/\//.test(u)) shell.openExternal(u); });
ipcMain.handle('test-key', async () => {
  try {
    const r = await fetch('https://api.anthropic.com/v1/models?limit=1', { headers: { 'x-api-key': getKey(), 'anthropic-version': '2023-06-01' } });
    if (r.ok) return { ok: true };
    return { error: friendly(r.status, await r.text().catch(() => '')) };
  } catch (e) { return { error: 'net' }; }
});

// ---------------- Claude ----------------
function friendly(status, body) {
  let msg = ''; try { msg = JSON.parse(body).error?.message || ''; } catch { msg = String(body || '').slice(0, 200); }
  if (status === 401) return 'badkey';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'ratelimit';
  if (status === 400 && /credit|balance|billing/i.test(msg)) return 'nocredit';
  if (status === 404 && /model/i.test(msg)) return 'badmodel';
  if (status === 529 || status === 503) return 'overloaded';
  return `Error ${status}${msg ? ': ' + msg : ''}`;
}

function buildRequest(messages) {
  const body = {
    model: cfg.model, max_tokens: Math.max(cfg.maxTokens || 0, 8000), stream: true,  // los dibujos SVG necesitan espacio
    // Caché de prompt: las directrices (y la herramienta) se cobran ~10% en las preguntas siguientes,
    // y la conversación se va guardando en caché automáticamente.
    cache_control: { type: 'ephemeral' },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages,
  };
  body.tools = cfg.allowReply ? [REPLY_TOOL, DRAW_TOOL] : [DRAW_TOOL];
  return body;
}

/** Llama a Claude con streaming. Emite texto con onText y devuelve { text, tools:[{id,name,input}], stop }. */
async function streamClaude(messages, signal, onText) {
  let r, tries = 0;
  while (true) {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-api-key': getKey(), 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(buildRequest(messages)),
    });
    if ((r.status === 529 || r.status === 503 || r.status === 500) && tries < 2) { tries++; await sleep(1500 * tries); continue; }
    break;
  }
  if (!r.ok) throw new Error(friendly(r.status, await r.text().catch(() => '')));
  const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
  const blocks = []; let stop = null, text = '';
  while (true) {
    const { done, value } = await rd.read(); if (done) break;
    buf += dec.decode(value, { stream: true }); let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue; let ev; try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (ev.type === 'content_block_start') {
          const b = ev.content_block || {};
          blocks[ev.index] = b.type === 'tool_use' ? { type: 'tool_use', id: b.id, name: b.name, json: '' } : { type: b.type };
        } else if (ev.type === 'content_block_delta') {
          if (ev.delta?.type === 'text_delta') { text += ev.delta.text; onText(ev.delta.text); }
          else if (ev.delta?.type === 'input_json_delta' && blocks[ev.index]) blocks[ev.index].json += ev.delta.partial_json || '';
        } else if (ev.type === 'message_delta') { stop = ev.delta?.stop_reason || stop; }
        else if (ev.type === 'error') throw new Error(ev.error?.type === 'overloaded_error' ? 'overloaded' : (ev.error?.message || 'stream error'));
      }
    }
  }
  const tools = blocks.filter(b => b && b.type === 'tool_use').map(b => { let input = {}; try { input = JSON.parse(b.json || '{}'); } catch {} return { id: b.id, name: b.name, input }; });
  return { text, tools, stop };
}

/** Si la última respuesta de Claude usó la herramienta, la API exige devolver el resultado en el siguiente mensaje. */
function pendingToolResults() {
  const last = history[history.length - 1];
  if (!last || last.role !== 'assistant' || !Array.isArray(last.content)) return [];
  return last.content.filter(c => c.type === 'tool_use').map(c => {
    if (c.name === DRAW_TOOL.name) {
      const d = drawings.get(c.id);
      const st = !d ? 'The drawing could not be shown.' : d.decided === 'pasted' ? 'The user pasted the drawing into their window (e.g. Paint).'
        : d.decided === 'saved' ? 'The user saved the drawing as an image.' : d.decided === 'copied' ? 'The user copied the drawing.'
        : 'The drawing was shown in the chat.';
      return { type: 'tool_result', tool_use_id: c.id, content: st };
    }
    const p = proposals.get(c.id);
    const status = !p ? 'The card could not be shown.'
      : p.decided === 'written' ? 'The user authorized it and Orbe typed it into the text box (not sent; the user sends it).'
      : p.decided === 'copied' ? 'The user copied the draft to paste it themselves.'
      : p.decided === 'discarded' ? 'The user discarded the draft.'
      : 'The draft card was shown; the user has not authorized it yet.';
    return { type: 'tool_result', tool_use_id: c.id, content: status };
  });
}
function trimHistory() {
  if (history.length > 30) history = history.slice(-30);
  // el historial debe empezar con un mensaje del usuario que no sea un resultado de herramienta
  while (history.length && (history[0].role !== 'user' || (Array.isArray(history[0].content) && history[0].content.some(c => c.type === 'tool_result')))) history.shift();
}

ipcMain.handle('ask', async (_e, { text, withScreen, readFile, spoken }) => {
  if (busy) return { error: 'busy' };
  if (!ready()) return { error: 'nokey' };
  busy = true; setState('thinking');
  try {
    const shot = withScreen ? await capture(target) : null;
    const ctxLine = target ? `[Window: "${target.title}" — app: ${target.proc || 'unknown'}]` : '[Full screen]';
    const content = [...pendingToolResults()];
    // carpeta o archivo bajo el orbe: su contenido real (el archivo por dentro solo si el usuario activó "Leer contenido")
    const it = cfg.allowFiles && target && target.item;
    if (it && it.path) {
      if (it.kind === 'folder') content.push({ type: 'text', text: describeFolder(it.path) });
      else if (it.kind === 'file') content.push(...describeFile(it.path, !!readFile).blocks);
    } else if (it) content.push({ type: 'text', text: `[Icon under the orb: "${it.name}"${it.where ? ' in ' + it.where : ''}. Its location on disk could not be resolved (it may be a shortcut, a special folder or a cloud item).]` });
    if (shot) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: shot.b64 } });
    content.push({ type: 'text', text: (spoken ? '[Voice: the user said this out loud; your answer will be spoken]\n' : '') + (shot ? ctxLine + '\n' : '') + text });
    // las capturas y documentos antiguos se reemplazan por una nota (ahorra tokens)
    history = history.map(m => (m.role === 'user' && Array.isArray(m.content))
      ? { role: 'user', content: m.content.map(c => c.type === 'image' ? { type: 'text', text: '[earlier screenshot omitted]' }
          : c.type === 'document' ? { type: 'text', text: '[earlier document omitted]' }
          : (c.type === 'text' && c.text.length > 4000 && /^\[(File|Folder) shown/.test(c.text)) ? { type: 'text', text: c.text.split('\n')[0] + ' [details omitted; shown earlier]' } : c) } : m);
    history.push({ role: 'user', content });
    trimHistory();
    panelWin.webContents.send('shot', shot ? shot.dataUrl : null);
    abortCtl = new AbortController();
    let started = false;
    const out = await streamClaude(history, abortCtl.signal, t => { if (!started) { started = true; setState('speaking'); } panelWin.webContents.send('delta', t); });
    const blocks = [];
    if (out.text) blocks.push({ type: 'text', text: out.text });
    const cards = [];
    for (const t of out.tools) {
      blocks.push({ type: 'tool_use', id: t.id, name: t.name, input: t.input });
      if (t.name === DRAW_TOOL.name && typeof t.input.svg === 'string' && /<svg[\s>]/i.test(t.input.svg)) {
        drawings.set(t.id, { svg: t.input.svg, title: t.input.titulo || '', target, decided: null });
        cards.push({ id: t.id, kind: 'draw', svg: t.input.svg, title: t.input.titulo || '', canPaste: !!(target && target.hwnd) });
      } else if (t.name === REPLY_TOOL.name && typeof t.input.texto === 'string' && t.input.texto.trim()) {
        proposals.set(t.id, { text: t.input.texto, target, created: Date.now(), decided: null });
        cards.push({ id: t.id, text: t.input.texto, para: t.input.para || '', canWrite: !!target });
      } else proposals.set(t.id, null);
    }
    if (!blocks.length) blocks.push({ type: 'text', text: '…' });
    history.push({ role: 'assistant', content: blocks });
    return { ok: true, text: out.text, cards };
  } catch (err) {
    if (history.length && history[history.length - 1].role === 'user') history.pop();
    return { error: err.name === 'AbortError' ? 'stopped' : String(err.message || err) };
  } finally { busy = false; abortCtl = null; setState(voiceActive ? 'speaking' : target ? 'locked' : 'idle'); }
});

// ---------------- responder por ti (solo con autorización y con el usuario presente) ----------------
function userPresent() {
  try {
    if (powerMonitor.getSystemIdleState(60) !== 'active') return false; // pantalla bloqueada o sin uso hace >1 min
  } catch {}
  return panelWin.isVisible();
}
async function typeInto(t, text) {
  const prev = clipboard.readText();
  clipboard.writeText(text);
  let ok = false;
  if (IS_WIN && t.hwnd) { const r = await psRaw(`paste ${t.hwnd}`, 5000); ok = !!(r && r.ok); }
  else if (IS_MAC && t.proc) {
    ok = (await run('osascript', ['-e', `tell application "${t.proc.replace(/"/g, '')}" to activate`, '-e', 'delay 0.3',
      '-e', 'tell application "System Events" to keystroke "v" using command down'])) !== null;
  } else if (!IS_WIN && !IS_MAC && t.wid) {
    ok = (await run('xdotool', ['windowactivate', '--sync', t.wid, 'key', '--clearmodifiers', 'ctrl+v'])) !== null;
  }
  setTimeout(() => { if (clipboard.readText() === text) clipboard.writeText(prev); }, 1500);
  return ok;
}
ipcMain.handle('reply-action', async (_e, { id, action, text }) => {
  const p = proposals.get(id);
  if (!p || p.decided === 'written' || p.decided === 'discarded') return { error: 'gone' };
  if (action === 'discard') { p.decided = 'discarded'; return { ok: true }; }
  const finalText = typeof text === 'string' && text.trim() ? text : p.text;
  if (action === 'copy') { clipboard.writeText(finalText); p.decided = 'copied'; return { ok: true }; }
  if (action !== 'write') return { error: 'bad' };
  if (!cfg.allowReply) return { error: 'replyoff' };
  if (Date.now() - p.created > 15 * 60 * 1000) return { error: 'expired' };   // autorización vieja: pedir de nuevo
  if (!userPresent()) return { error: 'notpresent' };
  const t = p.target || target;
  if (!t) return { error: 'notarget' };
  // confirmar que la ventana sigue ahí, bajo el orbe
  // (en Windows se puede preguntar por la ventana exacta; en macOS/Linux la ventana activa ahora es el chat de Orbe)
  if (IS_WIN) {
    const now = await windowAtDip(orbCenter());
    if (!now || now.hwnd !== t.hwnd) return { error: 'moved' };
  }
  panelWin.hide(); await sleep(150);
  const ok = await typeInto(t, finalText);
  if (ok) { p.decided = 'written'; react('happy'); return { ok: true }; }
  clipboard.writeText(finalText); p.decided = 'copied';
  showPanel(false);
  return { error: 'typefail' };
});

// ---------------- dibujos (pegar en Paint u otra ventana, copiar, guardar) ----------------
ipcMain.handle('draw-action', async (_e, { id, action, png }) => {
  const d = drawings.get(id);
  if (!d) return { error: 'gone' };
  if (typeof png !== 'string' || !png.startsWith('data:image/png;base64,')) return { error: 'bad' };
  const img = nativeImage.createFromDataURL(png);
  if (img.isEmpty()) return { error: 'bad' };
  if (action === 'copy') { clipboard.writeImage(img); d.decided = 'copied'; return { ok: true }; }
  if (action === 'save') {
    const name = (d.title || 'dibujo-orbe').replace(/[\\/:*?"<>|]+/g, '').slice(0, 60) || 'dibujo-orbe';
    const r = await dialog.showSaveDialog(panelWin, { defaultPath: path.join(app.getPath('pictures'), name + '.png'), filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (r.canceled || !r.filePath) return { error: 'canceled' };
    fs.writeFileSync(r.filePath, img.toPNG()); d.decided = 'saved'; return { ok: true };
  }
  if (action !== 'paste') return { error: 'bad' };
  const t = d.target || target;
  if (!IS_WIN || !t || !t.hwnd) { clipboard.writeImage(img); d.decided = 'copied'; return { error: 'nopaste' }; }
  clipboard.writeImage(img);
  panelWin.hide(); await sleep(150);
  const r = await psRaw(`paste ${t.hwnd}`, 5000);
  if (r && r.ok) { d.decided = 'pasted'; react('happy'); return { ok: true }; }
  d.decided = 'copied'; showPanel(false); return { error: 'typefail' };
});

// ---------------- voz: escuchar y hablar (solo Windows; voces y reconocimiento del propio Windows) ----------------
let listening = false;
ipcMain.handle('listen', async () => {
  if (!IS_WIN) return { error: 'novoice' };
  if (listening) return { error: 'busy' };
  listening = true; setState('listening');
  try {
    const r = await psListen.ask('listen', 45000);
    if (!r) return { error: 'cancel' };
    if (r.error === 'privacy') shell.openExternal('ms-settings:privacy-speech');
    else if (r.error === 'nomic') shell.openExternal('ms-settings:privacy-microphone');
    return r;
  } finally { listening = false; setState(target ? 'locked' : 'idle'); }
});
ipcMain.on('listen-cancel', () => { if (listening) { psListen.kill(); } });   // se reinicia solo en la próxima escucha
ipcMain.handle('tts', async (_e, text, opt) => {
  if (!IS_WIN || typeof text !== 'string' || !text.trim()) return { error: 'novoice' };
  const b = s => Buffer.from(s, 'utf8').toString('base64');
  const v = opt && typeof opt.voice === 'string' ? opt.voice : cfg.ttsVoice;
  const rate = opt && typeof opt.rate === 'number' && opt.rate >= 0.6 && opt.rate <= 1.8 ? opt.rate : (cfg.ttsRate || 1);
  const r = await psSpeak.ask(`say ${v ? b(v) : '-'} ${rate} ${b(text.slice(0, 1500))}`, 20000);
  if (!r || !r.wav) return { error: 'tts' };
  return { url: 'data:audio/wav;base64,' + r.wav };
});
ipcMain.on('voice-level', (_e, v) => bubbleWin?.webContents.send('wave', Array.isArray(v) ? v.slice(0, 48) : null));
ipcMain.handle('voices', async () => { if (!IS_WIN) return []; const r = await psSpeak.ask('voices', 10000); return (r && r.voices) || []; });
ipcMain.on('voice-state', (_e, s) => {
  voiceActive = s === 'speaking'; listening = s === 'listening';
  if (s === 'speaking' || s === 'listening') setState(s); else if (!busy) setState(target ? 'locked' : 'idle');
});
// Escuchar con el dictado de Windows (Windows + H), el mismo que el usuario ya usa: entiende muy bien el español.
// 'start' trae el chat al frente (el texto dictado cae en su cuadro) y abre el dictado; 'stop' lo cierra.
ipcMain.handle('vt', async (_e, action) => {
  if (!IS_WIN) return { error: 'novoice' };
  if (!cfg.allowTalk && action === 'start') return { error: 'talkoff' };
  if (action === 'start') { if (!panelWin.isVisible()) panelWin.show(); panelWin.focus(); panelWin.webContents.focus(); await sleep(120); }
  // va por su propio PowerShell: aunque algo se demore, nunca bloquea la detección de ventanas ni el pegar
  const r = await psKeys.ask(`winh ${process.pid}`, 3000);
  return { ok: !!(r && r.ok) };
});

// ---------------- manos libres: hablarle al orbe con el chat cerrado ----------------
// El dictado de Windows escribe en un cuadro invisible del propio orbe; al terminar, Orbe devuelve el foco
// a la ventana donde estabas y responde con voz. Funciona sobre cualquier ventana, carpeta o archivo.
let hf = null;
function voiceEntry() {
  if (!IS_WIN || !cfg.allowTalk) return;
  if (panelWin.isVisible()) { panelWin.webContents.send('voice-toggle'); return; }
  if (hf) { bubbleWin.webContents.send('sink-stop'); endHandsFree(); return; }
  if (voiceActive) panelWin.webContents.send('voice-stop');
  startHandsFree(false);
}
async function startHandsFree(auto) {
  if (!IS_WIN || !cfg.allowTalk || hf || busy) return;
  const prev = await psRaw(`fg ${process.pid}`, 2000);
  hf = { prev: prev && prev.hwnd, auto };
  bubbleWin.setFocusable(true); bubbleWin.focus(); bubbleWin.webContents.focus();
  bubbleWin.webContents.send('sink-start', { auto });
  listening = true; setState('listening');
  await sleep(150);
  const r = await psKeys.ask(`winh ${process.pid}`, 3000);
  if (!r || !r.ok) { bubbleWin.webContents.send('sink-stop'); hf.noClose = true; endHandsFree(); }
}
async function endHandsFree() {
  if (!hf) return; const h = hf; hf = null;
  if (!h.noClose) await psKeys.ask(`winh ${process.pid}`, 3000);   // cierra el dictado (solo si Orbe sigue al frente)
  bubbleWin.setFocusable(false);
  if (h.prev) psKeys.ask(`focus ${h.prev}`, 3000);                  // de vuelta a tu ventana
  listening = false; if (!busy && !voiceActive) setState(target ? 'locked' : 'idle');
}
ipcMain.on('sink-text', async (_e, text) => { await endHandsFree(); if (typeof text === 'string' && text.trim()) panelWin.webContents.send('voice-ask', text.trim().slice(0, 2000)); });
ipcMain.on('hands-free', () => { if (!panelWin.isVisible()) startHandsFree(true); });

// ---------------- atajo, ojos, actualizaciones ----------------
function registerHotkey() {
  globalShortcut.unregisterAll();
  try {
    globalShortcut.register(cfg.hotkey, async () => {
      if (panelWin.isVisible() && panelWin.isFocused()) { panelWin.hide(); return; }
      const t = await foregroundWindow(); if (t) { target = t; pushTarget(); setState('locked'); }
      showPanel();
    });
  } catch {}
  // atajo para hablarle: abre el chat y empieza a escuchar
  try {
    if (IS_WIN && cfg.allowTalk && cfg.voiceHotkey) globalShortcut.register(cfg.voiceHotkey, async () => {
      voiceEntry();
    });
  } catch {}
}
function eyeLoop() {
  setInterval(() => {
    if (!bubbleWin || bubbleWin.isDestroyed()) return;
    const c = screen.getCursorScreenPoint(), o = orbCenter();
    bubbleWin.webContents.send('cursor', { dx: c.x - o.x, dy: c.y - o.y });
  }, 50);
}
function autoUpdate() {
  if (!app.isPackaged) return;
  try { const { autoUpdater } = require('electron-updater'); autoUpdater.autoDownload = true; autoUpdater.checkForUpdatesAndNotify().catch(() => {}); } catch {}
}

app.whenReady().then(() => {
  if (IS_MAC) { app.dock?.hide(); try { systemPreferences.getMediaAccessStatus('screen'); } catch {} }
  loadCfg(); startPs(); createBubble(); createPanel(); registerHotkey(); eyeLoop(); autoUpdate();
  if (!cfg.onboarded || !ready()) setTimeout(() => { showPanel(false); panelWin.webContents.send('open-settings', { welcome: true }); }, 1200);
});
app.on('second-instance', () => showPanel());
app.on('will-quit', () => { globalShortcut.unregisterAll(); psMain.kill(); psItems.kill(); psListen.kill(); psSpeak.kill(); psKeys.kill(); });
app.on('window-all-closed', () => {});
