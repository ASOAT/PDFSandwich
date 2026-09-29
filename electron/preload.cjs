const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('pdfsandwich', {
  call: (action, args) => ipcRenderer.invoke('pdfsandwich:call', action, args),
  pathForFile: file => webUtils.getPathForFile(file),
  onState: callback => { const listener = (_event, state) => callback(state); ipcRenderer.on('pdfsandwich:state', listener); return () => ipcRenderer.removeListener('pdfsandwich:state', listener); }
});
