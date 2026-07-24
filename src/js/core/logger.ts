const DEBUG_KEY = 'stims:debug';

function isDebugEnabled(): boolean {
  try {
    return localStorage.getItem(DEBUG_KEY) === 'true';
  } catch {
    return false;
  }
}

export function createLogger(namespace: string) {
  const enabled = isDebugEnabled();

  function log(...args: unknown[]) {
    if (enabled) {
      console.log(`[${namespace}]`, ...args);
    }
  }

  function warn(...args: unknown[]) {
    console.warn(`[${namespace}]`, ...args);
  }

  function error(...args: unknown[]) {
    console.error(`[${namespace}]`, ...args);
  }

  function info(...args: unknown[]) {
    console.info(`[${namespace}]`, ...args);
  }

  return { log, warn, error, info };
}
