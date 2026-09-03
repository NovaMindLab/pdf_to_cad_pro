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

  // 当前登录用户名 / 退出登录
  getLoginUser: () =>
    ipcRenderer.invoke('get-login-user'),

  platformLogout: () =>
    ipcRenderer.invoke('platform-logout'),

  // 云端文件列表（历史记录面板）
  platformListFolderFiles: (folderId) =>
    ipcRenderer.invoke('platform-list-folder-files', folderId),

  // 从平台下载 PDF 文件（数据PDF列表 -> 导入）
  platformDownloadFile: (fileId, fileName) =>
    ipcRenderer.invoke('platform-download-file', { fileId, fileName }),

  // 云端文件下载缓存（标记已下载过的文件）
  getCloudDownloads: () =>
    ipcRenderer.invoke('get-cloud-downloads'),

  // 上传转换后的 CAD 并关联原 PDF（转换成功面板「保存」）；overwrite=true 时同名覆盖
  platformUploadFile: (filePath, sourceFileId, folderId, overwrite) =>
    ipcRenderer.invoke('platform-upload-file', { filePath, sourceFileId, folderId, overwrite }),

  // 删除云端文件（删 PDF 会级联删其下所有 CAD）
  platformDeleteFiles: (fileIds) =>
    ipcRenderer.invoke('platform-delete-files', fileIds),

  // CAD 转换结果本地缓存（图纸列表展开显示已转换的 CAD）
  recordCadCache: (keyId, dxfPath, name) =>
    ipcRenderer.invoke('record-cad-cache', { keyId, dxfPath, name }),
  getCadCache: () =>
    ipcRenderer.invoke('get-cad-cache'),

  // 清除某个云端 PDF 的本地缓存（PDF + 转换出的 CAD）
  clearFileCache: (fileId) =>
    ipcRenderer.invoke('clear-file-cache', fileId),

  // 用系统默认程序打开文件
  openPathExternal: (filePath) =>
    ipcRenderer.invoke('open-path-externally', filePath),

  platformLogin: () =>
    ipcRenderer.invoke('platform-login'),

  platformRequest: (params) =>
    ipcRenderer.invoke('platform-request', params),

  // ====== 应用内自动更新 ======
  getAppVersion: () =>
    ipcRenderer.invoke('get-app-version'),

  checkForUpdate: () =>
    ipcRenderer.invoke('check-for-update'),

  downloadUpdate: (url, name) =>
    ipcRenderer.invoke('download-update', url, name),

  installUpdate: (filePath, isPatch) =>
    ipcRenderer.invoke('install-update', filePath, isPatch),

  onUpdateDownloadProgress: (callback) =>
    ipcRenderer.on('update-download-progress', (event, pct) => callback(pct)),
});