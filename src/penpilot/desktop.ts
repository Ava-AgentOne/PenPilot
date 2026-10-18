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

export interface FileResult {
  ok: boolean;
  canceled?: boolean;
  message?: string;
  /** Where it was saved or read from, and the file's name. */
  path?: string;
  name?: string;
}

export interface ActionResult {
  ok: boolean;
  message?: string;
}

export interface PenPilotDesktop {
  platform: string;
  info(): Promise<{ platform: string; version: string; electron: string }>;
  windowsDeviceStatus(): Promise<WindowsDeviceStatus>;
  /** Serial devices the desktop shell has been asked about (for troubleshooting). */
  serialDevices(): Promise<{ id: string; name: string; via: string; isPlotter: boolean; raw: string }[]>;
  /** Whether the OS itself sees an EiBotBoard on USB (null = couldn't tell). */
  plotterPresent(): Promise<boolean | null>;
  /** Grant the plotter's port via requestPort(); the shell picks it, no chooser. */
  requestPlotterPort(): Promise<boolean>;
  installDriver(): Promise<ActionResult>;
  openFirmwareUpdater(): Promise<ActionResult>;
  openExternal(url: string): Promise<void>;
  /** Bounce the Dock icon / flash the taskbar button if PenPilot isn't in front. */
  attention?(): Promise<void>;
  /** Save `text` to a file the user picks (a Save dialog). */
  saveFileAs?(kind: "project" | "svg", suggestedName: string, text: string): Promise<FileResult>;
  /** Save again to a file picked earlier in this session (no dialog). */
  saveFile?(path: string, text: string): Promise<FileResult>;
  /** Pick and read a PenPilot project (an Open dialog). */
  openProject?(): Promise<FileResult & { text?: string }>;
  /** Projects double-clicked in Finder / Explorer before the UI was ready. */
  takeOpenFiles?(): Promise<(FileResult & { text?: string })[]>;
  /** Menu bar commands ("new", "open", "save", "save-as", "export-svg", "help", "plotter-check"). */
  onMenu?(fn: (command: string) => void): () => void;
  /** Projects double-clicked while PenPilot is open. Returns a function to stop listening. */
  onOpenFile?(fn: (file: FileResult & { text?: string }) => void): () => void;
  /** macOS only: talk to the plotter directly instead of via Web Serial. */
  nativeSerial?: NativeSerial;
}

export interface NativeSerial {
  list(): Promise<string[]>;
  open(path: string): Promise<{ id: number; path: string }>;
  write(id: number, bytes: Uint8Array): Promise<void>;
  close(id: number): Promise<void>;
  onData(fn: (id: number, bytes: Uint8Array) => void): () => void;
  onClosed(fn: (id: number) => void): () => void;
  onChanged(fn: (paths: string[]) => void): () => void;
}

declare global {
  interface Window {
    penpilot?: PenPilotDesktop;
  }
}

export const desktop: PenPilotDesktop | undefined = typeof window === "undefined" ? undefined : window.penpilot;
export const isWindows = desktop?.platform === "win32";
