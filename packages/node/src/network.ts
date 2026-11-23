import os from "node:os";
import { WIZ_BROADCAST } from "@ambientlight/core";

export function ipv4ToInt(address: string): number {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    throw new Error(`Not an IPv4 address: ${address}`);
  }
  const [a, b, c, d] = parts as [number, number, number, number];
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

export function intToIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");
}

/** e.g. 192.168.1.23 / 255.255.255.0 → 192.168.1.255 */
export function subnetBroadcast(address: string, netmask: string): string {
  return intToIpv4((ipv4ToInt(address) | ~ipv4ToInt(netmask)) >>> 0);
}

/**
 * Broadcast addresses for every active IPv4 LAN adapter, plus 255.255.255.255.
 * On Windows the limited broadcast only leaves through one adapter, so subnet
 * broadcasts make discovery work on PCs with VPN / Hyper-V / WSL adapters.
 */
export function broadcastAddresses(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): string[] {
  const result = new Set<string>();
  for (const infos of Object.values(interfaces)) {
    for (const info of infos ?? []) {
      if (info.family !== "IPv4" || info.internal || info.netmask === "255.255.255.255") continue;
      try {
        result.add(subnetBroadcast(info.address, info.netmask));
      } catch {
        // Ignore adapters with malformed addresses.
      }
    }
  }
  result.add(WIZ_BROADCAST);
  return [...result];
}
