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
| `r`, `g`, `b` | 0–255 | Color LEDs. The WiZ app puts only the hue here (smallest channel 0); see [Pale colors](#pale-colors-hue-on-rgb-paleness-on-the-white-leds). Brightness comes from `dimming`, not from the channel values. |
| `c`, `w` | 0–255 | Cold- and warm-white LEDs (RGBWW bulbs). The app uses them for the paleness of a color. |
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

The WiZ app derives the color it displays from these fields: the hue from `r,g,b` and the saturation from
`c + w`. So the app's color for a state we sent shows how WiZ interprets it (`r 255, g 188, b 133` with no white
displays as the fully saturated `#FF7300`). The app's picker also rounds: #ffffff reads back as #fffefe and
#85ff9c as #85ff9d. `npm run state` prints the raw fields.
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

Signing is not supported by AmbientLight yet (see ROADMAP Phase 3), but `npm run check-bulb` detects such
firmware: it reports signed replies and whether the bulb rejected the test color. Source: pywizlight README and
`sign_request`.

Some newer firmware replies with `"env":"pro"` and an `hmac` field. Reads (`getPilot`) still work, but an
unsigned `setPilot` fails with `-32602 Invalid params`, and a bad signature with `-32605 Security error`.
Because AmbientLight sends `setPilot` without waiting for the reply, such a bulb silently ignores every color.

**The usual cause is a WiZ app setting, not the firmware itself.** WiZ app → Settings (top right) → Security
(under Current home) has, besides the local communication toggle, an option **"Only verified controls"**: bulbs
then "only react to verified messages sent from the WiZ system or from a local third party integration which
would have been provided with the home security key" ([WiZ FAQ](https://faq.wizconnected.com/hc/en/7-wiz-v2/faq/548-disabling-local-network-communication)).
Turning it off (with local communication still on) lets unsigned commands through again; namanb-lab/wiz-sync's
setup notes call the same choice "Allow All Control". The trade-off: any device on the Wi-Fi can then control the
lights, as with older firmware. Tested on an `ESP25_SHRGB_01` bulb with firmware 1.38.0: with verified controls
on, its replies carried `hmac` (and `sigTs` in `result`) and an unsigned `setPilot` got `-32602`; after switching
the app to "Allow All Control", replies were unsigned and `setPilot` was accepted. The signing follows the setting,
not the firmware version.

To sign instead (not implemented; the app's export steps for the key are not documented by WiZ or pywizlight):

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

### Pale colors: hue on RGB, paleness on the white LEDs

The WiZ app does not mix a pale color from the RGB LEDs. It sends the **pure hue** on `r,g,b` (the smallest
channel is 0) and adds the **white LEDs** (`c`, `w`), and it reads saturation back from them.

Sending all three RGB channels instead gives the wrong color. Tested on an `ESP25_SHRGB_01` (firmware 1.38.0):
`setPilot` with `r 255, g 188, b 133` (a peach) lit the bulb **magenta**, because the red and blue LEDs overpower
green, and the app reported it as `#FF7300`: it takes only the hue from `r,g,b` and found no white.

What the app sends for colors picked in it (same bulb, read with `npm run state`, all at dimming 53 %):

| Picked | Saturation | Hue | r | g | b | c | w |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #ffffff | 0 | (0°) | 26 | 0 | 0 | 0 | 140 |
| #ffc0c0 | 0.247 | 0° | 82 | 0 | 0 | 0 | 140 |
| #ffbc85 | 0.478 | 27° | 135 | 61 | 0 | 16 | 124 |
| #ff8080 | 0.498 | 0° | 140 | 0 | 0 | 0 | 140 |
| #85ff9c | 0.478 | 131° | 0 | 135 | 26 | 77 | 63 |
| #85bcff | 0.478 | 213° | 0 | 61 | 135 | 124 | 16 |
| #c085ff | 0.478 | 269° | 65 | 0 | 135 | 106 | 34 |
| #ff85d0 | 0.478 | 323° | 135 | 0 | 83 | 43 | 97 |
| #ff4040 | 0.749 | 0° | 255 | 0 | 0 | 0 | 70 |
| #ff2020 | 0.875 | 0° | 255 | 0 | 0 | 0 | 35 |
| #ff0000 | 1 | 0° | 255 | 0 | 0 | 0 | 0 |

The rule behind it (every reading within ±1), with saturation s and white level W = 140:

- **Hue level** (brightest RGB channel): `255 × (0.1 + 0.9 s)` up to s = 0.5 (26 → 140); 255 from s = 0.75.
  Between 0.5 and 0.75 nothing was measured; `calibrate` ramps 140 → 255 so the light doesn't step there.
- **White** `c + w`: W up to s = 0.5, then `W × 2 (1 − s)` down to 0 at s = 1.
- **Cold share** `c / (c + w)` follows the hue: `hue / 240°` from red (0, all warm) to blue (1, all cold), then
  `(360° − hue) / 120°` back to red. A gray counts as hue 0° (#ffffff → `r 26`, all warm).

`calibrate` encodes pale colors this way (`calibration.paleWhite` = W), so the app shows the color we meant and
the bulb looks like the app's. Verified on the same bulb: we sent `rgb(136, 61, 0) + c 16 w 124` for a beige screen
(intended #ffbb84), `getPilot` reported exactly that, and the app showed **#FFBB84**. Brightness is independent:
#ffbc85 picked at 100 % reads the same `r,g,b,c,w` with `dimming 100`.

pywizlight's `rgbcw.py` describes an older version of the same idea (full hue down to s = 0.5, white capped at
128, warm white only). It does not match this firmware/app: with it the bulb looked more orange, more saturated
and darker than the app's color.

To measure the app's encoding for another color or bulb model: pick the color in the WiZ app (it accepts hex),
run `npm run state`, and compare the `r,g,b,c,w` line with what `calibrate` produces for the same color with
`gamma 1, saturationBoost 1, whiteSaturation 0` (the fixtures in `packages/core/test/color.test.ts` do this).

White channels: routing low-saturation colors to `temp` (or `c`/`w`) gives cleaner whites than the RGB LEDs.
wiz-pc switches below saturation 0.15 (`temp 4000`), namanb-lab/wiz-sync below 0.12 (`temp 4500`).
