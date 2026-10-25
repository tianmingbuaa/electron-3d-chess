import type { ClientMessage, ServerMessage } from '@nocturne/chess-shared';
import { fetchRuntimeInfo, websocketUrl } from './runtime';

export type ConnectionStatus = 'connecting' | 'online' | 'reconnecting' | 'offline';

export interface SocketCallbacks {
  onMessage(message: ServerMessage): void;
  onStatus(status: ConnectionStatus, detail?: string): void;
}

const RECONNECT_DELAYS = [600, 1_200, 2_000, 3_500, 5_000] as const;

/**
 * Small typed client for the local authoritative backend. Reconnection fetches
 * a fresh runtime token, since the desktop host may have restarted.
 */
export class ChessSocket {
  private socket: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private hasConnectedOnce = false;

  constructor(private readonly callbacks: SocketCallbacks) {}

  start(): void {
    this.stopped = false;
    void this.open();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.socket?.close(1000, 'client shutdown');
    this.socket = null;
  }

  send(message: ClientMessage): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  private async open(): Promise<void> {
    if (this.stopped) return;
    this.callbacks.onStatus(this.hasConnectedOnce ? 'reconnecting' : 'connecting');

    try {
      const runtime = await fetchRuntimeInfo();
      if (this.stopped) return;

      const socket = new WebSocket(websocketUrl(runtime));
      this.socket = socket;

      socket.addEventListener('open', () => {
        if (this.socket !== socket) return;
        this.attempt = 0;
        this.callbacks.onStatus('online');
      });

      socket.addEventListener('message', (event) => {
        if (this.socket !== socket) return;
        try {
          const parsed = JSON.parse(String(event.data)) as ServerMessage;
          if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
            this.hasConnectedOnce = true;
            this.callbacks.onMessage(parsed);
          }
        } catch {
          this.callbacks.onStatus('online', '收到了无法解析的服务器消息');
        }
      });

      socket.addEventListener('error', () => {
        // The close event that follows owns the retry decision.
      });

      socket.addEventListener('close', (event) => {
        if (this.socket === socket) this.socket = null;
        if (this.stopped) return;
        const detail = event.code === 4401 ? '访问令牌无效' : event.reason || '与本地棋局服务的连接中断';
        this.scheduleReconnect(detail);
      });
    } catch (error) {
      if (this.stopped) return;
      const detail = error instanceof Error ? error.message : '无法连接本地棋局服务';
      this.scheduleReconnect(detail);
    }
  }

  private scheduleReconnect(detail: string): void {
    if (this.retryTimer) return;
    const delay = RECONNECT_DELAYS[Math.min(this.attempt, RECONNECT_DELAYS.length - 1)] ?? 5_000;
    this.attempt += 1;
    this.callbacks.onStatus(this.attempt > 2 ? 'offline' : 'reconnecting', detail);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.open();
    }, delay);
  }
}
