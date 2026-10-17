// Barre de titre Mac : bande déplaçable en haut (sous les boutons rouge / orange / vert), l'appli démarre juste dessous.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('lumioDesktop', { platform: process.platform });

const BAR = 32;
window.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style');
  style.textContent = `
    html, body { height: 100%; margin: 0; background: #000; }
    body { padding-top: ${BAR}px; box-sizing: border-box; overflow: hidden; }
    #root { height: 100% !important; }
    #lumio-titlebar {
      position: fixed; top: 0; left: 0; right: 0; height: ${BAR}px; z-index: 2147483000;
      -webkit-app-region: drag; background: #000;
      display: flex; align-items: center; justify-content: center;
      font: 600 12px -apple-system, system-ui, sans-serif; color: rgba(255,255,255,.45); letter-spacing: .3px;
      user-select: none;
    }
    :fullscreen #lumio-titlebar { display: none; }
  `;
  document.head.appendChild(style);
  const bar = document.createElement('div');
  bar.id = 'lumio-titlebar';
  bar.textContent = 'Lumio';
  document.body.appendChild(bar);
});
