import type { RuntimeInfo } from '@nocturne/chess-shared';

const configuredBase = import.meta.env.VITE_BACKEND_HTTP_URL?.replace(/\/$/, '');

export async function fetchRuntimeInfo(): Promise<RuntimeInfo> {
  const response = await fetch(`${configuredBase ?? ''}/api/runtime`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(5_000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Runtime endpoint returned ${response.status}`);
  }
  return (await response.json()) as RuntimeInfo;
}

export function websocketUrl(info: RuntimeInfo): string {
  const base = configuredBase ? new URL(configuredBase) : new URL(window.location.href);
  const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  const path = info.wsPath.startsWith('/') ? info.wsPath : `/${info.wsPath}`;
  return `${protocol}//${base.host}${path}?token=${encodeURIComponent(info.token)}`;
}
