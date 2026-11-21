import assert from "node:assert/strict";
import type os from "node:os";
import { describe, it } from "node:test";
import { broadcastAddresses, intToIpv4, ipv4ToInt, subnetBroadcast } from "../src/network.js";

function iface(address: string, netmask: string, extra: Partial<os.NetworkInterfaceInfo> = {}): os.NetworkInterfaceInfo {
  return {
    address,
    netmask,
    family: "IPv4",
    mac: "00:00:00:00:00:00",
    internal: false,
    cidr: null,
    ...extra,
  } as os.NetworkInterfaceInfo;
}

describe("network helpers", () => {
  it("converts IPv4 addresses to and from unsigned integers", () => {
    assert.equal(ipv4ToInt("255.255.255.255"), 4294967295);
    assert.equal(intToIpv4(ipv4ToInt("192.168.1.23")), "192.168.1.23");
    assert.throws(() => ipv4ToInt("192.168.1"), /Not an IPv4/);
    assert.throws(() => ipv4ToInt("192.168.1.300"), /Not an IPv4/);
  });

  it("computes subnet broadcast addresses", () => {
    assert.equal(subnetBroadcast("192.168.1.23", "255.255.255.0"), "192.168.1.255");
    assert.equal(subnetBroadcast("10.0.5.9", "255.255.0.0"), "10.0.255.255");
    assert.equal(subnetBroadcast("172.20.33.4", "255.255.240.0"), "172.20.47.255");
  });

  it("lists LAN broadcast addresses, skipping loopback and IPv6, plus 255.255.255.255", () => {
    const addresses = broadcastAddresses({
      "Wi-Fi": [iface("192.168.1.23", "255.255.255.0"), iface("fe80::1", "ffff:ffff:ffff:ffff::", { family: "IPv6" } as never)],
      "Loopback Pseudo-Interface 1": [iface("127.0.0.1", "255.0.0.0", { internal: true })],
      "vEthernet (WSL)": [iface("172.20.33.4", "255.255.240.0")],
    });
    assert.deepEqual(addresses, ["192.168.1.255", "172.20.47.255", "255.255.255.255"]);
  });
});
