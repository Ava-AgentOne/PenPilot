/**
 * PenPilot's "Plotter check": finds the AxiDraw, connects to it, and explains in
 * plain words what is wrong when something is (no USB, no driver, nobody
 * answering, old firmware, motor power adapter unplugged).
 *
 * Desktop only. In a plain browser saxi's own PortSelector is used instead.
 */

// biome-ignore lint/correctness/noUnusedImports: JSX compiles to React.createElement (classic runtime)
import React, { useCallback, useEffect, useRef, useState } from "react";
import { type BaseDriver, WebSerialDriver } from "../drivers.js";
import type { Hardware } from "../ebb.js";
import { desktop, isWindows } from "./desktop.js";
import { type NativePlotterPort, openNativePlotter } from "./native-port.js";

const EBB_VENDOR_ID = 0x04d8;
const EBB_PRODUCT_ID = 0xfd92;
const RECOMMENDED_FIRMWARE: [number, number, number] = [2, 5, 3];
const LATEST_FIRMWARE = "3.1.7";
const CONNECT_TIMEOUT_MS = 5000;

type Status = "pending" | "checking" | "ok" | "warn" | "fail" | "skipped";
type ActionId = "install-driver" | "update-firmware";

interface CheckItem {
  label: string;
  status: Status;
  detail?: string;
  action?: ActionId;
}

interface Checks {
  usb: CheckItem;
  talk: CheckItem;
  firmware: CheckItem;
  power: CheckItem;
}

const freshChecks = (): Checks => ({
  usb: { label: "Plotter plugged in by USB", status: "pending" },
  talk: { label: "PenPilot can talk to it", status: "pending" },
  firmware: { label: "Firmware", status: "pending" },
  power: { label: "Motor power adapter", status: "pending" },
});

const NOT_FOUND_TIPS =
  "Check the USB cable is plugged in at both ends and the light on the plotter's board is on. " +
  "Some USB cables only charge and carry no data, so try another cable or another USB port.";

function isEBBPort(port: SerialPort): boolean {
  const { usbVendorId, usbProductId } = port.getInfo();
  return usbVendorId === EBB_VENDOR_ID && usbProductId === EBB_PRODUCT_ID;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("no answer")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function grantedPlotterPort(): Promise<SerialPort | null> {
  const ports = (await navigator.serial.getPorts()).filter(isEBBPort);
  return ports[0] ?? null;
}

/**
 * Normally the desktop shell pre-approves the plotter (setDevicePermissionHandler
 * in desktop/app/main.cjs) and getPorts() finds it. On macOS Chromium only does
 * that for boards that report a USB serial number, so if the OS says a plotter is
 * plugged in but getPorts() doesn't list it, approve it once via requestPort()
 * (answered by the shell, no chooser). macOS may ask about Bluetooth then.
 */
async function findPlotterPort(onAskingOs: () => void): Promise<SerialPort | null> {
  const granted = await grantedPlotterPort();
  if (granted || !desktop) return granted;
  const present = await desktop.plotterPresent().catch(() => null);
  if (present === false) return null;
  onAskingOs();
  await desktop.requestPlotterPort().catch(() => false);
  return grantedPlotterPort();
}

/** A few plain facts to read out (or screenshot) when the plotter isn't recognised. */
async function describeForTroubleshooting(driver: BaseDriver | null): Promise<string> {
  if (!desktop) return "";
  const lines: string[] = [];
  try {
    const info = await desktop.info();
    lines.push(`PenPilot ${info.version} on ${info.platform} (Electron ${info.electron})`);
  } catch {}
  if (driver instanceof WebSerialDriver && driver.connected) {
    lines.push(`Connected: ${driver.name()}, firmware ${driver.ebb.firmwareVersion.join(".")}`);
  }
  try {
    const devices = await desktop.serialDevices();
    lines.push(
      devices.length === 0
        ? "Serial devices seen: none"
        : `Serial devices seen:\n${devices
            .map((d) => `  ${d.id} ${d.name}${d.isPlotter ? "  <- AxiDraw" : ""} (via ${d.via})\n    ${d.raw}`)
            .join("\n")}`,
    );
  } catch {}
  return lines.join("\n");
}

const allOk = (checks: Checks) => Object.values(checks).every((c: CheckItem) => c.status === "ok");

type Props = {
  driver: BaseDriver | null;
  setDriver: (driver: BaseDriver | null) => void;
  hardware: Hardware;
  /** True while a plot is running; checks are paused then. */
  busy: boolean;
};

export function PlotterCheck({ driver, setDriver, hardware, busy }: Props) {
  const [open, setOpen] = useState(true);
  const [running, setRunning] = useState(false);
  const [checks, setChecks] = useState<Checks>(freshChecks);
  const [message, setMessage] = useState<string | null>(null);
  const [techDetails, setTechDetails] = useState<string>("");
  const driverRef = useRef(driver);
  driverRef.current = driver;
  const runningRef = useRef(false);

  const showUnplugged = useCallback(() => {
    setChecks({
      ...freshChecks(),
      usb: {
        label: "Plotter plugged in by USB",
        status: "fail",
        detail: `The plotter was disconnected. ${NOT_FOUND_TIPS}`,
      },
    });
    setOpen(true);
  }, []);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setMessage(null);
    const next = freshChecks();
    const show = (patch: Partial<Checks>) => {
      Object.assign(next, patch);
      setChecks({ ...next });
    };
    try {
      show({ usb: { ...next.usb, status: "checking" } });

      // 1. Is the plotter there?
      const current = driverRef.current;
      let ebbDriver = current instanceof WebSerialDriver && current.connected ? current : null;
      // macOS talks to the plotter directly (desktop/app/native-serial.cjs);
      // elsewhere through Web Serial.
      const native = desktop?.nativeSerial;
      let found: { kind: "web"; port: SerialPort } | { kind: "native"; path: string } | null = null;
      if (!ebbDriver) {
        if (native) {
          const paths = await native.list().catch(() => [] as string[]);
          found = paths[0] ? { kind: "native", path: paths[0] } : null;
        } else {
          const port = await findPlotterPort(() =>
            show({ usb: { ...next.usb, status: "checking", detail: "Found it, asking for access…" } }),
          );
          found = port ? { kind: "web", port } : null;
        }
      }
      if (!ebbDriver && !found) {
        let usb: CheckItem = {
          ...next.usb,
          status: "fail",
          detail: `PenPilot can't find the plotter. ${NOT_FOUND_TIPS}`,
        };
        if (isWindows && desktop) {
          const win = await desktop.windowsDeviceStatus().catch(() => null);
          if (win?.present && !win.working) {
            usb = {
              ...next.usb,
              status: "fail",
              detail:
                "Windows can see the plotter but has no working driver for it. This happens on older Windows. " +
                "Press Install driver (Windows will ask for permission), then unplug and replug the USB cable.",
              action: "install-driver",
            };
          }
        }
        show({
          usb,
          talk: { ...next.talk, status: "skipped" },
          firmware: { ...next.firmware, status: "skipped" },
          power: { ...next.power, status: "skipped" },
        });
        return;
      }
      show({ usb: { ...next.usb, status: "ok" }, talk: { ...next.talk, status: "checking" } });

      // 2. Can we talk to it?
      if (!ebbDriver && found) {
        let nativePort: NativePlotterPort | null = null;
        try {
          if (found.kind === "native" && native) {
            nativePort = await openNativePlotter(native, found.path);
            const connected = await withTimeout(
              WebSerialDriver.fromPort(nativePort, found.path, hardware),
              CONNECT_TIMEOUT_MS,
            );
            nativePort.onClosed(() => {
              connected.markDisconnected();
              showUnplugged();
            });
            ebbDriver = connected;
          } else if (found.kind === "web") {
            ebbDriver = await withTimeout(WebSerialDriver.connect(found.port, hardware), CONNECT_TIMEOUT_MS);
          }
        } catch (e) {
          console.error("Plotter connect failed", e);
          nativePort?.close().catch(() => {});
          show({
            talk: {
              ...next.talk,
              status: "fail",
              detail:
                "The plotter is plugged in but didn't answer. Close any other program that might be using it " +
                "(Inkscape, saxi, the firmware updater), unplug the USB cable, plug it back in, and press Check again.",
            },
            firmware: { ...next.firmware, status: "skipped" },
            power: { ...next.power, status: "skipped" },
          });
          return;
        }
        setDriver(ebbDriver);
      }
      if (!ebbDriver) return;
      show({ talk: { ...next.talk, status: "ok" }, firmware: { ...next.firmware, status: "checking" } });

      // 3. Firmware
      const version = ebbDriver.ebb.firmwareVersion.join(".");
      if (ebbDriver.ebb.firmwareVersionCompare(...RECOMMENDED_FIRMWARE) < 0) {
        show({
          firmware: {
            label: `Firmware ${version}`,
            status: "warn",
            detail: isWindows
              ? `This firmware is old. Plotting still works but is a little less precise. Press Update firmware to install ${LATEST_FIRMWARE}.`
              : "This firmware is old. Plotting still works but is a little less precise. The official updater only runs on Windows: plug the plotter into the Windows PC and use Update firmware in PenPilot there (one time only).",
            action: isWindows ? "update-firmware" : undefined,
          },
        });
      } else {
        show({ firmware: { label: `Firmware ${version}`, status: "ok" } });
      }
      show({ power: { ...next.power, status: "checking" } });

      // 4. Motor power
      try {
        const powered = await withTimeout(ebbDriver.ebb.areSteppersPowered(), CONNECT_TIMEOUT_MS);
        show({
          power: powered
            ? { ...next.power, status: "ok" }
            : {
                ...next.power,
                status: "fail",
                detail:
                  "The motors have no power. Plug in the AxiDraw's power adapter (the round plug on the board), " +
                  "then press Check again. USB alone can't move the pen.",
              },
        });
      } catch (e) {
        console.error("Motor power check failed", e);
        show({
          power: {
            ...next.power,
            status: "warn",
            detail: "PenPilot couldn't check the motor power on this firmware.",
          },
        });
      }
    } finally {
      runningRef.current = false;
      setRunning(false);
      void describeForTroubleshooting(driverRef.current).then(setTechDetails);
      if (allOk(next)) setTimeout(() => setOpen(false), 1200);
    }
  }, [hardware, setDriver, showUnplugged]);

  // First check when the app opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
  useEffect(() => {
    void run();
  }, []);

  // macOS (direct connection): a plotter appearing re-runs the check.
  useEffect(() => {
    const native = desktop?.nativeSerial;
    if (!native) return;
    return native.onChanged((paths) => {
      if (paths.length > 0 && !driverRef.current?.connected && !busy) {
        setOpen(true);
        void run();
      }
    });
  }, [busy, run]);

  // Plugging in or unplugging the plotter re-runs the check (Web Serial).
  // Not on macOS: there the direct connection reports plug/unplug, and merely
  // listening to navigator.serial makes Chromium start its Bluetooth stack on
  // the main thread, which freezes the app until macOS's Bluetooth prompt is answered.
  useEffect(() => {
    if (desktop?.nativeSerial) return;
    const onConnect = () => {
      if (!busy) {
        setOpen(true);
        void run();
      }
    };
    const onDisconnect = () => {
      setChecks({
        ...freshChecks(),
        usb: {
          label: "Plotter plugged in by USB",
          status: "fail",
          detail: `The plotter was disconnected. ${NOT_FOUND_TIPS}`,
        },
      });
      setOpen(true);
    };
    navigator.serial.addEventListener("connect", onConnect);
    navigator.serial.addEventListener("disconnect", onDisconnect);
    return () => {
      navigator.serial.removeEventListener("connect", onConnect);
      navigator.serial.removeEventListener("disconnect", onDisconnect);
    };
  }, [busy, run]);

  const doAction = async (action: ActionId) => {
    if (!desktop) return;
    if (action === "install-driver") {
      setMessage("Installing the driver…");
      const result = await desktop.installDriver();
      setMessage(result.message ?? (result.ok ? "Done." : "Something went wrong."));
    } else if (action === "update-firmware") {
      // The updater needs the plotter to itself.
      const current = driverRef.current;
      if (current) {
        await current.close().catch(() => {});
        setDriver(null);
      }
      const result = await desktop.openFirmwareUpdater();
      setMessage(
        result.ok
          ? "The firmware updater is open. Follow its steps. When it says it has finished, unplug the plotter's USB cable, plug it back in, and press Check again."
          : (result.message ?? "Couldn't open the firmware updater."),
      );
    }
  };

  const connected = driver?.connected === true;
  const healthy = connected && allOk(checks);

  return (
    <>
      <div className={`pp-status ${healthy ? "pp-status--ok" : connected ? "pp-status--warn" : "pp-status--off"}`}>
        <span className="pp-dot" />
        {healthy ? "Plotter ready" : connected ? "Plotter connected, needs attention" : "Plotter not connected"}
      </div>
      <button type="button" disabled={busy} onClick={() => setOpen(true)}>
        Plotter check
      </button>

      {open && (
        <div className="pp-overlay">
          <div className="pp-card" role="dialog" aria-label="Plotter check">
            <div className="pp-card-title">Plotter check</div>
            <ul className="pp-checks">
              {Object.entries(checks).map(([key, item]: [string, CheckItem]) => (
                <li key={key} className={`pp-check pp-check--${item.status}`}>
                  <span className="pp-icon" aria-hidden="true">
                    {{ pending: "·", checking: "…", ok: "✓", warn: "!", fail: "✕", skipped: "–" }[item.status]}
                  </span>
                  <div className="pp-check-body">
                    <div className="pp-check-label">{item.label}</div>
                    {item.detail && <div className="pp-check-detail">{item.detail}</div>}
                    {item.action && (
                      <button
                        type="button"
                        className="pp-action"
                        disabled={running}
                        onClick={() => void doAction(item.action as ActionId)}
                      >
                        {item.action === "install-driver" ? "Install driver" : "Update firmware"}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {message && <div className="pp-message">{message}</div>}
            {techDetails && (
              <details className="pp-tech">
                <summary>Technical details</summary>
                <pre>{techDetails}</pre>
              </details>
            )}
            {allOk(checks) && !running && <div className="pp-message pp-message--ok">All good. Ready to plot.</div>}
            <div className="button-row">
              <button type="button" disabled={running || busy} onClick={() => void run()}>
                {running ? "Checking…" : "Check again"}
              </button>
              <button type="button" onClick={() => setOpen(false)}>
                {allOk(checks) ? "Close" : "Continue without plotter"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
