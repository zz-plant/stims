// The smallest Electron shell around an unmodified Stims: one window on a local
// URL, plus a display-media handler that answers with system audio and no picker.
// Everything behind `measuring` exists for the spike and adds nothing without
// STIMS_SPIKE_COLLECTOR set.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, session } = require('electron');

const env = process.env;
const pageUrl = env.STIMS_URL ?? 'http://localhost:5991/?agent=true';
const collector = env.STIMS_SPIKE_COLLECTOR;
const measuring = Boolean(collector);
// The web preference alone keeps every hidden state drawing at full rate; the
// command-line switches that '1' adds made no measurable difference.
const keepRendering = Boolean(env.STIMS_SPIKE_KEEP_RENDERING);

if (env.STIMS_SPIKE_KEEP_RENDERING === '1') {
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
}

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 800,
    height: 500,
    x: env.STIMS_SPIKE_X ? Number(env.STIMS_SPIKE_X) : undefined,
    y: env.STIMS_SPIKE_Y ? Number(env.STIMS_SPIKE_Y) : undefined,
    show: false,
    alwaysOnTop: env.STIMS_SPIKE_ON_TOP === '1',
    title: 'Stims (Electron spike)',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: !keepRendering,
    },
  });
  win.once('ready-to-show', () => win.showInactive());
  win.loadURL(pageUrl);
}

ipcMain.on('spike:probe', (event) => {
  event.returnValue = measuring
    ? {
        config: { collector, shell: env.STIMS_SPIKE_SHELL ?? 'electron' },
        source: fs.readFileSync(
          path.join(__dirname, '../shared/probe.js'),
          'utf8',
        ),
      }
    : null;
});

// Spike-only window control, so a script can hide and cover the window on
// demand. The Tauri shell answers the same routes.
function startControl(port) {
  http
    .createServer(async (request, response) => {
      const url = new URL(request.url, 'http://localhost');
      let result = 'ok';
      switch (url.pathname) {
        case '/show':
          win.showInactive();
          break;
        case '/hide':
          win.hide();
          break;
        case '/minimize':
          win.minimize();
          break;
        case '/restore':
          win.restore();
          win.showInactive();
          break;
        case '/app-hide':
          app.hide();
          break;
        case '/app-show':
          app.show();
          break;
        case '/gesture-eval': {
          let code = '';
          for await (const chunk of request) code += chunk;
          result = JSON.stringify(
            await win.webContents.executeJavaScript(code, true),
          );
          break;
        }
        case '/versions':
          result = JSON.stringify(process.versions);
          break;
        case '/quit':
          response.end('bye');
          app.quit();
          return;
        default:
          result = 'unknown';
      }
      response.end(result);
    })
    .listen(port, '127.0.0.1');
}

app.whenReady().then(() => {
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      // Capturing this window's own frame needs no screen-recording grant;
      // the video track is stopped straight away by the shim in preload.js.
      callback({ video: request.frame, audio: 'loopback' });
    },
    { useSystemPicker: false },
  );

  // A local shell must not reach production: 2026-11-03 had to be excluded
  // from every report because the Android spike's runs posted to it.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const { hostname, protocol } = new URL(details.url);
    const local =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      !protocol.startsWith('http');
    if (!local) console.log(`blocked ${details.url}`);
    callback({ cancel: !local });
  });

  createWindow();
  if (env.STIMS_SPIKE_CONTROL) startControl(Number(env.STIMS_SPIKE_CONTROL));
});

app.on('window-all-closed', () => app.quit());
