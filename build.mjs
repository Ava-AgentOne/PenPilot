/* eslint-env node */

import { cpSync, rmSync } from "node:fs";
import { htmlPlugin as html } from "@craftamap/esbuild-plugin-html";
import { build, context } from "esbuild";
import inlineWorker from "esbuild-plugin-inline-worker";

// PenPilot desktop build: browser (Web Serial) UI, written straight into the
// Electron app folder, without source maps.
const isDesktop = process.env.PENPILOT_DESKTOP === "1";

const buildOptions = {
  entryPoints: ["src/ui.tsx", "src/background-planner.ts", "src/penpilot/trace-worker.ts"],
  bundle: true,
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: !isDesktop,
  metafile: true,
  logLevel: "debug",
  outdir: isDesktop ? "desktop/app/ui" : "dist/ui",
  tsconfig: "tsconfig.ui.json",
  loader: { ".svg": "file", ".woff": "file", ".woff2": "file" },
  define: {
    IS_WEB: (process.env.IS_WEB === "1" || isDesktop).toString(),
    "process.env.DEBUG_SAXI_COMMANDS": JSON.stringify(process.env.DEBUG_SAXI_COMMANDS ?? ""),
    "process.env.SAXI_FIFO_DEPTH": JSON.stringify(process.env.SAXI_FIFO_DEPTH ?? ""),
  },
  plugins: [
    inlineWorker(),
    html({
      files: [
        {
          entryPoints: ["src/ui.tsx"],
          filename: "index.html",
          htmlTemplate: "src/index.html",
          scriptLoading: "defer",
        },
      ],
    }),
  ],
  resolveExtensions: [".mjs", ".js", ".ts", ".tsx", ".svg"],
};

// PenPilot: Plotterfun's photo styles run as plain Web Workers, copied as-is.
const copyPlotterfun = () => cpSync("vendor/plotterfun", `${buildOptions.outdir}/plotterfun`, { recursive: true });

(async () => {
  try {
    // The desktop build folder is entirely generated: start clean, so nothing
    // stray (e.g. test files) can end up inside an installer.
    if (isDesktop) rmSync(buildOptions.outdir, { recursive: true, force: true });
    copyPlotterfun();
    if (process.env.SAXI_HOT_RELOAD) {
      const ctx = await context({
        ...buildOptions,
        banner: { js: "new EventSource('/esbuild').addEventListener('change', () => location.reload());" },
      });
      await ctx.watch();
      const { host, port } = await ctx.serve({ servedir: "dist/ui", port: 9080 });
      console.log(`http://${host}:${port}`);
    } else {
      await build(buildOptions);
    }
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
