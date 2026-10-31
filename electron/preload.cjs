const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  getVersion: () => ipcRenderer.invoke('app:version'),
  searchTracks: (params) => ipcRenderer.invoke('search:tracks', params),
  loadDownloadLocation: () => ipcRenderer.invoke('downloads:location-load'),
  chooseDownloadLocation: () => ipcRenderer.invoke('downloads:location-choose'),
  startDownloads: (tracks, uploadToNas = false) => ipcRenderer.invoke('downloads:start', { tracks, uploadToNas }),
  cancelDownloads: (jobId) => ipcRenderer.invoke('downloads:cancel', jobId),
  onDownloadEvent: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('downloads:event', handler)
    return () => ipcRenderer.removeListener('downloads:event', handler)
  },
  loadFnosSettings: () => ipcRenderer.invoke('fnos:settings-load'),
  saveFnosSettings: (settings) => ipcRenderer.invoke('fnos:settings-save', settings),
  testFnosConnection: (settings) => ipcRenderer.invoke('fnos:connection-test', settings),
  listSources: () => ipcRenderer.invoke('sources:list'),
  importSource: (targetId) => ipcRenderer.invoke('sources:import', targetId)
})
