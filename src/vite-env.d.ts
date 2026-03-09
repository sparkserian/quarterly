/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  desktopMeta?: {
    platform: string;
    versions: {
      app: string;
      chrome: string;
      electron: string;
    };
    updater?: {
      check: () => Promise<{
        ok: boolean;
        message?: string;
        status?: 'available' | 'dev-mode' | 'not-configured' | 'up-to-date';
        version?: string;
      }>;
      getState: () => Promise<{
        canInstall: boolean;
        configured: boolean;
        message: string;
        percent?: number;
        status:
          | 'available'
          | 'checking'
          | 'dev-mode'
          | 'downloaded'
          | 'downloading'
          | 'error'
          | 'not-configured'
          | 'up-to-date';
        version?: string;
      }>;
      install: () => Promise<{ ok: boolean }>;
      onStatus: (
        callback: (payload: {
          canInstall: boolean;
          configured: boolean;
          message: string;
          percent?: number;
          status:
            | 'available'
            | 'checking'
            | 'dev-mode'
            | 'downloaded'
            | 'downloading'
            | 'error'
            | 'not-configured'
            | 'up-to-date';
          version?: string;
        }) => void,
      ) => () => void;
    };
  };
}
