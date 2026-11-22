# Development guide

## Setup

Clone the repository, then:

```powershell
cd AmbientLight
npm install
npm run check   # build + type-check tests + run tests
```

Requires Node.js 22.12+ (24 LTS recommended, see `.nvmrc`). `sharp` (used by the `screenshot-desktop` capture
fallback) downloads a prebuilt native binary during `npm install`. If that fails behind a proxy, see the sharp
install docs. The default Windows capture needs no npm package: its helper is compiled on first use with the
`csc.exe` that ships with Windows.

To time capture on your machine, run `npm run sync -- -v` (each line shows `capture N ms`), or put a few
`await capturer.capture()` calls of `GdiCapturer` / `DesktopCapturer` in a scratch `.mts` script and run it with
`npx tsx --conditions=development`.

`package-lock.json` is committed, and CI installs with `npm ci`. Commit lockfile changes along with any
dependency change.

## Scripts (repository root)

| Script | Description |
| --- | --- |
| `npm run build` | `tsc -b`: builds `packages/core` then `apps/pc-cli` into their `dist/` folders |
| `npm run clean` | Removes build output |
| `npm test` | Runs all `*.test.ts` with Node's built-in test runner (via `tsx`) |
| `npm run typecheck` | Type-checks source and tests together (`tsconfig.tests.json`) |
| `npm run check` | build + typecheck + test (what CI runs) |
| `npm run discover` / `check-bulb` / `state` / `displays` / `color` / `once` / `sync` / `help` | Run the CLI from source (`check-bulb` runs the CLI's `check` command; `npm run check` is the build + test script) |

Pass CLI flags after `--`: `npm run sync -- --bulb 192.168.1.50 -v`.
To run the compiled CLI instead: `npm run build`, then `node apps/pc-cli/dist/main.js sync`.

## How the workspace is wired

- **npm workspaces:** `packages/core` and `apps/pc-cli`. The CLI depends on `@ambientlight/core`, which npm
  links locally.
- **TypeScript project references:** the root `tsconfig.json` references both packages, and `apps/pc-cli`
  references `packages/core`. Shared compiler options live in `tsconfig.base.json` (strict, `NodeNext`, ES2023).
- **`development` export condition:** `@ambientlight/core` exports `./src/index.ts` under the `development`
  condition and `./dist/index.js` otherwise. Dev scripts and tests run `tsx --conditions=development`, so
  edits to the core apply immediately without a build. The compiler (`customConditions`) resolves it the
  same way.

## Conventions

- ESM everywhere (`"type": "module"`). Relative imports use the **`.js` suffix** (`./light.js`), as NodeNext requires.
- `strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax`: use `import type` for types.
- **The core stays platform-agnostic.** Don't import `node:*` and don't use `Buffer`, `console`, or DOM APIs.
  Timers go through `platform/timers.ts`. The core's `"types": []` makes violations fail to compile.
- Platform-specific code lives in `apps/*` behind the core's interfaces (`UdpSocket`, `ScreenCapturer`, `ColorSink`).
- Line endings are LF (enforced by `.gitattributes` and `.editorconfig`).

## Tests

- Framework: `node:test` + `node:assert/strict`, run through `tsx` (no extra test dependency).
- Tests live in `<package>/test/*.test.ts`. Core fakes are in `packages/core/test/helpers.ts`: `FakeSocket`
  (in-memory UDP with scripted replies), `FakeCapturer`, `FakeClock`, `RecordingSink`, `solidFrame`.
- Tests need no bulb, screen, or network.
- Run a single file: `npx tsx --conditions=development --test packages/core/test/color.test.ts`.
- The GDI capture helper needs a real screen, so tests cover only its byte-stream handling (`FrameAssembler`).
  After changing `native/gdi-capture.cs` or `gdi-capture.ts`, check capture time and colors by hand with `sync -v`.

## Debugging a scene

When the light looks wrong on a particular shot, save the pixels the analysis saw (a 64×36 lossless PNG). Pause on
the shot, run this, and switch to the full-screen video before the 5 seconds are up, so that the terminal and the
player's controls aren't captured:

```powershell
Start-Sleep 5; npm run once -- --save-frame "$env:TEMP\lamp.png"
```

`once` also sends that color to the bulb and prints the screen average, the hue source, and what was sent. A
relative path starts in the folder you ran npm from. Saved frames show whatever was on screen, so keep them out
of git.

Phone footage of the screen can show *when* the light changes, but not *why*, and never what color the screen is:
under a warm bulb, exposure and white balance make the screen look brighter and bluer. Measured on 2026-11-22
with the same paused shots (average of the screen):

| Shot | Saved frame | Phone photo |
| --- | --- | --- |
| Wall lamps | `23,18,16` (near-black brown) | `64,81,91` (blue) |
| Doorway | `32,35,25` (dark olive) | `79,105,113` (teal) |

The display's gamma ramp was neutral, so it doesn't explain the difference.

## Trying it without a bulb

A tiny fake bulb is handy when you change protocol code:

```js
// fake-bulb.mjs (run with: node fake-bulb.mjs, then: npm run sync -- --bulb 127.0.0.1 -v)
import dgram from "node:dgram";
const s = dgram.createSocket("udp4");
s.on("message", (msg, r) => {
  console.log(msg.toString());
  const { method } = JSON.parse(msg.toString());
  const result = method === "getPilot" ? { state: true, sceneId: 0, temp: 2700, dimming: 60 } : { success: true };
  s.send(JSON.stringify({ method, env: "pro", result }), r.port, r.address);
});
s.bind(38899, "127.0.0.1");
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `discover` finds nothing | Allow Node.js through Windows Defender Firewall (Private). Make sure the PC and bulb share a subnet (guest Wi‑Fi and mesh "IoT" networks often isolate devices). Turn on "Allow local communication" in the WiZ app. |
| `color` works but `sync` says the state can't be read | Same firewall issue (inbound replies are blocked). Sync still works; only restore-on-exit is skipped. |
| First `once`/`sync` on Windows takes ~0.3 s longer | The `"gdi"` capture compiles its helper (`apps/pc-cli/native/gdi-capture.cs`) into `%LOCALAPPDATA%\AmbientLight\gdi-capture-<hash>.exe` on first use. Later runs reuse it; changing the source builds a new one. Delete the folder to force a rebuild. |
| `Couldn't compile the screen capture helper` / `Can't find the C# compiler` | The `"gdi"` capture needs `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe` (part of Windows 10/11). Use `--capture screenshot-desktop` meanwhile. |
| `Screen capture is unavailable` | Only the `screenshot-desktop` fallback uses `sharp`. Re-run `npm install` so it fetches its native binary for your platform. |
| Low FPS in `sync -v` | Capture time is the limit. With `"capture": "gdi"` it is ~20–35 ms; `screenshot-desktop` takes ~370 ms per frame on Windows (it compiles its helper on every frame). |
| `'screenCapture_1.3.3.bat' is not recognized` (screenshot-desktop) | The environment variable `NoDefaultCurrentDirectoryInExePath` is set (some agent and CI shells set it), so `cmd.exe` won't run the `.bat` that screenshot-desktop starts by bare name from its folder. Unset it for that command, or use the `"gdi"` capture, which starts its helper by full path. |
