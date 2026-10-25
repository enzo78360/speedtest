// Signature « ad-hoc » de l'app Mac (sans certificat Apple payant).
// Sans elle, macOS Apple Silicon refuse d'ouvrir l'app depuis le Finder.
const { execFileSync } = require("child_process");
const path = require("path");

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  // Les attributs étendus (Finder, provenance…) font échouer codesign.
  execFileSync("xattr", ["-cr", app]);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
};
