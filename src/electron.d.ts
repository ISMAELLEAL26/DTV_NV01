export {};

declare global {
  interface Window {
    electronAPI?: {
      printTicket: (html: string, options?: { printerName?: string }) => Promise<void>;
      printLabels: (html: string, options?: { printerName?: string; width?: number; height?: number }) => Promise<void>;
      getPrinters: () => Promise<{ name: string; isDefault: boolean; displayName: string }[]>;
      getAppVersion: () => Promise<string>;
      isElectron: true;
    };
  }
}
