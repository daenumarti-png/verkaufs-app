// Ergänzt PWA-Manifest + Apple-Touch-Icon-Link im von "expo export --platform
// web" erzeugten dist/index.html. Expo Routers eigener +html.tsx-Mechanismus
// dafür setzt web.output="static" voraus (SSG mit einer HTML-Datei pro Route)
// - eine grössere Verhaltensänderung als hier nötig (bestehende Auth-/Stripe-/
// eBay-OAuth-Flows laufen bewusst als reine Single-Page-App). Deshalb per
// simplem String-Patch nach dem normalen Single-Output-Export.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const indexPath = path.join(repoRoot, "apps", "mobile", "dist", "index.html");

if (!existsSync(indexPath)) {
  console.error(`Fehlt: ${indexPath} - vorher "expo export --platform web" ausführen.`);
  process.exit(1);
}

let html = readFileSync(indexPath, "utf8");

if (!html.includes('rel="manifest"')) {
  html = html.replace(
    '<link rel="icon" href="/favicon.ico" />',
    '<link rel="icon" href="/favicon.ico" /><link rel="manifest" href="/manifest.json" /><link rel="apple-touch-icon" href="/apple-touch-icon.png" /><meta name="theme-color" content="#1C1B19" />',
  );
}
html = html.replace('<html lang="en">', '<html lang="de-CH">');

writeFileSync(indexPath, html);
console.log("dist/index.html gepatcht (Manifest + Apple-Touch-Icon + Sprache).");
