import { useEffect, useState } from "react";
import type { ShortcutsView } from "../../../shared/api";
import { api } from "../api";
import { Button, CloseIcon } from "../components/ui";
import { shortcutLabel, STATUS_TEXT } from "../model/shortcuts";

/** The global shortcut keys, whether each one works, and where to change them. */
export function ShortcutsDialog({ onClose }: { onClose(): void }) {
  const [view, setView] = useState<ShortcutsView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    api.getShortcuts().then(setView, (error: unknown) => setMessage(error instanceof Error ? error.message : String(error)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function reload() {
    setReloading(true);
    setMessage(null);
    try {
      setView(await api.reloadShortcuts());
      setMessage("Keys reloaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setReloading(false);
    }
  }

  async function openFile() {
    setMessage(null);
    try {
      await api.openShortcutsFile();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="fixed inset-0 flex items-start justify-center overflow-y-auto bg-[rgba(5,5,6,0.72)] px-4 py-14">
      <section role="dialog" aria-modal="true" aria-labelledby="keys-h" className="flex w-full max-w-[660px] flex-col gap-[18px] rounded-2xl border border-[#2e3036] bg-card p-6">
        <header className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="keys-h" className="m-0 text-lg font-bold">
              Keyboard shortcuts
            </h2>
            <p className="m-0 text-[13px] text-muted">
              They work in any app or game while I'm bien light is open, even minimized. A popup at the bottom of the screen says what changed.
            </p>
          </div>
          <Button variant="ghost" aria-label="Close" onClick={onClose} className="w-11 px-0" autoFocus>
            <CloseIcon />
          </Button>
        </header>

        {view?.error && (
          <p role="alert" className="m-0 rounded-xl border border-warn-line bg-field px-4 py-3 text-[13px] text-warn">
            {view.error}
          </p>
        )}

        {view && (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[520px] border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-muted">
                  <th scope="col" className="px-3 py-2.5 font-medium">Action</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Keys</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {view.keys.map((key) => (
                  <tr key={key.action} className="border-t border-line">
                    <td className="px-3 py-2">{shortcutLabel(key.action)}</td>
                    <td className="px-3 py-2">
                      {key.accelerator ? (
                        <kbd className="rounded-md border border-control-line bg-control px-2 py-0.5 font-sans text-xs font-semibold text-ink-strong">
                          {key.accelerator}
                        </kbd>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className={`px-3 py-2 ${key.status === "taken" || key.status === "invalid" ? "text-warn" : "text-soft"}`}>
                      {STATUS_TEXT[key.status]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="m-0 text-[13px] leading-normal text-soft">
          Next, previous and the number keys pick film looks, or game looks after the switch key or a game look. To
          change a key, edit <span className="break-all font-semibold text-ink">{view?.file ?? "shortcuts.json"}</span> and
          press Reload keys. Write keys like <code className="text-ink">"Ctrl+Alt+L"</code>, or{" "}
          <code className="text-ink">null</code> to turn one off.
        </p>

        {message && (
          <p role="status" className="m-0 text-[13px] text-muted">
            {message}
          </p>
        )}

        <footer className="flex flex-wrap justify-end gap-2.5 border-t border-line pt-4">
          <Button onClick={() => void openFile()} disabled={!view}>
            Open file
          </Button>
          <Button onClick={() => void reload()} disabled={!view || reloading}>
            {reloading ? "Reloading…" : "Reload keys"}
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </footer>
      </section>
    </div>
  );
}
