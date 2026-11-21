# Development guide

## Setup

Clone the repository, then:

```powershell
cd AmbientLight
npm install
npm run check   # build + type-check tests + run tests
```

Requires Node.js 22.12+ (24 LTS recommended, see `.nvmrc`). `sharp` downloads a prebuilt native binary
during `npm install`. If that fails behind a proxy, see the sharp install docs.

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
| `npm run discover` / `displays` / `color` / `once` / `sync` / `help` | Run the CLI from source |

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
| First `once`/`sync` on Windows is slow | `screenshot-desktop` compiles its helper on first use. Later frames are faster. |
| `Screen capture is unavailable` | Re-run `npm install` so `sharp` fetches its native binary for your platform. |
| Low FPS in `sync -v` | Capture time is the limit. See Phase 3 in `ROADMAP.md` for faster backends. |
