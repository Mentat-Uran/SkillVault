import { describe, it, expect } from "vitest";
import packageJson from "../../package.json";
import { APP_VERSION, ASSET_TYPES, TARGET_TOOLS, EXPORT_PRESETS, ASSET_STATUSES, VISIBILITIES, ASSET_SOURCES } from "@/lib/constants";

describe("constants", () => {
  it("APP_VERSION matches expected format", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("APP_VERSION matches the package version", () => {
    expect(APP_VERSION).toBe(packageJson.version);
  });

  it("ASSET_TYPES contains expected values", () => {
    expect(ASSET_TYPES).toContain("agent_skill");
    expect(ASSET_TYPES).toContain("chat_prompt");
    expect(ASSET_TYPES.length).toBeGreaterThan(0);
  });

  it("TARGET_TOOLS contains expected values", () => {
    expect(TARGET_TOOLS).toContain("codex");
    expect(TARGET_TOOLS).toContain("general");
  });

  it("EXPORT_PRESETS contains expected values", () => {
    expect(EXPORT_PRESETS).toContain("general_markdown");
    expect(EXPORT_PRESETS).toContain("codex_skill_md");
  });

  it("ASSET_STATUSES contains expected values", () => {
    expect(ASSET_STATUSES).toContain("draft");
    expect(ASSET_STATUSES).toContain("active");
  });

  it("VISIBILITIES contains expected values", () => {
    expect(VISIBILITIES).toContain("private");
    expect(VISIBILITIES).toContain("public");
  });

  it("ASSET_SOURCES contains expected values", () => {
    expect(ASSET_SOURCES).toContain("self_created");
    expect(ASSET_SOURCES).toContain("imported");
  });

  it("enum arrays are non-empty and readonly", () => {
    expect(ASSET_TYPES.length).toBeGreaterThan(0);
    expect(TARGET_TOOLS.length).toBeGreaterThan(0);
    expect(EXPORT_PRESETS.length).toBeGreaterThan(0);
    expect(ASSET_STATUSES.length).toBeGreaterThan(0);
    expect(VISIBILITIES.length).toBeGreaterThan(0);
    expect(ASSET_SOURCES.length).toBeGreaterThan(0);
  });
});
