# Handoff: resuming I'm bien light (AmbientLight) somewhere else

Written 2026-11-25. Start here when you continue on another PC, in a cloud session, or after a long break. The facts
also live in the docs listed below; if they disagree, the docs win. The desktop app's own detail (decisions, code
map, MVP plan) is in [docs/HANDOFF_DESKTOP.md](docs/HANDOFF_DESKTOP.md). This file replaces the first handoff of
2026-11-21, whose items are all done.

## 1. Where things stand (2026-11-25)

**Git**

- `origin/main` = `d6bdc52` (game looks, pushed 2026-11-24). CI runs `npm run check` on Windows and Ubuntu.
- **AI look tuning is merged into the local `main` (2026-11-26) but not pushed**, so **another machine sees none of it
  until `main` is pushed** (section 2). `npm run check` passes with it: build, typecheck, 253 of 253 tests
  (2026-11-26).
- Older local branches (`feat/ai-look-tuning`, `feat/color-base-brightness`, `feat/game-looks`,
  `feat/time-based-smoothing`, `fix/teal-scene-color`, `ccr-89d32679-dhyf40`) are fully merged into `main` and can be
  deleted.

**Features**

| Feature | State | Proven how |
| --- | --- | --- |
| Screen sync, CLI (`npm run sync`) | Works | Real bulb: 20 FPS, GDI capture ~32 ms, restore on exit |
| Calibration (white routing, pale colors, muted greens, color base) | Works, Phase 3 still open | Real bulb, by the user's eye; open items in ROADMAP Phase 3 |
| Film looks (`--film`, `--series`, `--look`) | Built | Live APIs, real film frames, fake bulb. **Not yet judged on the real bulb** |
| Game looks (`--game`, `--game-look`) | Built, on `main` | Live Wikipedia (15/16 games); the fast pace felt right on the real bulb |
| Desktop app, demo flow (`npm run desktop`) | Built, on `main` | Real bulb, driven through its API (2026-11-23). **Not yet clicked through by hand** |
| AI look tuning (Gemini or Groq) | Built, on local `main` (**not pushed**) | Fakes and live summaries only. **No real AI answer yet**: `.env` has empty keys, so the model id `gemini-3.5-flash-lite` and the prompt are unproven |
| Rain signal (`npm run rain`) | Parked option | Live weather data, fake bulb |
| Android app | Not started | |

**Deadlines**

- **Thu 2026-11-26:** write-up and demo video (the core feature only). These deliverables live outside git; see
  section 2.
- **Sat 2026-12-12:** live demo of the MVP. Freeze on 12-11.

## 2. Before leaving this PC

Git carries only what is committed and pushed. Everything in this table stays behind unless you copy it.

| What | Where (this PC) | Needed for |
| --- | --- | --- |
| The AI-tuning work | Local `main` (merged 2026-11-26) | `git push origin main` |
| CLI config (bulb address, calibration) | `ambientlight.config.json` in the repo root (git-ignored) | Copy it, or rebuild it from `ambientlight.config.example.json` |
| AI keys | `.env` in the repo root (git-ignored; both keys empty on 2026-11-25) | Copy it if keys were added. Never commit it |
| Desktop app settings | `%APPDATA%\AmbientLight\ambientlight.config.json` (and `.env` there, if used) | Optional: a first start copies the CLI config |
| Title and AI answer cache | `%LOCALAPPDATA%\AmbientLight\titles` | Optional: rebuilds itself, but it lets the demo titles work offline |
| Hackathon write-up, video script, ffmpeg edit pipeline, raw clips | `C:\AI_Sandbox\Project\AmbientLight-hackathon\` | Private, never in git. Has its own `HANDOFF.md`. Copy the whole folder |
| The 16 reference repos | `C:\AI_Sandbox\Project\AmbientLight-references\` | Re-clone them (section 3) |
| Claude Code's memory of earlier sessions | `%USERPROFILE%\.claude\projects\C--AI-Sandbox-Project-AmbientLight\memory\` | Optional: section 6 has what matters. The folder name follows the project path |

## 3. Set up in the new place

### Another Windows PC

Needs Windows 10/11 (the GDI capture helper is compiled with the `csc.exe` that ships with Windows), Node.js 22.12+
(this PC: Node 26.13.1, npm 12.2.3), git, and optionally the GitHub CLI and ffmpeg (for the video).

```powershell
mkdir C:\AI_Sandbox\Project; cd C:\AI_Sandbox\Project   # the same path keeps the docs' paths valid
git clone https://github.com/egaexplorer/AmbientLight.git
cd AmbientLight
npm install
npm run check                        # must be green (253 tests on 2026-11-26)
copy ambientlight.config.example.json ambientlight.config.json   # or the copied one
npm run discover                     # the bulb's address can differ on another network
npm run check-bulb                   # must end with "Ready"
```

- Set the git identity used so far: user name `egaexplorer` with the same email as earlier commits.
- **WiZ app:** Settings → Security → "Allow local communication" on, and "Allow All Control" (not "Only verified
  controls"). Otherwise the bulb rejects colors and `check-bulb` reports `needs-signing`.
- Windows asks whether Node.js and Electron may use the network; allow on Private networks. On the old PC it worked
  either way.
- `npm run desktop`: npm 12 may not fetch Electron's binary; the first start downloads it (~100 MB).
- The first search after the bulb powers on can miss it while it joins Wi-Fi. Search again.
- **If the light looks dim in the new room**, raise `calibration.colorBaseBrightness` from 10 to 30 or 50. That was
  the user's own plan for when the bulb or the PC moves farther away.
- References, read-only and outside the repo (shallow clones are enough):

  ```powershell
  mkdir C:\AI_Sandbox\Project\AmbientLight-references; cd C:\AI_Sandbox\Project\AmbientLight-references
  foreach ($r in "one-adnan/ambient-setup","namanb-lab/wiz-sync","MihirGupta07/wiz-sync","awawa-dev/HyperHDR",
    "uditkarode/wikari","noturbob/wiz-pc","shikhar13012001/wiz-led-nodejs","sbidy/pywizlight",
    "kpsuperplane/homebridge-wiz-lan","GreenSky-Productions/SignalRGB-WIZ-Network-Plugin",
    "hyperion-project/hyperion.ng","psieg/Lightpack","kershner/screenBloom","nashaofu/node-screenshots",
    "evanwhitt/hyperion-android-reborn","tradle/react-native-udp") {
    git clone --depth 1 "https://github.com/$r.git" ($r -replace "/","__")
  }
  ```

### A cloud session (Claude Code on the web)

- It sees only what was pushed, so push `main` first.
- It can build and run the tests (`npm run check` works on Linux; CI runs it on Ubuntu) and run Electron under Xvfb
  against a fake bulb (DEVELOPMENT, "The desktop app"). Linux is only for running tests; never build or package for
  it.
- It can't reach the bulb, capture a Windows screen, or see the hackathon folder and the references. For bulb
  behavior, ask the user to run `npm run state` / `npm run once` on the PC and paste the output.

## 4. Next steps, in order

**A. By Thu 2026-11-26 (write-up and video).** The write-up already presents AI tuning as built, so step 1 matters.

1. **A real AI answer.** Put a free Gemini key in `.env` (<https://aistudio.google.com/apikey>), check which models
   the key may use, then try Pengabdi Setan, Agak Laen, a romance and DreadOut with `npm run once -- --film "..."`
   (DEVELOPMENT, "Testing AI look tuning"). If the model id is wrong, fix it in `packages/node/src/ai.ts`.
2. ~~Commit `feat/ai-look-tuning` and merge it into `main`~~ (done 2026-11-26). Push `main` when the user approves.
3. Judge the film looks on the real bulb, above all horror (too dark?), romance and animation.
4. Click through the desktop app once by hand and answer Electron's firewall prompt (HANDOFF_DESKTOP, step A).
5. Record the video and render it (the hackathon folder's `HANDOFF.md`). The CLI is the fallback if the app
   misbehaves. Since 2026-11-26 the film scenes play on Netflix in Chrome (One Punch Man S1E12, Fear Street Part One:
   1994); the script `naskah-video.md` has the minutes.

**B. 2026-11-27 → 12-10: the desktop MVP** (HANDOFF_DESKTOP, step B): setup wizard, Bulbs page with check report and
power, Tuning page that applies live, display picker, tray, Diagnostics, About with data credits, CLI `sync` on
`SyncSession`, NSIS installer. Then a `desktopCapturer` benchmark against GDI. Freeze 12-11, demo 12-12.

**C. After the demo:** presets, letterbox detection, HUD and center weighting for games, night watching, Android
(React Native reusing the core). Bardi/Tuya bulbs stay a docs-only backlog item until the WiZ work is done.

## 5. What to read first

| File | What it holds |
| --- | --- |
| `CLAUDE.md` | Rules for coding assistants: core stays platform-agnostic, `.js` suffixes, docs in the same change |
| `README.md` | What a user can do: commands, config keys, film/game looks, AI tuning, desktop app |
| `docs/ROADMAP.md` | Every phase as a checklist with measurements and the user's choices |
| `docs/ARCHITECTURE.md` | Pipeline, packages, design decisions (15 capture, 16 game looks, 17 AI tuning) |
| `docs/DEVELOPMENT.md` | Scripts, tests, fake bulb, measuring the desktop app, testing looks and AI, troubleshooting |
| `docs/WIZ_PROTOCOL.md` | The bulb's protocol and measured behavior (signing, pale colors, discovery) |
| `docs/UI_DESIGN.md` | Desktop screens, design tokens, what is built |
| `docs/HANDOFF_DESKTOP.md` | Desktop app decisions, code map, gotchas, MVP plan |
| `docs/REFERENCE_NOTES.md`, `docs/PROJECT_GUIDE.md` | What each reference teaches; licenses (never copy GPL-3.0 or unlicensed code) |

## 6. Working agreements from earlier sessions

- **Measure the bulb before changing bulb or protocol behavior.** Ask for `npm run state` readings of colors set in
  the WiZ app; keep the readings as test fixtures. Reference libraries were wrong for this firmware before.
- **Check that the user isn't testing** before any bulb command or full-screen test scene: is `electron.exe`
  running? Read `npm run state` first and restore that state at the end; never end a test with `npm run off`.
- **Explain trade-offs before asking for a choice:** where the time or cost goes, what each option changes, a small
  table.
- **Commit and push only when asked.** An earlier OK doesn't cover the next push.
- **Never present untested work as working.** Say what was measured, on what, and how.
- Commands given to the user must work from any folder.
- When tuning colors, show how far a change reaches into other scenes. The user judges a scene by its "vibe"
  (a muted olive doorway should light the room cool white); treat that as a wish for the mapping and offer an A/B on
  the bulb.
- Check an API's terms before suggesting it and quote the clause (TMDB data may not feed an AI).
- Don't add contact details to the Wikimedia User-Agent until the user says so (asked, not answered).
- The hackathon write-up is in Indonesian; code, docs and commits stay in English.

## 7. Paste-ready opening message for the new session

> Continue AmbientLight. Read `CLAUDE.md` and `HANDOFF.md` first, then `docs/HANDOFF_DESKTOP.md` and the docs they
> point to. AI look tuning is on `main` (built but never run with a real key). Next: a
> real Gemini answer, then judging the film looks on the real bulb, then the demo video; after that the desktop MVP
> for the live demo on 2026-12-12. Before driving the bulb or showing test scenes, check that I'm not using the app.
> Run `npm run check` before and after changes, and update the docs in the same change. Targets are Windows and
> Android only.
