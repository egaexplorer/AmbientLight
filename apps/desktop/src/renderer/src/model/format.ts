import type { AppState, FrameView, TitleKind, TitleResult } from "../../../shared/api";

export function statusText(state: AppState | null, frame: FrameView | null): string {
  switch (state?.sync) {
    case "starting":
      return "Starting…";
    case "running":
      return frame && frame.fps > 0 ? `Syncing · ${frame.fps.toFixed(1)} fps` : "Syncing";
    case "stopping":
      return "Stopping…";
    default:
      return "Idle";
  }
}

export function statsText(frame: FrameView | null): string {
  if (!frame) return "Press Start sync. The bulb returns to its previous state when you stop.";
  const fps = frame.fps > 0 ? `${frame.fps.toFixed(1)} fps` : "-- fps";
  return `${fps} · capture ${frame.captureMs} ms · ${Math.round(frame.sentShare * 100)} % of frames sent`;
}

/** "70 % · bulb up to 45 %": the brightness setting, then the top brightness it gives with the current look. */
export function brightnessText(value: number, cap: number): string {
  return `${value} % · bulb up to ${cap} %`;
}

/** A MAC as discovery reports it (`9877d56c94fe`), written in the usual pairs; a dash when unknown. */
export function macText(mac: string | undefined): string {
  if (!mac) return "—";
  const pairs = /^[0-9a-f]{12}$/i.test(mac) ? mac.toLowerCase().match(/../g) : null;
  return pairs ? pairs.join(":") : mac;
}

const SERVICE: Record<TitleKind, string> = { film: "Wikipedia", series: "TVmaze" };

/** The advice for a failed title lookup, worded for the app (the error codes come from @ambientlight/node). */
export function titleErrorText(kind: TitleKind, title: string, result: Extract<TitleResult, { ok: false }>): string {
  switch (result.code) {
    case "no-title":
      return `Type a ${kind === "film" ? "film" : "series"} title first.`;
    case "offline":
      return `Can't reach ${SERVICE[kind]}. Pick a look below instead.`;
    case "rate-limited":
      return `${SERVICE[kind]} is limiting lookups. Try again in ${result.retryAfterS ?? 60} s, or pick a look below.`;
    case "not-found": {
      const similar = result.similar.slice(0, 3).map((t) => `“${t}”`).join(", ");
      const other = kind === "film" ? "Series" : "Film";
      return (
        `No ${kind} called “${title.trim()}” found.${similar ? ` Close: ${similar}.` : ""} ` +
        `Use the full title, add the year like “Dune (1984)”, or switch to ${other}.`
      );
    }
    case "no-genre":
      return "Found it, but its description names no genre the looks know. Pick a look below.";
    default:
      return `The lookup failed (${result.message}). Pick a look below.`;
  }
}
