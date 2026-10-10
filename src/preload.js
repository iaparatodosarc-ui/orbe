const { contextBridge, ipcRenderer } = require('electron');
const on = (ch, fn) => ipcRenderer.on(ch, (_e, ...a) => fn(...a));
contextBridge.exposeInMainWorld('orbe', {
  // orbe
  mouseIgnore: v => ipcRenderer.send('mouse-ignore', v),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: () => ipcRenderer.send('drag-move'),
  dragEnd: moved => ipcRenderer.invoke('drag-end', moved),
  click: () => ipcRenderer.send('bubble-click'),
  menu: () => ipcRenderer.send('bubble-menu'),
  // panel
  ask: (text, withScreen, readFile) => ipcRenderer.invoke('ask', { text, withScreen, readFile }),
  stop: () => ipcRenderer.send('stop'),
  newChat: () => ipcRenderer.send('new-chat'),
  hide: () => ipcRenderer.send('panel-hide'),
  getCfg: () => ipcRenderer.invoke('get-cfg'),
  setCfg: c => ipcRenderer.invoke('set-cfg', c),
  testKey: () => ipcRenderer.invoke('test-key'),
  getTarget: () => ipcRenderer.invoke('get-target'),
  recapture: () => ipcRenderer.invoke('recapture'),
  drawAction: (id, action, png) => ipcRenderer.invoke('draw-action', { id, action, png }),
  replyAction: (id, action, text) => ipcRenderer.invoke('reply-action', { id, action, text }),
  openUrl: u => ipcRenderer.send('open-url', u),
  on,
});
