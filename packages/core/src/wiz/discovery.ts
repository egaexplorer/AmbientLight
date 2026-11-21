import { sleep } from "../platform/timers.js";
import { WIZ_BROADCAST, WIZ_PORT } from "./constants.js";
import { getPilotMessage, type PilotState, parseResponse } from "./protocol.js";
import type { UdpSocket } from "./socket.js";

export interface DiscoveredBulb {
  address: string;
  mac?: string;
  rssi?: number;
  state: PilotState;
}

export interface DiscoverOptions {
  /** Where to send the broadcast. Subnet broadcasts (e.g. 192.168.1.255) are more reliable on multi-adapter PCs. */
  broadcastAddresses?: string[];
  /** Total time to listen for replies. Default 2000 ms. */
  timeoutMs?: number;
  /** Broadcast repeats, since UDP can drop packets. Default 3. */
  attempts?: number;
  port?: number;
}

function ipSortKey(address: string): string {
  return address
    .split(".")
    .map((part) => part.padStart(3, "0"))
    .join(".");
}

/**
 * Finds WiZ bulbs on the LAN by broadcasting `getPilot` and collecting replies.
 * The socket must have broadcast enabled.
 */
export async function discoverBulbs(socket: UdpSocket, options: DiscoverOptions = {}): Promise<DiscoveredBulb[]> {
  const addresses = options.broadcastAddresses?.length ? options.broadcastAddresses : [WIZ_BROADCAST];
  const attempts = Math.max(1, options.attempts ?? 3);
  const timeoutMs = Math.max(100, options.timeoutMs ?? 2000);
  const port = options.port ?? WIZ_PORT;
  const found = new Map<string, DiscoveredBulb>();

  const unsubscribe = socket.onMessage((text, remote) => {
    const response = parseResponse(text);
    if (!response || response.method !== "getPilot" || !response.result) return;
    const state = response.result as PilotState;
    found.set(remote.address, {
      address: remote.address,
      ...(typeof state.mac === "string" ? { mac: state.mac } : {}),
      ...(typeof state.rssi === "number" ? { rssi: state.rssi } : {}),
      state,
    });
  });

  try {
    const message = getPilotMessage();
    let lastError: unknown;
    let anySent = false;
    for (let attempt = 0; attempt < attempts; attempt++) {
      await Promise.all(
        addresses.map((address) =>
          socket.send(message, port, address).then(
            () => {
              anySent = true;
            },
            (error: unknown) => {
              lastError = error;
            },
          ),
        ),
      );
      await sleep(timeoutMs / attempts);
    }
    if (!anySent && lastError !== undefined) throw lastError;
  } finally {
    unsubscribe();
  }

  return [...found.values()].sort((a, b) => ipSortKey(a.address).localeCompare(ipSortKey(b.address)));
}
