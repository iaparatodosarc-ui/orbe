// Orbe Claude — asistente de IA flotante que ve la ventana donde lo pones. Funciona solo con la API de Claude.
// MIT License. Ver README.
const { app, BrowserWindow, ipcMain, screen, desktopCapturer, globalShortcut, Menu, shell, safeStorage, systemPreferences, clipboard, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { SYSTEM, REPLY_TOOL, MODELS } = require('./guidelines');

if (!app.requestSingleInstanceLock()) { app.quit(); }
// El orbe hace sonidos al tocarlo: se permite el audio sin esperar otro gesto.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const IS_WIN = process.platform === 'win32', IS_MAC = process.platform === 'darwin';
const BUBBLE = { w: 300, h: 140, orb: 84, ox: 18, oy: 28 };
let bubbleWin, panelWin;
let target = null;    // { hwnd, wid, title, proc, x, y, w, h, physical:bool }
let history = [];
let busy = false, abortCtl = null;
const proposals = new Map(); // id -> { text, target, created, decided }

// ---------------- configuración ----------------
const cfgPath = () => path.join(app.getPath('userData'), 'config.json');
const DEFAULT_CFG = {
  apiKeyEnc: '', apiKeyPlain: '',
  model: 'claude-opus-5-5',
  voice: false, maxTokens: 1500,
  sounds: true, volume: 0.6,
  allowReply: false,           // "Orbe puede escribir respuestas por mí" (cada respuesta igual pide autorización)
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
let ps = null, psBuf = '', psQueue = [];
function startPs() {
  if (!IS_WIN) return;
  ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', res(path.join(__dirname, 'winutil.ps1'))], { windowsHide: true });
  ps.stdout.setEncoding('utf8');
  ps.stdout.on('data', d => {
    psBuf += d; let i;
    while ((i = psBuf.indexOf('\n')) >= 0) {
      const line = psBuf.slice(0, i).trim(); psBuf = psBuf.slice(i + 1);
      const r = psQueue.shift(); if (!r) continue;
      try { r(JSON.parse(line)); } catch { r(null); }
    }
  });
  ps.on('exit', () => { ps = null; psQueue.splice(0).forEach(r => r(null)); });
}
function psRaw(cmd, ms = 6000) {
  return new Promise(resolve => {
    if (!ps) startPs(); if (!ps) return resolve(null);
    const done = v => { clearTimeout(timer); resolve(v); };
    const timer = setTimeout(() => { const k = psQueue.indexOf(done); if (k >= 0) psQueue.splice(k, 1); resolve(null); }, ms);
    psQueue.push(done); ps.stdin.write(cmd + '\n');
  });
}
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
    alwaysOnTop: true, backgroundColor: '#00000000', title: 'Orbe', webPreferences,
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
function pushTarget() { const i = target ? { title: target.title, proc: target.proc } : null; bubbleWin?.webContents.send('target', i); panelWin?.webContents.send('target', i); }

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
async function lockUnderBubble() {
  setState('scanning');
  const t = await windowAtDip(orbCenter());
  target = t; pushTarget(); setState(t ? 'locked' : 'idle');
  return t ? { title: t.title, proc: t.proc } : null;
}
ipcMain.on('bubble-click', () => { if (panelWin.isVisible()) panelWin.hide(); else showPanel(); });
ipcMain.on('bubble-menu', () => {
  const es = app.getLocale().startsWith('es');
  Menu.buildFromTemplate([
    { label: es ? 'Abrir chat' : 'Open chat', click: () => showPanel() },
    { label: es ? 'Fijar ventana bajo el orbe' : 'Lock window under orb', click: () => lockUnderBubble() },
    { label: es ? 'Olvidar ventana (pantalla completa)' : 'Forget window (full screen)', click: () => { target = null; pushTarget(); setState('idle'); } },
    { type: 'separator' },
    { label: es ? 'Sonidos' : 'Sounds', type: 'checkbox', checked: cfg.sounds, click: m => { cfg.sounds = m.checked; saveCfg(); pushSound(); } },
    { label: es ? 'Configuración' : 'Settings', click: () => { showPanel(false); panelWin.webContents.send('open-settings'); } },
    { label: es ? 'Salir de Orbe' : 'Quit Orbe', click: () => { app.isQuitting = true; app.quit(); } },
  ]).popup({ window: bubbleWin });
});
ipcMain.handle('get-cfg', () => {
  const k = getKey();
  return { model: cfg.model, models: MODELS, voice: cfg.voice, sounds: cfg.sounds, volume: cfg.volume, allowReply: cfg.allowReply,
    hotkey: cfg.hotkey, apiKey: k ? '••••' + k.slice(-4) : '', ready: ready(), onboarded: cfg.onboarded, platform: process.platform, version: app.getVersion() };
});
ipcMain.handle('set-cfg', (_e, c) => {
  if (typeof c.apiKey === 'string' && c.apiKey && !c.apiKey.startsWith('••••')) setKey(c.apiKey);
  if (typeof c.model === 'string' && /^claude-[a-z0-9.\-]+$/i.test(c.model.trim())) cfg.model = c.model.trim();
  for (const k of ['voice', 'sounds', 'allowReply', 'onboarded']) if (typeof c[k] === 'boolean') cfg[k] = c[k];
  if (typeof c.volume === 'number' && c.volume >= 0 && c.volume <= 1) cfg.volume = c.volume;
  saveCfg(); registerHotkey(); pushSound(); return true;
});
ipcMain.handle('get-target', () => (target ? { title: target.title, proc: target.proc } : null));
ipcMain.handle('recapture', async () => { const s = await capture(target); return s ? s.dataUrl : null; });
ipcMain.on('panel-hide', () => panelWin.hide());
ipcMain.on('new-chat', () => { history = []; proposals.clear(); });
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
    model: cfg.model, max_tokens: cfg.maxTokens, stream: true,
    // Caché de prompt: las directrices (y la herramienta) se cobran ~10% en las preguntas siguientes,
    // y la conversación se va guardando en caché automáticamente.
    cache_control: { type: 'ephemeral' },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages,
  };
  if (cfg.allowReply) body.tools = [REPLY_TOOL];
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

ipcMain.handle('ask', async (_e, { text, withScreen }) => {
  if (busy) return { error: 'busy' };
  if (!ready()) return { error: 'nokey' };
  busy = true; setState('thinking');
  try {
    const shot = withScreen ? await capture(target) : null;
    const ctxLine = target ? `[Window: "${target.title}" — app: ${target.proc || 'unknown'}]` : '[Full screen]';
    const content = [...pendingToolResults()];
    if (shot) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: shot.b64 } });
    content.push({ type: 'text', text: (shot ? ctxLine + '\n' : '') + text });
    history = history.map(m => (m.role === 'user' && Array.isArray(m.content))
      ? { role: 'user', content: m.content.map(c => c.type === 'image' ? { type: 'text', text: '[earlier screenshot omitted]' } : c) } : m);
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
      if (t.name === REPLY_TOOL.name && typeof t.input.texto === 'string' && t.input.texto.trim()) {
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
  } finally { busy = false; abortCtl = null; setState(target ? 'locked' : 'idle'); }
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
app.on('will-quit', () => { globalShortcut.unregisterAll(); try { ps?.kill(); } catch {} });
app.on('window-all-closed', () => {});
