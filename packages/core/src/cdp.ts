import WebSocket from "ws";

type JsonValue = unknown;

interface Pending {
  resolve: (v: JsonValue) => void;
  reject: (e: Error) => void;
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: JsonValue;
  error?: { message: string };
  result?: JsonValue;
}

/** Minimal Chrome DevTools Protocol client over WebSocket. */
export class Cdp {
  private ws: WebSocket;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private handlers = new Map<string, (params: JsonValue) => void>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on("message", (data: WebSocket.RawData) => {
      const msg = JSON.parse(String(data)) as CdpMessage;
      if (typeof msg.id === "number") {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (!p) return;
        if (msg.error) p.reject(new Error("CDP error: " + msg.error.message));
        else p.resolve(msg.result);
      } else if (msg.method) {
        const h = this.handlers.get(msg.method);
        if (h) h(msg.params);
      }
    });
    ws.on("close", () => {
      for (const [, p] of this.pending) p.reject(new Error("CDP connection closed"));
      this.pending.clear();
    });
    ws.on("error", () => {
      /* close event follows */
    });
  }

  static connect(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, {
        maxPayload: 512 * 1024 * 1024,
        perMessageDeflate: false,
      });
      ws.once("open", () => resolve(new Cdp(ws)));
      ws.once("error", reject);
    });
  }

  send<T = JsonValue>(method: string, params?: object): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: JsonValue) => void,
        reject,
      });
      this.ws.send(JSON.stringify({ id, method, params }), (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });
  }

  on(event: string, fn: (params: JsonValue) => void): void {
    this.handlers.set(event, fn);
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* already gone */
    }
  }
}
