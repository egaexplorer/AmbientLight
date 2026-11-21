# WiZ local UDP protocol

WiZ bulbs accept JSON commands over UDP on the local network. Nothing goes through the cloud.
This page collects what AmbientLight relies on. The implementation is in `packages/core/src/wiz/`.

| | |
| --- | --- |
| Transport | UDP, IPv4 |
| Port | **38899** (the bulb listens here and replies to the sender's port) |
| Encoding | UTF-8 JSON, one message per datagram |
| Prerequisite | WiZ app → Settings → Security → **Allow local communication** on |

## Message format

```json
{ "method": "<name>", "params": { } }
```

Replies echo the method and carry either `result` or `error`:

```json
{ "method": "setPilot", "env": "pro", "result": { "success": true } }
{ "method": "getPilot", "env": "pro", "error": { "code": -32600, "message": "Invalid Request" } }
```

## `setPilot`: change the light

```json
{ "method": "setPilot", "params": { "r": 255, "g": 0, "b": 0, "dimming": 100 } }
```

| Param | Range | Notes |
| --- | --- | --- |
| `state` | `true` / `false` | On/off |
| `r`, `g`, `b` | 0–255 | RGB mix. Brightness comes from `dimming`, not from the channel values. |
| `c`, `w` | 0–255 | Cold- and warm-white LED channels (RGBWW bulbs) |
| `temp` | ≈2200–6500 K | White color temperature (model dependent) |
| `dimming` | **10–100** | Brightness %. Values below 10 are rejected by firmware. |
| `sceneId` | 1–32 | Built-in scenes (0 = none) |
| `speed` | 10–200 | Scene animation speed % |

Send only the fields that change. `sanitizeSetPilot()` clamps and rounds everything, because
out-of-range values are a common cause of silently ignored commands.

## `getPilot`: read the state

```json
{ "method": "getPilot", "params": {} }
```

```json
{
  "method": "getPilot",
  "env": "pro",
  "result": {
    "mac": "a8bb50xxxxxx", "rssi": -58, "src": "",
    "state": true, "sceneId": 0,
    "r": 255, "g": 0, "b": 0, "c": 0, "w": 0,
    "dimming": 100
  }
}
```

The result holds either `r,g,b,c,w`, or `temp`, or a non-zero `sceneId`, depending on the current mode.
`pilotToRestoreParams()` turns it back into a `setPilot` so `sync` can restore the light on exit.

## Discovery

Broadcast `getPilot` and collect the replies: each bulb answers from its own IP.

- Prefer the **subnet broadcast** (e.g. `192.168.1.255`) over `255.255.255.255`. On Windows the limited
  broadcast only leaves through one adapter, and VPN, Hyper-V, or WSL adapters often win. The CLI sends to
  every adapter's subnet broadcast plus `255.255.255.255` (`apps/pc-cli/src/network.ts`).
- Repeat the broadcast a few times. UDP is lossy.
- Receiving replies needs inbound UDP. On Windows, allow Node.js through Windows Defender Firewall on
  **Private** networks.

## Practical limits

- **Update rate:** about 5–15 `setPilot` per second per bulb. Faster than that, bulbs lag or drop updates.
  `SyncEngine` defaults to 10 FPS, skips tiny changes (`minChange`), and never queues stale frames.
- **Lost packets:** `setPilot` is fire-and-forget. The engine re-sends the current color every
  `keepAliveMs` (2 s), so a dropped packet self-heals.
- **Black:** the core never sends all-zero RGB. Dark scenes keep a hue and drop to `minDimming`
  (10 %) instead of switching the bulb off, which avoids on/off flicker.
- **Fixed IP:** bulbs get their address from DHCP. Reserve it in the router so the config keeps working.
- **No request ids:** replies carry no id, so they are matched by the bulb's IP and the method name. A late
  duplicate reply can be mistaken for the answer to a newer request (homebridge-wiz-lan).

## Signed requests (newer firmware)

Not supported by AmbientLight yet (see ROADMAP Phase 3). Source: pywizlight README and `sign_request`.

Some newer firmware replies with `"env":"pro"` and an `hmac` field. Reads (`getPilot`) still work, but an
unsigned `setPilot` fails with `-32602 Invalid params`, and a bad signature with `-32605 Security error`.
Because AmbientLight sends `setPilot` without waiting for the reply, such a bulb silently ignores every color.

- Key: `udp_signing_key` (32 hex characters, one per home) from the WiZ app's local integration export.
- Add `sigTs` (Unix time in seconds) to `params`.
- `hmac` = base64 of HMAC-SHA256 over the compact JSON of `params` (no spaces), keyed with the hex-decoded key.
- Send `{"method": ..., "env": "pro", "params": {...}, "hmac": "..."}`.
- The bulb rejects a `sigTs` about a minute old, so the computer's clock must be correct.

## Other methods (not used yet)

Collected from the references in [REFERENCE_NOTES.md](REFERENCE_NOTES.md).

| Method | What it does | Source |
| --- | --- | --- |
| `registration` with `register: false` | Discovery probe. Some firmware answers only this and not a `getPilot` broadcast, so send both. Reply `result` has `mac` and `success`. | MihirGupta07/wiz-sync, wiz-pc, SignalRGB plugin, homebridge-wiz-lan |
| `registration` with `register: true`, `phoneIp`, `phoneMac` | Subscribes to push updates: the bulb sends `syncPilot` (its state) to UDP **38900** on `phoneIp`, roughly every 5 s and on changes, and `firstBeat` when it boots. Acknowledging `syncPilot` is not needed. | pywizlight, wikari, homebridge-wiz-lan |
| `getSystemConfig` | `moduleName` (e.g. `ESP25_SHRGB_01`), `fwVersion`, `mac`. `RGB` in the module name means color; `TW` (tunable white) and `DW` (dimmable white) are white-only. | homebridge-wiz-lan, MihirGupta07/wiz-sync, pywizlight |
| `getModelConfig` | `minDimLevel` (use 10 when missing), `cctRange` on newer firmware, e.g. `[2200,2700,6500,6500]`. | pywizlight |
| `pulse` with `delta`, `duration` | Briefly pulses the brightness; HyperHDR uses `{"delta":100,"duration":1000}` to identify a bulb. | HyperHDR |

White channels: routing low-saturation colors to `temp` (or `c`/`w`) gives cleaner whites than the RGB LEDs.
wiz-pc switches below saturation 0.15 (`temp 4000`), namanb-lab/wiz-sync below 0.12 (`temp 4500`).
