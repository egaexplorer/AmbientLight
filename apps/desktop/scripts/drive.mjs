// Drives the running desktop app through the Chrome DevTools protocol, for measurements on the real bulb without
// clicking. Development only. Start the app with a debugging port first (see docs/DEVELOPMENT.md):
//   npm run dev -w @ambientlight/desktop -- --remoteDebuggingPort 9222
// Then:
//   node apps/desktop/scripts/drive.mjs eval "window.ambient.discover()"   any expression; promises are awaited
//   node apps/desktop/scripts/drive.mjs measure 60 [none|horror|...]       sync N seconds, stop, print stats
// The stats come from the frame views (about 8 a second). For every frame, start the app with AMBIENTLIGHT_VERBOSE=1.
// Needs Node.js 22 or later (built-in WebSocket). DRIVE_PORT picks another port.
const port = process.env.DRIVE_PORT ?? "9222";
const [, , command, ...args] = process.argv;

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((target) => target.type === "page");
if (!page) throw new Error(`No page on port ${port}. Is the app running with --remoteDebuggingPort ${port}?`);

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve);
  socket.addEventListener("error", reject);
});
let lastId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  pending.get(message.id)?.(message);
  pending.delete(message.id);
});

async function evaluate(expression) {
  const id = ++lastId;
  const message = await new Promise((resolve) => {
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  if (message.error) throw new Error(message.error.message);
  const { result, exceptionDetails } = message.result;
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

async function measure(seconds, look) {
  await evaluate(`(() => {
    window.__drive?.();
    window.__frames = [];
    window.__states = [];
    const offFrame = window.ambient.onFrame((f) => window.__frames.push({ ...f, t: performance.now() }));
    const offState = window.ambient.onState((s) => window.__states.push(s));
    window.__drive = () => { offFrame(); offState(); };
  })()`);
  if (look) await evaluate(`window.ambient.setLook(${look === "none" ? "null" : JSON.stringify({ name: look })})`);
  await evaluate("window.ambient.startSync()");
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  const frames = await evaluate("window.__frames");
  await evaluate("window.ambient.stopSync()");
  const states = await evaluate("(window.__drive(), window.__states)");
  // The fps counter needs a full second before it reads right.
  const fps = frames.filter((f) => f.t - frames[0].t > 2000).map((f) => f.fps);
  const capture = frames.map((f) => f.captureMs);
  return {
    views: frames.length,
    fps: { min: Math.min(...fps), p50: percentile(fps, 50), max: Math.max(...fps) },
    captureMs: { p50: percentile(capture, 50), p95: percentile(capture, 95), max: Math.max(...capture) },
    sentShare: frames.at(-1)?.sentShare,
    last: frames.at(-1) && { screen: frames.at(-1).screen, bulb: frames.at(-1).bulb, bulbText: frames.at(-1).bulbText },
    states: states.map((s) => s.sync).join(" > "),
    errors: [...new Set(states.map((s) => s.error).filter(Boolean))],
    notRestored: states.at(-1)?.notRestored ?? [],
  };
}

try {
  if (command === "eval") console.log(JSON.stringify(await evaluate(args.join(" ")), null, 2));
  else if (command === "measure") console.log(JSON.stringify(await measure(Number(args[0] ?? 30), args[1]), null, 2));
  else throw new Error('Commands: eval "<expression>", measure <seconds> [look]');
} finally {
  socket.close();
}
