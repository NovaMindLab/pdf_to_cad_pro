const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const child_process = require('child_process');
const { login: platformLogin, httpRequest } = require('./utils/login');

let mainWindow;
let dbPath = '';

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

app.whenReady().then(() => {
  dbPath = app.isPackaged 
    ? path.join(app.getPath('userData'), 'history.db') 
    : path.join(__dirname, 'history.db');
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
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
