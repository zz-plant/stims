declare module '*.css';

interface Window {
  __stimsTheme?: {
    applyTheme(theme: string, persist?: boolean): void;
  };
  __stimsAppReady?: Promise<void>;
}
