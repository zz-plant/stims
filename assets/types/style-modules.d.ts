declare module '*.css';

interface Window {
  __stimsTheme?: {
    resolveThemePreference: () => 'light' | 'dark';
    applyTheme: (theme: 'light' | 'dark', persist?: boolean) => void;
  };
  __stimsAppReady?: Promise<void>;
}
