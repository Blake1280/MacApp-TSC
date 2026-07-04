import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';

/**
 * Explicit application menu. Without this Electron falls back to its default
 * menu, which on macOS is what powers every system shortcut — Cmd+C/V/A,
 * Cmd+Q, Cmd+W, Cmd+H — but also ships developer items (Toggle DevTools)
 * and generic labels. This template keeps all the standard roles (so the
 * shortcuts keep working) minus the developer chrome in packaged builds,
 * and adds the macOS-conventional "Settings… (Cmd+,)" entry.
 *
 * On Windows the window uses autoHideMenuBar, so this menu only appears on
 * an Alt press there — macOS shows it in the system menu bar always.
 */
export function installAppMenu(getWindow: () => BrowserWindow | null): void {
  const isMac = process.platform === 'darwin';
  const isDev = !app.isPackaged;

  const navigate = (route: string) => {
    const win = getWindow();
    if (!win) return;
    win.webContents.send('menu:navigate', route);
    if (win.isMinimized()) win.restore();
    win.show();
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              {
                label: 'Settings…',
                accelerator: 'CmdOrCtrl+,',
                click: () => navigate('/settings'),
              },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        ...(isDev ? [{ role: 'toggleDevTools' } satisfies MenuItemConstructorOptions] : []),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'The Sweet Creative website',
          click: () => void shell.openExternal('https://thesweetcreative.com.au'),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
