/**
 * Pooled window example: High-performance overlays
 *
 * This example demonstrates:
 * - Creating window pools for specific window "shapes"
 * - Using PooledWindow for rapid show/hide cycles
 * - Transparent, frameless windows for overlays
 */

import React, { useState } from "react";
import {
  WindowProvider,
  PooledWindow,
  createWindowPool,
  useCurrentWindow,
} from "@loc/electron-window";

// Define a pool for transparent overlay windows
const overlayPool = createWindowPool(
  {
    // Window shape (creation-only props)
    transparent: true,
    frame: false,
  },
  {
    // Pool configuration
    minIdle: 1, // Keep 1 warm window
    maxIdle: 3, // Don't keep more than 3
    idleTimeout: 5000, // Destroy idle windows after 5s
  },
);

// Overlay content
function OverlayContent({ onClose }: { onClose: () => void }) {
  const window = useCurrentWindow();

  return (
    <div
      style={{
        background: "rgba(0, 0, 0, 0.8)",
        color: "white",
        padding: 20,
        borderRadius: 8,
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)",
      }}
    >
      <h2>Quick Overlay</h2>
      <p>This is a pooled window for fast show/hide.</p>
      <p>Window ID: {window?.id}</p>
      <button onClick={onClose} style={{ marginTop: 10 }}>
        Dismiss
      </button>
    </div>
  );
}

// Main application
export function App() {
  const [showOverlay, setShowOverlay] = useState(false);

  return (
    <WindowProvider>
      <div style={{ padding: 20 }}>
        <h1>Pooled Window Example</h1>

        <button onClick={() => setShowOverlay(true)}>Show Overlay</button>

        {/* Pooled window - uses pre-warmed windows for instant show */}
        <PooledWindow
          pool={overlayPool}
          open={showOverlay}
          onUserClose={() => setShowOverlay(false)}
          defaultWidth={300}
          defaultHeight={200}
          alwaysOnTop
          skipTaskbar
        >
          <OverlayContent onClose={() => setShowOverlay(false)} />
        </PooledWindow>
      </div>
    </WindowProvider>
  );
}

export default App;
