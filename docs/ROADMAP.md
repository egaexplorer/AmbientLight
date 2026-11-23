# Roadmap

Based on the *WiZ PC Screen-Sync Ambilight Project Guide* (Google Drive).

## Phase 1: Node.js + TypeScript proof of concept ✅

- [x] TypeScript Node.js project (`tsc` build, `tsx` for running from source)
- [x] Capture a frame with `screenshot-desktop` (`apps/pc-cli/src/capture.ts`)
- [x] Downscale (sharp, 64×36) and compute the average RGB color (`averageColor`)
- [x] Send a `setPilot` UDP packet with `node:dgram` → `npm run once`
- [x] Connectivity test command → `npm run color -- --rgb 255,0,0`
- [x] Bulb discovery (`getPilot` broadcast) → `npm run discover`
- [x] Turn the bulbs on/off → `npm run on` / `npm run off` (an off bulb stays reachable; tested 2026-11-23)

## Phase 2: continuous sync loop and throttling ✅

- [x] Non-blocking timed loop, 5–15 FPS (`SyncEngine`, default 10 FPS)
- [x] Color smoothing (EMA) and minimum-change threshold
- [x] Keep-alive re-send for lost UDP packets
- [x] No stale-frame backlog (one frame at a time; the newest frame wins)
- [x] Restore the bulb's previous state on Ctrl+C
- [x] Multiple bulbs (same color)

## Phase 3: testing and calibration ⏳

- [ ] Run full-screen YouTube Ambilight test videos and tune `saturationBoost`, `gamma`, `brightnessGamma`, `minDimming`, `colorBaseBrightness`
      - First clip (2026-11-22, 20 FPS, phone video): the room turns orange in a dark shot with two small wall
        lamps. The user likes the orange (the most vibrant color). The shot looked teal on video, but its saved
        frame is near-black brown, so the orange follows the pixels (see the next items). The user first wanted it
        darker; after comparing levels by eye, colors turned out to be too dim in general
- [x] Separate base brightness for colors → `colorBaseBrightness` / `--color-base`, default 10 (off)
- [x] Try it on the bulb → 2026-11-22: the user saw a noticeable difference in brightness and liked the result
- [x] Pick the value to keep and decide the default → 10 for both (user, 2026-11-22): enough with the bulb where
      it is now. The user plans to raise theirs to 30 or 50 if the device or the bulb moves farther away
- [x] Save the analyzed frame for offline tuning → `once --save-frame`
- [x] Measure that lamp shot with `--save-frame`, plus the doorway shot as a reference that must not change → lamps:
      average `23,18,16`, winning hue family on 2.3 % of the screen, dimming 15. Doorway (teal on video): average
      `32,35,25` (olive), family on 1.4 %, dimming 19. Without the family's pixels the lamp shot is still warm,
      only paler
- [ ] Deferred by the user: make the light darker when its color comes from a small area. Revisit if small lights
      look too strong at the chosen color base (at base 40 the first rule takes the lamp shot from 43 to 38 and
      leaves the other dark scenes tested alone). Measured dimming per rule at base 10:

      | Rule | Lamps (now 15) | Doorway (now 19) | White page + 2 % red icon (now 100) |
      | --- | --- | --- | --- |
      | Scale only the family's light by `min(1, coverage / 0.10)` | 13 | 19 | 99 |
      | Scale the whole dimming above 10 by the same factor | 11 | 11 | 28 |
      | `brightnessGamma` 1.5 (config only, all scenes) | 11 | 13 | 100 |

      The first rule is the one that leaves the references alone. 13 is as far as it can go on this shot (the same
      with the family's light removed entirely). The second breaks both references
- [x] Let large dim areas count a little more for the hue, only if the lamp shot stays orange → no change: there
      are no large teal areas to count. Even at chroma 0.06 (instead of `MIN_CHROMA` 0.12) the lamp shot has 150
      warm pixels and 10 teal-blue ones
- [x] Doorway shot: the light is too yellow, the user sees white-blue-teal (2026-11-22). Not caused by the orange
      lamp (without its pixels the frame still gives yellow-green) and not by the capture (equals a screenshot
      that looks like the video). The cause is the mapping: saturation 0.29 → 0.52 (`saturationBoost`, `gamma`) and
      67 % warm white for a ~5400 K color (hue 78°).
      - [x] The user picks the target on the bulb → cool white with the screen's faint olive (key 3 of 7; the range 3 to 5,
            i.e. also plain 5000 and 6500 K, was liked)
      - [x] Apply it only to muted yellow-green to green scenes of dark or medium brightness (the user's choice of
            reach) → `mutedGreenCorrection` / `--muted-green`, default 1. Global settings can't do that:
            `saturationBoost` 1 + `gamma` 1 pales the lamp orange and skin, `whiteSaturation` 0.4 turns beige and
            pale blue white
      - [x] The user tries it before it's merged → "looks good enough" (2026-11-22, by eye; which scenes wasn't
            reported). The other evidence is two measured shots and their crops, test colors, and 37 bundled Windows
            photos (none changed, but few are greenish). If a green scene looks too cool, lower
            `mutedGreenCorrection` or narrow its range
- [x] Measure capture time and real FPS on Windows → `screenshot-desktop` took 367 ms per frame (685 ms with
      `screen` set), so `sync` reached ~2.7 FPS. See the latency budget in [ARCHITECTURE.md](ARCHITECTURE.md#latency-budget)
- [x] Decide whether `screenshot-desktop` is fast enough → no: it compiles its C# helper on every frame. A helper
      that stays running (`"capture": "gdi"`, now the Windows default) takes 32 ms; `screenshot-desktop` stays
      as the fallback
- [x] Hold the configured FPS on Windows: the loop now sleeps to fixed frame times (8.8 → 10.0 FPS)
- [x] Faster default `smoothing` (0.5 → 0.7: 90 % of a change after ~190 ms instead of ~330 ms)
- [ ] Measure end-to-end latency (screen change → bulb), e.g. by filming the screen and the bulb together
- [x] Find the bulb's real update limit → the `ESP25_SHRGB_01` keeps up at 20 FPS, so the default `fps` is now 20.
      Rates above 20 are untested
- [ ] Tune `sceneCut` (default 40) on real videos with `sync -v`, which marks cut frames
- [ ] Black-bar (letterbox) detection so movie bars don't darken the light: 3-line probe from each edge, switch
      only after the border is stable for ~2 s (HyperHDR, hyperion.ng)
- [ ] Hue-specific compensation (WiZ greens and yellows tend to look off; muted greens are done, see
      `mutedGreenCorrection`, vivid ones are untested): extra saturation for green/yellow
      hues, per-channel gains scaled by saturation so grays stay neutral (ambient-setup, namanb-lab)
- [x] Route low-saturation colors to the white LEDs (`temp`) for cleaner whites, with hysteresis so a scene near
      the threshold doesn't flip modes (wiz-pc, namanb-lab) → `whiteSaturation`, `whiteTemp`
- [x] Send pale colors as the pure hue plus the white LEDs, like the WiZ app; an RGB-only pale mix looks pink
      → `paleWhite`, `npm run state`
- [x] Measure the app's `r,g,b,c,w` for 11 colors with `npm run state` and fit the encoder to them (hue level,
      white level, hue-tinted cold/warm split)
- [ ] Measure the app between saturation 0.5 and 0.75 (e.g. #ff7070, #ff6060) and replace the ramp if it differs
- [ ] Presets: gaming (fast), movie (smooth), ambient (very smooth, dimmer)

Lessons from the reference study ([REFERENCE_NOTES.md](REFERENCE_NOTES.md)):

- [x] Detect bulbs that require signed `setPilot` (`hmac` in replies, `-32602` reply) and tell the user →
      `npm run check-bulb`
- [ ] Support an optional `signingKey` through an injected HMAC-SHA256 function, since the core can't import
      `node:crypto` (pywizlight)
- [x] Time-based smoothing (`1 − e^(−dt/τ)`) so the feel doesn't change with FPS, plus an instant snap on scene
      cuts (HyperHDR, MihirGupta07/wiz-sync) → `smoothing` is now per 100 ms, and a dominant-hue jump of more
      than 60° snaps instead of fading through a muddy color (red → green no longer passes brownish yellow).
      Brightness cuts snap too: a mean pixel change of `sceneCut` (40) or more resets the smoothers
      (MihirGupta07/wiz-sync). Not done: blending in OKLab (wiz-pc)
- [ ] Dark scenes: below `blackThreshold`, fade to a configurable warm glow or hold the last hue instead of
      showing a noisy hue (ambient-setup, SignalRGB plugin)
- [x] Take the hue from vivid pixels and the brightness from the plain luminance mean (ambient-setup,
      namanb-lab) → `colorWeighting`
- [x] Dominant color instead of a mix of hues: vote colorful pixels into hue bins, average only the strongest
      hue family, keep the previous one on near ties (hyperion.ng's dominant-color mode) → `colorMode`
- [ ] Discovery: also broadcast `registration`; save bulbs by MAC and re-resolve their IP at startup; read
      `getSystemConfig` to tell color bulbs from white-only ones
- [x] Requests (`getPilot` and others) retransmit once after 400 ms (homebridge-wiz-lan)
- [ ] Clamp dimming to `getModelConfig.minDimLevel` (`check-bulb` already reports it) (pywizlight)
- [ ] `identify` command that flashes one bulb (ambient-setup, HyperHDR)

## Phase 4: desktop app (Electron) and Android port (React Native) 🗓️

Targets: Windows (PC) and Android only; macOS, Linux and iOS are not planned.

**Electron (`apps/desktop`)**, Windows. Screens and their spec: [UI_DESIGN.md](UI_DESIGN.md). Planned on 2026-11-23.

- [x] Wireframes of every screen and a Google Stitch brief (2026-11-23, [UI_DESIGN.md](UI_DESIGN.md))
- [ ] Capture with the GDI helper the CLI already uses (decided 2026-11-23: measured at 32 ms and 20 FPS, while
      `desktopCapturer` is unmeasured; see [ARCHITECTURE.md](ARCHITECTURE.md), decision 15)
- [ ] Shared foundation: the CLI's Node adapters move to `packages/node`; `SyncSession` (start, stop with restore,
      live option updates) and `identifyBulb` in the core
- [ ] **Demo flow by 2026-11-25, for the video on 2026-11-26:** find a bulb, Blink, film title or look chip, Start
      with live colors, Stop or quit restores the bulb
- [ ] **MVP by 2026-12-10, for the live demo on 2026-12-12:** setup wizard, Bulbs page with check report and power,
      Tuning page that applies live, display picker, tray (close to tray, start with Windows), Diagnostics, About
      with data credits, film errors as codes, CLI `sync` on `SyncSession`, NSIS installer
- [ ] `desktopCapturer` spike: a hidden-window capturer and a benchmark against GDI (capture ms, FPS, CPU, memory,
      color difference on the same screens), run on the user's PC. Switch only if it wins

**Android (`apps/android`)**

- [ ] React Native app reusing `@ambientlight/core` and shared UI
- [ ] UDP through `react-native-udp` (implements the core's `UdpSocket`)
- [ ] Kotlin native module: `MediaProjection` in a foreground service, downscaled RGB streamed to TypeScript.
      Render the `VirtualDisplay` ~96 px wide so the GPU downscales, use `ImageReader` with 2 images and
      `acquireLatestImage()`, respect `rowStride`, register the projection callback before
      `createVirtualDisplay` (Android 14+), and resize on rotation (namanb-lab, hyperion-android-reborn)
- [ ] Android TV support (see namanb-lab/wiz-sync); check which apps can be captured

**Electron, from the reference study**

- [ ] Re-run discovery periodically (e.g. every 60 s) so bulbs that join later appear (SignalRGB plugin)

## Later ideas

- Multi-zone: several bulbs mapped to screen regions (left/right/top), like Hyperion edge mapping
  (HyperHDR's WiZ driver maps one zone per bulb)
- Audio-reactive mode (WASAPI loopback, see MihirGupta07/wiz-sync)
- TV sources that screen capture can't reach: an HDMI capture device between the source and the TV, read like a
  webcam, as dedicated sync boxes do. Untested here
- Push updates: `registration` with `register: true` and a listener on UDP 38900, so the Electron UI shows changes
  made in the WiZ app (pywizlight, wikari)
- Send at a steady rate between captures with the time-based smoother, and an optional `delayMs` to match TV
  input lag (hyperion.ng). With capture at ~30 ms this matters less than it did at ~370 ms
- DXGI Desktop Duplication capture if GDI ever isn't enough: copy only changed frames, shrink on the GPU with a
  mip chain, read back a few KB, handle HDR (HyperHDR `DxGrabber`, Lightpack `DDuplGrabber`). Could live in the
  same kind of helper as `native/gdi-capture.cs`, but D3D11 from C# 5 without libraries is a lot of interop
- Faster end of a fade: HyperHDR speeds up small leftover differences (`k^0.6` below 16/255), so colors don't
  creep toward the target for long
- Per-bulb calibration (gamma and white balance) once several bulbs are supported (wiz-pc)

## Film looks ⏳

Picked on 2026-11-22 as the core feature. Priority: the core working, with a write-up and a demo video, by
2026-11-26; everything else can follow until the live demo on 2026-12-12.

- [x] `--film` (Wikipedia), `--series` (TVmaze), `--look`, cache, 8 looks, tests
- [x] Lookup: 21 of 21 test films right, including 7 Indonesian ones; mistyped titles and series are refused
- [x] Looks measured through `SyncEngine` on 99 distinct frames of Sintel, Big Buck Bunny and Tears of Steel: each
      differs from plain sync on 59–92 % of frames and from each other look on at least 63 %, no vivid color turned
      white, hue moved at most 30° after gamma
- [x] End to end on a fake bulb: 20 FPS kept, previous state restored
- [ ] Judge the looks on the real bulb, above all horror (too dark?), romance and animation, then tune
- [ ] Record the demo video
- [ ] Later, if there is time: night watching (cap by sunset; see the options below)
- [ ] Later: optional AI look per title from the Wikipedia summary
- [ ] Later: read the title from the player, switch looks without restarting
- [ ] Ask before adding contact details to the Wikimedia User-Agent (200 instead of 10 requests a minute)

## Option: rain signal (on hold)

Put on hold on 2026-11-22: the user preferred a feature closer to ambient light and picked [film looks](#film-looks-).
The prototype works and stays available as an option; the open boxes below wait until it is picked.

`npm run rain` (2026-11-22): the bulb shows whether it's a good time to go outside. Sources were first tried
on 2026-11-22 at 20:18–20:19 WIB, for central Jakarta (-6.2, 106.8; BMKG forecast: Kemayoran, `31.71.03.1001`):

| Source | Returned | Use and limit |
| --- | --- | --- |
| BMKG nowcast (CAP XML) | Active "Jakarta" heavy-rain alert, 18:05–21:05; neither test point was inside its polygons | Best local warning. Match polygon and `effective`/`expires`, never the province in the title |
| Aviation Weather METAR (WIHH, WIII) | No rain at 20:00; WIHH had thunderstorms and rain to the southwest until 18:30 | Real observations every 30 min, but only at airports (12–18 km from the test point) |
| BMKG forecast | Cloudy at 20:00, light rain at 23:00 | Village level, but 3-hour steps |
| Open-Meteo | 0 mm now with 69 % probability; for the same hour ICON gave 0.9 mm, JMA 0.4, ECMWF and GFS 0 | `current` is model output, and 15-minute values are interpolated in Indonesia. Not proof of dry weather |
| RainViewer radar | Coverage tile is solid black (no coverage) at the test point | Not usable there |

- "No alert" doesn't mean "no rain": show risk and the data's age, and give missing or stale data its own color.
- BMKG requires visible attribution and allows 60 requests per minute per IP. Open-Meteo's free API is non-commercial.
- Decided: a separate command (not mixed into `sync`), steady colors without blinking, Open-Meteo and radar not used.
  The AI only weighs the user's plan, within limits set by the rules.

- [x] Rules, data sources, AI guard, simulations and tests
- [x] Live data, 20:42–20:45 WIB on 2026-11-22: a dry area gave green, Pamulang Barat (`36.74.06.1001`) gave red from
      a real warning until 21:05 while its forecast said cloudy
- [x] End to end on a fake bulb: five colors, restore on exit, offline → purple, an AI downgrade of red rejected
- [ ] Check the five colors on the real bulb, especially yellow (`255,190,0`) and purple against blue
- [ ] A real AI answer. Only the endpoints were tried (with an invalid key), so model id and JSON schema are unproven
- [ ] Judge the rules against real weather for a few days; the thresholds are a first guess
- [ ] Later: phone notification for when the bulb is out of sight

## Options: ambient features with a public API (1 picked, 2 next if time allows)

Brainstorm of 2026-11-22. Each must build on screen sync, use a public API and work without AI (AI is optional).

| # | Idea | Public API | Without AI | Optional AI | Found when probed |
| --- | --- | --- | --- | --- | --- |
| 1 | Film director: a look per film or series on top of screen sync | Wikipedia, TVmaze (both CC BY-SA); Wikidata dropped, it needs several requests | Genre → small hue turn, saturation, brightness, white temperature | A look per title from its description | Genre for 6 of 7 test films. The seventh (Petualangan Sherina) has it in its Indonesian Wikipedia summary ("komedi musikal", CC BY-SA), readable by keywords or AI; keep a manual genre for the rest |
| 2 | Night watching: screen colors stay, brightness and white follow the sun | Sunrise-Sunset (attribution link) | Minutes after sunset → `maxDimming`, `whiteTemp` (only gray and white scenes get warmer) | Plain-language preferences | No key, answered in 0.5 s |
| 3 | Hearing through light: pulses for sound captions, for deaf viewers | OpenSubtitles (5 downloads a day, 20 with an account) | Keywords in captions such as [explosion] | Classify captions and emotion | The API refused a generic client: needs a registered app. Not tested further |
| 4 | Lyric stage: choruses and quiet parts shape the screen's color | LRCLIB (no key, no stated license for lyrics) | Repeated lines = chorus | Emotion per line | Timed lyrics for 5 of 5 test songs, 3 of them Indonesian |
| 5 | Space window: full-screen space photos light the room | NASA Image Library (no key) | Screen sync as it is, plus a slideshow | Narrate each photo | Search and 3 test images worked |

Picked: 1 first ([Film looks](#film-looks-)), then 2. Both act on the calibration step and need no key.
The measurements below led to the design; the built version narrows the hue turn further (ARCHITECTURE, decision 13).

**How to make a film look.** Simulated with `calibrate` and `previewRgb` on 540 test colors (36 hues, 5 saturations,
3 brightnesses) and 3 looks (horror, romance, animation). This replaces a first test that was wrong: its "romance"
look used the default saturation and gamma, and the 25 % blend it recommended breaks colors.

| Method | Visibly different from default | Hue change | Colors broken |
| --- | --- | --- | --- |
| Settings only (saturation, gamma, brightness, white temperature) | 73–89 % | mean ≤ 3°, max 8° | none, but no genre tone |
| Blend 25 % of a genre color | 95–97 % | mean 29–34°, max 179° | up to 41 % move > 30°, up to 5 % of vivid colors turn white (sky → white) |
| **Settings + hue turn of at most 20° toward the genre** (fades to none at the opposite hue) | 91–96 % | mean 12–13°, max 31° after gamma | ≤ 2 % move > 30°, none turn white |

"Visibly different" means hue ≥ 10°, saturation ≥ 0.1, dimming ≥ 10 points, or white temperature ≥ 1000 K. That is a
threshold, not a judgment by eye: none of this was seen on the bulb. Constraints found:

- The hue turn goes between smoothing and `calibrate`, so scene-cut detection still sees the screen's own hue.
- Leave muted greens out of the turn: with it, the romance look made the doorway shot yellow (`#fffc99`) again.
- Night watching changes no hue. A cap of 100 → 25 takes skin from 80 to 22 but dark shots only from 15 to 11, a step
  that is hard to see on this bulb.
- Combined, the cap is the lower of genre and night, and `colorBaseBrightness` must shrink with it: a base of 45
  under a cap of 25 gave 7 of 8 test scenes the same brightness.
- Titles are ambiguous ("Interstellar" first finds the interstellar medium) and films have up to 12 genres, so search
  results need a film filter and genres a priority ("comedy horror" should not look like horror).

Findings for whichever is built:

- Windows' media session API answers from PowerShell 5.1, so ideas 1, 3 and 4 may get title and position from it.
  Only the session count was read; whether browsers report a usable position is untested.
- Test and demo with YouTube or open movies.
- Wikimedia wants a User-Agent with a contact, and LRCLIB one that names the app.

What the film and music APIs allow (verbatim terms read on 2026-11-22; our reading, not legal advice):

| Use | Verdict | Basis |
| --- | --- | --- |
| TMDB genre lookup, no AI in the app | Allowed for non-commercial use | FAQ. Credit TMDB with its logo in About/Credits; cache at most 6 months |
| Genre → look through a fixed table | Probably fine, not stated | 1.C also bans "derivatives" of TMDB content, without defining them |
| TMDB data as AI input, also after fetching it | Not allowed without written permission | 1.C: "in connection with, including for training" an ML or AI based application. 1.A: information obtained from the API is TMDB Content |
| TMDB in an app whose AI never sees TMDB data | Unclear, ask TMDB | The wording covers the application, not only the model's input |
| Deezer data as AI input | Not allowed | III.8 names "using Content as input" |
| Deezer without AI | Possible after approval | Private, non-commercial use; no derivative works |
| iTunes artwork as a light source | Not allowed | Promotional content only, "not for entertainment purposes" |

So for idea 1, either TMDB with a fixed table and no AI, or Wikidata + Wikipedia + TVmaze with optional AI. A TMDB
forum question about inference-only use (2026-07-30) had no staff answer.

Ruled out:

| Source | Why |
| --- | --- |
| TheSportsDB goal lights | Live scores are paid only |
| Met and Art Institute of Chicago paintings | Images or API answered scripts with a bot check |

## Backlog: Bardi / Tuya Wi-Fi bulbs (side project)

For after Phase 4; no code yet. Bardi bulbs are rebranded Tuya devices. Both routes below add a new `ColorSink`
next to `WizLight`, so `SyncEngine` and `calibrate` don't change.

**Route A: stock firmware, Tuya local protocol (no jailbreak)**

- [ ] Get the device id and local key. The Tuya IoT platform can't link the Bardi app, so re-pair the bulb in the
      Smart Life app, link that account to a Tuya IoT cloud project, and run `tinytuya wizard`. Re-pairing changes
      the key.
- [ ] `TuyaLight` in `packages/core/src/tuya/`: TCP port 6668. Protocol 3.1/3.3 uses AES-128-ECB + CRC32, 3.4 adds
      session-key negotiation + HMAC-SHA256, and 3.5 uses AES-GCM with `0x6699` frames. Send a heartbeat about
      every 10 s, reconnect when the connection drops, and send only the newest color while a write is in flight.
      TCP and crypto must be injected interfaces like `UdpSocket` (the core can't import `node:net`/`node:crypto`).
      This shares the injected-crypto work with the WiZ `signingKey` item.
- [ ] Map `WizColor` to data points (DPs). Newer ("v2") lights use 20 on/off, 21 mode (`white`/`colour`),
      22 brightness 10–1000, 23 white temperature 0–1000, and 24 color `HHHHSSSSVVVV` (hue 0–360, saturation and
      value 0–1000). For sync, try 28 `control_data` or 27 `music_data`: the bulb doesn't save these and changes
      color instantly. Older ("v1") lights use DPs 1–5. Read the bulb's DP list first, because it varies.
- [ ] Restore on exit: read the DPs (`DP_QUERY`) before syncing and write them back afterwards.
- [ ] Config: a `bulbs` entry can also be an object, e.g.
      `{ "type": "tuya", "host", "id", "key", "version" }`. Plain IP strings stay WiZ.
- Expect about 5–10 updates per second. A bulb may accept only one local connection, so close the app while
  syncing.
- Protocol references (MIT; clone them into `AmbientLight-references` when work starts):
  `jasonacox/tinytuya` (3.1–3.5) and `codetheweb/tuyapi` (Node.js; 3.5 since 7.7.0).

**Route B: jailbreak to OpenBeken, then DDP**

- [ ] Identify the chip from the module label (e.g. Tuya WB2L = BK7231T, CB2L/CBLC = BK7231N) or a teardown on
      elektroda.com. OpenBeken supports those and several other Tuya chips.
- [ ] Flash over the air with tuya-cloudcutter if the bulb's firmware isn't patched (Tuya patched its SDK in 2022;
      check the project's patched-firmware list). Otherwise open the bulb and flash it over serial, never while
      it's on mains power. The warranty, the cloud and the app are lost, and a bad flash can brick the bulb.
- [ ] Start OpenBeken's DDP driver from the startup command (`startDriver DDP`), because it resets on reboot.
- [ ] `DdpLight` in the core: DDP over UDP 4048, a 10-byte header followed by RGB bytes. DDP has no brightness
      field, so scale `r,g,b` by `dimming`. White mode sends an RGBW payload (OpenBeken 1.17.795 or later drives
      the white channel) or a warm RGB. Needs binary `UdpSocket.send`, which only sends strings today.
- [ ] Restore on exit: the light keeps the last DDP color, so restore it with OpenBeken's Tasmota-style HTTP
      commands (`/cm?cmnd=...`).
- Bonus: the same sink also drives WLED strips.
