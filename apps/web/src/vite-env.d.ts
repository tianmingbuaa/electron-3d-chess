/// <reference types="vite/client" />

interface NocturneDesktopInfo {
  platform: NodeJS.Platform;
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
  appVersion: string;
}

interface Window {
  nocturneDesktop?: {
    readonly isElectron: true;
    getInfo(): Promise<NocturneDesktopInfo>;
  };
}

declare interface ImportMetaEnv {
  readonly VITE_BACKEND_HTTP_URL?: string;
}
