# AmbientLight: WiZ Screen Sync

Turn a Philips WiZ smart bulb into an ambient backlight for your PC (and later Android) screen.
AmbientLight captures the screen, works out its average color, and sends it straight to the bulb
over your local network (UDP port 38899). It doesn't need a cloud service or extra hardware.

```text
Capture screen  ->  Downscale + average color  ->  Calibrate + smooth  ->  UDP setPilot  ->  WiZ bulb
   (5-15 times per second)
```

**Status:** Phases 1–2 work end to end in the PC command-line app (capture, average, calibrate,
smooth, throttle, send, restore on exit). Phase 3 (calibrating on real hardware) and Phase 4
(Electron desktop app, Android app) are next. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Repository layout

```text
packages/core     Shared TypeScript: WiZ UDP protocol, color pipeline, sync engine.
                  No Node.js APIs, so the React Native app can reuse it unchanged.
apps/pc-cli       Node.js CLI: screenshot-desktop + sharp capture, node:dgram UDP.
apps/desktop      Phase 4: Electron app (planned)
apps/android      Phase 4: React Native + Kotlin MediaProjection (planned)
docs/             Architecture, WiZ protocol notes, roadmap, development guide
```

## Requirements

- **Windows 10/11** (macOS and Linux work too; Linux needs ImageMagick for screen capture).
- **Node.js 22.12 or newer.** Node 24 LTS is recommended.
- **A Philips WiZ bulb** set up in the official WiZ app, on the **same Wi‑Fi/subnet** as the PC.
- In the WiZ app, turn on **Settings → Security → Allow local communication**, and turn **off "Only verified controls"**
  (some app versions call this "Allow All Control"). Otherwise the bulb ignores AmbientLight's colors;
  `npm run check-bulb` tells you if that's the case.
- Recommended: give the bulb a fixed IP with a **DHCP reservation** in your router.

## Quick start (Windows PowerShell)

```powershell
cd C:\AI_Sandbox\Project\AmbientLight
npm install

# 1. Find your bulb's IP address
npm run discover

# 2. Save it in a local config file (git-ignored), then edit "bulbs"
copy ambientlight.config.example.json ambientlight.config.json

# 3. Check the bulb: it should turn red for 2 seconds, and the report should end with "Ready"
npm run check-bulb

# 4. Phase 1: capture one frame and send its color
npm run once

# 5. Phase 2: continuous sync. Press Ctrl+C to stop; the bulb returns to its previous state.
npm run sync
```

> **Windows Firewall:** the first time you run `discover` or `sync`, Windows may ask whether Node.js can
> use the network. Allow it on **Private networks**. If you don't, sending colors still works, but discovery
> and "restore previous state" can't receive the bulb's replies.

You can pass any setting on the command line instead of the config file, e.g.
`npm run sync -- --bulb 192.168.1.50 --fps 12 --saturation 1.5`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run discover` | Broadcasts `getPilot` on every LAN adapter and lists the bulbs that answer |
| `npm run displays` | Lists display ids for `--screen` (multi-monitor setups) |
| `npm run state` | Shows each bulb's current color exactly as the bulb reports it (`r,g,b,c,w`, `temp`, dimming). Changes nothing |
| `npm run check-bulb` | Tests each bulb (all bulbs found on the network if none is configured): reply time, signal, model, firmware, whether it accepts colors (or needs signed commands), then restores it |
| `npm run color -- --rgb r,g,b [--dimming n]` | Sets a fixed color to test connectivity |
| `npm run once` | Captures one frame and sends its color (Phase 1) |
| `npm run sync` | Continuous screen sync (Phase 2). Add `-v` to print every frame |
| `npm run help` | All options |

## Configuration

`ambientlight.config.json` is searched for in the folder you run npm from and its parents.
Command-line flags override it.

| Key | Default | Meaning |
| --- | --- | --- |
| `bulbs` | `[]` | Bulb IPs. Several bulbs all show the same color. |
| `fps` | `10` | Updates per second. WiZ bulbs handle about 5–15. |
| `screen` | `null` | Display id from `npm run displays`; `null` means the primary display. |
| `sampleWidth` / `sampleHeight` | `64` / `36` | Size the screenshot is shrunk to before averaging. |
| `smoothing` | `0.5` | Share of the way to a new color the light covers in 100 ms (0–1), the same at any `fps`. Lower is calmer, higher reacts faster, `1` turns smoothing off. A jump to a far-away hue (e.g. red → green) is shown at once instead of fading through a muddy in-between color. |
| `colorWeighting` | `0.6` | How much bright, colorful areas outweigh gray ones when picking the hue (0 = plain average). Brightness always follows the whole screen. |
| `colorMode` | `"dominant"` | `"dominant"`: the bulb shows the strongest color on screen (by area and vividness), so red and green never mix into an orange that isn't there. `"average"`: all colors are mixed. |
| `minChange` | `4` | Changes smaller than this (0–255 scale) aren't sent, which avoids flooding the bulb. |
| `keepAliveMs` | `2000` | Re-sends the current color this often in case a UDP packet was lost. |
| `restoreOnExit` | `true` | Restores the bulb's previous color, white, or scene when sync stops. |
| `calibration.saturationBoost` | `1.3` | Makes washed-out average colors more vivid. |
| `calibration.gamma` | `1.6` | Deepens colors. Weak channels fade faster. |
| `calibration.minDimming` / `maxDimming` | `10` / `100` | Brightness range in %. WiZ accepts 10–100. |
| `calibration.brightnessGamma` | `1.0` | Values below 1 lift dark scenes; values above 1 make them darker. |
| `calibration.blackThreshold` | `0.04` | Screen brightness below which the bulb stays at `minDimming`. |
| `calibration.whiteSaturation` | `0.15` | Below this saturation the bulb uses its white LEDs instead of mixing white from RGB, which looks lavender on WiZ bulbs. `0` = never. |
| `calibration.whiteTemp` | `5000` | Color temperature (K, 2200–6500) for white: lower is warmer (4000 looks warm next to a screen), 6500 matches a screen's white but looks cool. |
| `calibration.paleWhite` | `140` | White LED level (0–255) for pale colors. They are sent exactly as the WiZ app sends them: the pure hue plus the white LEDs, tinted warm or cold by the hue. Mixed from RGB alone they look pink. `0` = RGB only. |

### Tuning tips (Phase 3)

- **Colors look pale:** raise `saturationBoost` (1.5–1.8) or `gamma` (2.0).
- **The bulb stays white while a colorful video plays in a window:** raise `colorWeighting` (0.8–1.0), or lower
  `whiteSaturation` (0.1).
- **The light shows a color that isn't on screen** (orange from red + green, lavender from blue + orange): keep
  `colorMode` at `"dominant"`. If you prefer a blend of everything on screen, use `"average"`.
- **The bulb looks pink while the terminal shows a pale color (peach, beige, skin tones):** keep `paleWhite`
  at 140 (what the WiZ app uses). Raise it (160–200) if pale colors look too strong, lower it (90–120) if they
  look washed out.
  `npm run once` prints what was sent and what the bulb reports back.
- **White pages give a purple or pink light:** keep `whiteSaturation` above 0 so white uses the white LEDs; change
  `whiteTemp` (e.g. 2700 for warm, 6500 for cool) to taste.
- **Flicker or nervous light:** lower `smoothing` (0.3) or raise `minChange` (6–8).
- **Light lags behind the picture:** raise `smoothing` (0.7–1.0) and check that the `capture` time shown by `sync -v` is well under 1000/fps ms.
- **Dark movie scenes too bright:** set `brightnessGamma` to 1.5 and keep `minDimming` at 10.

## Development

```powershell
npm run build       # tsc -b (project references)
npm test            # node:test via tsx, no bulb or screen needed
npm run typecheck   # type-checks the tests
npm run check       # all of the above
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for conventions and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit together.
Protocol details are in [docs/WIZ_PROTOCOL.md](docs/WIZ_PROTOCOL.md).

## References

These open-source projects informed the design. See [docs/PROJECT_GUIDE.md](docs/PROJECT_GUIDE.md) for the full
list with licenses, and [docs/REFERENCE_NOTES.md](docs/REFERENCE_NOTES.md) for what each one teaches and how it applies
to AmbientLight.

- [one-adnan/ambient-setup](https://github.com/one-adnan/ambient-setup): color pipeline ideas (saturation boost, gamma, EMA smoothing, presets)
- [uditkarode/wikari](https://github.com/uditkarode/wikari): TypeScript WiZ library (discovery, getPilot/setPilot)
- [noturbob/wiz-pc](https://github.com/noturbob/wiz-pc): "latest-wins" UDP scheduling, white-channel routing
- [MihirGupta07/wiz-sync](https://github.com/MihirGupta07/wiz-sync): Windows desktop media/audio sync
- [hyperion-project/hyperion.ng](https://github.com/hyperion-project/hyperion.ng): smoothing, black-bar detection, multi-zone mapping

## License

No license has been granted. All rights reserved. The code is public for reference.
