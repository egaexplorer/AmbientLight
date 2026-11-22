import type { AirportObservation, ForecastSlot, LatLon, WeatherAlert, WeatherSnapshot } from "@ambientlight/core";
import { errorMessage } from "./log.js";

const FORECAST_URL = "https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=";
const ALERTS_URL = "https://www.bmkg.go.id/alerts/nowcast/id";
const METAR_URL = "https://aviationweather.gov/api/data/metar";
const ALERT_LINK = /<link>\s*(https:\/\/www\.bmkg\.go\.id\/alerts\/nowcast\/id\/[A-Za-z0-9_]+_alert\.xml)\s*<\/link>/g;
const AIRPORT_RADIUS_KM = 15;
const KM_PER_DEGREE = 111;

export interface Forecast {
  point: LatLon;
  utcOffsetMinutes: number;
  issued: number;
  slots: ForecastSlot[];
}

function finite(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${what} is not a number`);
  return value;
}

/** External text ends up in the terminal and in the AI prompt. */
function plain(value: unknown): string {
  return String(value ?? "").replace(/[^\p{L}\p{N} +/-]/gu, "").slice(0, 60);
}

export function parseForecast(json: any): Forecast {
  const place = json?.data?.[0]?.lokasi;
  const days = json?.data?.[0]?.cuaca;
  const zone = /^([+-])(\d\d)(\d\d)$/.exec(place?.timezone ?? "");
  if (!zone || !Array.isArray(days)) throw new Error("unexpected forecast format");
  return {
    point: [finite(place.lat, "lat"), finite(place.lon, "lon")],
    utcOffsetMinutes: (zone[1] === "-" ? -1 : 1) * (Number(zone[2]) * 60 + Number(zone[3])),
    // analysis_date is UTC, but has no "Z".
    issued: finite(Date.parse(`${days.flat()[0]?.analysis_date}Z`), "analysis_date"),
    slots: days.flat().map((slot: any) => ({
      time: finite(Date.parse(slot.datetime), "datetime"),
      code: finite(slot.weather, "weather"),
      description: plain(slot.weather_desc),
      rainMm: finite(slot.tp, "tp"),
    })),
  };
}

export function parseAlertLinks(rss: string): string[] {
  if (!rss.includes("<channel>")) throw new Error("unexpected alert list format");
  const links = [...rss.matchAll(ALERT_LINK)].map((match) => match[1]!);
  // A changed format must fail instead of reading as "no alerts".
  if (links.length !== rss.split("<item>").length - 1) throw new Error("unexpected alert link format");
  return [...new Set(links)];
}

/** `null` for tests and cancellations. */
export function parseAlert(xml: string): WeatherAlert | null {
  const tag = (name: string): string => new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1]?.trim() ?? "";
  if (!tag("status")) throw new Error("unexpected alert format");
  if (tag("status") !== "Actual" || tag("msgType") === "Cancel") return null;
  const polygons = [...xml.matchAll(/<polygon>([^<]+)<\/polygon>/g)].map((match) =>
    match[1]!.trim().split(/\s+/).map((pair): LatLon => {
      const [lat, lon] = pair.split(",").map(Number);
      return [finite(lat, "polygon lat"), finite(lon, "polygon lon")];
    }),
  );
  if (polygons.length === 0) throw new Error("alert without an area");
  return {
    effective: finite(Date.parse(tag("effective")), "effective"),
    expires: finite(Date.parse(tag("expires")), "expires"),
    polygons,
  };
}

/** The newest report of the nearest airport within range. */
export function parseObservation(json: any, [lat, lon]: LatLon): AirportObservation | null {
  if (!Array.isArray(json)) throw new Error("unexpected METAR format");
  const near = json
    .map((report: any) => ({
      time: finite(report.obsTime, "obsTime") * 1000,
      km: Math.hypot(report.lat - lat, (report.lon - lon) * Math.cos((lat * Math.PI) / 180)) * KM_PER_DEGREE,
      weather: String(report.wxString ?? ""),
    }))
    .filter((report) => report.km <= AIRPORT_RADIUS_KM)
    .sort((a, b) => a.km - b.km || b.time - a.time);
  return near[0] ?? null;
}

export class WeatherClient {
  private readonly area: string;
  private readonly fetchFn: typeof fetch;
  /** An alert file never changes; caching it keeps us under BMKG's 60 requests a minute. */
  private readonly alertCache = new Map<string, WeatherAlert | null>();
  private place: Pick<Forecast, "point" | "utcOffsetMinutes"> | undefined;

  constructor(area: string, fetchFn: typeof fetch = fetch) {
    this.area = area;
    this.fetchFn = fetchFn;
  }

  async read(stop: AbortSignal): Promise<{ snapshot: WeatherSnapshot; errors: string[] }> {
    const errors: string[] = [];
    const attempt = async <T>(source: string, load: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await load();
      } catch (error) {
        if (!stop.aborted) errors.push(`${source}: ${errorMessage(error)}`);
        return undefined;
      }
    };
    const get = async (url: string): Promise<string> => {
      const response = await this.fetchFn(url, { signal: AbortSignal.any([stop, AbortSignal.timeout(15_000)]) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    };

    const forecast = await attempt("BMKG forecast", async () => parseForecast(JSON.parse(await get(FORECAST_URL + this.area))));
    if (forecast) this.place = forecast;
    const point = this.place?.point;

    const [alerts, observation] = await Promise.all([
      attempt("BMKG alerts", async () => {
        // shortcut: reads every alert in Indonesia, filter by region if the list ever nears 60 files.
        const all = await Promise.all(
          parseAlertLinks(await get(ALERTS_URL)).map(async (url) => {
            if (!this.alertCache.has(url)) this.alertCache.set(url, parseAlert(await get(url)));
            return this.alertCache.get(url);
          }),
        );
        return all.filter((alert): alert is WeatherAlert => !!alert);
      }),
      attempt("METAR", async () => {
        if (!point) throw new Error("the area's position is unknown");
        const margin = (AIRPORT_RADIUS_KM / KM_PER_DEGREE) * 1.1;
        const [lat, lon] = point;
        const box = [lat - margin, lon - margin, lat + margin, lon + margin].map((v) => v.toFixed(2)).join(",");
        // An empty body (HTTP 204) means no airport in the box.
        const text = await get(`${METAR_URL}?bbox=${box}&format=json`);
        return parseObservation(text === "" ? [] : JSON.parse(text), point);
      }),
    ]);

    return {
      snapshot: { point, utcOffsetMinutes: this.place?.utcOffsetMinutes ?? 420, alerts, forecast, observation },
      errors,
    };
  }
}
