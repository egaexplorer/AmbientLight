import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BulbCheckReport } from "@ambientlight/core";
import { formatCheckReport } from "../src/check.js";

const BASE: BulbCheckReport = {
  host: "192.168.1.50",
  verdict: "ready",
  replyMs: 35,
  state: { state: true, rssi: -58, temp: 2700, dimming: 70 },
  signed: false,
  system: { mac: "a8bb50aabbcc", moduleName: "ESP25_SHRGB_01", fwVersion: "1.31.0" },
  kind: "color",
  minDimming: 10,
  testColor: { state: true, r: 255, g: 0, b: 0, dimming: 100 },
  test: { status: "accepted" },
  restore: "restored",
};

describe("formatCheckReport", () => {
  it("summarizes a working bulb", () => {
    const text = formatCheckReport(BASE).join("\n");
    assert.match(text, /\[ok\]\s+Reachable\s+replied in 35 ms; signal -58 dBm/);
    assert.match(text, /Current state\s+on, white 2700 K, 70 %/);
    assert.match(text, /\[ok\]\s+Model\s+ESP25_SHRGB_01 \(full color\)/);
    assert.match(text, /Firmware\s+1\.31\.0/);
    assert.match(text, /\[ok\]\s+Test color\s+accepted rgb\(255, 0, 0\) at 100 %/);
    assert.match(text, /Result: Ready/);
  });

  it("explains firmware that requires signed commands", () => {
    const text = formatCheckReport({
      ...BASE,
      verdict: "needs-signing",
      signed: true,
      test: { status: "rejected", code: -32602, message: "Invalid params" },
      restore: "not-needed",
    }).join("\n");
    assert.match(text, /\[warn\]\s+Signed replies\s+yes/);
    assert.match(text, /\[FAIL\]\s+Test color\s+rejected: Invalid params \(code -32602\)/);
    assert.match(text, /requires signed commands/);
  });

  it("points to the firewall when the bulb is unreachable", () => {
    const lines = formatCheckReport({
      ...BASE,
      verdict: "unreachable",
      error: "No getPilot reply from 192.168.1.50 within 1000 ms",
      test: { status: "skipped" },
      restore: "skipped",
    });
    assert.match(lines[0] ?? "", /\[FAIL\]\s+Reachable\s+No getPilot reply/);
    assert.match(lines.join("\n"), /Windows Defender Firewall/);
  });
});
