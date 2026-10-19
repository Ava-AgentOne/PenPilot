import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { compareVersions } = require("../../desktop/app/updater.cjs") as {
  compareVersions: (a: string, b: string) => number;
};

describe("PenPilot updates", () => {
  it("knows which version is newer", () => {
    expect(compareVersions("0.9.3", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.10", "1.0.9")).toBe(1);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("2.0.0", "10.0.0")).toBe(-1);
  });
});
