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

type Scripts = {
  setupScript: (o: { pid: number; setup: string; exe: string; args?: string[]; log: string }) => string;
  portableScript: (o: {
    pid: number;
    launcherPid?: number;
    downloaded: string;
    old: string;
    fresh: string;
    args?: string[];
    log: string;
  }) => string;
  helperCommand: (script: string, dir: string) => [string, string[]];
  psQuote: (s: string) => string;
  winQuote: (s: string) => string;
};
const decode = (b64: string) => Buffer.from(b64, "base64").toString("utf16le");
const win = require("../../desktop/app/windows-update.cjs") as Scripts;

// The Windows helper runs hidden with no console, where 1.0.0/1.0.1's
// `tasklist | find` wait hung forever. Keep console tools out of it.
describe("PenPilot updates on Windows", () => {
  const tmp = "C:\\Users\\Me\\AppData\\Local\\Temp\\penpilot-update-1.0.2";
  const exe = "C:\\Users\\Me\\AppData\\Local\\Programs\\PenPilot\\PenPilot.exe";

  it("quotes for PowerShell and for Windows command lines", () => {
    expect(win.psQuote("C:\\O'Brien\\x")).toBe("'C:\\O''Brien\\x'");
    expect(win.winQuote("--remote-debugging-port=9333")).toBe("--remote-debugging-port=9333");
    expect(win.winQuote("--user-data-dir=C:\\My Files\\")).toBe('"--user-data-dir=C:\\My Files\\\\"');
    expect(win.winQuote('say "hi"')).toBe('"say \\"hi\\""');
    expect(win.winQuote("")).toBe('""');
  });

  it("installed: waits for PenPilot, runs the installer silently, then reopens PenPilot", () => {
    const s = win.setupScript({
      pid: 4242,
      setup: `${tmp}\\PenPilot-Setup-1.0.2.exe`,
      exe,
      args: ["--remote-debugging-port=9333"],
      log: `${tmp}\\update.log`,
    });
    const at = (needle: string) => {
      const i = s.indexOf(needle);
      expect(i, needle).toBeGreaterThanOrEqual(0);
      return i;
    };
    const wait = at("Wait-Closed 4242");
    const setup = at(`Start-Process -FilePath '${tmp}\\PenPilot-Setup-1.0.2.exe' -ArgumentList '--updated','/S' -PassThru`);
    const waitSetup = at("$s.WaitForExit()");
    const reopen = at(
      `Start-Process -FilePath '${exe}' -WorkingDirectory 'C:\\Users\\Me\\AppData\\Local\\Programs\\PenPilot' -ArgumentList '--remote-debugging-port=9333'`,
    );
    expect(wait < setup && setup < waitSetup && waitSetup < reopen).toBe(true);
    expect(s).not.toMatch(/tasklist|\bfind\b|--force-run/i);
    expect(s).toContain(`$log = '${tmp}\\update.log'`);
    expect(s).toContain(`Test-Path -LiteralPath '${tmp}\\update.cancel'`);
  });

  it("no arguments: reopens PenPilot without an empty argument list", () => {
    const s = win.setupScript({ pid: 1, setup: "C:\\t\\s.exe", exe, log: "C:\\t\\update.log" });
    expect(s).toContain(`Start-Process -FilePath '${exe}' -WorkingDirectory 'C:\\Users\\Me\\AppData\\Local\\Programs\\PenPilot'\r\n`);
  });

  it("portable: waits for PenPilot and its launcher, swaps the .exe, starts it, removes the old one", () => {
    const s = win.portableScript({
      pid: 10,
      launcherPid: 9,
      downloaded: `${tmp}\\PenPilot-Portable-1.0.2.exe`,
      old: "D:\\Apps\\PenPilot-Portable-1.0.1.exe",
      fresh: "D:\\Apps\\PenPilot-Portable-1.0.2.exe",
      log: `${tmp}\\update.log`,
    });
    const order = [
      "Wait-Closed 10 $null",
      "Wait-Closed 9 'D:\\Apps\\PenPilot-Portable-1.0.1.exe'",
      `Copy-Item -LiteralPath '${tmp}\\PenPilot-Portable-1.0.2.exe' -Destination $run`,
      "Start-Process -FilePath $run -WorkingDirectory (Split-Path $run)",
      "Remove-Item -LiteralPath 'D:\\Apps\\PenPilot-Portable-1.0.1.exe'",
    ].map((n) => s.indexOf(n));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("portable with the same file name: replaced in place, nothing removed", () => {
    const s = win.portableScript({
      pid: 10,
      downloaded: `${tmp}\\PenPilot-Portable-1.0.2.exe`,
      old: "D:\\Apps\\penpilot-portable-1.0.2.EXE",
      fresh: "D:\\Apps\\PenPilot-Portable-1.0.2.exe",
      log: `${tmp}\\update.log`,
    });
    expect(s).not.toContain("Remove-Item -LiteralPath");
    expect(s).not.toContain("Wait-Closed undefined");
  });

  // Spawned detached, PowerShell 5.1 quits at once; spawned normally, it ends with
  // PenPilot. A short-lived starter launches the helper with Start-Process instead.
  it("starts the helper through a starter PowerShell", () => {
    const script = "Log 'hello'";
    const [ps, args] = win.helperCommand(script, `${tmp}`);
    expect(ps).toMatch(/\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/);
    expect(args.slice(0, -1)).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-WindowStyle",
      "Hidden",
      "-EncodedCommand",
    ]);
    const starter = decode(args[args.length - 1]);
    const m = starter.match(
      /^Start-Process -FilePath '(.+)' -WindowStyle Hidden -WorkingDirectory '(.+)' -ArgumentList '(.+)'$/,
    );
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe(ps);
    expect(m?.[2]).toBe(tmp);
    const helperArgs = (m?.[3] ?? "").split(" ");
    expect(helperArgs.slice(0, -1)).toEqual(args.slice(0, -1));
    expect(decode(helperArgs[helperArgs.length - 1])).toBe(script);
  });
});
