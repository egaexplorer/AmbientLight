import { useEffect, useState } from "react";
import type { Toast } from "../../../shared/api";
import { api } from "../api";
import { toastText } from "../model/shortcuts";

/** The shortcut popup (its own small window, `?view=overlay`): what the last key press did. */
export function Overlay() {
  const [shown, setShown] = useState<{ toast: Toast; id: number } | null>(null);

  useEffect(() => {
    let id = 0;
    return api.onToast((toast) => setShown({ toast, id: ++id }));
  }, []);

  if (!shown) return null;
  const { title, detail } = toastText(shown.toast);
  return (
    // A new key per toast restarts the fade-in.
    <div key={shown.id} role="status" className="overlay-in flex h-full flex-col justify-center gap-0.5 border border-line bg-card px-5">
      <span className="truncate text-base font-bold text-ink-strong">{title}</span>
      {detail && <span className={`line-clamp-2 text-[13px] ${shown.toast.kind === "error" ? "text-warn" : "text-muted"}`}>{detail}</span>}
    </div>
  );
}
