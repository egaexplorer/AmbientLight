import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessRain, type RainAssessment } from "@ambientlight/core";
import { checkAdvice, createAdvisor } from "../src/advisor.js";
import { CliError, parseCommandLine, SIMULATIONS } from "../src/cli.js";
import { resolveConfig, validateConfigFile } from "../src/config.js";
import { signalParams, simulatedWeather } from "../src/rain.js";
import { parseAlert, parseAlertLinks, parseForecast, parseObservation, WeatherClient } from "../src/weather.js";

const AREA = "31.71.03.1001";
const LINK = "https://www.bmkg.go.id/alerts/nowcast/id/CJK20261122004_alert.xml";
const RSS = `<rss><channel><link>https://www.bmkg.go.id/alerts/nowcast/id/rss.xml</link><item><link>${LINK}</link></item></channel></rss>`;
const CAP = `<alert><status>Actual</status><msgType>Alert</msgType><info><effective>2026-11-22T18:05:00+07:00</effective>
<expires>2026-11-22T21:05:00+07:00</expires><area><polygon>-6,106 -6,107 -7,107 -7,106</polygon></area></info></alert>`;
const FORECAST = {
  data: [
    {
      lokasi: { lat: -6.16, lon: 106.85, timezone: "+0700" },
      cuaca: [[{ datetime: "2026-11-22T13:00:00Z", analysis_date: "2026-11-22T12:00:00", weather: 3, weather_desc: "Berawan", tp: 0 }]],
    },
  ],
};
const METAR = [{ obsTime: 1795354200, lat: -6.267, lon: 106.891, wxString: "VCTS" }];
const signal = (): AbortSignal => new AbortController().signal;

describe("weather sources", () => {
  it("parses a forecast, reading analysis_date as UTC", () => {
    const forecast = parseForecast(FORECAST);
    assert.equal(forecast.issued, Date.parse("2026-11-22T12:00:00Z"));
    assert.equal(forecast.utcOffsetMinutes, 420);
    assert.equal(forecast.slots[0]!.description, "Berawan");
    assert.throws(() => parseForecast({ data: [] }));
  });

  it("fails on a changed alert format instead of reporting no alerts", () => {
    assert.deepEqual(parseAlertLinks(RSS), [LINK]);
    assert.deepEqual(parseAlertLinks("<rss><channel></channel></rss>"), []);
    assert.throws(() => parseAlertLinks("<html>maintenance</html>"));
    assert.throws(() => parseAlertLinks(RSS.replace(LINK, "https://example.com/x_alert.xml")));
    assert.throws(() => parseAlert("<html></html>"));
    assert.throws(() => parseAlert(CAP.replace(/<polygon>.*<\/polygon>/, "")));
  });

  it("parses alerts and skips cancellations", () => {
    assert.equal(parseAlert(CAP)!.polygons[0]!.length, 4);
    assert.equal(parseAlert(CAP.replace(">Alert<", ">Cancel<")), null);
  });

  it("ignores airports that are too far away", () => {
    assert.equal(parseObservation(METAR, [-6.2, 106.85])!.weather, "VCTS");
    assert.equal(parseObservation(METAR, [-7, 106.85]), null);
  });

  it("caches alert files and reports a failed source as missing", async () => {
    const calls: string[] = [];
    let metarUp = true;
    const fake = (async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("prakiraan-cuaca")) return new Response(JSON.stringify(FORECAST));
      if (url === LINK) return new Response(CAP);
      if (url.includes("alerts")) return new Response(RSS);
      return metarUp ? new Response(null, { status: 204 }) : new Response("down", { status: 503 });
    }) as typeof fetch;
    const client = new WeatherClient(AREA, fake);

    const first = await client.read(signal());
    assert.equal(first.snapshot.alerts!.length, 1);
    assert.equal(first.snapshot.observation, null);
    metarUp = false;
    const second = await client.read(signal());
    assert.equal(second.snapshot.observation, undefined);
    assert.equal(second.errors.length, 1);
    assert.equal(calls.filter((url) => url === LINK).length, 1);
  });
});

describe("advisor", () => {
  const rules = (level: RainAssessment["level"]): RainAssessment => ({ level, facts: ["Peringatan BMKG 18:05-21:05."] });
  const reply = (level: string, advice = "Tunggu sampai 21.05.") => JSON.stringify({ level, advice });

  it("can't clear rain, downgrade danger or fill in missing data", () => {
    assert.throws(() => checkAdvice(reply("go"), rules("prepare"), "", "18:10"));
    assert.throws(() => checkAdvice(reply("go"), rules("wait"), "", "18:10"));
    assert.throws(() => checkAdvice(reply("wait"), rules("danger"), "", "18:10"));
    assert.throws(() => checkAdvice(reply("go"), rules("unknown"), "", "18:10"));
    assert.equal(checkAdvice(reply("prepare"), rules("wait"), "", "18:10").level, "prepare");
  });

  it("rejects invented times and accepts the user's own", () => {
    assert.throws(() => checkAdvice(reply("danger", "Aman pukul 20:15."), rules("danger"), "", "18:10"));
    assert.equal(checkAdvice(reply("danger"), rules("danger"), "", "18:10").text, "Tunggu sampai 21.05.");
    checkAdvice(reply("wait", "Tunggu sampai 19.00."), rules("wait"), "bisa nunggu sampai 19", "18:10");
  });

  it("uses whichever key is set, without leaking it", async () => {
    assert.equal(createAdvisor({}), undefined);
    for (const key of ["GEMINI_API_KEY", "GROQ_API_KEY"]) {
      let sent = "";
      const ok = (async (_url: unknown, init?: RequestInit) => {
        sent = String(init?.body);
        return Response.json({ choices: [{ message: { content: reply("wait") } }] });
      }) as typeof fetch;
      const advice = await createAdvisor({ [key]: "secret-key" }, ok)!.advise(rules("wait"), "naik motor", "18:10", signal());
      assert.equal(advice.level, "wait");
      assert.ok(!sent.includes("secret-key"));

      const down = (async () => new Response("bad key secret-key", { status: 401 })) as typeof fetch;
      await assert.rejects(
        createAdvisor({ [key]: "secret-key" }, down)!.advise(rules("wait"), "", "18:10", signal()),
        (error: Error) => error.message.includes("401") && !error.message.includes("secret-key"),
      );
    }
  });
});

describe("rain command", () => {
  it("has simulations that give the level they are named after", () => {
    const now = Date.now();
    for (const kind of SIMULATIONS) assert.equal(assessRain(simulatedWeather(kind, now), now).level, kind);
  });

  it("clears the white LEDs for every signal", () => {
    for (const kind of SIMULATIONS) {
      const { c, w, state } = signalParams(kind);
      assert.deepEqual([c, w, state], [0, 0, true]);
    }
  });

  it("validates its options", () => {
    assert.equal(parseCommandLine(["rain", "--simulate", "danger"]).flags.simulate, "danger");
    assert.throws(() => parseCommandLine(["rain", "--simulate", "storm"]), CliError);
    assert.throws(() => parseCommandLine(["sync", "--plan", "x"]), CliError);
    const file = validateConfigFile({ weatherArea: AREA }, "test");
    assert.equal(resolveConfig(file, parseCommandLine(["rain"]).flags).weatherArea, AREA);
    for (const weatherArea of ["31.71.03", "31x71x03x1001", "31.71.03.1001&x=1", 3171]) {
      assert.throws(() => validateConfigFile({ weatherArea }, "test"), CliError);
    }
    assert.equal(validateConfigFile({ weatherArea: null }, "test").weatherArea, null);
  });
});
