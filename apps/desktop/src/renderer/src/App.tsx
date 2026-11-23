import { useEffect, useState } from "react";
import type { AppState, FrameView } from "../../shared/api";
import { api, isMock } from "./api";
import { BulbIcon, HomeIcon } from "./components/ui";
import { FindBulbsDialog } from "./screens/FindBulbs";
import { Home } from "./screens/Home";

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [frame, setFrame] = useState<FrameView | null>(null);
  const [findingBulbs, setFindingBulbs] = useState(false);

  useEffect(() => {
    void api.getState().then(setState);
    const offState = api.onState((next) => {
      setState(next);
      if (next.sync === "idle") setFrame(null);
    });
    const offFrame = api.onFrame(setFrame);
    return () => {
      offState();
      offFrame();
    };
  }, []);

  return (
    <div className="flex h-full">
      <nav aria-label="Main" className="flex w-[200px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-[#24262b] bg-side px-3 py-5">
        <div className="flex items-center gap-2.5 px-2.5 pb-5 pt-1">
          <BulbIcon size={22} />
          <span className="text-[15px] font-bold">AmbientLight</span>
        </div>
        <a href="#home" aria-current="page" className="flex items-center gap-2.5 rounded-lg bg-control p-2.5 text-sm font-semibold text-ink-strong no-underline">
          <HomeIcon />
          Home
        </a>
        {isMock && <p className="mt-auto px-2.5 text-xs text-muted">Browser preview: fake bulb and colors</p>}
      </nav>
      <main className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-8 py-7">
        <Home state={state} frame={frame} onFindBulbs={() => setFindingBulbs(true)} />
      </main>
      {findingBulbs && state && <FindBulbsDialog configured={state.bulbs} onClose={() => setFindingBulbs(false)} />}
    </div>
  );
}
