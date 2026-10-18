// Recognising the AxiDraw's EiBotBoard (USB 04D8:FD92) in every shape
// Electron describes a serial port. Kept separate so it can be unit-tested
// (src/__tests__/penpilot-serial-match.test.ts).

const EBB_VENDOR_ID = 0x04d8;
const EBB_PRODUCT_ID = 0xfd92;

// Electron describes serial ports in two shapes:
//  - "select-serial-port" (requestPort): { portId, portName, displayName,
//    vendorId: "1240", productId: "64914" }  (decimal strings)
//  - setDevicePermissionHandler (getPorts): { name, vendor_id: 1240,
//    product_id: 64914, serial_number, ... } on macOS/Linux, but on Windows
//    only { name, device_instance_id: "USB\\VID_04D8&PID_FD92\\..." }.
// See shell/browser/serial/serial_chooser_context.cc (PortInfoToValue).
function parseUsbId(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || value === "") return Number.NaN;
  return /^\d+$/.test(value) ? Number(value) : Number.parseInt(value, 16);
}

function usbIds(port) {
  if (port == null) return { vendorId: Number.NaN, productId: Number.NaN };
  const instanceId = port.device_instance_id ?? port.deviceInstanceId;
  const fromInstance = typeof instanceId === "string" ? /VID_([0-9A-F]{4})&PID_([0-9A-F]{4})/i.exec(instanceId) : null;
  return {
    vendorId: parseUsbId(port.vendorId ?? port.vendor_id ?? (fromInstance ? fromInstance[1] : undefined)),
    productId: parseUsbId(port.productId ?? port.product_id ?? (fromInstance ? fromInstance[2] : undefined)),
  };
}

function isEBB(port) {
  const { vendorId, productId } = usbIds(port);
  return vendorId === EBB_VENDOR_ID && productId === EBB_PRODUCT_ID;
}

module.exports = { EBB_VENDOR_ID, EBB_PRODUCT_ID, isEBB, usbIds };
