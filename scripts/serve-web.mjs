#!/usr/bin/env node
/**
 * Local browser launcher for Nocturne Chess.
 *
 * Starts the same authoritative game server used by Electron, but serves the
 * built renderer as a normal web page. This mode is intended for a single
 * person trying the game on their own machine. It uses plain HTTP and has no
 * accounts, login or user authentication. CHESS_HOST defaults to loopback but
 * can be set to 0.0.0.0 for containers; publish the port to the host carefully.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readPathEnv(name, fallback) {
  const raw = process.env[name]?.trim();
  return raw ? path.resolve(root, raw) : fallback;
}

const staticDir = readPathEnv('CHESS_STATIC_DIR', path.join(root, 'apps', 'web', 'dist'));
const serverEntry = readPathEnv(
  'CHESS_SERVER_ENTRY',
  path.join(root, 'apps', 'server', 'dist', 'index.cjs'),
);
const indexPath = path.join(staticDir, 'index.html');

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!fs.existsSync(indexPath)) {
  fail('Web build not found. Run "pnpm web:build" first (or just use "pnpm web").');
}
if (!fs.existsSync(serverEntry)) {
  fail('Server build not found. Run "pnpm web:build" first (or just use "pnpm web").');
}

function readPort() {
  const raw = process.env.CHESS_PORT?.trim();
  if (!raw) return 8787;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 65_535) {
    fail(`CHESS_PORT must be an integer between 0 and 65535; received "${raw}".`);
  }
  return value;
}

function readHost() {
  const raw = process.env.CHESS_HOST?.trim();
  return raw || '127.0.0.1';
}

function openBrowser(url) {
  if (
    process.env.CHESS_NO_OPEN === '1' ||
    process.env.CI ||
    (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
  ) {
    return;
  }

  let command;
  let args;
  if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (process.platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', () => {
      console.log(`  Could not open a browser automatically. Open ${url} manually.`);
    });
    child.unref();
  } catch {
    console.log(`  Could not open a browser automatically. Open ${url} manually.`);
  }
}

const require = createRequire(import.meta.url);
const { createChessServer } = require(serverEntry);

const host = readHost();
const port = readPort();

let server;
try {
  server = await createChessServer({
    host,
    port,
    staticDir,
  });
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  if (/EADDRINUSE/i.test(detail)) {
    fail(`Port ${port} is already in use. Try "CHESS_PORT=8788 pnpm web:serve".`);
  }
  fail(`Could not start the local web server on ${host}:${port}: ${detail}`);
}

const loopbackHost = host === '127.0.0.1' || host === 'localhost' || host === '::1';
const browserUrl = loopbackHost ? server.url : `http://127.0.0.1:${server.port}`;

console.log('');
console.log('  NOCTURNE CHESS · WEB');
console.log('  --------------------------------------------------');
console.log(`  Open in browser:  ${browserUrl}`);
console.log(`  Listening on:     ${host}:${server.port}`);
console.log('  Game mode:        local single-player (no login)');
console.log(`  Network:          ${loopbackHost ? 'loopback only' : 'container/custom interface'} · plain HTTP`);
console.log('  Stop:             Ctrl+C');
if (!loopbackHost) {
  console.log('  Container note:   publish this port on the host to open the page.');
}
console.log('');

openBrowser(browserUrl);

let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n  Received ${signal}; stopping the web server...`);
  try {
    await server.close();
    process.exit(0);
  } catch (error) {
    console.error('  Failed to stop cleanly:', error);
    process.exit(1);
  }
};

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});
