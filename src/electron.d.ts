export {};

declare global {
  interface Window {
    electronAPI?: {
      printTicket: (html: string, options?: { printerName?: string }) => Promise<void>;
      getPrinters: () => Promise<{ name: string; isDefault: boolean; displayName: string }[]>;
      getAppVersion: () => Promise<string>;
      isElectron: true;
    };
  }
}
