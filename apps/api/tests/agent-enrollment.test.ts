import { describe, expect, it } from "vitest";
import { AgentEnrollmentSchema } from "../src/schemas/agent-enrollment.js";

const enrollment = {
  enrollmentToken: "a".repeat(43),
  name: "scanner",
};

describe("agent enrollment platform paths", () => {
  it("accepts absolute POSIX paths for Linux, macOS, and Android agents", () => {
    for (const osName of ["Linux", "macOS", "Android (Termux)"]) {
      expect(
        AgentEnrollmentSchema.safeParse({
          ...enrollment,
          osName,
          monitoredRoot: "/storage/emulated/0/Documents",
        }).success
      ).toBe(true);
    }
  });

  it("accepts absolute Windows drive and UNC paths", () => {
    for (const monitoredRoot of [
      "C:\\Users\\scanner\\Documents",
      "\\\\server\\share\\folder",
    ]) {
      expect(
        AgentEnrollmentSchema.safeParse({
          ...enrollment,
          osName: "Windows",
          monitoredRoot,
        }).success
      ).toBe(true);
    }
  });

  it("rejects relative and wrong-platform roots", () => {
    expect(
      AgentEnrollmentSchema.safeParse({
        ...enrollment,
        osName: "Windows",
        monitoredRoot: "/home/scanner",
      }).success
    ).toBe(false);
    expect(
      AgentEnrollmentSchema.safeParse({
        ...enrollment,
        osName: "Linux",
        monitoredRoot: "C:\\Users\\scanner",
      }).success
    ).toBe(false);
    expect(
      AgentEnrollmentSchema.safeParse({
        ...enrollment,
        osName: "macOS",
        monitoredRoot: "relative/path",
      }).success
    ).toBe(false);
  });
});
