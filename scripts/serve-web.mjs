#!/usr/bin/env node
/**
 * Local browser launcher for Nocturne Chess.
 *
 * Starts the same authoritative game server used by Electron, but serves the
 * built renderer as a normal web page. This mode is intended for a single
 * person trying the game on their own machine: it binds to loopback only,
 * uses plain HTTP, and has no accounts, login or user authentication.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = path.join(root, 'apps', 'web', 'dist');
const serverEntry = path.join(root, 'apps', 'server', 'dist', 'index.cjs');
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

let server;
try {
  server = await createChessServer({
    host: '127.0.0.1',
    port: readPort(),
    staticDir,
  });
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  if (/EADDRINUSE/i.test(detail)) {
    fail(`Port ${readPort()} is already in use. Try "CHESS_PORT=8788 pnpm web:serve".`);
  }
  fail(`Could not start the local web server: ${detail}`);
}

console.log('');
console.log('  NOCTURNE CHESS · WEB');
console.log('  --------------------------------------------------');
console.log(`  Open in browser:  ${server.url}`);
console.log('  Game mode:        local single-player (no login)');
console.log('  Network:          loopback only · plain HTTP');
console.log('  Stop:             Ctrl+C');
console.log('');

openBrowser(server.url);

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
