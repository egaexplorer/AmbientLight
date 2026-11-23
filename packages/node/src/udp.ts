import dgram from "node:dgram";
import type { RemoteInfo, UdpSocket } from "@ambientlight/core";

export interface NodeUdpSocketOptions {
  /** Enable sending to broadcast addresses (needed for discovery). */
  broadcast?: boolean;
}

/** `UdpSocket` backed by node:dgram, bound to an ephemeral port so bulb replies can be received. */
export async function createNodeUdpSocket(options: NodeUdpSocketOptions = {}): Promise<UdpSocket> {
  const socket = dgram.createSocket({ type: "udp4" });

  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(0, () => {
      socket.off("error", reject);
      resolve();
    });
  });

  if (options.broadcast) socket.setBroadcast(true);
  // Errors after binding (e.g. ICMP unreachable on some platforms) must not crash the process;
  // individual send() calls still reject with their own error.
  socket.on("error", () => undefined);

  let closed = false;

  return {
    send(message, port, address) {
      return new Promise<void>((resolve, reject) => {
        socket.send(message, port, address, (error) => (error ? reject(error) : resolve()));
      });
    },
    onMessage(listener: (message: string, remote: RemoteInfo) => void) {
      const handler = (msg: Buffer, rinfo: dgram.RemoteInfo): void => {
        listener(msg.toString("utf8"), { address: rinfo.address, port: rinfo.port });
      };
      socket.on("message", handler);
      return () => socket.off("message", handler);
    },
    close() {
      if (closed) return Promise.resolve();
      closed = true;
      return new Promise<void>((resolve) => socket.close(() => resolve()));
    },
  };
}
