// Orbe — asistente de IA flotante que ve la ventana donde lo pones.
// MIT License. https://github.com/  (ver README)
const { app, BrowserWindow, ipcMain, screen, desktopCapturer, globalShortcut, Menu, shell, safeStorage, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');

if (!app.requestSingleInstanceLock()) { app.quit(); }

const IS_WIN = process.platform === 'win32', IS_MAC = process.platform === 'darwin';
const BUBBLE = { w: 300, h: 120, orb: 84 };
let bubbleWin, panelWin;
let target = null;    // { title, proc, x, y, w, h, physical:bool }
let history = [];
let busy = false, abortCtl = null;

// ---------------- configuración ----------------
const cfgPath = () => path.join(app.getPath('userData'), 'config.json');
const DEFAULT_CFG = {
  provider: 'anthropic',          // 'anthropic' | 'ollama'
  apiKeyEnc: '', apiKeyPlain: '',
  model: 'claude-opus-5-5',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'qwen2.5vl',
  voice: false, maxTokens: 1500,
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
const ready = () => cfg.provider === 'ollama' ? true : !!getKey();

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
      try { const o = JSON.parse(line); r(o && o.title !== undefined ? { ...o, physical: true } : null); } catch { r(null); }
    }
  });
  ps.on('exit', () => { ps = null; psQueue.splice(0).forEach(r => r(null)); });
}
function psAsk(cmd) {
  return new Promise(resolve => {
    if (!ps) startPs(); if (!ps) return resolve(null);
    const done = v => { clearTimeout(timer); resolve(v); };
    const timer = setTimeout(() => { const k = psQueue.indexOf(done); if (k >= 0) psQueue.splice(k, 1); resolve(null); }, 6000);
    psQueue.push(done); ps.stdin.write(cmd + '\n');
  });
}
function run(cmd, args) { return new Promise(r => execFile(cmd, args, { timeout: 4000 }, (e, out) => r(e ? null : String(out)))); }
async function macFront() {
  const s = await run('osascript', ['-e', 'tell application "System Events" to tell (first application process whose frontmost is true) to get {name, name of front window, position of front window, size of front window}']);
  if (!s) return null; const p = s.trim().split(', ');
  if (p.length < 6) return null;
  const n = p.length; return { proc: p[0], title: p.slice(1, n - 4).join(', ') || p[0], x: +p[n - 4], y: +p[n - 3], w: +p[n - 2], h: +p[n - 1], physical: false };
}
async function linuxFront() {
  const g = await run('xdotool', ['getactivewindow', 'getwindowgeometry', '--shell']); if (!g) return null;
  const v = Object.fromEntries(g.trim().split('\n').map(l => l.split('=')));
  const name = (await run('xdotool', ['getactivewindow', 'getwindowname'])) || 'Ventana';
  return { title: name.trim(), proc: '', x: +v.X, y: +v.Y, w: +v.WIDTH, h: +v.HEIGHT, physical: false };
}
async function windowAtDip(pt) {
  if (IS_WIN) { const p = screen.dipToScreenPoint(pt); return psAsk(`point ${Math.round(p.x)} ${Math.round(p.y)} ${process.pid}`); }
  return foregroundWindow(); // macOS/Linux: la ventana activa (el orbe no roba el foco)
}
async function foregroundWindow() {
  if (IS_WIN) return psAsk(`fg ${process.pid}`);
  if (IS_MAC) return macFront();
  return linuxFront();
}

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
  const orbX = b.x + 18;
  let x = orbX - p.width - 12; if (x < d.x) x = orbX + BUBBLE.orb + 12;
  x = Math.max(d.x, Math.min(x, d.x + d.width - p.width));
  const y = Math.max(d.y, Math.min(Math.round(b.y + BUBBLE.h / 2 - p.height / 2), d.y + d.height - p.height));
  panelWin.setPosition(Math.round(x), Math.round(y));
}
function showPanel(focusInput = true) { placePanel(); panelWin.show(); panelWin.focus(); if (focusInput) panelWin.webContents.send('focus-input'); }
function setState(s) { bubbleWin?.webContents.send('state', s); }
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
  const b = bubbleWin.getBounds(); setState('scanning');
  const t = await windowAtDip({ x: b.x + 18 + BUBBLE.orb / 2, y: b.y + BUBBLE.h / 2 });
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
    { label: es ? 'Configuración' : 'Settings', click: () => { showPanel(false); panelWin.webContents.send('open-settings'); } },
    { label: es ? 'Salir de Orbe' : 'Quit Orbe', click: () => { app.isQuitting = true; app.quit(); } },
  ]).popup({ window: bubbleWin });
});
ipcMain.handle('get-cfg', () => {
  const k = getKey();
  return { provider: cfg.provider, model: cfg.model, ollamaUrl: cfg.ollamaUrl, ollamaModel: cfg.ollamaModel, voice: cfg.voice,
    hotkey: cfg.hotkey, apiKey: k ? '••••' + k.slice(-4) : '', ready: ready(), onboarded: cfg.onboarded, platform: process.platform, version: app.getVersion() };
});
ipcMain.handle('set-cfg', (_e, c) => {
  if (typeof c.apiKey === 'string' && c.apiKey && !c.apiKey.startsWith('••••')) setKey(c.apiKey);
  for (const k of ['provider', 'model', 'ollamaUrl', 'ollamaModel']) if (typeof c[k] === 'string' && c[k].trim()) cfg[k] = c[k].trim();
  if (typeof c.voice === 'boolean') cfg.voice = c.voice;
  if (typeof c.onboarded === 'boolean') cfg.onboarded = c.onboarded;
  saveCfg(); registerHotkey(); return true;
});
ipcMain.handle('get-target', () => (target ? { title: target.title, proc: target.proc } : null));
ipcMain.handle('recapture', async () => { const s = await capture(target); return s ? s.dataUrl : null; });
ipcMain.on('panel-hide', () => panelWin.hide());
ipcMain.on('new-chat', () => { history = []; });
ipcMain.on('stop', () => abortCtl?.abort());
ipcMain.on('open-url', (_e, u) => { if (/^https:\/\//.test(u)) shell.openExternal(u); });

const SYSTEM = `You are Orbe, a real-time assistant that lives on the user's screen as a floating orb.
The user drags the orb onto a window or browser tab and asks you things; you receive a screenshot of that window plus its title and app.
- Always reply in the same language the user writes in. Be clear, direct and brief; use numbered steps when something must be done.
- Base answers on what is actually visible in the screenshot; if something is unreadable or missing, say so and ask them to zoom or scroll.
- If you see an error, explain the likely cause and how to fix it. If you see a message or email, you may offer a ready-to-copy reply.
- You cannot click or type on the screen; tell the user exactly where to do it.
- Never repeat sensitive data visible in the screenshot (passwords, card numbers, keys).`;

async function* streamAnthropic(messages, signal) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-api-key': getKey(), 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: cfg.model, max_tokens: cfg.maxTokens, system: SYSTEM, messages, stream: true }),
  });
  if (!r.ok) { let m = `Error ${r.status}`; try { const j = await r.json(); m += ': ' + (j.error?.message || JSON.stringify(j)); } catch {} throw new Error(m); }
  const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
  while (true) {
    const { done, value } = await rd.read(); if (done) break;
    buf += dec.decode(value, { stream: true }); let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue; let ev; try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') yield ev.delta.text;
        if (ev.type === 'error') throw new Error(ev.error?.message || 'stream error');
      }
    }
  }
}
async function* streamOllama(messages, signal) {
  // convierte el formato Anthropic al de Ollama (texto + images base64)
  const msgs = [{ role: 'system', content: SYSTEM }, ...messages.map(m => {
    if (typeof m.content === 'string') return { role: m.role, content: m.content };
    const text = m.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
    const images = m.content.filter(c => c.type === 'image').map(c => c.source.data);
    return images.length ? { role: m.role, content: text, images } : { role: m.role, content: text };
  })];
  const r = await fetch(cfg.ollamaUrl.replace(/\/$/, '') + '/api/chat', { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: cfg.ollamaModel, messages: msgs, stream: true }) });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text().catch(() => '')}`);
  const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
  while (true) {
    const { done, value } = await rd.read(); if (done) break;
    buf += dec.decode(value, { stream: true }); let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      if (ev.error) throw new Error(ev.error);
      if (ev.message?.content) yield ev.message.content;
    }
  }
}

ipcMain.handle('ask', async (_e, { text, withScreen }) => {
  if (busy) return { error: 'busy' };
  if (!ready()) return { error: 'nokey' };
  busy = true; setState('thinking');
  try {
    const shot = withScreen ? await capture(target) : null;
    const ctxLine = target ? `[Window: "${target.title}" — app: ${target.proc || 'unknown'}]` : '[Full screen]';
    const content = [];
    if (shot) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: shot.b64 } });
    content.push({ type: 'text', text: (shot ? ctxLine + '\n' : '') + text });
    history = history.map(m => (m.role === 'user' && Array.isArray(m.content))
      ? { role: 'user', content: m.content.map(c => c.type === 'image' ? { type: 'text', text: '[earlier screenshot omitted]' } : c) } : m);
    history.push({ role: 'user', content });
    if (history.length > 30) history = history.slice(-30);
    while (history.length && history[0].role !== 'user') history.shift();
    panelWin.webContents.send('shot', shot ? shot.dataUrl : null);
    abortCtl = new AbortController();
    const gen = cfg.provider === 'ollama' ? streamOllama(history, abortCtl.signal) : streamAnthropic(history, abortCtl.signal);
    let full = ''; setState('speaking');
    for await (const t of gen) { full += t; panelWin.webContents.send('delta', t); }
    history.push({ role: 'assistant', content: full || '…' });
    return { ok: true, text: full };
  } catch (err) {
    if (history.length && history[history.length - 1].role === 'user') history.pop();
    return { error: err.name === 'AbortError' ? 'stopped' : String(err.message || err) };
  } finally { busy = false; abortCtl = null; setState(target ? 'locked' : 'idle'); }
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
    const c = screen.getCursorScreenPoint(), b = bubbleWin.getBounds();
    bubbleWin.webContents.send('cursor', { dx: c.x - (b.x + 18 + BUBBLE.orb / 2), dy: c.y - (b.y + BUBBLE.h / 2) });
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
