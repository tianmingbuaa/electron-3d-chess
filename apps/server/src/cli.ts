import { createChessServer } from './server.js';
import { DEFAULT_HOST, SERVER_VERSION, WS_PATH } from './protocol.js';

const DEV_PORT = 8787;

function readPort(): number {
  const raw = process.env.CHESS_PORT;
  if (raw === undefined || raw.trim() === '') return DEV_PORT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 65_535) {
    throw new Error(`CHESS_PORT must be an integer between 0 and 65535, received "${raw}".`);
  }
  return value;
}

function readHost(): string {
  const raw = process.env.CHESS_HOST;
  if (raw === undefined || raw.trim() === '') return DEFAULT_HOST;
  return raw.trim();
}

function readOptionalEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  return raw.trim();
}

async function main(): Promise<void> {
  const port = readPort();
  const host = readHost();
  const token = readOptionalEnv('CHESS_TOKEN');
  const staticDir = readOptionalEnv('CHESS_STATIC_DIR');

  const server = await createChessServer({
    host,
    port,
    ...(token === undefined ? {} : { token }),
    ...(staticDir === undefined ? {} : { staticDir }),
  });

  const wsUrl = `${server.url.replace(/^http/, 'ws')}${WS_PATH}?token=${encodeURIComponent(server.token)}`;
  const healthUrl = `${server.url}/api/health`;

  console.log('');
  console.log(`  Nocturne Chess Server v${SERVER_VERSION}`);
  console.log('  ------------------------------------------------');
  console.log(`  URL     ${server.url}`);
  console.log(`  WS      ${wsUrl}`);
  console.log(`  Health  ${healthUrl}`);
  console.log(`  Token   ${server.token}`);
  console.log(`  Static  ${staticDir ?? '(disabled)'}`);
  console.log('');
  console.log('  Press Ctrl+C to stop.');
  console.log('');

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\nReceived ${signal}; shutting down...`);
    try {
      await server.close();
      process.exit(0);
    } catch (error) {
      console.error('Failed to shut down cleanly:', error);
      process.exit(1);
    }
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((error: unknown) => {
  console.error('Fatal server error:', error);
  process.exitCode = 1;
});
