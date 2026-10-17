// Lumio pour Mac : fenêtre Electron qui affiche l'appli Lumio (version web du même code que l'iPhone).
const { app, BrowserWindow, Menu, net, protocol, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const WEB = path.join(__dirname, 'web');
const ORIGIN = 'app://lumio';

// Schéma « app:// » sécurisé : stockage local (réglages, connexion) conservé entre deux lancements
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

/** Fichier de l'appli web correspondant à l'adresse, sinon la page d'accueil (navigation gérée par l'appli). */
function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]).replace(/\.\.+/g, '');
  const candidates = [path.join(WEB, clean), path.join(WEB, `${clean}.html`), path.join(WEB, clean, 'index.html')];
  for (const f of candidates) {
    try {
      if (f.startsWith(WEB) && fs.statSync(f).isFile()) return f;
    } catch {}
  }
  return path.join(WEB, 'index.html');
}

let win = null;
let pendingDeepLink = null;

/** lumio://invite?… → app://lumio/invite?… */
function deepLinkToAppUrl(link) {
  try {
    const u = new URL(link);
    return `${ORIGIN}/${u.host}${u.pathname === '/' ? '' : u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

function openDeepLink(link) {
  const url = deepLinkToAppUrl(link);
  if (!url) return;
  if (win) {
    win.loadURL(url);
    win.show();
  } else pendingDeepLink = url;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Lumio',
    backgroundColor: '#000000',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // L'appli parle directement à Jellyfin, TMDB, Radarr / Sonarr et au serveur Lumio (comme sur iPhone)
      webSecurity: false,
      allowRunningInsecureContent: true,
      contextIsolation: true,
      sandbox: false,
    },
  });
  win.once('ready-to-show', () => win.show());

  // Liens externes : ouverts dans le navigateur ou l'appli correspondante (VLC, Infuse…)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(ORIGIN)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN)) {
      e.preventDefault();
      shell.openExternal(url).catch(() => {});
    }
  });

  win.loadURL(pendingDeepLink ?? `${ORIGIN}/`);
  pendingDeepLink = null;
  win.on('closed', () => {
    win = null;
  });
}

app.setName('Lumio');
app.setAsDefaultProtocolClient('lumio');
app.on('open-url', (e, url) => {
  e.preventDefault();
  openDeepLink(url);
});

app.whenReady().then(() => {
  protocol.handle('app', (req) => net.fetch(pathToFileURL(resolveFile(new URL(req.url).pathname)).toString()));

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      {
        label: 'Présentation',
        submenu: [
          { role: 'reload', label: 'Recharger' },
          { type: 'separator' },
          { role: 'resetZoom', label: 'Taille réelle' },
          { role: 'zoomIn', label: 'Agrandir' },
          { role: 'zoomOut', label: 'Réduire' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: 'Plein écran' },
          { role: 'toggleDevTools', label: 'Outils de développement' },
        ],
      },
      { role: 'windowMenu' },
    ])
  );

  createWindow();
  app.on('activate', () => {
    if (!win) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
