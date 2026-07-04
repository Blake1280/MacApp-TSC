import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { exposeElectronTRPC } from 'electron-trpc/main';

process.once('loaded', () => {
  exposeElectronTRPC();
});

contextBridge.exposeInMainWorld('app', {
  platform: process.platform,
  versions: process.versions,
  /** Subscribe to routes pushed from the native app menu (e.g. macOS
   *  "Settings… Cmd+,"). Returns an unsubscribe function. */
  onMenuNavigate: (cb: (route: string) => void) => {
    const listener = (_event: IpcRendererEvent, route: string) => cb(route);
    ipcRenderer.on('menu:navigate', listener);
    return () => ipcRenderer.removeListener('menu:navigate', listener);
  },
});
