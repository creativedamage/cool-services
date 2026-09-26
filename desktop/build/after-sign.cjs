/**
 * Optional: sign the app with the church's own (self-made) certificate instead of an ad-hoc
 * signature. A stable signature means macOS remembers "Always Allow" for the Keychain item that
 * protects saved sign-ins, so it doesn't ask again after every update.
 *
 * Used by the GitHub release workflow when the MAC_CERT_P12 secret is set (see README → Updates).
 * Without it, builds keep the ad-hoc signature and everything still works.
 */
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterSign(context) {
  const id = process.env.COOL_SIGN_IDENTITY;
  if (!id || context.electronPlatformName !== "darwin") return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const args = ["--force", "--deep", "--timestamp=none", "--sign", id];
  if (process.env.COOL_SIGN_KEYCHAIN) args.push("--keychain", process.env.COOL_SIGN_KEYCHAIN);
  console.log(`  • signing ${path.basename(app)} with the Cool Services certificate`);
  execFileSync("/usr/bin/codesign", [...args, app], { stdio: "inherit" });
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
};
