// Baut einen eigenständigen, deploybaren Ordner ("functions-deploy/") für
// Firebase Cloud Functions. Grund: apps/backend hängt via npm-Workspaces
// von "@verkaufs-app/shared" ab (Version "*") - das funktioniert lokal
// durch das Hoisting der Workspaces, aber Cloud Build installiert
// apps/backend isoliert (ohne den restlichen Monorepo-Kontext) und würde
// "@verkaufs-app/shared" vom öffentlichen npm-Registry laden wollen (404,
// da privates Paket). Dieses Skript kopiert die fertig gebauten
// dist-Ordner von apps/backend UND packages/shared in einen einzigen,
// in sich geschlossenen Ordner mit einer lokalen file:-Abhängigkeit -
// ändert NICHTS an apps/backend/package.json selbst, damit die normale
// lokale Monorepo-Entwicklung unverändert funktioniert.
import { existsSync, rmSync, mkdirSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const backendDir = path.join(repoRoot, "apps", "backend");
const sharedDir = path.join(repoRoot, "packages", "shared");
const stageDir = path.join(repoRoot, "functions-deploy");

for (const dir of [path.join(backendDir, "dist"), path.join(sharedDir, "dist")]) {
  if (!existsSync(dir)) {
    console.error(`Fehlt: ${dir} - vorher "npm run build" in beiden Workspaces ausführen.`);
    process.exit(1);
  }
}

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });

// Backend: dist + package.json (mit umgeschriebener shared-Abhängigkeit)
cpSync(path.join(backendDir, "dist"), path.join(stageDir, "dist"), { recursive: true });

const backendPkg = JSON.parse(readFileSync(path.join(backendDir, "package.json"), "utf8"));
backendPkg.dependencies["@verkaufs-app/shared"] = "file:./verkaufs-app-shared";
delete backendPkg.devDependencies;

// Bisherige Versuche und warum sie scheiterten:
// (a) generierten Client 1:1 nach node_modules/.prisma/client kopieren,
//     "@prisma/client" normal in package.json belassen: Cloud Builds
//     "npm install" installiert "@prisma/client" trotzdem frisch (kein
//     Lockfile zum Abgleichen vorhanden -> kompletter Neu-Install), dessen
//     EIGENES postinstall überschreibt ".prisma/client" dabei mit einem
//     "did not initialize yet"-Platzhalter, weil remote kein
//     schema.prisma existiert.
// (b) "prisma generate" selbst remote per postinstall laufen lassen
//     (schema.prisma mitgeliefert, "prisma" als Dependency): scheiterte an
//     der Cloud-Build-Umgebung selbst ("prisma: not found", dann "Cannot
//     find module .../prisma/build/index.js") - das CLI-Paket wird dort
//     aus unbekanntem Grund nicht zuverlässig nutzbar installiert/verlinkt.
// (c) "@prisma/client" komplett aus package.json entfernen, nur die
//     Ordner manuell nach node_modules kopieren: npm behandelt nicht in
//     package.json gelistete node_modules-Ordner als "extraneous" und
//     LÖSCHT sie beim "npm install" wieder ("Cannot find package
//     '@prisma/client'").
//
// Robuste Lösung: "@prisma/client" bleibt eine normale Dependency (wird
// also ganz gewöhnlich per npm install aus der Registry geholt - das
// funktioniert zuverlässig, nur der GENERIERTE Output kann remote nicht
// zuverlässig erzeugt werden). Der vorgenerierte Output (inkl.
// Linux-Query-Engine dank binaryTargets in schema.prisma) wird an einer
// Stelle AUSSERHALB von node_modules mitgeliefert (npm fasst ihn dort
// nicht an) und per eigenem "postinstall" NACH npm installs eigenem
// (destruktivem) Lauf über "@prisma/client"s postinstall zurück nach
// node_modules/.prisma/client kopiert - unser postinstall läuft
// garantiert zuletzt, da npm die Lifecycle-Skripte des Root-Pakets erst
// nach denen aller Dependencies ausführt.
backendPkg.scripts = { postinstall: "node scripts/restore-prisma-client.mjs" };
writeFileSync(path.join(stageDir, "package.json"), JSON.stringify(backendPkg, null, 2));

const localGeneratedClient = path.join(repoRoot, "node_modules", ".prisma", "client");
if (!existsSync(localGeneratedClient)) {
  console.error(`Fehlt: ${localGeneratedClient} - vorher "npx prisma generate" in apps/backend ausführen.`);
  process.exit(1);
}
mkdirSync(path.join(stageDir, "prisma-vendor", "client"), { recursive: true });
cpSync(localGeneratedClient, path.join(stageDir, "prisma-vendor", "client"), { recursive: true });

mkdirSync(path.join(stageDir, "scripts"), { recursive: true });
writeFileSync(
  path.join(stageDir, "scripts", "restore-prisma-client.mjs"),
  `import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = path.join(root, "prisma-vendor", "client");
const targetDir = path.join(root, "node_modules", ".prisma", "client");

if (!existsSync(vendorDir)) {
  console.error(\`Prisma-Vendor-Ordner fehlt: \${vendorDir}\`);
  process.exit(1);
}
cpSync(vendorDir, targetDir, { recursive: true, force: true });
console.log("Vorgenerierter Prisma-Client (Linux-Engine) wiederhergestellt.");
`,
);

// Shared: dist + eigenes package.json (unverändert, zeigt schon auf dist/index.js)
const sharedStageDir = path.join(stageDir, "verkaufs-app-shared");
mkdirSync(sharedStageDir, { recursive: true });
cpSync(path.join(sharedDir, "dist"), path.join(sharedStageDir, "dist"), { recursive: true });
cpSync(path.join(sharedDir, "package.json"), path.join(sharedStageDir, "package.json"));

console.log(`functions-deploy/ bereit (Backend + gebündeltes @verkaufs-app/shared).`);
