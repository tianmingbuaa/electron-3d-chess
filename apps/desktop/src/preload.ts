import { contextBridge, ipcRenderer } from 'electron';

export interface DesktopInfo {
  platform: NodeJS.Platform;
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
  appVersion: string;
}

const bridge = {
  getInfo: (): Promise<DesktopInfo> => ipcRenderer.invoke('desktop:info'),
  isElectron: true as const,
};

contextBridge.exposeInMainWorld('nocturneDesktop', bridge);

export type NocturneDesktopBridge = typeof bridge;
