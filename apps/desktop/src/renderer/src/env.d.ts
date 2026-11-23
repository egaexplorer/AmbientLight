/// <reference types="vite/client" />
import type { AmbientApi } from "../../shared/api";

declare global {
  interface Window {
    /** Set by the preload inside Electron; absent in a plain browser, where the mock API takes over. */
    ambient?: AmbientApi;
  }
}
