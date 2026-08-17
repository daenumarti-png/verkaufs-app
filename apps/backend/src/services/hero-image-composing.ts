import sharp from "sharp";
import type { BoundingBox } from "@verkaufs-app/shared";
import { detectPrivacyRegions } from "./privacy-redaction.js";

// Composing-Ansatz (Briefing Abschnitt 6, Ansatz 1): Artikel-Foto vor einen
// neutralen Studio-Hintergrund setzen, dezenter Bodenschatten für Räumlichkeit.
// Kein generatives Risiko – der Artikel selbst bleibt das unveränderte
// Originalfoto. Optional (composeMarketingHeroImage) wird zusätzlich Titel/
// Preis/Zustand als Text-Overlay ergänzt (Nutzerfeedback: das rein generative
// Stimmungsbild wurde durch diese Variante ersetzt, da das reale Foto
// erkennbar bleiben muss).
//
// Echter Freisteller (Hintergrund-Entfernung) ist aktuell deaktiviert, siehe
// Kommentar bei buildComposedOverlays() weiter unten.

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 1200;
const PADDING_RATIO = 0.12;
const BANNER_HEIGHT = 170;

// Phase 4b: Polster um die vom Modell gelieferte Bounding Box, bevor daraus
// zugeschnitten wird - Vision-Model-Boxen sind oft leicht zu eng, das
// verhindert abgeschnittene Artikelränder.
const BBOX_PADDING_RATIO = 0.12;

function isPlausibleBoundingBox(box: BoundingBox | null | undefined): box is BoundingBox {
  if (!box) return false;
  const { x, y, width, height } = box;
  if (![x, y, width, height].every((n) => typeof n === "number" && Number.isFinite(n))) return false;
  if (width <= 0 || height <= 0) return false;
  // Grosszügig toleranztolerant statt hart auf [0,1]: leicht ausserhalb wird
  // unten geclamped. Nur grob unplausible Werte (Modell-Halluzination, z.B.
  // width=5) werden verworfen -> Fallback aufs ganze Foto.
  if (x < -0.2 || y < -0.2 || x > 1.2 || y > 1.2 || width > 1.4 || height > 1.4) return false;
  return true;
}

function clampRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Fail-safe by design: wirft NIE. Jeder Fehlerpfad (kein Bild-Metadata,
// Rundungsfehler auf 0px, ungültige Box, sharp-Fehler) liefert das
// UNVERÄNDERTE Originalfoto zurück -> "kein Crop, ganzes Foto" bleibt der
// garantierte Fallback für jeden Aufrufer, der (noch) keine Bounding Box hat.
async function cropToBoundingBox(sourceBuffer: Buffer, box: BoundingBox | null | undefined): Promise<Buffer> {
  if (!isPlausibleBoundingBox(box)) return sourceBuffer;
  try {
    const { width: imgWidth, height: imgHeight } = await sharp(sourceBuffer).metadata();
    if (!imgWidth || !imgHeight) return sourceBuffer;

    const padX = box.width * BBOX_PADDING_RATIO;
    const padY = box.height * BBOX_PADDING_RATIO;
    const x0 = clampRange(box.x - padX, 0, 1);
    const y0 = clampRange(box.y - padY, 0, 1);
    const x1 = clampRange(box.x + box.width + padX, 0, 1);
    const y1 = clampRange(box.y + box.height + padY, 0, 1);

    const left = Math.round(x0 * imgWidth);
    const top = Math.round(y0 * imgHeight);
    const width = Math.min(Math.round((x1 - x0) * imgWidth), imgWidth - left);
    const height = Math.min(Math.round((y1 - y0) * imgHeight), imgHeight - top);
    if (width <= 0 || height <= 0) return sourceBuffer;

    return await sharp(sourceBuffer).extract({ left, top, width, height }).toBuffer();
  } catch {
    return sourceBuffer;
  }
}

// Kleinerer Sicherheitsrand als beim Artikel-Crop (BBOX_PADDING_RATIO):
// hier soll wirklich nur das Gesicht/Schild selbst verpixelt werden, kein
// grossflächiger Bereich (explizite Nutzeranforderung) - der Rand gleicht
// nur leichte Ungenauigkeit der KI-Erkennung aus.
const PRIVACY_PADDING_RATIO = 0.06;

async function pixelateRegion(
  buffer: Buffer,
  imgWidth: number,
  imgHeight: number,
  box: BoundingBox
): Promise<sharp.OverlayOptions | null> {
  const padX = box.width * PRIVACY_PADDING_RATIO;
  const padY = box.height * PRIVACY_PADDING_RATIO;
  const x0 = clampRange(box.x - padX, 0, 1);
  const y0 = clampRange(box.y - padY, 0, 1);
  const x1 = clampRange(box.x + box.width + padX, 0, 1);
  const y1 = clampRange(box.y + box.height + padY, 0, 1);

  const left = Math.round(x0 * imgWidth);
  const top = Math.round(y0 * imgHeight);
  const width = Math.min(Math.round((x1 - x0) * imgWidth), imgWidth - left);
  const height = Math.min(Math.round((y1 - y0) * imgHeight), imgHeight - top);
  if (width <= 0 || height <= 0) return null;

  try {
    const patch = await sharp(buffer).extract({ left, top, width, height }).toBuffer();
    // Deutlich sichtbare Pixelation statt weichem Weichzeichner - eindeutig
    // als "absichtlich verdeckt" erkennbar, nicht durch simple
    // Schärfungsfilter rückgängig zu machen.
    const blockSize = Math.max(3, Math.round(Math.min(width, height) / 9));
    const smallWidth = Math.max(1, Math.round(width / blockSize));
    const smallHeight = Math.max(1, Math.round(height / blockSize));
    const pixelated = await sharp(patch)
      .resize(smallWidth, smallHeight, { kernel: "nearest" })
      .resize(width, height, { kernel: "nearest" })
      .toBuffer();
    return { input: pixelated, left, top };
  } catch {
    return null;
  }
}

// Fail-safe: liefert bei jedem Fehler (Metadata fehlt, sharp-Fehler) das
// unveränderte Foto zurück, statt das Titelbild scheitern zu lassen -
// Datenschutz-Verpixelung ist eine Zusatz-Absicherung, kein Grund, das
// Kernfeature zu blockieren.
async function redactPrivacyRegions(buffer: Buffer, regions: BoundingBox[]): Promise<Buffer> {
  if (regions.length === 0) return buffer;
  try {
    const { width: imgWidth, height: imgHeight } = await sharp(buffer).metadata();
    if (!imgWidth || !imgHeight) return buffer;

    const overlays = (
      await Promise.all(regions.map((box) => pixelateRegion(buffer, imgWidth, imgHeight, box)))
    ).filter((o): o is sharp.OverlayOptions => o !== null);
    if (overlays.length === 0) return buffer;

    return await sharp(buffer).composite(overlays).toBuffer();
  } catch {
    return buffer;
  }
}

export interface MarketingFacts {
  title: string;
  priceChf: number;
  conditionGuess?: string;
}

// Nutzerfeedback: das bisherige Design (warmer Radial-Verlauf + reiner
// Text-Balken) wirkte zu "roh"/unprofessionell. Überarbeitet nach Vorbild
// hochwertiger Vorlagen-Designs (dezentes geometrisches Akzentelement,
// klare Kartenwirkung durch einen dünnen Rahmen) - Farben bleiben bewusst
// bei der bestehenden App-Palette (Gold/Dunkel/Petrol aus constants/theme.ts),
// damit das Titelbild zur restlichen App passt statt einen fremden Blauton
// zu übernehmen.
function buildBackgroundSvg(width: number, height: number): string {
  const accentSize = width * 0.5;
  const accentCx = width * 0.87;
  const accentCy = height * 0.13;
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#F8F6F1"/>
        <stop offset="100%" stop-color="#E5E1D6"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#bg)"/>
    <g transform="rotate(12 ${accentCx} ${accentCy})">
      <rect x="${accentCx - accentSize / 2}" y="${accentCy - accentSize / 2}" width="${accentSize}" height="${accentSize}" fill="#D4A017" opacity="0.07"/>
      <rect x="${accentCx - accentSize / 2}" y="${accentCy - accentSize / 2}" width="${accentSize}" height="${accentSize}" fill="none" stroke="#D4A017" stroke-width="2" opacity="0.22"/>
    </g>
    <rect x="14" y="14" width="${width - 28}" height="${height - 28}" fill="none" stroke="#1C1B19" stroke-width="1.5" opacity="0.14"/>
  </svg>`;
}

// Preis als eigenständiges Badge (statt reiner Text auf Verlauf) - deutlich
// "gestalteter" Eindruck, orientiert an Preis-Ecketiketten professioneller
// Verkaufsvorlagen. Positioniert oben links, damit es sich nicht mit dem
// unteren Titel-Balken überschneidet.
function buildPriceBadgeSvg(priceChf: number): string {
  const priceText = escapeSvgText(`CHF ${Math.round(priceChf)}`);
  // Grobe Breitenschätzung je Zeichen bei Schriftgrösse 36/Bold - keine exakte
  // Textmessung möglich (dafür bräuchte es eine Canvas-Bibliothek), grosszügig
  // geschätzt, damit der Text nie am Badge-Rand abgeschnitten wirkt.
  const badgeWidth = 64 + priceText.length * 24;
  const badgeHeight = 76;
  const margin = 36;
  return `<svg width="${badgeWidth + margin * 2}" height="${badgeHeight + margin * 2}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#000000" flood-opacity="0.28"/>
      </filter>
    </defs>
    <rect x="${margin}" y="${margin}" width="${badgeWidth}" height="${badgeHeight}" rx="10" fill="#D4A017" filter="url(#shadow)"/>
    <text x="${margin + badgeWidth / 2}" y="${margin + badgeHeight / 2 + 13}" font-family="Arial, sans-serif" font-size="36" font-weight="800" letter-spacing="0.3" fill="#1C1B19" text-anchor="middle">${priceText}</text>
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

// Durchgehender dunkler Balken statt eines auslaufenden Verlaufs - wirkt
// wie eine bewusst gestaltete Titelzeile statt eines nachträglich
// aufgelegten Textes. Dünne Gold-Trennlinie oben als Markenelement. Preis
// steht jetzt im eigenen Badge (buildPriceBadgeSvg), hier nur noch Titel +
// Zustand als dezentes Tag. Zeichenlimits sind grobe Schätzwerte für die
// gewählte Schriftgrösse/-breite, keine exakte Textmessung (dafür bräuchte
// es eine Canvas-Bibliothek).
function buildFactsBannerSvg(width: number, height: number, facts: MarketingFacts): string {
  const title = escapeSvgText(truncateForBanner(facts.title, 42));
  const condition = facts.conditionGuess ? escapeSvgText(truncateForBanner(facts.conditionGuess, 28)) : null;
  const conditionLabel = condition?.toUpperCase() ?? "";
  const tagWidth = 56 + conditionLabel.length * 12.5;

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${width}" height="${height}" fill="#1C1B19"/>
    <rect x="0" y="0" width="${width}" height="3" fill="#D4A017"/>
    <text x="44" y="${Math.round(height * 0.46)}" font-family="Arial, sans-serif" font-size="38" font-weight="700" fill="#F5F1E8">${title}</text>
    ${
      condition
        ? `<rect x="44" y="${Math.round(height * 0.6)}" width="${tagWidth}" height="36" rx="18" fill="none" stroke="#4A7A6D" stroke-width="1.5"/>
    <text x="${44 + tagWidth / 2}" y="${Math.round(height * 0.6) + 24}" font-family="Arial, sans-serif" font-size="15" font-weight="700" letter-spacing="0.8" fill="#4A7A6D" text-anchor="middle">${conditionLabel}</text>`
        : ""
    }
  </svg>`;
}

// TEMPORÄR deaktiviert (siehe unten) - Hintergrund-Entfernung bewusst NICHT
// mehr aufgerufen. @imgly/background-removal-node (onnxruntime-node ~1.17,
// letztes Paket-Release ~2 Jahre her, faktisch unmaintained) stürzt in der
// Cloud-Run-Produktionsumgebung reproduzierbar UND SOFORT (<2s, also vor
// echter Modell-Inferenz) mit einem nativen Speicherfehler ab ("free():
// invalid size" / "munmap_chunk(): invalid pointer", SIGABRT) - das reisst
// den GESAMTEN Container-Prozess mit, nicht nur den einzelnen Request, und
// betrifft daher potenziell auch andere gleichzeitige Nutzer. Weder ein
// zusätzliches CPU-Kontingent (2 vCPU statt Default) noch mehr Memory (2GiB)
// behoben das - kein reines Ressourcenproblem, sondern vermutlich eine
// Binärkompatibilität der vorkompilierten onnxruntime-node-Engine mit der
// Cloud-Run-Laufzeitumgebung. Bis eine stabile Ersatz-Bibliothek evaluiert
// ist, wird das freigestellte Studio-Hintergrund-Kompositing übersprungen -
// der Artikel bleibt auf seinem Originalfoto (nur zugeschnitten), damit
// Freisteller/Marketing-Titelbild wenigstens nutzbar bleiben statt zu crashen.
async function buildComposedOverlays(
  sourcePhotoBuffer: Buffer,
  boundingBox: BoundingBox | null | undefined,
  apiKey: string | undefined
): Promise<sharp.OverlayOptions[]> {
  // Phase 4b: falls eine Bounding Box übergeben wurde, zuerst auf genau
  // diesen Artikel zuschneiden, damit der Freisteller nicht andere Artikel
  // auf demselben Gruppenfoto mit einschliesst. Ohne/mit ungültiger Box:
  // unverändertes Originalfoto (bisheriges Verhalten).
  const croppedBuffer = await cropToBoundingBox(sourcePhotoBuffer, boundingBox);

  // Datenschutz: Gesichter/Kontrollschilder auf dem für das Titelbild
  // verwendeten (bereits zugeschnittenen) Foto erkennen und NUR diese engen
  // Bereiche verpixeln, bevor das Foto öffentlich sichtbar wird - läuft auf
  // dem bereits zugeschnittenen Foto, damit die Bounding Boxes direkt in
  // der richtigen Koordinaten-Basis liegen.
  const privacyRegions = await detectPrivacyRegions(croppedBuffer.toString("base64"), "image/jpeg", apiKey);
  const redactedBuffer = await redactPrivacyRegions(croppedBuffer, [
    ...privacyRegions.faces,
    ...privacyRegions.licensePlates,
  ]);

  const maxItemWidth = Math.round(CANVAS_WIDTH * (1 - PADDING_RATIO * 2));
  const maxItemHeight = Math.round(CANVAS_HEIGHT * (1 - PADDING_RATIO * 2));

  // Bewusst OHNE withoutEnlargement: ist das (zugeschnittene) Quellfoto
  // kleiner als die Ziel-Canvas, muss es hochskaliert werden, sonst entsteht
  // ein winziges Motiv auf grossem Hintergrund.
  const resizedItem = await sharp(redactedBuffer)
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

export async function composeHeroImage(
  sourcePhotoBuffer: Buffer,
  boundingBox?: BoundingBox | null,
  apiKey?: string
): Promise<Buffer> {
  const overlays = await buildComposedOverlays(sourcePhotoBuffer, boundingBox, apiKey);
  return sharp(Buffer.from(buildBackgroundSvg(CANVAS_WIDTH, CANVAS_HEIGHT)))
    .composite(overlays)
    .jpeg({ quality: 90 })
    .toBuffer();
}

export async function composeMarketingHeroImage(
  sourcePhotoBuffer: Buffer,
  facts: MarketingFacts,
  boundingBox?: BoundingBox | null,
  apiKey?: string
): Promise<Buffer> {
  const overlays = await buildComposedOverlays(sourcePhotoBuffer, boundingBox, apiKey);
  const banner = Buffer.from(buildFactsBannerSvg(CANVAS_WIDTH, BANNER_HEIGHT, facts));
  const priceBadge = Buffer.from(buildPriceBadgeSvg(facts.priceChf));

  return sharp(Buffer.from(buildBackgroundSvg(CANVAS_WIDTH, CANVAS_HEIGHT)))
    .composite([
      ...overlays,
      { input: banner, left: 0, top: CANVAS_HEIGHT - BANNER_HEIGHT },
      { input: priceBadge, left: 0, top: 0 },
    ])
    .jpeg({ quality: 90 })
    .toBuffer();
}
