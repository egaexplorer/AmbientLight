import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { BulbInfo } from "../../../shared/api";
import { api } from "../api";
import { Button, CloseIcon } from "../components/ui";

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

interface Row extends BulbInfo {
  /** Configured, but didn't answer this search. */
  silent?: boolean;
}

/** Discovery results plus the configured bulbs that didn't answer, so they can be kept or dropped. */
function mergeRows(found: BulbInfo[], configured: string[]): Row[] {
  const rows: Row[] = [...found];
  for (const ip of configured) if (!found.some((b) => b.ip === ip)) rows.push({ ip, silent: true });
  return rows;
}

export function FindBulbsDialog({ configured, onClose }: { configured: string[]; onClose(): void }) {
  const [rows, setRows] = useState<Row[]>(() => configured.map((ip) => ({ ip, silent: true })));
  const [selected, setSelected] = useState<Set<string>>(() => new Set(configured));
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState("");
  const [blink, setBlink] = useState<Record<string, string>>({});
  const [manual, setManual] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const search = useCallback(async () => {
    setSearching(true);
    setStatus("Searching…");
    try {
      const result = await api.discover();
      setRows(mergeRows(result.bulbs, configured));
      // With no bulb configured yet, everything found starts selected.
      if (configured.length === 0) setSelected(new Set(result.bulbs.map((b) => b.ip)));
      setStatus(
        result.bulbs.length === 0
          ? `Searched ${result.via.join(", ")} · nothing answered`
          : `Found ${result.bulbs.length} bulb${result.bulbs.length === 1 ? "" : "s"} via ${result.via.join(", ")}`,
      );
    } catch (error) {
      setStatus(`Search failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSearching(false);
    }
  }, [configured]);

  useEffect(() => {
    void search();
  }, [search]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function identify(ip: string) {
    setBlink((b) => ({ ...b, [ip]: "Blinking…" }));
    const outcome = await api.identify(ip).catch((error: unknown) => ({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }));
    setBlink((b) => ({ ...b, [ip]: outcome.ok ? (outcome.message ?? "Blinked") : (outcome.message ?? "No answer") }));
  }

  function toggle(ip: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(ip)) next.delete(ip);
      else next.add(ip);
      return next;
    });
  }

  function add(event: FormEvent) {
    event.preventDefault();
    const ip = manual.trim();
    if (!IPV4.test(ip)) {
      setManualError("Type an IPv4 address like 192.168.1.50");
      return;
    }
    setManualError(null);
    setRows((r) => (r.some((row) => row.ip === ip) ? r : [...r, { ip, silent: true }]));
    setSelected((s) => new Set(s).add(ip));
    setManual("");
  }

  async function save() {
    setSaving(true);
    try {
      await api.setBulbs(rows.map((r) => r.ip).filter((ip) => selected.has(ip)));
      onClose();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setSaving(false);
    }
  }

  const count = rows.filter((r) => selected.has(r.ip)).length;
  const noneFound = !searching && rows.every((r) => r.silent);

  return (
    <div className="fixed inset-0 flex items-start justify-center overflow-y-auto bg-[rgba(5,5,6,0.72)] px-4 py-14">
      <section role="dialog" aria-modal="true" aria-labelledby="find-h" className="flex w-full max-w-[660px] flex-col gap-[18px] rounded-2xl border border-[#2e3036] bg-card p-6">
        <header className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="find-h" className="m-0 text-lg font-bold">
              Find bulbs
            </h2>
            <p className="m-0 text-[13px] text-muted">Searches every network adapter for WiZ bulbs (UDP 38899) for 2 seconds.</p>
          </div>
          <Button variant="ghost" aria-label="Close" onClick={onClose} className="w-11 px-0">
            <CloseIcon />
          </Button>
        </header>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void search()} disabled={searching} autoFocus>
            {searching ? "Searching…" : "Search again"}
          </Button>
          <span role="status" className="text-[13px] text-muted">
            {status}
          </span>
        </div>

        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[520px] border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-muted">
                  <th scope="col" className="px-3 py-2.5 font-medium">Use</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">IP address</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Power</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Signal</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    <span className="sr-only">Identify</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.ip} className="border-t border-line">
                    <td className="px-3 py-1.5">
                      <label className="inline-flex size-11 items-center justify-center">
                        <input
                          type="checkbox"
                          checked={selected.has(row.ip)}
                          onChange={() => toggle(row.ip)}
                          aria-label={`Use ${row.ip}`}
                          className="size-[18px] accent-soft"
                        />
                      </label>
                    </td>
                    <td className="px-3 py-1.5 font-semibold tabular-nums">{row.ip}</td>
                    <td className="px-3 py-1.5 text-soft">{row.silent ? "Not answering" : row.on ? "On" : "Off"}</td>
                    <td className="px-3 py-1.5 text-soft">{row.rssi !== undefined ? `${row.rssi} dBm` : "—"}</td>
                    <td className="px-3 py-1.5 text-right">
                      <Button onClick={() => void identify(row.ip)} disabled={blink[row.ip] === "Blinking…"} className="min-h-10 px-3.5 text-[13px]">
                        {blink[row.ip] ?? "Blink"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {noneFound && (
          <div className="flex flex-col gap-2 rounded-xl border border-warn-line bg-field p-4 text-[13px] leading-normal">
            <strong className="text-sm">No bulbs answered</strong>
            <span className="text-soft">Allow AmbientLight through Windows Defender Firewall on Private networks.</span>
            <span className="text-soft">Check that the PC and the bulb are on the same Wi-Fi (guest and IoT networks often isolate devices).</span>
            <span className="text-soft">In the WiZ app, turn on Settings › Security › Allow local communication.</span>
          </div>
        )}

        <form onSubmit={add} className="flex flex-wrap items-end gap-2.5">
          <div className="flex flex-[1_1_220px] flex-col gap-1.5">
            <label htmlFor="ip-in" className="text-xs text-muted">
              Or add a bulb by IP address
            </label>
            <input
              id="ip-in"
              type="text"
              inputMode="decimal"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="192.168.1.50"
              className="h-11 rounded-[9px] border border-field-line bg-field px-3.5 text-sm text-ink placeholder:text-[#7d8089]"
            />
          </div>
          <Button type="submit">Add</Button>
          {manualError && (
            <p role="alert" className="m-0 basis-full text-[13px] text-warn">
              {manualError}
            </p>
          )}
        </form>

        <footer className="flex flex-wrap justify-end gap-2.5 border-t border-line pt-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            {count === 1 ? "Use 1 bulb" : `Use ${count} bulbs`}
          </Button>
        </footer>
      </section>
    </div>
  );
}
