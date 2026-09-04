const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const child_process = require('child_process');
const { login: platformLogin, loginWithPassword, httpRequest, PLATFORM_BASE } = require('./utils/login');

let mainWindow;
let loginWindow;
let dbPath = '';
let platformToken = null; // 登录成功后缓存的全局 token

function createWindow() {
  const iconPath = process.platform === 'win32'
    ? path.join(__dirname, 'assets', 'icon.ico')
    : path.join(__dirname, 'assets', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 850,
    minWidth: 1200,
    minHeight: 700,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    titleBarStyle: 'hiddenInset', // clean title bar for macOS, looks premium on Windows too
    show: false
  });

  mainWindow.loadFile('index.html');

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer] ${message} (${sourceId}:${line})`);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 开发调试模式：自动打开 DevTools
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createLoginWindow(prefillUsername) {
  const iconPath = process.platform === 'win32'
    ? path.join(__dirname, 'assets', 'icon.ico')
    : path.join(__dirname, 'assets', 'icon.png');

  loginWindow = new BrowserWindow({
    width: 1400,
    height: 850,
    minWidth: 1200,
    minHeight: 700,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    titleBarStyle: 'hiddenInset',
    show: false
  });

  loginWindow.loadFile('login.html', { query: { u: prefillUsername || '' } });

  loginWindow.once('ready-to-show', () => {
    loginWindow.show();
  });

  // 用户直接关闭登录窗口 → 退出应用（未登录不允许使用）
  loginWindow.on('closed', () => {
    loginWindow = null;
    if (!mainWindow) {
      app.quit();
    }
  });
}

// ====== 登录凭据持久化（记住登录状态） ======

function getAuthFilePath() {
  return path.join(app.getPath('userData'), 'auth.json');
}

// 登录成功后加密保存凭据（Windows 使用 DPAPI，按当前系统用户加密）
function saveAuthCredentials(username, password) {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[Auth] 系统不支持安全存储，跳过保存凭据');
      return;
    }
    const payload = {
      username,
      password: safeStorage.encryptString(password).toString('base64'),
    };
    fs.writeFileSync(getAuthFilePath(), JSON.stringify(payload), 'utf-8');
  } catch (e) {
    console.error('[Auth] 保存凭据失败:', e.message);
  }
}

function loadAuthCredentials() {
  try {
    const file = getAuthFilePath();
    if (!fs.existsSync(file) || !safeStorage.isEncryptionAvailable()) return null;
    const { username, password } = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return { username, password: safeStorage.decryptString(Buffer.from(password, 'base64')) };
  } catch (e) {
    return null;
  }
}

function clearAuthCredentials() {
  try {
    const file = getAuthFilePath();
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (e) { /* ignore */ }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null); // 隐藏 File/Edit/View/Window/Help 菜单栏
  dbPath = app.isPackaged
    ? path.join(app.getPath('userData'), 'history.db')
    : path.join(__dirname, 'history.db');

  // 有保存的凭据时自动登录，成功则直接进主界面
  const saved = loadAuthCredentials();
  if (saved) {
    console.log('[Auth] 检测到已保存凭据，尝试自动登录:', saved.username);
    const res = await loginWithPassword(saved.username, saved.password);
    if (res && res.success) {
      platformToken = res.token;
      createWindow();
      return;
    }
    console.warn('[Auth] 自动登录失败，显示登录窗口:', res ? res.error : '未知错误');
    clearAuthCredentials();
    createLoginWindow(saved.username);
    return;
  }

  createLoginWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const cred = loadAuthCredentials();
      if (cred) {
        loginWithPassword(cred.username, cred.password).then((res) => {
          if (res && res.success) {
            platformToken = res.token;
            createWindow();
          } else {
            createLoginWindow(cred.username);
          }
        });
      } else {
        createLoginWindow();
      }
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handler for file open dialog
ipcMain.handle('select-input-path', async (event) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select PDF Drawing',
    properties: ['openFile'],
    filters: [
      { name: 'PDF Files', extensions: ['pdf'] }
    ]
  });
  
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

// IPC Handler for file save dialog
ipcMain.handle('select-output-path', async (event, defaultPath) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Select CAD DXF Output Location',
    defaultPath: defaultPath || app.getPath('documents'),
    filters: [
      { name: 'AutoCAD DXF', extensions: ['dxf'] }
    ]
  });
  
  if (result.canceled) {
    return null;
  }
  return result.filePath;
});

// IPC Handler to read a text file
ipcMain.handle('read-text-file', async (event, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8');
  }
  return null;
});

// IPC Handler for PDF to DXF conversion
ipcMain.handle('convert-pdf-to-dxf', async (event, inputPath, outputPath) => {
  return new Promise((resolve) => {
    // 1. Validate inputs
    if (!inputPath || !fs.existsSync(inputPath)) {
      return resolve({ status: 'error', message: 'Input PDF file does not exist.' });
    }
    if (!outputPath) {
      return resolve({ status: 'error', message: 'Output path not specified.' });
    }

    // 2. Resolve sidecar executable path
    const isPackaged = app.isPackaged;
    let execCmd = '';
    let runArgs = [];

    if (isPackaged) {
      // Packaged Sidecar: located in Electron's resources directory
      const binName = process.platform === 'win32' ? 'pdf-converter.exe' : 'pdf-converter';
      const candidates = [
        path.join(process.resourcesPath, 'converter', 'dist', binName),
        path.join(process.resourcesPath, binName)
      ];
      execCmd = candidates.find(p => fs.existsSync(p)) || candidates[0];
    } else {
      // Development mode
      const devWinBin = path.join(__dirname, 'converter', 'dist', 'pdf-converter.exe');
      const devUnixBin = path.join(__dirname, 'converter', 'dist', 'pdf-converter');
      const localBin = process.platform === 'win32' ? devWinBin : devUnixBin;

      if (fs.existsSync(localBin)) {
        // Use pre-compiled local sidecar if it exists
        execCmd = localBin;
      } else {
        // Fallback to local python script execution
        execCmd = process.platform === 'win32' ? 'py' : 'python3';
        const scriptPath = path.join(__dirname, 'converter', 'converter.py');
        
        if (process.platform === 'win32') {
          runArgs.push('-3');
        }
        runArgs.push(scriptPath);
      }
    }

    // Add inputs/outputs/db to args
    runArgs.push('--input', inputPath);
    runArgs.push('--output', outputPath);
    if (dbPath) {
      runArgs.push('--db', dbPath);
    }

    // 3. Spawn child process
    child_process.execFile(execCmd, runArgs, (error, stdout, stderr) => {
      if (error) {
        // First try to parse graceful error response from stdout
        try {
          const cleanedStdout = stdout.trim();
          const lines = cleanedStdout.split('\n');
          let jsonStr = '';
          for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].trim().startsWith('{') && lines[i].trim().endsWith('}')) {
              jsonStr = lines[i].trim();
              break;
            }
          }
          if (jsonStr) {
            const response = JSON.parse(jsonStr);
            if (response && response.status === 'error') {
              return resolve(response);
            }
          }
        } catch (e) {
          // ignore and proceed to default error handler
        }

        // If execution failed completely (e.g. executable not found or crashed)
        let errMsg = error.message;
        if (stderr) {
          errMsg += `\nStderr: ${stderr}`;
        }
        return resolve({
          status: 'error',
          message: `Conversion process failed to start or crashed: ${errMsg}`
        });
      }

      // 4. Parse JSON output
      try {
        const cleanedStdout = stdout.trim();
        // Look for the last line which contains JSON (to bypass any warnings/prints)
        const lines = cleanedStdout.split('\n');
        let jsonStr = '';
        for (let i = lines.length - 1; i >= 0; i--) {
          if (lines[i].trim().startsWith('{') && lines[i].trim().endsWith('}')) {
            jsonStr = lines[i].trim();
            break;
          }
        }
        
        if (!jsonStr) {
          throw new Error(`Output does not contain a valid JSON string. Raw output: ${cleanedStdout}`);
        }

        const response = JSON.parse(jsonStr);
        resolve(response);
      } catch (parseError) {
        resolve({
          status: 'error',
          message: `Failed to parse conversion output: ${parseError.message}\nRaw stdout: ${stdout}\nRaw stderr: ${stderr}`
        });
      }
    });
  });
});

// IPC Handler to open file in system explorer
ipcMain.handle('open-explorer', async (event, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return true;
  }
  return false;
});

// IPC Handler to query history from DB using Python sidecar
ipcMain.handle('get-history', async () => {
  return new Promise((resolve) => {
    const isPackaged = app.isPackaged;
    let execCmd = '';
    let runArgs = [];

    if (isPackaged) {
      const binName = process.platform === 'win32' ? 'pdf-converter.exe' : 'pdf-converter';
      execCmd = path.join(process.resourcesPath, binName);
    } else {
      const devWinBin = path.join(__dirname, 'converter', 'dist', 'pdf-converter.exe');
      const devUnixBin = path.join(__dirname, 'converter', 'dist', 'pdf-converter');
      const localBin = process.platform === 'win32' ? devWinBin : devUnixBin;

      if (fs.existsSync(localBin)) {
        execCmd = localBin;
      } else {
        execCmd = process.platform === 'win32' ? 'py' : 'python3';
        const scriptPath = path.join(__dirname, 'converter', 'converter.py');
        if (process.platform === 'win32') {
          runArgs.push('-3');
        }
        runArgs.push(scriptPath);
      }
    }

    runArgs.push('--history-list', dbPath);

    child_process.execFile(execCmd, runArgs, (error, stdout, stderr) => {
      if (error) {
        return resolve([]);
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (e) {
        resolve([]);
      }
    });
  });
});

// IPC Handler to clear history from DB using Python sidecar
ipcMain.handle('clear-history', async () => {
  return new Promise((resolve) => {
    const isPackaged = app.isPackaged;
    let execCmd = '';
    let runArgs = [];

    if (isPackaged) {
      const binName = process.platform === 'win32' ? 'pdf-converter.exe' : 'pdf-converter';
      execCmd = path.join(process.resourcesPath, binName);
    } else {
      const devWinBin = path.join(__dirname, 'converter', 'dist', 'pdf-converter.exe');
      const devUnixBin = path.join(__dirname, 'converter', 'dist', 'pdf-converter');
      const localBin = process.platform === 'win32' ? devWinBin : devUnixBin;

      if (fs.existsSync(localBin)) {
        execCmd = localBin;
      } else {
        execCmd = process.platform === 'win32' ? 'py' : 'python3';
        const scriptPath = path.join(__dirname, 'converter', 'converter.py');
        if (process.platform === 'win32') {
          runArgs.push('-3');
        }
        runArgs.push(scriptPath);
      }
    }

    runArgs.push('--history-clear', dbPath);

    child_process.execFile(execCmd, runArgs, (error, stdout, stderr) => {
      if (error) {
        return resolve({ status: 'error', message: error.message });
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (e) {
        resolve({ status: 'error', message: 'Failed to parse output' });
      }
    });
  });
});

// IPC Handler to delete a specific history item from DB
ipcMain.handle('delete-history-item', async (event, id) => {
  return new Promise((resolve) => {
    const isPackaged = app.isPackaged;
    let execCmd = '';
    let runArgs = [];

    if (isPackaged) {
      const binName = process.platform === 'win32' ? 'pdf-converter.exe' : 'pdf-converter';
      execCmd = path.join(process.resourcesPath, binName);
    } else {
      const devWinBin = path.join(__dirname, 'converter', 'dist', 'pdf-converter.exe');
      const devUnixBin = path.join(__dirname, 'converter', 'dist', 'pdf-converter');
      const localBin = process.platform === 'win32' ? devWinBin : devUnixBin;

      if (fs.existsSync(localBin)) {
        execCmd = localBin;
      } else {
        execCmd = process.platform === 'win32' ? 'py' : 'python3';
        const scriptPath = path.join(__dirname, 'converter', 'converter.py');
        if (process.platform === 'win32') {
          runArgs.push('-3');
        }
        runArgs.push(scriptPath);
      }
    }

    runArgs.push('--history-delete', String(id), '--db', dbPath);

    child_process.execFile(execCmd, runArgs, (error, stdout, stderr) => {
      if (error) {
        return resolve({ status: 'error', message: error.message });
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (e) {
        resolve({ status: 'error', message: 'Failed to parse output' });
      }
    });
  });
});


// IPC Handler to read image file and return base64 Data URL
ipcMain.handle('read-image-base64', async (event, filePath) => {
  try {
    if (filePath && fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath);
      return `data:image/png;base64,${data.toString('base64')}`;
    }
  } catch (e) {
    console.error("Error reading image base64:", e);
  }
  return null;
});

// IPC Handler to open file with system default CAD viewer
ipcMain.handle('open-file', async (event, filePath) => {
  try {
    if (filePath && fs.existsSync(filePath)) {
      await shell.openPath(filePath);
      return true;
    }
  } catch (e) {
    console.error("Error opening file:", e);
  }
  return false;
});

// IPC Handler to write a text file (used by the DXF editor for export)
ipcMain.handle('save-text-file', async (event, filePath, text) => {
  try {
    fs.writeFileSync(filePath, text, 'utf-8');
    return { status: 'success', saved_to: filePath };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
});

// IPC Handler to show a save dialog (for DXF editor export / save-as)
ipcMain.handle('show-save-dialog', async (event, defaultPath) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出编辑后的 DXF',
    defaultPath: defaultPath || app.getPath('documents'),
    filters: [
      { name: 'AutoCAD DXF', extensions: ['dxf'] }
    ]
  });
  if (result.canceled) return null;
  return result.filePath;
});
ipcMain.handle('list-subgraphs', async () => {
  return new Promise((resolve) => {
    const isPackaged = app.isPackaged;
    let execCmd = '';
    let runArgs = [];

    if (isPackaged) {
      const binName = process.platform === 'win32' ? 'pdf-converter.exe' : 'pdf-converter';
      execCmd = path.join(process.resourcesPath, binName);
    } else {
      execCmd = process.platform === 'win32' ? 'py' : 'python3';
      const scriptPath = path.join(__dirname, 'converter', 'converter.py');
      if (process.platform === 'win32') runArgs.push('-3');
      runArgs.push(scriptPath);
    }

    if (dbPath) {
      runArgs.push('--mode', 'list-subgraphs', '--db', dbPath);
      child_process.execFile(execCmd, runArgs, (error, stdout, stderr) => {
        try {
          const lines = stdout.trim().split('\n');
          let jsonResponse = '';
          for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].trim().startsWith('[')) {
              jsonResponse = lines[i].trim();
              break;
            }
          }
          if (jsonResponse) {
            resolve(JSON.parse(jsonResponse));
          } else {
            resolve([]);
          }
        } catch (e) {
          resolve({ status: 'error', message: e.message });
        }
      });
    } else {
      resolve([]);
    }
  });
});

ipcMain.handle('export-subgraph-to-file', async (event, sourcePath) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出为 DXF',
    defaultPath: path.basename(sourcePath),
    filters: [{ name: 'AutoCAD DXF', extensions: ['dxf'] }]
  });
  
  if (result.canceled || !result.filePath) {
    return { status: 'canceled' };
  }
  
  try {
    fs.copyFileSync(sourcePath, result.filePath);
    return { status: 'success', path: result.filePath };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
});

ipcMain.handle('export-dxf-subgraph', async (event, jsonStr, name, pdfHash) => {
  return new Promise(async (resolve) => {
    try {
      // 1. 生成自动保存路径
      const subgraphsDir = path.join(app.getPath('userData'), 'subgraphs');
      if (!fs.existsSync(subgraphsDir)) {
        fs.mkdirSync(subgraphsDir, { recursive: true });
      }
      const outputPath = path.join(subgraphsDir, `subgraph_${Date.now()}.dxf`);
      
      // 2. 将 JSON 写入临时文件
      const tempJsonPath = path.join(app.getPath('temp'), `export_${Date.now()}.json`);
      fs.writeFileSync(tempJsonPath, jsonStr, 'utf8');
      
      // 3. 准备执行 Python 侧
      const isPackaged = app.isPackaged;
      let execCmd = '';
      let runArgs = [];

      if (isPackaged) {
        const binName = process.platform === 'win32' ? 'pdf-converter.exe' : 'pdf-converter';
        execCmd = path.join(process.resourcesPath, binName);
      } else {
        execCmd = process.platform === 'win32' ? 'py' : 'python3';
        const scriptPath = path.join(__dirname, 'converter', 'converter.py');
        if (process.platform === 'win32') runArgs.push('-3');
        runArgs.push(scriptPath);
      }

      runArgs.push('--mode', 'export-subgraph', '--data', tempJsonPath, '--output', outputPath);
      if (dbPath && name) {
        runArgs.push('--db', dbPath, '--name', name);
        if (pdfHash) {
          runArgs.push('--pdf-hash', pdfHash);
        } else {
          runArgs.push('--pdf-hash', 'legacy_or_unknown');
        }
      }

      child_process.execFile(execCmd, runArgs, (error, stdout, stderr) => {
        if (error) {
          return resolve({ success: false, error: error.message });
        }
        
        try {
          const cleanedStdout = stdout.trim();
          const lines = cleanedStdout.split('\n');
          let jsonResponse = '';
          for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].trim().startsWith('{') && lines[i].trim().endsWith('}')) {
              jsonResponse = lines[i].trim();
              break;
            }
          }
          if (jsonResponse) {
            const parsed = JSON.parse(jsonResponse);
            if (parsed.status === 'success') {
              return resolve({ success: true, path: outputPath });
            } else {
              return resolve({ success: false, error: parsed.message || 'Unknown error' });
            }
          } else {
             return resolve({ success: true, path: outputPath }); // Fallback if it just worked silently
          }
        } catch (e) {
          return resolve({ success: false, error: e.message });
        }
      });
    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
});

// ====== 第三方平台对接 API ======

// 登录界面：用户名 + 密码登录
ipcMain.handle('login-with-password', async (event, username, password) => {
  const res = await loginWithPassword(username, password);
  if (res && res.success) {
    platformToken = res.token;
    saveAuthCredentials(username, password); // 记住登录状态，下次启动自动登录
    // 登录成功：先创建主窗口，再关闭登录窗口
    if (!mainWindow) createWindow();
    if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
    return { success: true, user: res.data ? res.data.user : null };
  }
  return res;
});

// 渲染进程获取登录后的平台 token
ipcMain.handle('get-platform-token', async () => {
  return platformToken;
});

// 获取当前登录用户名（来自本地保存的凭据）
ipcMain.handle('get-login-user', async () => {
  const saved = loadAuthCredentials();
  return saved ? saved.username : '';
});

// 退出登录：清除本地凭据与 token，回到登录界面
ipcMain.handle('platform-logout', async () => {
  const saved = loadAuthCredentials();
  const username = saved ? saved.username : '';
  clearAuthCredentials();
  platformToken = null;
  createLoginWindow(username);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  return { success: true };
});

// 云端文件列表（历史记录面板数据源，两层结构：原始 PDF -> children CAD）
ipcMain.handle('platform-list-folder-files', async (event, folderId) => {
  try {
    if (!platformToken) return { success: false, error: '未登录平台' };
    const res = await httpRequest({
      url: `/folder/files?folder_id=${folderId || 4}`,
      method: 'GET',
      token: platformToken,
    });
    if (res && res.code === 0) {
      const saved = loadAuthCredentials();
      return { success: true, data: res.data || [], user: saved ? saved.username : '' };
    }
    return { success: false, error: (res && (res.message || res.msg)) || '接口返回异常' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 云端文件删除：DELETE /folder/file，body { dtlist: [fileId, ...] }
// 删除原始 PDF 会连带删除其下所有关联 CAD（平台级联）
ipcMain.handle('platform-delete-files', async (event, fileIds) => {
  try {
    if (!platformToken) return { success: false, error: '未登录平台' };
    const ids = (Array.isArray(fileIds) ? fileIds : [fileIds]).filter(id => id != null);
    if (!ids.length) return { success: false, error: '缺少文件 id' };

    const res = await httpRequest({
      url: '/folder/file',
      method: 'DELETE',
      data: { dtlist: ids },
      token: platformToken,
    });
    if (res && res.code === 0) {
      console.log(`[平台] 文件删除成功: dtlist=${JSON.stringify(ids)}`);
      return { success: true, data: res.data };
    }
    return { success: false, error: (res && (res.message || res.msg)) || `HTTP 删除失败` };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 云端下载缓存注册表（fileId -> 本地路径），记录已下载过的平台文件
function getPdfDir() {
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'pdf')
    : path.join(__dirname, 'pdf');
}

function getCloudDownloadsFile() {
  return path.join(getPdfDir(), 'cloud_downloads.json');
}

function loadCloudDownloads() {
  try {
    return JSON.parse(fs.readFileSync(getCloudDownloadsFile(), 'utf-8'));
  } catch {
    return {};
  }
}

function saveCloudDownloads(map) {
  const dir = getPdfDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getCloudDownloadsFile(), JSON.stringify(map, null, 2), 'utf-8');
}

// 查询云端下载缓存（渲染进程渲染列表时标记已下载文件）
ipcMain.handle('get-cloud-downloads', async () => {
  const map = loadCloudDownloads();
  // 过滤掉本地文件已被手动删除的记录
  const valid = {};
  let changed = false;
  for (const [id, entry] of Object.entries(map)) {
    if (entry.path && fs.existsSync(entry.path)) {
      valid[id] = entry;
    } else {
      changed = true;
    }
  }
  if (changed) saveCloudDownloads(valid);
  return valid;
});

// CAD 转换结果缓存注册表（云端 PDF id -> 本地转换出的 DXF 列表）
function getCadCacheFile() {
  return path.join(getPdfDir(), 'cad_cache.json');
}

function loadCadCache() {
  try {
    return JSON.parse(fs.readFileSync(getCadCacheFile(), 'utf-8'));
  } catch {
    return {};
  }
}

function saveCadCache(map) {
  const dir = getPdfDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getCadCacheFile(), JSON.stringify(map, null, 2), 'utf-8');
}

// 记录转换出的 CAD（转换成功后调用）
ipcMain.handle('record-cad-cache', async (event, { keyId, dxfPath, name }) => {
  try {
    if (!keyId || !dxfPath || !fs.existsSync(dxfPath)) return { success: false };
    const map = loadCadCache();
    const key = String(keyId);
    if (!map[key]) map[key] = [];
    // 去重：同一路径只记一次，更新时间
    const exist = map[key].find((e) => e.path === dxfPath);
    if (exist) {
      exist.savedAt = new Date().toISOString();
    } else {
      map[key].push({
        path: dxfPath,
        name: name || path.basename(dxfPath),
        size: fs.statSync(dxfPath).size,
        savedAt: new Date().toISOString(),
      });
    }
    saveCadCache(map);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 查询 CAD 缓存（列表展开时显示已转换的 CAD）
ipcMain.handle('get-cad-cache', async () => {
  const map = loadCadCache();
  const valid = {};
  let changed = false;
  for (const [id, entries] of Object.entries(map)) {
    const ok = entries.filter((e) => e.path && fs.existsSync(e.path));
    if (ok.length > 0) valid[id] = ok;
    if (ok.length !== entries.length) changed = true;
  }
  if (changed) saveCadCache(valid);
  return valid;
});

// 用系统默认程序打开文件（列表展开后打开缓存的 CAD）
ipcMain.handle('open-path-externally', async (event, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return { success: false, error: '文件不存在' };
    const err = await shell.openPath(filePath);
    return err ? { success: false, error: err } : { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 清除某个云端 PDF 的本地缓存（下载的 PDF + 转换出的 CAD），图纸列表「清除缓存」按钮
ipcMain.handle('clear-file-cache', async (event, fileId) => {
  try {
    const key = String(fileId);
    const removed = { pdf: 0, cad: 0 };

    // 1. 删除缓存的 PDF 文件及注册记录
    const dlMap = loadCloudDownloads();
    if (dlMap[key] && dlMap[key].path && fs.existsSync(dlMap[key].path)) {
      try { fs.unlinkSync(dlMap[key].path); removed.pdf = 1; } catch {}
    }
    delete dlMap[key];
    saveCloudDownloads(dlMap);

    // 2. 删除转换出的 CAD 文件及注册记录
    const cadMap = loadCadCache();
    if (Array.isArray(cadMap[key])) {
      for (const entry of cadMap[key]) {
        if (entry.path && fs.existsSync(entry.path)) {
          try { fs.unlinkSync(entry.path); removed.cad++; } catch {}
          // 顺手删转换时生成的同名 PNG 预览图（xxx_page_0.png）
          const pngs = path.join(path.dirname(entry.path), path.basename(entry.path, '.dxf') + '_page_');
          try {
            const dir = path.dirname(entry.path);
            for (const f of fs.readdirSync(dir)) {
              if (f.startsWith(path.basename(pngs)) && f.endsWith('.png')) {
                try { fs.unlinkSync(path.join(dir, f)); } catch {}
              }
            }
          } catch {}
        }
      }
      delete cadMap[key];
      saveCadCache(cadMap);
    }

    console.log(`[缓存] 已清除 fileId=${key} 的本地缓存: PDF×${removed.pdf}, CAD×${removed.cad}`);
    return { success: true, removed };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 从平台下载文件到本地 pdf 目录（数据PDF列表 -> 导入 -> 转换）；已下载过直接用缓存
ipcMain.handle('platform-download-file', async (event, { fileId, fileName }) => {
  try {
    if (!platformToken) return { success: false, error: '未登录平台' };

    // 命中缓存：本地文件存在则直接复用，不再下载
    const cacheMap = loadCloudDownloads();
    const cached = cacheMap[String(fileId)];
    if (cached && cached.path && fs.existsSync(cached.path)) {
      console.log(`[平台] 命中本地缓存: ${cached.path}`);
      return { success: true, path: cached.path, cached: true };
    }

    const res = await fetch(`${PLATFORM_BASE}/folder/file/download?id=${fileId}`, {
      headers: { Cookie: `xr3d_token=${platformToken}`, Authorization: `Bearer ${platformToken}` },
    });
    const ct = res.headers.get('content-type') || '';
    if (!res.ok || ct.includes('application/json')) {
      const body = await res.json().catch(() => null);
      const msg = (body && (body.message || body.msg)) || `HTTP ${res.status}`;
      return { success: false, error: msg === 'file_no_existed' ? '文件在平台上不存在' : msg };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const pdfDir = getPdfDir();
    if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
    const safeName = (fileName || `remote_${fileId}.pdf`).replace(/[\\/:*?"<>|]/g, '_');
    const dest = path.join(pdfDir, safeName);
    fs.writeFileSync(dest, buf);

    // 记录到下载缓存
    cacheMap[String(fileId)] = {
      path: dest,
      name: fileName || safeName,
      size: buf.length,
      downloadedAt: new Date().toISOString(),
    };
    saveCloudDownloads(cacheMap);

    console.log(`[平台] 文件下载成功: ${dest} (${(buf.length / 1024).toFixed(1)} KB)`);
    return { success: true, path: dest, cached: false };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 上传转换后的 CAD 并关联到原始 PDF（转换成功面板「保存」按钮）
ipcMain.handle('platform-upload-file', async (event, { filePath, sourceFileId, folderId, overwrite }) => {
  try {
    if (!platformToken) return { success: false, error: '未登录平台' };
    if (!filePath || !fs.existsSync(filePath)) return { success: false, error: 'DXF 文件不存在' };

    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
    form.append('folder_id', String(folderId || 4));
    if (sourceFileId != null) form.append('source_file_id', String(sourceFileId)); // 关联的原始 PDF id（上传 CAD 时才带）
    if (overwrite) form.append('overwrite', 'true'); // 同名覆盖：编辑后反复保存场景

    const res = await fetch(`${PLATFORM_BASE}/folder/file/upload`, {
      method: 'POST',
      headers: { Cookie: `xr3d_token=${platformToken}`, Authorization: `Bearer ${platformToken}` },
      body: form,
    });
    const body = await res.json().catch(() => null);
    if (res.ok && body && body.code === 0) {
      console.log(`[平台] CAD 上传成功并已关联 source_file_id=${sourceFileId}`);
      return { success: true, data: body.data };
    }
    return { success: false, error: (body && (body.message || body.msg)) || `HTTP ${res.status}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 平台登录
ipcMain.handle('platform-login', async () => {
  return platformLogin();
});

// 平台通用 HTTP 请求（携带 token）
ipcMain.handle('platform-request', async (event, { url, method, data, token }) => {
  try {
    const result = await httpRequest({ url, method, data, token });
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ====== 应用内自动更新（GitHub Release + 国内 CDN 镜像加速） ======
const GITHUB_OWNER = 'NovaMindLab';
const GITHUB_REPO = 'pdf_to_cad_pro';
const UPDATE_RELEASE_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

// 国内多线路高速下载镜像（自动容灾重试）
const ACCELERATED_MIRRORS = [
  (url) => `https://ghfast.top/${url}`,
  (url) => `https://ghproxy.net/${url}`,
  (url) => url // 原始 GitHub 直连
];

// 解析 "v1.2.3" / "1.2.3-rc" 之类的 tag 为 [major, minor, patch]
function parseVersion(v) {
  const m = String(v || '').trim().replace(/^v/i, '').match(/\d+(?:\.\d+)*/);
  if (!m) return null;
  return m[0].split('.').map((n) => parseInt(n, 10));
}

function isNewerVersion(remote, local) {
  const r = parseVersion(remote);
  const l = parseVersion(local);
  if (!r) return false;
  if (!l) return true;
  for (let i = 0; i < 3; i++) {
    const a = r[i] || 0;
    const b = l[i] || 0;
    if (a !== b) return a > b;
  }
  return false;
}

// 检查更新：获取最新 Release 并与当前版本比较
ipcMain.handle('check-for-update', async () => {
  try {
    let res;
    // 先尝试直接请求 GitHub API，如失败则尝试代理
    try {
      res = await fetch(UPDATE_RELEASE_API, {
        headers: { 'User-Agent': 'PDF-to-CAD-Client' }
      });
    } catch {
      res = await fetch(`https://ghfast.top/${UPDATE_RELEASE_API}`, {
        headers: { 'User-Agent': 'PDF-to-CAD-Client' }
      });
    }
    if (res.status === 404) {
      return { success: true, hasUpdate: false, currentVersion: app.getVersion(), notes: '暂无新版本发布' };
    }
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    const rel = await res.json();
    const currentVersion = app.getVersion();
    const latestVersion = rel.tag_name || rel.name || '';
    const assets = rel.assets || [];

    // 优先寻找差分增量包 update-patch-*.zip
    const patchAsset = assets.find((a) => /^update-patch-.*\.zip$/i.test(a.name));
    const exeAsset = assets.find((a) => /\.exe$/i.test(a.name) && !/\.gpart\d+$/i.test(a.name));
    const partAssets = assets
      .filter((a) => /\.gpart\d+$/i.test(a.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    let isPatch = false;
    let parts = [];

    if (patchAsset) {
      isPatch = true;
      parts = [{ name: patchAsset.name, url: patchAsset.browser_download_url, size: patchAsset.size }];
    } else if (exeAsset) {
      isPatch = false;
      parts = [{ name: exeAsset.name, url: exeAsset.browser_download_url, size: exeAsset.size }];
    } else if (partAssets.length) {
      isPatch = false;
      parts = partAssets.map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size }));
    }

    return {
      success: true,
      hasUpdate: isNewerVersion(latestVersion, currentVersion),
      isPatch,
      currentVersion,
      latestVersion,
      notes: rel.body || '',
      parts,
      totalSize: parts.reduce((s, p) => s + (p.size || 0), 0),
      releaseUrl: rel.html_url || `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 获取当前应用版本
ipcMain.handle('get-app-version', () => app.getVersion());

// 下载更新（支持镜像加速与分卷兼容），通过 update-download-progress 事件回报详细进度
ipcMain.handle('download-update', async (event, parts, totalSize) => {
  try {
    if (!Array.isArray(parts) || parts.length === 0) {
      return { success: false, error: '没有可下载的更新文件' };
    }
    const tmpDir = app.getPath('temp');
    let downloaded = 0;
    const partPaths = [];
    let effectiveTotal = Number(totalSize) || 0;

    for (const part of parts) {
      const dest = path.join(tmpDir, part.name);
      let success = false;
      let lastErr = null;

      // 依次尝试国内 CDN 加速节点下载
      for (const getUrl of ACCELERATED_MIRRORS) {
        const downloadUrl = getUrl(part.url);
        try {
          console.log(`[更新] 尝试从镜像下载: ${downloadUrl}`);
          const res = await fetch(downloadUrl);
          if (!res.ok || !res.body) {
            throw new Error(`HTTP ${res.status}`);
          }

          const lenHeader = Number(res.headers.get('content-length'));
          if (lenHeader && (!effectiveTotal || effectiveTotal < lenHeader)) {
            effectiveTotal = lenHeader;
          }

          const nodeStream = Readable.fromWeb(res.body);
          let lastTime = Date.now();
          let lastDownloaded = downloaded;
          let currentSpeed = 0;
          let lastEmit = 0;

          nodeStream.on('data', (chunk) => {
            downloaded += chunk.length;
            const now = Date.now();

            // 每 250ms 计算一次瞬时下载速度 (Byte/s)
            if (now - lastTime >= 250) {
              const deltaBytes = downloaded - lastDownloaded;
              const deltaSec = (now - lastTime) / 1000;
              currentSpeed = deltaSec > 0 ? Math.round(deltaBytes / deltaSec) : 0;
              lastDownloaded = downloaded;
              lastTime = now;
            }

            // 节流推送：每 100ms 最多推一次 IPC，防止高频事件阻塞渲染进程
            if (now - lastEmit >= 100 || (effectiveTotal && downloaded >= effectiveTotal)) {
              lastEmit = now;
              const pct = effectiveTotal ? Math.min(99, Math.round((downloaded / effectiveTotal) * 100)) : 0;

              if (mainWindow && !mainWindow.isDestroyed()) {
                // Windows 任务栏图标同步显示进度
                mainWindow.setProgressBar(pct > 0 ? pct / 100 : 0);
                mainWindow.webContents.send('update-download-progress', {
                  pct,
                  downloadedBytes: downloaded,
                  totalBytes: effectiveTotal,
                  speedBytes: currentSpeed,
                  downloadedMb: (downloaded / 1024 / 1024).toFixed(1),
                  totalMb: (effectiveTotal / 1024 / 1024).toFixed(1),
                  speedMb: (currentSpeed / 1024 / 1024).toFixed(1)
                });
              }
            }
          });

          await pipeline(nodeStream, fs.createWriteStream(dest));
          success = true;
          break;
        } catch (err) {
          lastErr = err;
          console.warn(`[更新] 镜像下载失败，切换备用线路: ${err.message}`);
        }
      }

      if (!success) {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setProgressBar(-1);
        return { success: false, error: `所有下载源均失败: ${lastErr ? lastErr.message : '未知错误'}` };
      }
      partPaths.push(dest);
    }

    // 若为分卷文件则合并，若为单个 exe 或 zip 补丁包则直接使用
    let finalPath;
    const isSplit = parts.some((p) => /\.gpart\d+$/i.test(p.name));
    if (isSplit && partPaths.length > 1) {
      const finalName = parts[0].name.replace(/\.gpart\d+$/i, '');
      finalPath = path.join(tmpDir, finalName);
      const out = fs.openSync(finalPath, 'w');
      for (const p of partPaths) {
        fs.writeSync(out, fs.readFileSync(p));
        fs.unlinkSync(p);
      }
      fs.closeSync(out);
    } else {
      finalPath = partPaths[0];
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(-1);
      mainWindow.webContents.send('update-download-progress', {
        pct: 100,
        downloadedBytes: downloaded,
        totalBytes: effectiveTotal || downloaded,
        speedBytes: 0,
        downloadedMb: (downloaded / 1024 / 1024).toFixed(1),
        totalMb: ((effectiveTotal || downloaded) / 1024 / 1024).toFixed(1),
        speedMb: '0.0'
      });
    }
    return { success: true, path: finalPath };
  } catch (err) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setProgressBar(-1);
    return { success: false, error: err.message };
  }
});

// 安装更新：支持差分补丁秒级自重启替换，或全量安装包启动
ipcMain.handle('install-update', async (event, filePath, isPatch) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: '更新文件不存在' };
    }

    if (isPatch) {
      // 差分增量升级模式：解压 zip 提取新 app.asar，通过后台 bat 覆盖并自重启
      const tmpExtractDir = path.join(app.getPath('temp'), `pdf_to_cad_patch_${Date.now()}`);
      fs.mkdirSync(tmpExtractDir, { recursive: true });

      try {
        child_process.execSync(`tar -xf "${filePath}" -C "${tmpExtractDir}"`);
      } catch (e) {
        return { success: false, error: `补丁解压失败: ${e.message}` };
      }

      const newAsar = path.join(tmpExtractDir, 'app.asar');
      if (!fs.existsSync(newAsar)) {
        return { success: false, error: '补丁包中未找到 app.asar 文件' };
      }

      // 若处于开发调试模式，仅做解压和校验提示
      if (!app.isPackaged) {
        return {
          success: true,
          message: '【调试模式】差分补丁已解压校验通过（在打包运行环境下将自动静默替换 app.asar 并重启生效）'
        };
      }

      const destAsar = path.join(process.resourcesPath, 'app.asar');
      const appExe = app.getPath('exe');
      const updateBat = path.join(app.getPath('temp'), 'apply_patch.bat');

      // 编写 Windows 独立替换与自重启脚本
      const batScript = [
        '@echo off',
        'chcp 65001 >nul',
        'ping 127.0.0.1 -n 2 >nul',
        `copy /Y "${newAsar}" "${destAsar}" >nul`,
        `start "" "${appExe}"`,
        `rd /s /q "${tmpExtractDir}" 2>nul`,
        `del "%~f0"`
      ].join('\r\n');

      fs.writeFileSync(updateBat, batScript, 'utf-8');

      const child = child_process.spawn('cmd.exe', ['/c', updateBat], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.unref();

      // 退出当前应用，释放文件锁以供批处理脚本覆盖
      app.exit(0);
      return { success: true };
    }

    // 全量安装升级模式：启动 Setup.exe
    const err = await shell.openPath(filePath);
    if (err) return { success: false, error: err };
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
