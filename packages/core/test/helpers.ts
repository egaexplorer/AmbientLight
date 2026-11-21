import type { Clock, ColorSink, PixelFrame, RemoteInfo, ScreenCapturer, UdpSocket, WizColor } from "../src/index.js";

export interface SentDatagram {
  message: string;
  port: number;
  address: string;
}

type Reply = { text: string; address: string };

/** In-memory UdpSocket. `responder` can produce replies, delivered asynchronously like real UDP. */
export class FakeSocket implements UdpSocket {
  readonly sent: SentDatagram[] = [];
  closed = false;
  responder: ((datagram: SentDatagram) => Reply[] | undefined) | undefined;
  private readonly listeners = new Set<(message: string, remote: RemoteInfo) => void>();

  get listenerCount(): number {
    return this.listeners.size;
  }

  async send(message: string, port: number, address: string): Promise<void> {
    const datagram = { message, port, address };
    this.sent.push(datagram);
    for (const reply of this.responder?.(datagram) ?? []) {
      setTimeout(() => this.emit(reply.text, { address: reply.address, port }), 1);
    }
  }

  emit(message: string, remote: RemoteInfo): void {
    for (const listener of [...this.listeners]) listener(message, remote);
  }

  onMessage(listener: (message: string, remote: RemoteInfo) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

export class FakeClock implements Clock {
  time = 0;
  now(): number {
    return this.time;
  }
}

/** A tiny frame filled with one color. */
export function solidFrame(r: number, g: number, b: number, width = 4, height = 2): PixelFrame {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < data.length; i += 3) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  return { data, width, height, channels: 3 };
}

/** Returns queued frames in order, then keeps repeating the last one. */
export class FakeCapturer implements ScreenCapturer {
  calls = 0;
  frames: PixelFrame[];

  constructor(...frames: PixelFrame[]) {
    this.frames = frames;
  }

  async capture(): Promise<PixelFrame> {
    const frame = this.frames[Math.min(this.calls, this.frames.length - 1)];
    this.calls++;
    if (!frame) throw new Error("FakeCapturer has no frames");
    return frame;
  }
}

export class RecordingSink implements ColorSink {
  readonly colors: WizColor[] = [];
  async setColor(color: WizColor): Promise<void> {
    this.colors.push(color);
  }
}
