/** Sender of a received datagram. */
export interface RemoteInfo {
  address: string;
  port: number;
}

/**
 * The only networking surface the core needs. Each platform provides an implementation:
 * - PC (Node.js / Electron main process): `node:dgram` — see apps/pc-cli/src/udp.ts
 * - Android (React Native): `react-native-udp`
 *
 * Implementations should be bound to an ephemeral port so bulb replies can be received,
 * and have broadcast enabled when used for discovery.
 */
export interface UdpSocket {
  /** Sends a UTF-8 message to address:port. */
  send(message: string, port: number, address: string): Promise<void>;
  /** Subscribes to incoming UTF-8 messages. Returns an unsubscribe function. */
  onMessage(listener: (message: string, remote: RemoteInfo) => void): () => void;
  close(): Promise<void>;
}
