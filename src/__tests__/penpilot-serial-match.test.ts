import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { isEBB } = require("../../desktop/app/serial-match.cjs") as { isEBB: (port: unknown) => boolean };

// Shapes taken from Electron 44's shell/browser/serial (PortInfoToValue and the
// serial port gin converter). If Electron changes them, PenPilot stops finding
// the plotter, so pin them down here.
describe("PenPilot: recognising the AxiDraw's EiBotBoard", () => {
  it("in the select-serial-port list (decimal strings)", () => {
    expect(isEBB({ portId: "1", portName: "cu.usbmodem1101", vendorId: "1240", productId: "64914" })).toBe(true);
  });

  it("in the macOS pre-approval check (snake_case numbers)", () => {
    expect(isEBB({ name: "EiBotBoard", vendor_id: 1240, product_id: 64914, serial_number: "x" })).toBe(true);
  });

  it("in the Windows pre-approval check (device instance id only)", () => {
    expect(isEBB({ name: "USB Serial Device (COM4)", device_instance_id: "USB\\VID_04D8&PID_FD92\\5&2B1C&0&2" })).toBe(
      true,
    );
  });

  it("not for other devices", () => {
    expect(isEBB({ vendorId: "9025", productId: "67" })).toBe(false); // Arduino Uno
    expect(isEBB({ name: "x", device_instance_id: "USB\\VID_2341&PID_0043\\1" })).toBe(false);
    expect(isEBB({ name: "debug-console" })).toBe(false);
    expect(isEBB(null)).toBe(false);
  });
});
