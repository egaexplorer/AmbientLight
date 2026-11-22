import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessRain, clockTime, insidePolygon, type LatLon, type WeatherSnapshot } from "../src/index.js";

const now = Date.parse("2026-11-22T17:30:00+07:00");
const MIN = 60_000;
const square: LatLon[] = [[-1, -1], [-1, 1], [1, 1], [1, -1]];
const elsewhere: LatLon[] = square.map(([lat, lon]) => [lat + 5, lon + 5]);

function dry(change: Partial<WeatherSnapshot> = {}): WeatherSnapshot {
  return {
    point: [0, 0],
    utcOffsetMinutes: 420,
    alerts: [],
    forecast: { issued: now - 60 * MIN, slots: [{ time: now, code: 3, description: "Berawan", rainMm: 0 }] },
    observation: { time: now - 10 * MIN, km: 11, weather: "" },
    ...change,
  };
}
const level = (change: Partial<WeatherSnapshot> = {}) => assessRain(dry(change), now).level;
const alert = (from: number, to: number, polygon = square) => ({
  alerts: [{ effective: now + from * MIN, expires: now + to * MIN, polygons: [polygon] }],
});
const slot = (code: number, minutes = 0, rainMm = 0) => ({
  forecast: { issued: now, slots: [{ time: now + minutes * MIN, code, description: "x", rainMm }] },
});
const seen = (weather: string) => ({ observation: { time: now, km: 11, weather } });

describe("assessRain", () => {
  it("is green only with every source present and dry", () => {
    assert.equal(level(), "go");
    assert.equal(level({ observation: null }), "go"); // no airport nearby isn't a failure
  });

  it("matches alerts by polygon and time, not by name", () => {
    assert.equal(level(alert(-10, 50)), "danger");
    assert.equal(level(alert(-10, 50, elsewhere)), "go");
    assert.equal(level(alert(-90, 0)), "go"); // just expired
    assert.equal(level(alert(60, 120)), "danger"); // starts within the hour
    assert.equal(level(alert(61, 120)), "go");
  });

  it("never turns red from a forecast alone", () => {
    assert.equal(level(slot(61)), "prepare");
    assert.equal(level(slot(3, 0, 0.5)), "prepare");
    for (const code of [63, 65, 95, 97]) assert.equal(level(slot(code)), "wait");
  });

  it("reads present weather at the airport", () => {
    for (const w of ["-RA", "SHRA", "DZ"]) assert.equal(level(seen(w)), "wait", w);
    for (const w of ["+RA", "TSRA", "-TSRA", "+SHRA"]) assert.equal(level(seen(w)), "danger", w);
    for (const w of ["TS", "VCTS", "VCSH"]) assert.equal(level(seen(w)), "prepare", w);
    for (const w of ["RERA", "HZ", "BR"]) assert.equal(level(seen(w)), "go", w);
  });

  it("never looks safe with missing or stale data", () => {
    assert.equal(level({ alerts: undefined }), "unknown");
    assert.equal(level({ point: undefined }), "unknown");
    assert.equal(level({ forecast: undefined }), "unknown");
    assert.equal(level({ forecast: { issued: now, slots: [] } }), "unknown");
    assert.equal(level({ forecast: { ...dry().forecast!, issued: now - 25 * 60 * MIN } }), "unknown");
    assert.equal(level({ observation: undefined }), "unknown");
    assert.equal(level({ observation: { time: now - 91 * MIN, km: 11, weather: "" } }), "unknown");
    assert.equal(level({ ...slot(61), observation: undefined }), "unknown");
  });

  it("lets known danger win over missing data", () => {
    assert.equal(level({ ...alert(-10, 50), forecast: undefined, observation: undefined }), "danger");
  });

  it("writes times in the area's time zone", () => {
    assert.equal(clockTime(now, 420), "17:30");
    assert.equal(clockTime(now, 480), "18:30");
    assert.ok(assessRain(dry(alert(-10, 50)), now).facts[0]!.includes("17:20-18:20"));
  });
});

describe("insidePolygon", () => {
  it("handles closed and concave polygons", () => {
    assert.equal(insidePolygon([0, 0], [...square, square[0]!]), true);
    const notch: LatLon[] = [[0, 0], [4, 0], [4, 4], [2, 1], [0, 4]];
    assert.equal(insidePolygon([1, 1], notch), true);
    assert.equal(insidePolygon([2, 3], notch), false);
  });
});
