import screenshot from "screenshot-desktop";

export interface DisplayInfo {
  /** Display id for the `screen` setting (e.g. `\\.\DISPLAY2`); works with the GDI capture. */
  id: string | number;
  name: string;
}

/** Lists the displays through screenshot-desktop, without loading sharp. */
export async function listDisplays(): Promise<DisplayInfo[]> {
  const displays = await screenshot.listDisplays();
  return displays.map((d) => ({ id: d.id, name: d.name }));
}
