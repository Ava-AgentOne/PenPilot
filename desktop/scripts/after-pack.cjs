// electron-builder afterPack hook: ad-hoc sign the Mac app.
// Without any signature Apple Silicon Macs refuse to start it; an ad-hoc
// signature (no paid certificate) is enough for PenPilot's private use.
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  // electron-builder flips Electron's fuses (electron-builder.yml) only after
  // this hook, which would break the signature made here. Flip them first; its
  // own flip afterwards then changes nothing.
  const fuses = context.packager.config.electronFuses;
  if (fuses) await context.packager.addElectronFuses(context, await context.packager.generateFuseConfig(fuses));
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
};
