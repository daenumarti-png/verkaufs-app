import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { removeBackground } from "@imgly/background-removal-node";

// Composing-Ansatz (Briefing Abschnitt 6, Ansatz 1): Artikel per Freisteller
// aus dem besten Nutzerfoto isolieren, vor einen neutralen Studio-Hintergrund
// setzen, dezenter Bodenschatten für Räumlichkeit. Kein generatives Risiko –
// der Artikel selbst bleibt das unveränderte Originalfoto, nur freigestellt.
// Optional (composeMarketingHeroImage) wird zusätzlich Titel/Preis/Zustand
// als Text-Overlay ergänzt (Nutzerfeedback: das rein generative Stimmungsbild
// wurde durch diese Variante ersetzt, da das reale Foto erkennbar bleiben muss).
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
const BANNER_HEIGHT = 230;

export interface MarketingFacts {
  title: string;
  priceChf: number;
  conditionGuess?: string;
}

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

function escapeSvgText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncateForBanner(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

// Halbtransparenter Verlaufsbalken am unteren Bildrand mit Titel/Preis/
// Zustand als Text – bewusst KEIN Ersatz für das Foto, sondern eine Ergänzung
// darauf. Zeichenlimits sind grobe Schätzwerte für die gewählte Schriftgrösse/
// -breite, keine exakte Textmessung (dafür bräuchte es eine Canvas-Bibliothek).
function buildFactsBannerSvg(width: number, height: number, facts: MarketingFacts): string {
  const title = escapeSvgText(truncateForBanner(facts.title, 40));
  const price = escapeSvgText(`ab CHF ${Math.round(facts.priceChf)}`);
  const condition = facts.conditionGuess ? escapeSvgText(truncateForBanner(facts.conditionGuess, 26)) : null;

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="banner" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
        <stop offset="40%" stop-color="#000000" stop-opacity="0.7"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.82"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${width}" height="${height}" fill="url(#banner)"/>
    <text x="48" y="${height - 140}" font-family="Arial, sans-serif" font-size="44" font-weight="700" fill="#F5F1E8">${title}</text>
    <text x="48" y="${height - 66}" font-family="Arial, sans-serif" font-size="52" font-weight="700" fill="#D4A017">${price}</text>
    ${condition ? `<text x="${width - 48}" y="${height - 66}" font-family="Arial, sans-serif" font-size="30" font-weight="600" fill="#F5F1E8" text-anchor="end">${condition}</text>` : ""}
  </svg>`;
}

async function buildComposedOverlays(sourcePhotoBuffer: Buffer): Promise<sharp.OverlayOptions[]> {
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

  return [
    { input: Buffer.from(buildShadowSvg(shadowWidth, shadowHeight)), left: shadowLeft, top: shadowTop },
    { input: resizedItem, left: itemLeft, top: itemTop },
  ];
}

export async function composeHeroImage(sourcePhotoBuffer: Buffer): Promise<Buffer> {
  const overlays = await buildComposedOverlays(sourcePhotoBuffer);
  return sharp(Buffer.from(buildBackgroundSvg(CANVAS_WIDTH, CANVAS_HEIGHT)))
    .composite(overlays)
    .jpeg({ quality: 90 })
    .toBuffer();
}

export async function composeMarketingHeroImage(sourcePhotoBuffer: Buffer, facts: MarketingFacts): Promise<Buffer> {
  const overlays = await buildComposedOverlays(sourcePhotoBuffer);
  const banner = Buffer.from(buildFactsBannerSvg(CANVAS_WIDTH, BANNER_HEIGHT, facts));

  return sharp(Buffer.from(buildBackgroundSvg(CANVAS_WIDTH, CANVAS_HEIGHT)))
    .composite([...overlays, { input: banner, left: 0, top: CANVAS_HEIGHT - BANNER_HEIGHT }])
    .jpeg({ quality: 90 })
    .toBuffer();
}
