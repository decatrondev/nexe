const WS_URL =
  typeof window !== "undefined" &&
  (window.location.protocol === "https:" || "__TAURI__" in window || "__TAURI_INTERNALS__" in window || window.location.hostname === "tauri.localhost")
    ? "wss://nexews.decatron.net/ws"
    : "ws://161.132.53.175:8090/ws";

type WSEventHandler = (data: unknown) => void;

interface WSMessage {
  op: number;
  t?: string;
  d?: unknown;
}

class NexeWebSocket {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private handlers: Map<string, WSEventHandler[]> = new Map();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private intentionalClose = false;
  private messageQueue: WSMessage[] = [];

  connect(token: string) {
    this.token = token;
    this.intentionalClose = false;
    this.reconnectAttempts = 0;
    this.doConnect();
  }

  private doConnect() {
    if (!this.token) return;

    // Clean up any existing connection
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close();
      }
      this.ws = null;
    }

    try {
      this.ws = new WebSocket(`${WS_URL}?token=${this.token}`);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      this.flushQueue();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const msg: WSMessage = JSON.parse(event.data as string);
        this.handleMessage(msg);
      } catch {
        // ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after this
    };
  }

  private handleMessage(msg: WSMessage) {
    if (msg.op === 0 && msg.t) {
      // Dispatch event to registered handlers
      const handlers = this.handlers.get(msg.t);
      if (handlers) {
        for (const h of handlers) {
          h(msg.d);
        }
      }
    }
    // op 1 with HEARTBEAT_ACK — nothing to do, connection is alive
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      this.send({ op: 1 });
    }, 25000);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    this.reconnectTimeout = setTimeout(() => {
      this.doConnect();
    }, delay);
  }

  send(msg: WSMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      // Buffer messages while disconnected (max 50 to prevent memory issues)
      if (this.messageQueue.length < 50) {
        this.messageQueue.push(msg);
      }
    }
  }

  private flushQueue() {
    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift()!;
      this.send(msg);
    }
  }

  sendTyping(channelId: string) {
    this.send({ op: 2, d: { channelId } });
  }

  on(event: string, handler: WSEventHandler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event)!.push(handler);
  }

  off(event: string, handler?: WSEventHandler) {
    if (!handler) {
      this.handlers.delete(event);
    } else {
      const list = this.handlers.get(event);
      if (list) {
        this.handlers.set(
          event,
          list.filter((h) => h !== handler),
        );
      }
    }
  }

  disconnect() {
    this.intentionalClose = true;
    this.stopHeartbeat();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.onclose = null; // prevent reconnect trigger
      this.ws.close();
      this.ws = null;
    }
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const nexeWS = new NexeWebSocket();
