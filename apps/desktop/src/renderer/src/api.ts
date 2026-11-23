import type { AmbientApi } from "../../shared/api";
import { createMockApi } from "./mock-api";

/** Electron's preload API, or a fake one when the UI runs in a plain browser (UI work, screenshots). */
export const api: AmbientApi = window.ambient ?? createMockApi();
export const isMock = window.ambient === undefined;
