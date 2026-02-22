import { describe, it, expect, vi, beforeEach } from "vitest";
import { RENDERER_ALLOWED_PROPS } from "../../src/shared/types.js";

// Test the props allowlist
describe("Props Allowlist Security", () => {
  it("includes expected geometry props", () => {
    expect(RENDERER_ALLOWED_PROPS.has("width")).toBe(true);
    expect(RENDERER_ALLOWED_PROPS.has("height")).toBe(true);
    expect(RENDERER_ALLOWED_PROPS.has("x")).toBe(true);
    expect(RENDERER_ALLOWED_PROPS.has("y")).toBe(true);
    expect(RENDERER_ALLOWED_PROPS.has("minWidth")).toBe(true);
    expect(RENDERER_ALLOWED_PROPS.has("maxWidth")).toBe(true);
    expect(RENDERER_ALLOWED_PROPS.has("minHeight")).toBe(true);
    expect(RENDERER_ALLOWED_PROPS.has("maxHeight")).toBe(true);
    expect(RENDERER_ALLOWED_PROPS.has("defaultWidth")).toBe(true);
    expect(RENDERER_ALLOWED_PROPS.has("defaultHeight")).toBe(true);
  });

  it("includes expected appearance props", () => {
    expect(RENDERER_ALLOWED_PROPS.has("title")).toBe(true);
    expect(RENDERER_ALLOWED_PROPS.has("backgroundColor")).toBe(true);
    expect(RENDERER_ALLOWED_PROPS.has("opacity")).toBe(true);
    expect(RENDERER_ALLOWED_PROPS.has("transparent")).toBe(true);
    expect(RENDERER_ALLOWED_PROPS.has("frame")).toBe(true);
  });

  it("includes expected behavior props", () => {
    expect(RENDERER_ALLOWED_PROPS.has("resizable")).toBe(true);
    expect(RENDERER_ALLOWED_PROPS.has("movable")).toBe(true);
    expect(RENDERER_ALLOWED_PROPS.has("minimizable")).toBe(true);
    expect(RENDERER_ALLOWED_PROPS.has("maximizable")).toBe(true);
    expect(RENDERER_ALLOWED_PROPS.has("closable")).toBe(true);
    expect(RENDERER_ALLOWED_PROPS.has("focusable")).toBe(true);
    expect(RENDERER_ALLOWED_PROPS.has("alwaysOnTop")).toBe(true);
  });

  it("does NOT include security-sensitive props", () => {
    // webPreferences is the main security concern
    expect(RENDERER_ALLOWED_PROPS.has("webPreferences")).toBe(false);

    // Other potentially dangerous props
    expect(RENDERER_ALLOWED_PROPS.has("preload")).toBe(false);
    expect(RENDERER_ALLOWED_PROPS.has("nodeIntegration")).toBe(false);
    expect(RENDERER_ALLOWED_PROPS.has("contextIsolation")).toBe(false);
    expect(RENDERER_ALLOWED_PROPS.has("sandbox")).toBe(false);
    expect(RENDERER_ALLOWED_PROPS.has("enableRemoteModule")).toBe(false);
  });

  it("does NOT include parent/child window props", () => {
    expect(RENDERER_ALLOWED_PROPS.has("parent")).toBe(false);
    expect(RENDERER_ALLOWED_PROPS.has("modal")).toBe(false);
  });
});

// Test the filter function behavior
describe("filterAllowedProps", () => {
  // We can't easily import the private function, so we test via the public types
  it("RENDERER_ALLOWED_PROPS is a ReadonlySet", () => {
    // TypeScript enforces this, but we verify at runtime
    expect(RENDERER_ALLOWED_PROPS).toBeInstanceOf(Set);
    expect(typeof RENDERER_ALLOWED_PROPS.has).toBe("function");
    expect(typeof RENDERER_ALLOWED_PROPS.size).toBe("number");
  });

  it("allowlist has expected size", () => {
    // This helps catch accidental additions/removals
    // Current size is ~25 props
    expect(RENDERER_ALLOWED_PROPS.size).toBeGreaterThan(20);
    expect(RENDERER_ALLOWED_PROPS.size).toBeLessThan(50);
  });
});
