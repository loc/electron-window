/**
 * Basic example: Simple window management with React
 *
 * This example demonstrates:
 * - Opening/closing windows declaratively
 * - Window props (title, size, position)
 * - User close handling
 * - Bounds persistence
 */

import React, { useState } from "react";
import {
  WindowProvider,
  Window,
  useCurrentWindow,
  useWindowBounds,
  useWindowFocused,
} from "@loc/electron-window";

// Content rendered inside the child window
function SettingsContent() {
  const window = useCurrentWindow();
  const bounds = useWindowBounds();
  const isFocused = useWindowFocused();

  return (
    <div style={{ padding: 20 }}>
      <h1>Settings</h1>
      <p>Window ID: {window?.id}</p>
      <p>Focused: {isFocused ? "Yes" : "No"}</p>
      <p>
        Bounds: {bounds.width}x{bounds.height} at ({bounds.x}, {bounds.y})
      </p>

      <button onClick={() => window?.minimize()}>Minimize</button>
      <button onClick={() => window?.maximize()}>Maximize</button>
      <button onClick={() => window?.close()}>Close</button>
    </div>
  );
}

// Main application component
export function App() {
  const [showSettings, setShowSettings] = useState(false);

  return (
    <WindowProvider>
      <div style={{ padding: 20 }}>
        <h1>Electron Window Basic Example</h1>

        <button onClick={() => setShowSettings(true)}>Open Settings</button>

        {/* Declarative window - open when showSettings is true */}
        <Window
          open={showSettings}
          onUserClose={() => setShowSettings(false)}
          title="Settings"
          defaultWidth={600}
          defaultHeight={400}
          minWidth={400}
          minHeight={300}
          persistBounds="settings-window"
        >
          <SettingsContent />
        </Window>
      </div>
    </WindowProvider>
  );
}

export default App;
