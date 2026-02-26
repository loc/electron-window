import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

const root = createRoot(document.getElementById("root")!);

// Enable StrictMode when the main process sets the #strict hash (driven by
// STRICT_MODE env var). StrictMode double-invokes effects in dev, which
// exercises the Window component's cleanup/reopen logic.
const strict = window.location.hash === "#strict";
root.render(
  strict ? (
    <React.StrictMode>
      <App />
    </React.StrictMode>
  ) : (
    <App />
  ),
);
