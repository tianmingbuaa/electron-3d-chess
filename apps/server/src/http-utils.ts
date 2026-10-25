import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ProtocolErrorCode } from '@nocturne/chess-shared';

export interface JsonResponseOptions {
  head?: boolean;
  cacheControl?: string;
}

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** Baseline hardening applied to every HTTP response from this server. */
export function applySecurityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
}

export function isLoopbackOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '[::1]' ||
      parsed.hostname === '::1'
    );
  } catch {
    return false;
  }
}

/**
 * Reflect CORS only for loopback web origins (development renderer). A remote
 * web page cannot read the local token endpoint. The Electron production
 * renderer is same-origin and needs no CORS at all.
 */
export function applyCorsHeaders(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || !isLoopbackOrigin(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}

export function sendJson(
  res: ServerResponse,
  statusCode: number,
  payload: unknown,
  options: JsonResponseOptions = {},
): void {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', String(body.length));
  const cacheControl = options.cacheControl ?? 'no-store, no-cache, must-revalidate';
  res.setHeader('Cache-Control', cacheControl);
  if (cacheControl.startsWith('no-store')) {
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  if (options.head === true) {
    res.end();
  } else {
    res.end(body);
  }
}

export interface ErrorJsonBody {
  error: {
    code: ProtocolErrorCode;
    message: string;
  };
}

export function sendErrorJson(
  res: ServerResponse,
  statusCode: number,
  code: ProtocolErrorCode,
  message: string,
  head = false,
): void {
  sendJson(
    res,
    statusCode,
    { error: { code, message } } satisfies ErrorJsonBody,
    { head },
  );
}

export function sendNoContent(res: ServerResponse, statusCode = 204): void {
  res.statusCode = statusCode;
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}
