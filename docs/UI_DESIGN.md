# UI design (desktop app)

The screens of the Windows desktop app (`apps/desktop`, Electron), the reasons behind their look, and the tools
used to design them. The plan and milestones are in [ROADMAP.md](ROADMAP.md#phase-4-desktop-app-electron-and-android-port-react-native-);
the process model and IPC are in [ARCHITECTURE.md](ARCHITECTURE.md).

**Targets: Windows (PC) and Android only.** macOS, Linux and iOS are not designed for.

## Wireframes

Clickable wireframes of every screen (private Claude artifact, opened by its owner; comment on any element to ask for
a change): <https://claude.ai/artifact/9de8MxMAdW5DoCv6J7tHWN>

| Artboard | Milestone | What it shows |
| --- | --- | --- |
| Home | Demo flow (2026-11-26) | Start/Stop, live colors, film look, bulbs strip |
| Find bulbs dialog | Demo flow | Discovery results, Blink, add by IP, firewall hint when nothing answers |
| Bulbs | MVP (2026-12-12) | One card per bulb: power, Blink, Check report, remove |
| Tuning | MVP | Sliders for the calibration and sync options, reset per slider |
| First-run setup wizard | MVP | WiZ app checklist, find bulbs, display, done |
| Diagnostics | MVP | The analyzed 64×36 frame, live numbers, recent events, save frame |
| About | MVP | App options, data credits and privacy, references |
| Tray menu | MVP | Status, Stop sync, Look, bulbs off, open, quit |

The wireframe is the spec. Values in `[brackets]` are placeholders for data the bulb or the PC reports. Sample
numbers come from measurements in [ARCHITECTURE.md](ARCHITECTURE.md#latency-budget) (20.0 fps, 32 ms capture,
14 % of frames sent).

## Rules behind the look

- **Dark, neutral gray, and the only color is the light itself.** The window is captured while it is on screen. In
  the default `dominant` color mode gray pixels never vote for the hue, so a gray UI doesn't change the bulb's color.
  It still darkens the average, so "Hide window while syncing" is on by default.
- **One big Start/Stop control**, as in Hue Sync and the references (ambient-setup, MihirGupta07/wiz-sync,
  namanb-lab/wiz-sync; see [REFERENCE_NOTES.md](REFERENCE_NOTES.md#ui-study-2026-11-23)).
- **Plain words first, numbers second.** Tuning labels say what a setting does ("Reaction speed", "Color base
  brightness"); the config key appears only in the spec below. Hints come from the README's tuning tips.
- **Advanced settings are collapsed.** Most people need bulbs, a look and Start.
- **Accessible as drawn:** real buttons, labels and links, 44 px targets, text at 4.5:1 or more.

### Tokens

| Token | Value | Use |
| --- | --- | --- |
| Background | `#111214` | Window |
| Sidebar | `#0c0d0f` | Navigation |
| Card | `#17181b`, border `#26282d` | Sections |
| Field | `#0f1012`, border `#34363c` | Inputs, inner panels |
| Text | `#e8e8ea` | Body |
| Muted text | `#9a9da5` | Labels, hints |
| Primary button | `#e8e8ea` on `#111214` text | Start sync, Next |
| Secondary button | `#1e2024`, border `#3a3c42` | Everything else |
| Ready badge | border `#3d5a46`, text `#9fdcb4` | `checkBulb` verdict `ready` |
| Problem badge | border `#6b4b25`, text `#f2c48d` | Other verdicts |
| Font | Inter 400–700 | Everything; tabular numbers for live values |

Radius 14 px for cards, 9–10 px for controls. The window opens at 1000×680 and can shrink to 860×580.

## Screen spec

What backs each control. "IPC" names the `window.ambient` call (see ARCHITECTURE).

| Screen | Control | Backed by |
| --- | --- | --- |
| Home | Start/Stop sync | IPC `sync.start` / `sync.stop` → `SyncSession` (restores the bulbs on stop) |
| Home | Live colors: screen average, hue source, bulb | `sync:frame` events (`FrameReport.average`, `.color`, `previewRgb(output)`), 10 per second |
| Home | Status pill and stats | `sync:state`, fps and capture ms from `sync:frame` |
| Home | Film / Series / Pick a look | IPC `film.find` (`findTitle`, Wikipedia or TVmaze, cached) → `lookForGenres`; or a look chip (`LOOK_NAMES`, `FILM_LOOKS`) |
| Home | Bulbs strip | `bulbs` in the config; Find bulbs opens the dialog |
| Find bulbs | Search again | IPC `bulbs.discover` (`discoverBulbs` on every adapter's broadcast address) |
| Find bulbs | Blink | IPC `bulbs.identify` (`identifyBulb`: flash and restore) |
| Find bulbs | Add by IP, Use N bulbs | IPC `config.save` (`bulbs`) |
| Bulbs | Power | IPC `bulbs.power` (`turnOn` / `turnOff`) |
| Bulbs | Check | IPC `bulbs.check` (`checkBulb` report and verdict) |
| Tuning | Reaction speed, Scene cut, Updates per second, Colorful areas count more | `smoothing`, `sceneCut`, `fps`, `colorWeighting` |
| Tuning | Saturation boost, Color depth, Muted green correction, White in pale colors | `calibration.saturationBoost`, `.gamma`, `.mutedGreenCorrection`, `.paleWhite` |
| Tuning | Max/Min brightness, Color base brightness, Dark scene curve | `calibration.maxDimming`, `.minDimming`, `.colorBaseBrightness`, `.brightnessGamma` |
| Tuning | White temperature, Use white LEDs below | `calibration.whiteTemp`, `.whiteSaturation` |
| Tuning | Advanced | `colorMode`, `minChange`, `keepAliveMs`, `calibration.blackThreshold`, `sampleWidth`/`sampleHeight`, `capture`, `restoreOnExit`, `screen` |
| Tuning | Any change | IPC `config.save`, then `SyncSession.update` while syncing |
| Setup | WiZ app checklist | Static text (the settings `check-bulb` tests for) |
| Setup | Display | IPC `displays.list` (screenshot-desktop's display ids, as `npm run displays`) → `screen` |
| Diagnostics | Analyzed frame, Save frame | The frame behind `FrameReport`, sent only while the page is open; PNG through Electron's `nativeImage` |
| About | Start with Windows, close to tray, hide while syncing | App settings (not in `ambientlight.config.json`) |

The rain signal (on hold) has no screen.

## Google Stitch brief

Paste this into [Google Stitch](https://stitch.withgoogle.com/) to explore other visual styles. The wireframe stays
the spec for content and behavior; take only looks from Stitch.

```text
Design a Windows desktop app, window 1000x680, dark theme, called AmbientLight. It syncs a Philips WiZ smart bulb
to the colors on the PC screen. The UI must be neutral dark gray with no colored accents, because the app window
is captured while visible: the only colors on screen are live color swatches showing the light.

Layout: left sidebar (Home, Bulbs, Tuning, Diagnostics, About), content on the right.

Home screen:
1. A large round Start sync / Stop sync button, with "Primary display to 1 bulb" under it.
2. Live colors: three swatches labeled Screen average, Hue source (dominant), Bulb shows, each with a hex value,
   and a line "20.0 fps · capture 32 ms · 14 % of frames sent". A status pill "Idle" or "Syncing · 20.0 fps".
3. Film look card: a segmented control Film | Series | Pick a look, a title field with a Find button, a result line
   (title, genre, source Wikipedia CC BY-SA 4.0, chosen look), and 9 look chips in a 3-column grid: No look,
   Horror, Thriller, Romance, Animation, Comedy, Sci-fi, Action, Drama, each with one detail line
   (e.g. "Up to 45 % · 6500 K · pale, dim").
4. A bulbs strip: a chip with a color dot, "192.168.1.50" and "Ready", a Find bulbs button and a
   "Hide window while syncing" checkbox.

Use Inter, 44 px touch targets, 4.5:1 text contrast, no gradients, no emoji.
```

## AI design tools

State as of 2026-11 (prices from comparison articles; check the sites before paying):

| Tool | Good for | Cost and export |
| --- | --- | --- |
| Claude artifact (used here) | A clickable wireframe you can comment on, then the real code | Included |
| [Google Stitch](https://stitch.withgoogle.com/) | Text or sketch → hi-fi screens; exploring visual styles | Free (~350 generations a month); exports to Figma and HTML/Tailwind, the code is a scaffold |
| [v0](https://v0.app/) | Screens → React + Tailwind + shadcn/ui components, the desktop app's stack | Small free credit, Plus $30 a month |
| [Figma Make](https://www.figma.com/make/) | Prompt → React prototype inside Figma | Credits within Figma plans |
| [Visily](https://www.visily.ai/), [Uizard](https://uizard.io/) | Fast multi-screen wireframes, screenshot → wireframe | Free tiers; Pro about $11–14 a month |
| [UX Pilot](https://uxpilot.ai/) | Wireframes and flows in Figma | About $6–14 a month |
| [Excalidraw](https://excalidraw.com/) | Hand-drawn wireframes, text to diagram | Free |

Galileo AI no longer exists as a standalone product, so older lists that include it are out of date.
