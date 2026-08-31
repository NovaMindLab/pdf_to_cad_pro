const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  convertPdfToDxf: (inputPath, outputPath) => 
    ipcRenderer.invoke('convert-pdf-to-dxf', inputPath, outputPath),
    
  selectInputPath: () => 
    ipcRenderer.invoke('select-input-path'),
    
  selectOutputPath: (defaultPath) => 
    ipcRenderer.invoke('select-output-path', defaultPath),
    
  openExplorer: (filePath) =>
    ipcRenderer.invoke('open-explorer', filePath),
    
  readTextFile: (filePath) =>
    ipcRenderer.invoke('read-text-file', filePath),
    
  getHistory: () =>
    ipcRenderer.invoke('get-history'),
    
  clearHistory: () =>
    ipcRenderer.invoke('clear-history'),
    
  deleteHistoryItem: (id) =>
    ipcRenderer.invoke('delete-history-item', id),
    
  readImageBase64: (filePath) =>
    ipcRenderer.invoke('read-image-base64', filePath),
    
  openFile: (filePath) =>
    ipcRenderer.invoke('open-file', filePath),

  saveTextFile: (filePath, text) =>
    ipcRenderer.invoke('save-text-file', filePath, text),

  showSaveDialog: (defaultPath) =>
    ipcRenderer.invoke('show-save-dialog', defaultPath),
    
  exportDxfSubgraph: (jsonStr, name, pdfHash) =>
    ipcRenderer.invoke('export-dxf-subgraph', jsonStr, name, pdfHash),
    
  listSubgraphs: () => ipcRenderer.invoke('list-subgraphs'),
  
  exportSubgraphToFile: (sourcePath) => 
    ipcRenderer.invoke('export-subgraph-to-file', sourcePath),

  // ====== 第三方平台对接 ======
  loginWithPassword: (username, password) =>
    ipcRenderer.invoke('login-with-password', username, password),

  getPlatformToken: () =>
    ipcRenderer.invoke('get-platform-token'),

  // 云端文件列表（历史记录面板）
  platformListFolderFiles: (folderId) =>
    ipcRenderer.invoke('platform-list-folder-files', folderId),

  platformLogin: () =>
    ipcRenderer.invoke('platform-login'),

  platformRequest: (params) =>
    ipcRenderer.invoke('platform-request', params),

  // ====== 应用内自动更新 ======
  checkForUpdate: () =>
    ipcRenderer.invoke('check-for-update'),

  downloadUpdate: (url, name) =>
    ipcRenderer.invoke('download-update', url, name),

  installUpdate: (filePath) =>
    ipcRenderer.invoke('install-update', filePath),

  onUpdateDownloadProgress: (callback) =>
    ipcRenderer.on('update-download-progress', (event, pct) => callback(pct)),
});