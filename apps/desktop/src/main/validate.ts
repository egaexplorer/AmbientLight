import { GAME_LOOK_NAMES, type GameLookName, LOOK_NAMES, type LookName } from "@ambientlight/core";
import { RANGES, UserError } from "@ambientlight/node";
import type { LookChoice, TitleKind } from "../shared/api";

// The renderer is our own code, but everything that crosses IPC is checked before it reaches the network, a bulb
// or the config file.

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const MAX_BULBS = 16;
const MAX_TITLE = 200;
const MAX_TEXT = 500;

export function checkIp(value: unknown): string {
  if (typeof value !== "string" || !IPV4.test(value.trim())) {
    throw new UserError(`"${String(value).slice(0, 40)}" isn't an IPv4 address like 192.168.1.50`);
  }
  return value.trim();
}

export function checkBulbList(value: unknown): string[] {
  if (!Array.isArray(value)) throw new UserError("Expected a list of bulb IP addresses");
  if (value.length > MAX_BULBS) throw new UserError(`At most ${MAX_BULBS} bulbs are supported`);
  return [...new Set(value.map(checkIp))];
}

export function checkTitleKind(value: unknown): TitleKind {
  if (value !== "film" && value !== "series" && value !== "game") throw new UserError('Expected "film", "series" or "game"');
  return value;
}

export function checkTitle(value: unknown): string {
  if (typeof value !== "string") throw new UserError("Expected a title");
  return value.slice(0, MAX_TITLE);
}

function optionalText(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new UserError(`"${name}" must be text`);
  return value.slice(0, MAX_TEXT);
}

export function checkBrightness(value: unknown): number {
  const [min, max] = RANGES.brightness;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new UserError(`Brightness must be a whole number from ${min} to ${max}`);
  }
  return value;
}

export function checkLook(value: unknown): LookChoice | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new UserError("Expected a look");
  const raw = value as Record<string, unknown>;
  if (raw.set !== "film" && raw.set !== "game") throw new UserError('Expected a look "set" of "film" or "game"');
  const names: readonly unknown[] = raw.set === "game" ? GAME_LOOK_NAMES : LOOK_NAMES;
  if (!names.includes(raw.name)) throw new UserError(`Unknown ${raw.set} look ${String(raw.name)}`);
  const look: LookChoice =
    raw.set === "game" ? { set: "game", name: raw.name as GameLookName } : { set: "film", name: raw.name as LookName };
  for (const key of ["title", "genres", "source", "url"] as const) {
    const text = optionalText(raw[key], key);
    if (text !== undefined) look[key] = text;
  }
  return look;
}
