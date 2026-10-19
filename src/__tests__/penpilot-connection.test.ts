import { describe, expect, it } from "vitest";
import { WebSerialDriver } from "../drivers.js";
import type { EBBPort } from "../ebb.js";
import { plan } from "../planning.js";

/** A pretend plotter that answers like an EiBotBoard until it's "unplugged". */
function fakePort() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let unplugged = false;
  const enc = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    start: (c) => {
      controller = c;
    },
  });
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      if (unplugged) throw new Error("Plotter connection is closed.");
      for (const cmd of new TextDecoder().decode(chunk).split("\r").filter(Boolean)) {
        const name = cmd.split(",")[0];
        setTimeout(() => {
          if (unplugged) return;
          if (name === "V") controller.enqueue(enc.encode("EBBv13_and_above EB Firmware Version 2.8.1\r\n"));
          else if (name === "QM") controller.enqueue(enc.encode("QM,0,0,0,0\n\r"));
          else controller.enqueue(enc.encode("OK\r\n"));
        }, 1);
      }
    },
  });
  const port = { readable, writable, close: async () => {} } as unknown as EBBPort;
  return {
    port,
    /** The USB cable comes out: no more replies; the reply stream ends. */
    unplug() {
      unplugged = true;
      controller.close();
    },
    /** Replies just stop (e.g. Windows hasn't noticed yet); only the disconnect event arrives. */
    goSilent() {
      unplugged = true;
    },
  };
}

const profile = { acceleration: 1000, maximumVelocity: 500, corneringFactor: 0 };
const longPlot = () =>
  plan(
    Array.from({ length: 40 }, (_, i) => [
      { x: 10, y: 10 + i },
      { x: 60, y: 10 + i },
    ]),
    {
      penUpPos: 20000,
      penDownPos: 15000,
      penDownProfile: profile,
      penUpProfile: profile,
      penDropDuration: 0.01,
      penLiftDuration: 0.01,
    },
  );

async function outcomeAfter(run: Promise<void>, ms: number): Promise<string> {
  let outcome = "still waiting";
  void run.then(
    () => {
      outcome = "finished";
    },
    (e: Error) => {
      outcome = `failed: ${e.message}`;
    },
  );
  await new Promise((r) => setTimeout(r, ms));
  return outcome;
}

describe("PenPilot: losing the plotter mid-plot", () => {
  it("stops the plot (so it can be continued) when the cable comes out", async () => {
    const fp = fakePort();
    const driver = await WebSerialDriver.fromPort(fp.port, "fake");
    const run = Promise.resolve(driver.plot(longPlot()));
    await new Promise((r) => setTimeout(r, 100));
    fp.unplug();
    expect(await outcomeAfter(run, 300)).toMatch(/^failed: .*The plotter stopped answering/);
    expect(driver.connected).toBe(false);
  });

  it("stops the plot when only the disconnect event arrives", async () => {
    const fp = fakePort();
    const driver = await WebSerialDriver.fromPort(fp.port, "fake");
    const run = Promise.resolve(driver.plot(longPlot()));
    await new Promise((r) => setTimeout(r, 100));
    fp.goSilent();
    driver.markDisconnected();
    expect(await outcomeAfter(run, 300)).toMatch(/^failed: .*The plotter stopped answering/);
    // And nothing new waits forever either.
    await expect(driver.ebb.query("V")).rejects.toThrow("stopped answering");
  });
});
