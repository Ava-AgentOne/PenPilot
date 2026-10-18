/**
 * The plotter's serial port over PenPilot's direct (native) connection, shaped
 * like a Web Serial port so saxi's EBB class can use it unchanged (macOS; see
 * desktop/app/native-serial.cjs for why).
 */

import type { EBBPort } from "../ebb.js";
import type { NativeSerial } from "./desktop.js";

export interface NativePlotterPort extends EBBPort {
  path: string;
  /** Called once if the plotter is unplugged or the connection closes. */
  onClosed: (fn: () => void) => void;
}

export async function openNativePlotter(native: NativeSerial, path: string): Promise<NativePlotterPort> {
  const { id } = await native.open(path);
  let closedFns: (() => void)[] = [];
  let closed = false;
  let stopData: () => void = () => {};
  let stopClosed: () => void = () => {};

  const finish = () => {
    if (closed) return;
    closed = true;
    stopData();
    stopClosed();
    for (const fn of closedFns) fn();
    closedFns = [];
  };

  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      stopData = native.onData((from, bytes) => {
        if (from === id) controller.enqueue(new Uint8Array(bytes));
      });
      stopClosed = native.onClosed((from) => {
        if (from !== id) return;
        try {
          controller.close();
        } catch {
          // already closed
        }
        finish();
      });
    },
  });

  const writable = new WritableStream<Uint8Array>({
    write: (chunk) => native.write(id, chunk),
  });

  return {
    path,
    readable,
    writable,
    async close() {
      await native.close(id);
      finish();
    },
    onClosed(fn) {
      if (closed) fn();
      else closedFns.push(fn);
    },
  };
}
