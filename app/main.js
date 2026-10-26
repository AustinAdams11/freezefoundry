// Freeze Foundry desktop shell: runs the local server in-process and shows it in its own window.
// Same code runs on Windows, macOS and Linux.
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const http = require('http');

// Installed copies keep their data and workspace in Documents/Freeze Foundry (the app folder is read-only).
if (app.isPackaged) process.env.FF_HOME = path.join(app.getPath('documents'), 'Freeze Foundry');
require(path.join(__dirname, '..', 'server.js'));

const URL_BASE = 'http://127.0.0.1:4177';

function waitForServer(tries = 50) {
  return new Promise((resolve, reject) => {
    const attempt = n => http.get(URL_BASE + '/api/settings', res => { res.resume(); resolve(); })
      .on('error', () => (n > 0 ? setTimeout(() => attempt(n - 1), 200) : reject(new Error('Server did not start'))));
    attempt(tries);
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1000, minHeight: 640,
    backgroundColor: '#1a1520', title: 'Freeze Foundry', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  // Links that try to open a new window go to the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  await waitForServer();
  win.loadURL(URL_BASE + '/');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
