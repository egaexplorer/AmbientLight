# AmbientLight: WiZ Screen Sync

Turn a Philips WiZ smart bulb into an ambient backlight for your PC (and later Android) screen.
AmbientLight captures the screen, works out its average color, and sends it straight to the bulb
over your local network (UDP port 38899). Screen sync doesn't need a cloud service or extra hardware.
With a title, [film looks](#film-looks) give the light the mood of the film's genre (one internet lookup at the start).
An optional prototype, [`rain`](#rain-signal) (not chosen as a product feature yet), turns the bulb into a "is it a good time to head out?" light. It reads public
weather data and can ask a free AI model for advice, so that mode needs internet.

```text
Capture screen  ->  Downscale + average color  ->  Calibrate + smooth  ->  UDP setPilot  ->  WiZ bulb
   (20 times per second)
```

**Status:** Phases 1–2 work end to end in the PC command-line app (capture, average, calibrate,
smooth, throttle, send, restore on exit). Phase 3 (calibrating on real hardware) is in progress, and Phase 4
(Windows desktop app, then Android app) is next: the desktop app's screens are designed ([docs/UI_DESIGN.md](docs/UI_DESIGN.md)). Film looks are built and tested on live APIs, real film frames and a fake bulb, not yet judged on a real bulb.
The rain signal is a parked option: tested on live weather data and a fake bulb, not
yet on a real bulb or with a real AI answer. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Repository layout

```text
packages/core     Shared TypeScript: WiZ UDP protocol, color pipeline, sync engine.
                  No Node.js APIs, so the React Native app can reuse it unchanged.
packages/node     Node.js adapters shared by the CLI and the desktop app: GDI capture helper, node:dgram UDP,
                  config files, film title lookup.
apps/pc-cli       Node.js CLI (screenshot-desktop + sharp as a capture fallback).
apps/desktop      Phase 4: Electron app for Windows (planned; screens in docs/UI_DESIGN.md)
apps/android      Phase 4: React Native + Kotlin MediaProjection (planned)
docs/             Architecture, WiZ protocol notes, roadmap, development guide, UI design
```

## Requirements

- **Windows 10/11.** AmbientLight targets Windows PCs and, later, Android; macOS, Linux and iOS aren't supported
  (the CLI's `"capture": "screenshot-desktop"` fallback may run there, but that isn't tested or maintained).
  The first `once`/`sync` builds a small capture helper with the C# compiler that ships with Windows
  (.NET Framework 4); later runs reuse it.
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
| `npm run on` / `npm run off` | Turns the bulbs on (at their last color and brightness) or off. An off bulb stays connected: `state` still reads it and `on` brings it back. Only cutting power at the wall switch makes it unreachable |
| `npm run check-bulb` | Tests each bulb (all bulbs found on the network if none is configured): reply time, signal, model, firmware, whether it accepts colors (or needs signed commands), then restores it |
| `npm run color -- --rgb r,g,b [--dimming n]` | Sets a fixed color to test connectivity |
| `npm run once` | Captures one frame and sends its color (Phase 1). Add `-- --save-frame <file.png>` to also save the frame it analyzed |
| `npm run sync` | Continuous screen sync (Phase 2). Add `-v` to print every frame |
| `npm run sync -- --film "<title>"` | Sync with the look of that film's genre ([Film looks](#film-looks)). Also `--series` and `--look`, and the same for `once` |
| `npm run rain` | Weather signal on the bulb ([Rain signal](#rain-signal)). Don't run it at the same time as `sync` |
| `npm run help` | All options |

## Configuration

`ambientlight.config.json` is searched for in the folder you run npm from and its parents.
Command-line flags override it.

| Key | Default | Meaning |
| --- | --- | --- |
| `bulbs` | `[]` | Bulb IPs. Several bulbs all show the same color. |
| `fps` | `20` | Updates per second. A WiZ bulb (`ESP25_SHRGB_01`) followed 20 smoothly; above 20 the CLI warns, because faster rates are untested. Lower it if the light lags or skips colors. |
| `capture` | `"gdi"` on Windows | `"gdi"`: a small helper that stays running, copies the screen with GDI and shrinks it itself (~30 ms per frame at 1080p). `"screenshot-desktop"`: the fallback, and the default on macOS/Linux. On Windows it starts and compiles a helper and encodes a JPEG for every frame (~370 ms, ~690 ms with `screen` set), so it manages only about 2–3 FPS. |
| `screen` | `null` | Display id from `npm run displays` (e.g. `"\\\\.\\DISPLAY2"`); `null` means the primary display. Works with both `capture` backends. |
| `sampleWidth` / `sampleHeight` | `64` / `36` | Size the screenshot is shrunk to before averaging. |
| `smoothing` | `0.7` | Share of the way to a new color the light covers in 100 ms (0–1), the same at any `fps`: 0.7 shows 90 % of a change after about 190 ms. Lower is calmer, higher reacts faster, `1` turns smoothing off. Scene cuts (`sceneCut`) and jumps to a far-away hue (e.g. red → green) are shown at once instead. |
| `sceneCut` | `40` | When the picture changes by at least this much in one frame (mean change per color channel, 0–255), it's a scene cut: the new color and brightness are shown at once instead of faded. `sync -v` marks such frames with `cut`. `0` turns it off. |
| `colorWeighting` | `0.6` | How much bright, colorful areas outweigh gray ones when picking the hue (0 = plain average). Brightness always follows the whole screen. |
| `colorMode` | `"dominant"` | `"dominant"`: the bulb shows the strongest color on screen (by area and vividness), so red and green never mix into an orange that isn't there. `"average"`: all colors are mixed. |
| `minChange` | `4` | Changes smaller than this (0–255 scale) aren't sent, which avoids flooding the bulb. |
| `keepAliveMs` | `2000` | Re-sends the current color this often in case a UDP packet was lost. |
| `restoreOnExit` | `true` | Restores the bulb's previous color, white, or scene when `sync` or `rain` stops. |
| `weatherArea` | `null` | BMKG village code (adm4) for `rain`, e.g. `"31.71.03.1001"` (Kemayoran). |
| `calibration.saturationBoost` | `1.3` | Makes washed-out average colors more vivid. |
| `calibration.gamma` | `1.6` | Deepens colors. Weak channels fade faster. |
| `calibration.minDimming` / `maxDimming` | `10` / `100` | Brightness range in %. WiZ accepts 10–100. |
| `calibration.colorBaseBrightness` | `10` | Brightness in % that dark **colored** scenes start from; brighter scenes spread between it and `maxDimming`. Raise it if colors look weak. Black, gray and white screens keep the `minDimming` base, and full-brightness colors stay at `maxDimming`. CLI: `--color-base`. |
| `calibration.brightnessGamma` | `1.0` | Values below 1 lift dark scenes; values above 1 make them darker. |
| `calibration.blackThreshold` | `0.04` | Screen brightness below which the bulb stays at `minDimming`. |
| `calibration.whiteSaturation` | `0.15` | Below this saturation the bulb uses its white LEDs instead of mixing white from RGB, which looks lavender on WiZ bulbs. `0` = never. |
| `calibration.whiteTemp` | `5000` | Color temperature (K, 2200–6500) for white: lower is warmer (4000 looks warm next to a screen), 6500 matches a screen's white but looks cool. |
| `calibration.paleWhite` | `140` | White LED level (0–255) for pale colors. They are sent as the WiZ app sends them: the pure hue plus the white LEDs, tinted warm or cold by the hue (except muted greens, see the next row). Mixed from RGB alone they look pink. `0` = RGB only. |
| `calibration.mutedGreenCorrection` | `1` | Muted (grayish) yellow-green to green scenes of dark or medium brightness get their own faint tint on cool white, because with `saturationBoost`, `gamma` and warm white they look yellow. Orange, skin, vivid colors and bright pages aren't affected, and brightness never changes. `0` = off, values between blend. CLI: `--muted-green`. |

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
- **Grayish green or olive scenes light the room yellow:** keep `mutedGreenCorrection` at 1. If such scenes now look
  too cool, lower it (0.5–0.8). To compare on a playing video, switch between `npm run sync` and
  `npm run sync -- --muted-green 0`.
- **White pages give a purple or pink light:** keep `whiteSaturation` above 0 so white uses the white LEDs; change
  `whiteTemp` (e.g. 2700 for warm, 6500 for cool) to taste.
- **Colors are too dim, white is fine:** raise `colorBaseBrightness`. To compare levels, pause on a dark colored
  shot, run this in PowerShell and switch to the full-screen video within 5 seconds (judge by eye: a phone camera
  adjusts its exposure):

  ```powershell
  Start-Sleep 5; foreach ($b in 10,30,40,50,70) { npm run once -- --color-base $b; Start-Sleep 4 }
  ```

  Or try one level on a playing video with `npm run sync -- --color-base 40`. The higher the base, the smaller
  the difference between dark and bright scenes, so take the lowest one that looks strong enough. A dark theme
  with a tint (e.g. navy) counts as color and gets brighter too.
  The right level depends on the placement: the default 10 can be enough with the bulb close by; if the screen or
  the bulb moves farther away, try 30 or 50.
- **Flicker or nervous light:** lower `smoothing` (0.4–0.5), raise `minChange` (6–8), or raise `sceneCut` (60) if
  `sync -v` shows `cut` on frames that aren't real cuts.
- **Light lags behind the picture:** check the `capture` time in `sync -v`. About 20–35 ms is normal for
  `"capture": "gdi"`; several hundred ms means the slow `screenshot-desktop` fallback is in use. Then raise
  `smoothing` (0.85–1.0), or lower `sceneCut` (25–30) so more cuts snap. If the bulb itself falls behind or
  skips colors, lower `fps` (15).
- **Dark movie scenes too bright:** lower `colorBaseBrightness` if you raised it, set `brightnessGamma` to 1.5, and keep
  `minDimming` at 10.
- **A scene gets a color or brightness you didn't expect:** save what the analysis saw with `once --save-frame`
  ([how](docs/DEVELOPMENT.md#debugging-a-scene)). A phone photo of the screen doesn't show those colors.

## Film looks

The light still follows the screen; the genre of what you watch decides how.

```powershell
npm run sync -- --film "Pengabdi Setan"     # genre from Wikipedia
npm run sync -- --film "Dune (1984)"        # add the year to choose a version
npm run sync -- --series "Wednesday"        # genre from TVmaze
npm run sync -- --look horror               # pick it yourself, no internet
```

| Look | Brightness up to | White | Colors |
| --- | --- | --- | --- |
| `horror` | 45 % | 6500 K | Pale, dim |
| `thriller` | 55 % | 5700 K | Deep, dim |
| `romance` | 75 % | 2700 K | Nearby colors lean pink |
| `animation` | 100 % | 4500 K | Vivid, dark scenes lifted |
| `comedy` | 100 % | 3500 K | Cheerful, warm |
| `scifi` | 85 % | 6500 K | Vivid, nearby colors lean cyan |
| `action` | 100 % | 5500 K | Strong, nearby colors lean red-orange |
| `drama` | 80 % | 3800 K | Soft, natural |

- A look works on top of your calibration: it scales saturation and gamma, can only lower your `maxDimming`, and turns
  hues by at most 20° before gamma. Colors far from the look's hue and muted greens aren't turned.
- The title must match exactly (case and punctuation don't matter), including other names in the article's first
  sentence, so Indonesian titles work. A similar title is suggested, never guessed. Comedy horror counts as comedy.
- Only the title is sent, once: to English Wikipedia for a film, to TVmaze for a series. Results are cached in
  `%LOCALAPPDATA%\AmbientLight\titles`, so a title that was used before also starts offline. Screen content never
  leaves the PC.

Film data: [Wikipedia](https://en.wikipedia.org/). Series data: [TVmaze](https://www.tvmaze.com/). Both CC BY-SA 4.0.

## Rain signal

> An option on hold: film looks were picked as the core feature ([roadmap](docs/ROADMAP.md#option-rain-signal-on-hold)).

`npm run rain` checks the weather every 2 minutes and shows the result on the bulb until Ctrl+C. Its output is in
Indonesian, like the data.

| Color | Meaning | Set by the rules when |
| --- | --- | --- |
| Green | Go now | All sources answered and none shows rain |
| Yellow | Take a raincoat | Light rain is forecast, or the airport reports thunder or showers nearby |
| Blue | Wait | Moderate or heavier rain is forecast, or it rains at the airport |
| Red | Don't leave | A BMKG warning covers the point now or within an hour, or the airport reports heavy rain or a thunderstorm with rain |
| Purple | Unknown | A source failed or is stale, and no known danger |

1. Set `weatherArea` in `ambientlight.config.json` to your village's BMKG code.
2. Optional AI: put a key in a git-ignored `.env` next to that file, either `GEMINI_API_KEY=...`
   ([Google AI Studio](https://aistudio.google.com/apikey)) or `GROQ_API_KEY=...`
   ([Groq](https://console.groq.com/keys)). If both are set, Gemini is used.
3. Run it:

```powershell
npm run rain -- --plan "naik motor, bisa tunggu sampai 19:00"
npm run rain -- --simulate danger    # made-up data: go, prepare, wait, danger or unknown
```

The AI weighs your plan against the facts, within limits that the code enforces: green can become yellow, and yellow
and blue can swap. It can never clear rain, change red or purple, or mention a time that isn't in the input. Without
a key, or when the AI fails, the rules decide alone.

The AI gets the facts, the current time and your plan, but no coordinates or place names. Free tiers may use what they
receive to improve their models, so keep personal details out of `--plan`.

It is an estimate, not a promise of dry weather: forecasts come in 3-hour steps and the only observation is the nearest
airport within 15 km (if there is none, the forecast and warnings decide).

Weather data: **BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)** and NOAA Aviation Weather Center (METAR).

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
