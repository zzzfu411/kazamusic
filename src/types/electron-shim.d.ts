declare module "electron" {
  export const contextBridge: {
    exposeInMainWorld: (key: string, api: unknown) => void;
  };
  export const ipcRenderer: {
    send: (channel: string, ...args: unknown[]) => void;
    sendSync: (channel: string, ...args: unknown[]) => any;
    invoke: (channel: string, ...args: unknown[]) => Promise<any>;
    on: (channel: string, listener: (...args: any[]) => void) => void;
    removeListener: (channel: string, listener: (...args: any[]) => void) => void;
  };
}
