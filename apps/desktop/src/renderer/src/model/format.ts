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
