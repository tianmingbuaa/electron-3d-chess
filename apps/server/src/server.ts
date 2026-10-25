import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import {
  WebSocket,
  WebSocketServer,
  type RawData,
} from 'ws';
import {
  PROTOCOL_VERSION,
  SERVER_NAME,
  type AiProvider,
  type HealthInfo,
  type ProtocolErrorCode,
  type RuntimeInfo,
  type ServerMessage,
} from '@nocturne/chess-shared';
import { createAiProviderRegistry } from './ai/registry.js';
import { GameSession } from './session.js';
import { StaticFileServer } from './static.js';
import {
  applyCorsHeaders,
  applySecurityHeaders,
  sendErrorJson,
  sendJson,
  sendNoContent,
} from './http-utils.js';
import { defaultLog, safeLog, type LogFn } from './logging.js';
import {
  DEFAULT_AI_MOVE_DELAY_MS,
  DEFAULT_AI_PROVIDER_ID,
  DEFAULT_HOST,
  DEFAULT_PORT,
  SERVER_VERSION,
  WS_PATH,
  parseClientMessage,
} from './protocol.js';

export interface CreateChessServerOptions {
  /** Bind address. Defaults to loopback. */
  host?: string;
  /** TCP port; 0 (default) asks the OS for an ephemeral port. */
  port?: number;
  /** Shared secret for WebSocket and runtime discovery. Generated when omitted. */
  token?: string;
  /** Optional directory containing a built SPA. */
  staticDir?: string;
  /** Additional AI providers, merged with the built-in simple engine. */
  aiProviders?: AiProvider[];
  /** Provider used when an AI game omits an explicit provider id. */
  defaultAiProviderId?: string;
  /** Minimum perceived thinking delay before an AI move is applied. */
  aiMoveDelayMs?: number;
  /** Reported server version. */
  version?: string;
  log?: LogFn;
}

export interface ChessServer {
  host: string;
  port: number;
  url: string;
  token: string;
  close(): Promise<void>;
}

const WS_MAX_PAYLOAD_BYTES = 256 * 1024;

/**
 * Start an authoritative local chess server.
 *
 * The returned promise resolves only after the HTTP server is accepting
 * connections. Every call to `createChessServer` owns its own registry and
 * session set, making it safe to embed in the Electron main process and safe
 * to create several instances in tests.
 */
export async function createChessServer(
  options: CreateChessServerOptions = {},
): Promise<ChessServer> {
  const host = validateHost(options.host);
  const requestedPort = validatePort(options.port);
  const token = validateToken(options.token);
  const version = validateVersion(options.version);
  const aiMoveDelayMs = validateDelay(options.aiMoveDelayMs);
  const defaultAiProviderId = options.defaultAiProviderId ?? DEFAULT_AI_PROVIDER_ID;
  const log = validateLog(options.log);
  const providers = validateProviders(options.aiProviders);

  const registry = createAiProviderRegistry(providers);
  if (!registry.has(defaultAiProviderId)) {
    throw new Error(`Default AI provider "${defaultAiProviderId}" is not registered.`);
  }

  let staticServer: StaticFileServer | undefined;
  if (options.staticDir !== undefined) {
    if (typeof options.staticDir !== 'string' || options.staticDir.trim() === '') {
      throw new TypeError('staticDir must be a non-empty string when provided.');
    }
    staticServer = await StaticFileServer.create(options.staticDir);
  }

  const startedAt = Date.now();
  const sessions = new Set<GameSession>();

  try {
    await registry.initialize();
  } catch (error) {
    await registry.disposeAll().catch(() => undefined);
    throw error;
  }

  const handleHttpRequest = createHttpHandler({
    token,
    version,
    startedAt,
    staticServer,
  });

  const httpServer = createServer((req, res) => {
    applySecurityHeaders(res);
    applyCorsHeaders(req, res);
    void handleHttpRequest(req, res).catch((error: unknown) => {
      safeLog(log, 'error', 'Unhandled HTTP request failure.', error);
      if (!res.headersSent) {
        sendErrorJson(res, 500, 'internal_error', 'Internal server error.');
      } else {
        res.destroy();
      }
    });
  });

  httpServer.on('clientError', (_error, socket) => {
    if (socket.writable) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    } else {
      socket.destroy();
    }
  });

  const wss = new WebSocketServer({
    noServer: true,
    clientTracking: true,
    maxPayload: WS_MAX_PAYLOAD_BYTES,
    perMessageDeflate: false,
  });

  httpServer.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {
      // A rejected or interrupted upgrade must never crash the server.
    });

    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      rejectUpgrade(socket, 400, 'bad_request', 'Malformed WebSocket URL.');
      return;
    }

    if (url.pathname !== WS_PATH) {
      rejectUpgrade(socket, 404, 'bad_request', 'Unknown WebSocket path.');
      return;
    }

    const providedToken = url.searchParams.get('token');
    if (!tokensMatch(token, providedToken)) {
      rejectUpgrade(socket, 401, 'unauthorized', 'Missing or invalid token.');
      return;
    }

    try {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } catch (error) {
      safeLog(log, 'warn', 'Failed to complete a WebSocket upgrade.', error);
      rejectUpgrade(socket, 400, 'bad_request', 'Malformed WebSocket upgrade.');
    }
  });

  wss.on('error', (error) => {
    safeLog(log, 'error', 'WebSocket server error.', error);
  });

  wss.on('connection', (ws, req) => {
    let closed = false;
    const session = new GameSession({
      registry,
      emit: (message) => sendServerMessage(ws, message, log),
      serverVersion: version,
      defaultAiProviderId,
      aiMoveDelayMs,
      log,
    });
    sessions.add(session);

    const dispose = (): void => {
      if (closed) return;
      closed = true;
      sessions.delete(session);
      session.dispose();
    };

    ws.on('message', (data, isBinary) => {
      if (closed) return;
      if (isBinary) {
        sendErrorMessage(ws, 'bad_request', 'Binary messages are not supported.', log);
        return;
      }
      const text = rawDataToText(data);
      const parsed = parseClientMessage(text);
      if (!parsed.ok) {
        sendServerMessage(
          ws,
          {
            type: 'error',
            error: parsed.error,
            ...(parsed.requestId === undefined ? {} : { requestId: parsed.requestId }),
          },
          log,
        );
        return;
      }
      try {
        session.handleMessage(parsed.message);
      } catch (error) {
        safeLog(log, 'error', 'Unhandled WebSocket command failure.', error);
        sendErrorMessage(ws, 'internal_error', 'Unexpected server error.', log);
      }
    });

    ws.on('close', dispose);
    ws.on('error', (error) => {
      safeLog(log, 'warn', 'WebSocket connection error.', error);
      dispose();
    });

    session.sendWelcome();

    const remote = req.socket.remoteAddress ?? 'unknown';
    safeLog(log, 'info', `Client connected from ${remote}; session ${session.sessionId}.`);
  });

  let actualPort: number;
  try {
    actualPort = await listen(httpServer, requestedPort, host);
  } catch (error) {
    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    }).catch(() => undefined);
    await registry.disposeAll().catch(() => undefined);
    throw error;
  }

  httpServer.on('error', (error) => {
    safeLog(log, 'error', 'HTTP server error.', error);
  });

  const url = `http://${formatHostForUrl(host)}:${actualPort}`;
  let closePromise: Promise<void> | null = null;

  const close = (): Promise<void> => {
    if (closePromise !== null) return closePromise;
    closePromise = (async () => {
      for (const session of sessions) session.dispose();
      sessions.clear();

      for (const client of wss.clients) {
        try {
          client.terminate();
        } catch {
          // Already closed.
        }
      }

      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });

      if (httpServer.listening) {
        await new Promise<void>((resolve) => {
          httpServer.close(() => resolve());
          httpServer.closeAllConnections?.();
        });
      }

      try {
        await registry.disposeAll();
      } catch (error) {
        safeLog(log, 'error', 'Failed to dispose AI providers.', error);
      }
    })();
    return closePromise;
  };

  safeLog(log, 'info', `Listening on ${url} (WS ${WS_PATH}).`);

  return {
    host,
    port: actualPort,
    url,
    token,
    close,
  };
}

/* ---------------------------------------------------------------------- */
/*                                 HTTP                                   */
/* ---------------------------------------------------------------------- */

interface HttpHandlerOptions {
  token: string;
  version: string;
  startedAt: number;
  staticServer: StaticFileServer | undefined;
}

function createHttpHandler(options: HttpHandlerOptions) {
  return async function handleHttpRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      sendErrorJson(res, 400, 'bad_request', 'Malformed request URL.');
      return;
    }
    const pathname = url.pathname;
    const method = (req.method ?? 'GET').toUpperCase();
    const isHead = method === 'HEAD';

    if (method === 'OPTIONS' && (pathname === '/api' || pathname.startsWith('/api/'))) {
      res.setHeader('Allow', 'GET, HEAD, OPTIONS');
      sendNoContent(res, 204);
      return;
    }

    if (pathname === '/api/health' || pathname === '/api/runtime') {
      if (method !== 'GET' && !isHead) {
        res.setHeader('Allow', 'GET, HEAD, OPTIONS');
        sendErrorJson(res, 405, 'bad_request', 'Method not allowed.', isHead);
        return;
      }

      if (pathname === '/api/health') {
        const health: HealthInfo = {
          ok: true,
          serverName: SERVER_NAME,
          serverVersion: options.version,
          protocolVersion: PROTOCOL_VERSION,
          uptimeSeconds: Math.max(0, Math.floor((Date.now() - options.startedAt) / 1000)),
        };
        sendJson(res, 200, health, { head: isHead });
      } else {
        const runtime: RuntimeInfo = {
          serverName: SERVER_NAME,
          serverVersion: options.version,
          protocolVersion: PROTOCOL_VERSION,
          wsPath: WS_PATH,
          token: options.token,
        };
        sendJson(res, 200, runtime, { head: isHead });
      }
      return;
    }

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      sendErrorJson(res, 404, 'bad_request', 'Unknown API endpoint.', isHead);
      return;
    }

    if (pathname === WS_PATH) {
      if (method === 'GET' || isHead) {
        sendErrorJson(
          res,
          426,
          'unsupported',
          'WebSocket connections require an Upgrade request.',
          isHead,
        );
      } else {
        res.setHeader('Allow', 'GET, HEAD, OPTIONS');
        sendErrorJson(res, 405, 'bad_request', 'Method not allowed.', isHead);
      }
      return;
    }

    if (method !== 'GET' && !isHead) {
      res.setHeader('Allow', 'GET, HEAD, OPTIONS');
      sendErrorJson(res, 405, 'bad_request', 'Method not allowed.', isHead);
      return;
    }

    if (options.staticServer !== undefined) {
      await options.staticServer.handle(req, res, pathname);
      return;
    }

    sendErrorJson(res, 404, 'bad_request', 'Not found.', isHead);
  };
}

/* ---------------------------------------------------------------------- */
/*                             WebSocket helpers                          */
/* ---------------------------------------------------------------------- */

function rawDataToText(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

function sendServerMessage(ws: WebSocket, message: ServerMessage, log: LogFn): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  let payload: string;
  try {
    payload = JSON.stringify(message);
  } catch (error) {
    safeLog(log, 'error', 'Failed to serialise a server message.', error);
    try {
      ws.close(1011, 'Internal serialisation error');
    } catch {
      // Ignore.
    }
    return;
  }
  try {
    ws.send(payload);
  } catch (error) {
    safeLog(log, 'warn', 'Failed to send a WebSocket message.', error);
    try {
      ws.close(1011, 'Send failure');
    } catch {
      // Ignore.
    }
  }
}

function sendErrorMessage(
  ws: WebSocket,
  code: ProtocolErrorCode,
  message: string,
  log: LogFn,
): void {
  sendServerMessage(ws, { type: 'error', error: { code, message } }, log);
}

function rejectUpgrade(
  socket: Duplex,
  statusCode: number,
  code: ProtocolErrorCode,
  message: string,
): void {
  const statusText =
    statusCode === 400
      ? 'Bad Request'
      : statusCode === 401
        ? 'Unauthorized'
        : statusCode === 404
          ? 'Not Found'
          : 'Error';
  const body = JSON.stringify({ error: { code, message } });
  const response = [
    `HTTP/1.1 ${statusCode} ${statusText}`,
    'Connection: close',
    'Content-Type: application/json; charset=utf-8',
    `Content-Length: ${Buffer.byteLength(body, 'utf8')}`,
    'X-Content-Type-Options: nosniff',
    'Cache-Control: no-store',
    '',
    body,
  ].join('\r\n');
  try {
    socket.end(response);
  } catch {
    socket.destroy();
  }
}

function tokensMatch(expected: string, provided: string | null): boolean {
  if (provided === null) return false;
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(provided, 'utf8');
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

/* ---------------------------------------------------------------------- */
/*                              Validation                                */
/* ---------------------------------------------------------------------- */

function validateHost(value: string | undefined): string {
  const host = value?.trim() ?? DEFAULT_HOST;
  if (host === '') throw new TypeError('host must be a non-empty string.');
  return host;
}

function validatePort(value: number | undefined): number {
  const port = value ?? DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new TypeError('port must be an integer between 0 and 65535.');
  }
  return port;
}

function validateToken(value: string | undefined): string {
  if (value === undefined) return randomBytes(24).toString('base64url');
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('token must be a non-empty string when provided.');
  }
  return value;
}

function validateVersion(value: string | undefined): string {
  if (value === undefined) return SERVER_VERSION;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('version must be a non-empty string.');
  }
  return value;
}

function validateDelay(value: number | undefined): number {
  if (value === undefined) return DEFAULT_AI_MOVE_DELAY_MS;
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError('aiMoveDelayMs must be a finite number greater than or equal to 0.');
  }
  return value;
}

function validateLog(value: LogFn | undefined): LogFn {
  if (value === undefined) return defaultLog;
  if (typeof value !== 'function') throw new TypeError('log must be a function.');
  return value;
}

function validateProviders(value: AiProvider[] | undefined): AiProvider[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError('aiProviders must be an array.');
  return value;
}

/* ---------------------------------------------------------------------- */
/*                                Utilities                               */
/* ---------------------------------------------------------------------- */

function formatHostForUrl(host: string): string {
  if (host.startsWith('[') && host.endsWith(']')) return host;
  return host.includes(':') ? `[${host}]` : host;
}

function listen(
  server: ReturnType<typeof createServer>,
  port: number,
  host: string,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Server did not expose an inet address.'));
        return;
      }
      resolve((address as AddressInfo).port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

