export type LogLevel = 'info' | 'warn' | 'error';

export type LogFn = (level: LogLevel, message: string, meta?: unknown) => void;

export const defaultLog: LogFn = (level, message, meta) => {
  const line = `[chess-server] ${message}`;
  if (level === 'error') {
    console.error(line, ...(meta === undefined ? [] : [meta]));
  } else if (level === 'warn') {
    console.warn(line, ...(meta === undefined ? [] : [meta]));
  } else {
    console.info(line, ...(meta === undefined ? [] : [meta]));
  }
};

/** Logging must never take down a game because a custom logger throws. */
export function safeLog(
  log: LogFn | undefined,
  level: LogLevel,
  message: string,
  meta?: unknown,
): void {
  if (log === undefined) return;
  try {
    log(level, message, meta);
  } catch {
    // Deliberately ignored.
  }
}
