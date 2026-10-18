/**
 * The bridge to PenPilot's desktop shell (desktop/app/preload.cjs).
 * `desktop` is undefined when the UI runs in a normal browser.
 */

export interface WindowsDeviceStatus {
  supported: boolean;
  present?: boolean;
  working?: boolean;
  error?: string;
  devices?: { status: string; class: string; name: string }[];
}

export interface ActionResult {
  ok: boolean;
  message?: string;
}

export interface PenPilotDesktop {
  platform: string;
  info(): Promise<{ platform: string; version: string; electron: string }>;
  windowsDeviceStatus(): Promise<WindowsDeviceStatus>;
  installDriver(): Promise<ActionResult>;
  openFirmwareUpdater(): Promise<ActionResult>;
  openExternal(url: string): Promise<void>;
}

declare global {
  interface Window {
    penpilot?: PenPilotDesktop;
  }
}

export const desktop: PenPilotDesktop | undefined = typeof window === "undefined" ? undefined : window.penpilot;
export const isWindows = desktop?.platform === "win32";
