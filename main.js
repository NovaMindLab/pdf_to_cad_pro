const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const child_process = require('child_process');
const { login: platformLogin, loginWithPassword, httpRequest } = require('./utils/login');

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
      execCmd = path.join(process.resourcesPath, binName);
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
      return { success: true, data: res.data || [] };
    }
    return { success: false, error: (res && (res.message || res.msg)) || '接口返回异常' };
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

// ====== 应用内自动更新（Gitee Release） ======
// 升级仓库为公开仓库，读取 Release 无需鉴权，请勿将私有 token 打包进客户端
const UPDATE_RELEASE_API = 'https://gitee.com/api/v5/repos/hqxluoyang/pdf_to_cad_pro_update/releases/latest';

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
    const res = await fetch(UPDATE_RELEASE_API);
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    const rel = await res.json();
    const currentVersion = app.getVersion();
    const latestVersion = rel.tag_name || rel.name || '';
    const assets = rel.assets || [];
    // 分卷文件（>100MB 自动切分的 .gpartNN）优先，否则找单个 .exe
    const partAssets = assets
      .filter((a) => /\.gpart\d+$/i.test(a.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const exeAsset = assets.find((a) => /\.exe$/i.test(a.name) && !/\.gpart\d+$/i.test(a.name));
    const parts = partAssets.length
      ? partAssets.map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size }))
      : exeAsset
        ? [{ name: exeAsset.name, url: exeAsset.browser_download_url, size: exeAsset.size }]
        : [];
    // releases/latest 接口不带 size 字段，用 HEAD 请求补全（进度条需要）
    for (const p of parts) {
      if (!p.size) {
        try {
          const h = await fetch(p.url, { method: 'HEAD' });
          p.size = Number(h.headers.get('content-length')) || 0;
        } catch {
          p.size = 0;
        }
      }
    }
    return {
      success: true,
      hasUpdate: isNewerVersion(latestVersion, currentVersion),
      currentVersion,
      latestVersion,
      notes: rel.body || '',
      parts,
      totalSize: parts.reduce((s, p) => s + (p.size || 0), 0),
      releaseUrl: rel.html_url || 'https://gitee.com/hqxluoyang/pdf_to_cad_pro_update/releases'
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 下载更新（支持分卷，自动合并），通过 update-download-progress 事件回报进度（0-100）
ipcMain.handle('download-update', async (event, parts, totalSize) => {
  try {
    if (!Array.isArray(parts) || parts.length === 0) {
      return { success: false, error: '没有可下载的更新文件' };
    }
    const tmpDir = app.getPath('temp');
    let downloaded = 0;
    const partPaths = [];

    for (const part of parts) {
      const res = await fetch(part.url);
      if (!res.ok || !res.body) return { success: false, error: `HTTP ${res.status}` };
      const dest = path.join(tmpDir, part.name);
      const nodeStream = Readable.fromWeb(res.body);
      nodeStream.on('data', (chunk) => {
        downloaded += chunk.length;
        const pct = totalSize ? Math.min(99, Math.round((downloaded / totalSize) * 100)) : 0;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update-download-progress', pct);
        }
      });
      await pipeline(nodeStream, fs.createWriteStream(dest));
      partPaths.push(dest);
    }

    // 合并分卷为完整安装包
    const finalName = parts[0].name.replace(/\.gpart\d+$/i, '');
    const finalPath = path.join(tmpDir, finalName);
    const out = fs.openSync(finalPath, 'w');
    for (const p of partPaths) {
      fs.writeSync(out, fs.readFileSync(p));
      fs.unlinkSync(p);
    }
    fs.closeSync(out);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-download-progress', 100);
    }
    return { success: true, path: finalPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 启动安装程序并退出当前应用
ipcMain.handle('install-update', async (event, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: '安装包不存在' };
    }
    const err = await shell.openPath(filePath);
    if (err) return { success: false, error: err };
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
