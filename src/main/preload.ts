import { contextBridge } from 'electron';
import { exposeElectronTRPC } from 'electron-trpc/main';

process.once('loaded', () => {
  exposeElectronTRPC();
});

contextBridge.exposeInMainWorld('app', {
  platform: process.platform,
  versions: process.versions,
});
