import { type FormEvent, useEffect, useRef, useState } from "react";
import type { AppState, FrameView, LookChoice, TitleKind } from "../../../shared/api";
import { api } from "../api";
import { Button, Card, Swatch } from "../components/ui";
import { brightnessText, statsText, statusText, titleErrorText } from "../model/format";
import { gameLookChips, lookChips, lookLabel, sameLook, tuningText } from "../model/looks";

type LookMode = TitleKind | "pick";

const MODES: ReadonlyArray<readonly [LookMode, string]> = [
  ["film", "Film"],
  ["series", "Series"],
  ["game", "Game"],
  ["pick", "Pick a look"],
];

const TITLE_FIELD: Record<TitleKind, { label: string; placeholder: string }> = {
  film: { label: "Film title (Wikipedia)", placeholder: "e.g. Pengabdi Setan, or Dune (1984)" },
  series: { label: "Series title (TVmaze)", placeholder: "e.g. Wednesday" },
  game: { label: "Game title (Wikipedia)", placeholder: "e.g. DreadOut, or Doom (2016)" },
};

const MINIMIZE_KEY = "ambientlight.minimizeWhileSyncing";

function readMinimize(): boolean {
  try {
    return localStorage.getItem(MINIMIZE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function Home({ state, frame, onFindBulbs }: { state: AppState | null; frame: FrameView | null; onFindBulbs(): void }) {
  const sync = state?.sync ?? "idle";
  const running = sync === "running";
  const busy = sync === "starting" || sync === "stopping";
  const live = running ? frame : null;

  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [minimize, setMinimize] = useState(readMinimize);

  useEffect(() => {
    try {
      localStorage.setItem(MINIMIZE_KEY, String(minimize));
    } catch {
      // Only a convenience: without storage the box starts checked again.
    }
  }, [minimize]);

  async function toggleSync() {
    setPending(true);
    setActionError(null);
    try {
      if (running) {
        await api.stopSync();
      } else {
        await api.startSync();
        if (minimize) await api.minimizeWindow();
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  }

  const problem = actionError ?? state?.error ?? null;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-2xl font-bold">Home</h1>
        <span role="status" className="inline-flex items-center gap-2 rounded-full border border-[#2e3036] bg-control px-3 py-1.5 text-[13px] text-soft">
          <span aria-hidden="true" className="size-2 rounded-full" style={{ background: running ? "#6fcf97" : "#6b6e76" }} />
          {statusText(state, live)}
        </span>
      </header>

      <Card label="Sync" className="flex flex-wrap items-center gap-7">
        <div className="flex flex-none flex-col items-center gap-2.5">
          <button
            type="button"
            onClick={() => void toggleSync()}
            disabled={pending || busy || !state}
            className={`size-[136px] cursor-pointer rounded-full border-[6px] text-base font-bold disabled:cursor-default disabled:opacity-60 ${
              running ? "bg-control text-ink-strong" : "bg-ink text-bg hover:bg-white"
            }`}
            style={{ borderColor: live?.bulb ?? "#2e3036" }}
          >
            {running ? "Stop sync" : sync === "starting" ? "Starting…" : sync === "stopping" ? "Stopping…" : "Start sync"}
          </button>
          <span className="text-[13px] text-muted">
            Primary display to {state?.bulbs.length ?? 0} bulb{state?.bulbs.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-3.5">
          <h2 className="m-0 text-[15px] font-semibold">Live colors</h2>
          <div className="grid grid-cols-3 gap-3">
            <Swatch color={live?.screen} label="Screen average" value={live?.screen ?? "—"} />
            <Swatch color={live?.hue} label="Hue source (dominant)" value={live?.hue ?? "—"} />
            <Swatch color={live?.bulb} label="Bulb shows" value={live ? `${live.bulb} · ${live.bulbText}` : "Not syncing"} />
          </div>
          <p className="m-0 text-[13px] tabular-nums text-muted">{statsText(live)}</p>
          {problem && (
            <p role="alert" className="m-0 rounded-[10px] border border-warn-line bg-field px-3.5 py-2.5 text-[13px] text-warn">
              {problem}
            </p>
          )}
          {running && state && state.notRestored.length > 0 && (
            <p className="m-0 text-xs text-muted">
              Couldn't read {state.notRestored.join(", ")} at the start, so it won't be restored when you stop.
            </p>
          )}
          <BrightnessControl state={state} />
        </div>
      </Card>

      <LookCard state={state} />

      <Card label="Bulbs" className="flex flex-wrap items-center gap-3.5 py-[18px]">
        <h2 className="m-0 text-[15px] font-semibold">Bulbs</h2>
        {state?.bulbs.length ? (
          state.bulbs.map((ip) => (
            <span key={ip} className="inline-flex items-center gap-2 rounded-full border border-[#2e3036] bg-control px-3 py-2 text-[13px] tabular-nums">
              <span aria-hidden="true" className="size-3 rounded-full border border-control-line" style={{ background: live?.bulb ?? "#1e2024" }} />
              {ip}
            </span>
          ))
        ) : (
          <span className="text-[13px] text-muted">No bulb yet</span>
        )}
        <Button className="ml-auto" onClick={onFindBulbs} disabled={busy}>
          Find bulbs
        </Button>
        <label className="inline-flex min-h-11 items-center gap-2 text-[13px] text-soft">
          <input type="checkbox" checked={minimize} onChange={(e) => setMinimize(e.target.checked)} className="size-[18px] accent-soft" />
          Minimize while syncing
        </label>
      </Card>
    </>
  );
}

/** Sends at most one change per this many ms while the slider moves; each restarts the sync engine. */
const BRIGHTNESS_SEND_MS = 150;

function BrightnessControl({ state }: { state: AppState | null }) {
  // The value under the thumb while it moves; null shows the saved one.
  const [dragged, setDragged] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // The first change goes out at once, later ones at most every BRIGHTNESS_SEND_MS, and the last one always.
  function flush() {
    const value = pending.current;
    if (value === null) {
      timer.current = null;
      setDragged(null);
      return;
    }
    pending.current = null;
    api.setBrightness(value).then(
      () => setError(null),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
    timer.current = setTimeout(flush, BRIGHTNESS_SEND_MS);
  }

  function change(value: number) {
    setDragged(value);
    pending.current = value;
    if (!timer.current) flush();
  }

  const value = dragged ?? state?.brightness ?? 70;
  return (
    <div className="flex flex-col gap-1 border-t border-line pt-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label htmlFor="brightness" className="text-[13px] font-semibold">
          Brightness
        </label>
        <span className="text-[13px] tabular-nums text-ink-strong">{brightnessText(value, state?.brightnessCap ?? 100)}</span>
      </div>
      <input
        id="brightness"
        type="range"
        min={10}
        max={100}
        step={1}
        value={value}
        disabled={!state}
        onChange={(e) => change(Number(e.target.value))}
        aria-describedby="brightness-hint"
        className="h-11 w-full cursor-pointer accent-soft"
      />
      <span id="brightness-hint" className="text-xs text-muted">
        70 % is the look as designed. Higher brightens it.
      </span>
      {error && (
        <p role="alert" className="m-0 text-[13px] text-warn">
          {error}
        </p>
      )}
    </div>
  );
}

function LookCard({ state }: { state: AppState | null }) {
  // Opens on the tab whose chips show the look in use.
  const [mode, setMode] = useState<LookMode>(() => (state?.look?.set === "game" ? "game" : "film"));
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const look = state?.look ?? null;

  async function find(event: FormEvent) {
    event.preventDefault();
    if (mode === "pick") return;
    setSearching(true);
    setMessage(null);
    try {
      const result = await api.findTitle(mode, query);
      if (!result.ok) setMessage(titleErrorText(mode, query, result));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSearching(false);
    }
  }

  async function pick(choice: LookChoice | null) {
    setMessage(null);
    try {
      await api.setLook(choice);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  const chips = mode === "game" ? gameLookChips() : lookChips();

  return (
    <Card label="Look" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-[15px] font-semibold">Look</h2>
        <span className="text-[13px] text-muted">The light still follows the screen. The genre decides how.</span>
      </div>

      <div role="group" aria-label="Choose how to set the look" className="inline-flex gap-1 self-start rounded-[10px] border border-line bg-field p-1">
        {MODES.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={mode === id}
            onClick={() => {
              setMode(id);
              setMessage(null);
            }}
            className={`cursor-pointer rounded-[7px] px-3.5 py-2 text-[13px] font-semibold ${mode === id ? "bg-[#2a2c31] text-ink-strong" : "text-[#a7aab2] hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode !== "pick" && (
        <form onSubmit={(e) => void find(e)} className="flex flex-wrap items-end gap-2.5">
          <div className="flex flex-[1_1_280px] flex-col gap-1.5">
            <label htmlFor="title-in" className="text-xs text-muted">
              {TITLE_FIELD[mode].label}
            </label>
            <input
              id="title-in"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={TITLE_FIELD[mode].placeholder}
              maxLength={200}
              className="h-11 rounded-[9px] border border-field-line bg-field px-3.5 text-sm text-ink placeholder:text-[#7d8089]"
            />
          </div>
          <Button type="submit" disabled={searching}>
            {searching ? "Finding…" : "Find"}
          </Button>
        </form>
      )}

      {message && (
        <p role="alert" className="m-0 text-[13px] text-warn">
          {message}
        </p>
      )}

      {look?.title && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5 rounded-[10px] border border-line bg-field px-4 py-3.5 text-[13px]">
          <span className="text-sm font-bold">{look.title}</span>
          {look.genres && <span className="text-soft">{look.genres}</span>}
          {look.source && (
            <span className="text-muted">
              Source:{" "}
              {look.url ? (
                <a href={look.url} target="_blank" rel="noreferrer" className="text-soft hover:text-white">
                  {look.source}
                </a>
              ) : (
                look.source
              )}
            </span>
          )}
          <span className="font-semibold">
            Look: {lookLabel(look)}
            {look.tuning ? ", tuned by AI" : ""}
          </span>
          {look.tuning && (
            <p className="m-0 basis-full text-soft">
              <span className="font-semibold text-ink">{tuningText(look.tuning)}</span> · “{look.tuning.reason}”{" "}
              <span className="text-muted">({look.tuning.by})</span>
            </p>
          )}
          {look.aiError && <p className="m-0 basis-full text-muted">AI not used, so the genre look stays: {look.aiError}</p>}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2.5">
        {chips.map((chip) => {
          const selected = sameLook(look, chip.look);
          return (
            <button
              key={chip.label}
              type="button"
              aria-pressed={selected}
              onClick={() => void pick(chip.look)}
              className={`flex min-h-14 cursor-pointer flex-col gap-0.5 rounded-[10px] border-2 px-3 py-2.5 text-left ${
                selected ? "border-ink bg-[#22242a]" : "border-[#2e3036] bg-[#141518] hover:border-control-line"
              }`}
            >
              <span className="text-sm font-semibold">{chip.label}</span>
              <span className="text-xs text-muted">{chip.detail}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
