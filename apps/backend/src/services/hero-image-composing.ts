import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { removeBackground } from "@imgly/background-removal-node";

// Composing-Ansatz (Briefing Abschnitt 6, Ansatz 1): Artikel per Freisteller
// aus dem besten Nutzerfoto isolieren, vor einen neutralen Studio-Hintergrund
// setzen, dezenter Bodenschatten für Räumlichkeit. Kein generatives Risiko –
// der Artikel selbst bleibt das unveränderte Originalfoto, nur freigestellt.
//
// Hinweis: removeBackground lädt beim ersten Aufruf ein ONNX-Segmentierungsmodell
// nach (~Netzwerkzugriff, danach lokal gecacht) – erster Call ist deshalb spürbar
// langsamer als folgende.

// @imgly/background-removal-node berechnet seinen Standard-publicPath relativ
// zu process.cwd() (siehe deren schema.ts). Unter npm-Workspaces ist cwd beim
// "npm run dev --workspace=apps/backend" aber apps/backend, während das Paket
// (durch Hoisting) im Root-node_modules liegt -> ENOENT auf resources.json.
// Fix: publicPath explizit über echte ESM-Modulauflösung bestimmen statt auf
// den kaputten cwd-Default zu vertrauen.
const packageEntryUrl = import.meta.resolve("@imgly/background-removal-node");
const packageDistDir = path.dirname(fileURLToPath(packageEntryUrl));
const RESOURCES_PUBLIC_PATH = `file://${packageDistDir.replace(/\\/g, "/")}/`;

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 1200;
const PADDING_RATIO = 0.12;

function buildBackgroundSvg(width: number, height: number): string {
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="bg" cx="50%" cy="42%" r="75%">
        <stop offset="0%" stop-color="#f5f1e8"/>
        <stop offset="100%" stop-color="#dcd5c4"/>
      </radialGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#bg)"/>
  </svg>`;
}

function buildShadowSvg(width: number, height: number): string {
  const blurRadius = Math.max(4, Math.round(height * 0.35));
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="blur" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="${blurRadius}"/>
      </filter>
    </defs>
    <ellipse cx="${width / 2}" cy="${height / 2}" rx="${width * 0.42}" ry="${height * 0.3}" fill="#000000" opacity="0.32" filter="url(#blur)"/>
  </svg>`;
}

export async function composeHeroImage(sourcePhotoBuffer: Buffer): Promise<Buffer> {
  // Bewusst ein Blob mit explizitem MIME-Type statt des rohen Buffers: Die
  // Bibliothek wrapt einen rohen Buffer intern selbst in ein Blob, aber ohne
  // "type" zu setzen, was ihre eigene Formaterkennung mit "Unsupported
  // format: " (leerer String) scheitern lässt.
  const sourceBlob = new Blob([sourcePhotoBuffer], { type: "image/jpeg" });

  const cutoutBlob = await removeBackground(sourceBlob, {
    publicPath: RESOURCES_PUBLIC_PATH,
    model: "medium",
    output: { format: "image/png" },
  });
  const cutoutBuffer = Buffer.from(await cutoutBlob.arrayBuffer());

  // Transparente Ränder wegschneiden, damit der Artikel zentriert und
  // proportional auf den neuen Hintergrund passt (statt in der ursprünglichen,
  // ggf. sehr weiten Foto-Rahmung zu "schwimmen").
  const trimmed = await sharp(cutoutBuffer).trim().toBuffer();

  const maxItemWidth = Math.round(CANVAS_WIDTH * (1 - PADDING_RATIO * 2));
  const maxItemHeight = Math.round(CANVAS_HEIGHT * (1 - PADDING_RATIO * 2));

  // Bewusst OHNE withoutEnlargement: Das Segmentierungsmodell läuft intern auf
  // fester Auflösung: Ist das Quellfoto kleiner als die Ziel-Canvas, muss der
  // freigestellte Artikel hochskaliert werden, sonst entsteht ein winziges
  // Motiv auf grossem Hintergrund. Kleinere Quellfotos ergeben eine weichere
  // Kante, das ist der bessere Kompromiss gegenüber einem verlorenen Artikel.
  const resizedItem = await sharp(trimmed)
    .resize({ width: maxItemWidth, height: maxItemHeight, fit: "inside" })
    .toBuffer();
  const { width: itemWidth, height: itemHeight } = await sharp(resizedItem).metadata();

  const finalItemWidth = itemWidth ?? maxItemWidth;
  const finalItemHeight = itemHeight ?? maxItemHeight;
  const itemLeft = Math.round((CANVAS_WIDTH - finalItemWidth) / 2);
  const itemTop = Math.round((CANVAS_HEIGHT - finalItemHeight) / 2);

  const shadowWidth = Math.round(finalItemWidth * 0.85);
  const shadowHeight = Math.max(20, Math.round(finalItemHeight * 0.18));
  const shadowLeft = Math.round((CANVAS_WIDTH - shadowWidth) / 2);
  const shadowTop = itemTop + finalItemHeight - Math.round(shadowHeight * 0.5);

  return sharp(Buffer.from(buildBackgroundSvg(CANVAS_WIDTH, CANVAS_HEIGHT)))
    .composite([
      { input: Buffer.from(buildShadowSvg(shadowWidth, shadowHeight)), left: shadowLeft, top: shadowTop },
      { input: resizedItem, left: itemLeft, top: itemTop },
    ])
    .jpeg({ quality: 90 })
    .toBuffer();
}
