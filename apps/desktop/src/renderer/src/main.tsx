import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Overlay } from "./screens/Overlay";
import "./styles.css";

// The shortcut popup is a second, small window on the same page (src/main/overlay.ts).
const overlay = new URLSearchParams(window.location.search).get("view") === "overlay";

createRoot(document.getElementById("root")!).render(<StrictMode>{overlay ? <Overlay /> : <App />}</StrictMode>);
