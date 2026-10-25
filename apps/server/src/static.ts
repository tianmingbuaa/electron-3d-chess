import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendErrorJson } from './http-utils.js';

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
const REVALIDATE_CACHE = 'no-cache';
const HASHED_ASSET_RE = /\.[A-Za-z0-9_-]{8,}\.(?:js|mjs|css|woff2?|ttf|png|jpe?g|webp|svg|wasm)$/;

function contentTypeFor(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function hasExtension(segments: readonly string[]): boolean {
  const last = segments[segments.length - 1];
  return last !== undefined && path.extname(last) !== '';
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

/**
 * Serves a built SPA from disk with traversal protection, SPA fallback and
 * long-lived caching for Vite-style hashed assets. API/WS routes are handled
 * by the server before this class is reached.
 */
export class StaticFileServer {
  private constructor(
    private readonly rootRealPath: string,
    private readonly indexRealPath: string | null,
  ) {}

  static async create(staticDir: string): Promise<StaticFileServer> {
    let rootRealPath: string;
    try {
      rootRealPath = await fs.realpath(staticDir);
      const stats = await fs.stat(rootRealPath);
      if (!stats.isDirectory()) {
        throw new Error(`staticDir is not a directory: ${staticDir}`);
      }
    } catch (error) {
      throw new Error(
        `Unable to use staticDir "${staticDir}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    let indexRealPath: string | null = null;
    const candidateIndex = path.join(rootRealPath, 'index.html');
    try {
      const stats = await fs.stat(candidateIndex);
      if (stats.isFile()) {
        const real = await fs.realpath(candidateIndex);
        if (isPathInside(rootRealPath, real)) indexRealPath = real;
      }
    } catch {
      // A missing index simply means SPA fallback is unavailable.
    }

    return new StaticFileServer(rootRealPath, indexRealPath);
  }

  get root(): string {
    return this.rootRealPath;
  }

  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<void> {
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      sendErrorJson(res, 400, 'bad_request', 'Malformed URL encoding.');
      return;
    }

    if (decoded.includes('\0') || decoded.includes('\\')) {
      sendErrorJson(res, 403, 'bad_request', 'Forbidden path.');
      return;
    }

    const segments = decoded.split('/').filter((segment) => segment.length > 0);
    if (
      segments.some(
        (segment) =>
          segment === '..' ||
          segment.startsWith('.') ||
          segment.includes(':'),
      )
    ) {
      sendErrorJson(res, 403, 'bad_request', 'Forbidden path.');
      return;
    }

    const candidate = path.resolve(this.rootRealPath, ...segments);
    if (!isPathInside(this.rootRealPath, candidate)) {
      sendErrorJson(res, 403, 'bad_request', 'Forbidden path.');
      return;
    }

    let filePath: string | null = null;
    try {
      const stats = await fs.stat(candidate);
      if (stats.isFile()) filePath = candidate;
    } catch (error) {
      if (!isErrnoException(error) || error.code !== 'ENOENT') {
        sendErrorJson(res, 500, 'internal_error', 'Unable to read the requested file.');
        return;
      }
    }

    if (filePath !== null) {
      await this.serveFile(req, res, filePath);
      return;
    }

    // Missing paths under /assets are always 404s; they must never receive
    // the HTML shell in place of a script or stylesheet.
    const inAssetNamespace = segments[0] === 'assets';
    if (
      this.indexRealPath !== null &&
      !hasExtension(segments) &&
      !inAssetNamespace
    ) {
      await this.serveFile(req, res, this.indexRealPath);
      return;
    }

    sendErrorJson(res, 404, 'bad_request', 'Not found.');
  }

  private async serveFile(
    req: IncomingMessage,
    res: ServerResponse,
    filePath: string,
  ): Promise<void> {
    let realPath: string;
    try {
      realPath = await fs.realpath(filePath);
    } catch {
      sendErrorJson(res, 404, 'bad_request', 'Not found.');
      return;
    }
    if (!isPathInside(this.rootRealPath, realPath)) {
      sendErrorJson(res, 403, 'bad_request', 'Forbidden path.');
      return;
    }

    let stats;
    try {
      stats = await fs.stat(realPath);
    } catch {
      sendErrorJson(res, 404, 'bad_request', 'Not found.');
      return;
    }
    if (!stats.isFile()) {
      sendErrorJson(res, 404, 'bad_request', 'Not found.');
      return;
    }

    const relative = path.relative(this.rootRealPath, realPath);
    const firstSegment = relative.split(path.sep)[0] ?? '';
    const immutable =
      firstSegment === 'assets' || HASHED_ASSET_RE.test(path.basename(realPath));

    res.statusCode = 200;
    res.setHeader('Content-Type', contentTypeFor(realPath));
    res.setHeader('Content-Length', String(stats.size));
    res.setHeader('Cache-Control', immutable ? IMMUTABLE_CACHE : REVALIDATE_CACHE);
    res.setHeader('Last-Modified', stats.mtime.toUTCString());

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    await new Promise<void>((resolve) => {
      const stream = createReadStream(realPath);
      let settled = false;

      const finish = (): void => {
        if (settled) return;
        settled = true;
        res.off('close', onClose);
        stream.off('error', onError);
        stream.off('end', onEnd);
        resolve();
      };

      const onClose = (): void => {
        stream.destroy();
        finish();
      };

      const onError = (error: NodeJS.ErrnoException): void => {
        if (!res.headersSent) {
          if (error.code === 'ENOENT') {
            sendErrorJson(res, 404, 'bad_request', 'Not found.');
          } else {
            sendErrorJson(res, 500, 'internal_error', 'Unable to stream the file.');
          }
        } else {
          res.destroy(error);
        }
        finish();
      };

      const onEnd = (): void => {
        finish();
      };

      res.once('close', onClose);
      stream.once('error', onError);
      stream.once('end', onEnd);
      stream.pipe(res);
    });
  }
}
