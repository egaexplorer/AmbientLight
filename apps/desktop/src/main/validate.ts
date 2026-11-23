import { LOOK_NAMES, type LookName } from "@ambientlight/core";
import { UserError } from "@ambientlight/node";
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
  if (value !== "film" && value !== "series") throw new UserError('Expected "film" or "series"');
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

export function checkLook(value: unknown): LookChoice | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new UserError("Expected a look");
  const raw = value as Record<string, unknown>;
  if (!(LOOK_NAMES as readonly unknown[]).includes(raw.name)) throw new UserError(`Unknown look ${String(raw.name)}`);
  const look: LookChoice = { name: raw.name as LookName };
  for (const key of ["title", "genres", "source", "url"] as const) {
    const text = optionalText(raw[key], key);
    if (text !== undefined) look[key] = text;
  }
  return look;
}
