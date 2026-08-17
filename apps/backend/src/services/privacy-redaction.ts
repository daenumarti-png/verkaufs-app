import Anthropic from "@anthropic-ai/sdk";
import type { BoundingBox } from "@verkaufs-app/shared";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 1024;

// Datenschutz-Vorabstufe fürs Titelbild (Freisteller/Marketing-Titelbild):
// erkennt Gesichter und Fahrzeug-Kontrollschilder auf dem Foto, DAMIT NUR
// diese engen Bereiche verpixelt werden (siehe hero-image-composing.ts,
// redactPrivacyRegions) - explizit NICHT grossflächig unscharf, sondern eng
// am tatsächlichen Gesicht/Schild (Nutzeranforderung). Läuft absichtlich als
// eigener, gezielter Vision-Call statt Teil der normalen /items/analyze-
// Antwort zu sein, da er nur beim tatsächlichen Erstellen eines Titelbilds
// gebraucht wird, nicht bei jeder Analyse.
export type PrivacyRegions = {
  faces: BoundingBox[];
  licensePlates: BoundingBox[];
};

const EMPTY_REGIONS: PrivacyRegions = { faces: [], licensePlates: [] };

function buildPrompt(): string {
  return `Du bist ein Experte für Datenschutz in Verkaufsfotos. Untersuche GENAU dieses eine Foto auf zwei Arten datenschutzrelevanter Bereiche:

1. Menschliche Gesichter (auch teilweise sichtbare, im Hintergrund stehende oder unscharfe Personen) - die Box soll NUR das Gesicht selbst umfassen (etwa Stirn bis Kinn, Ohr zu Ohr), NICHT Haare, Hals, Schultern oder den ganzen Körper.
2. Fahrzeug-Kontrollschilder/Nummernschilder (Auto, Motorrad, Anhänger) - die Box soll NUR das Schild selbst umfassen, NICHT das ganze Fahrzeug.

Gib für jeden gefundenen Bereich eine MÖGLICHST ENGE Bounding Box an (als Bruchteil 0.0-1.0 der Bild-Breite/Höhe, "x"/"y" = linke obere Ecke, "width"/"height" = Breite/Höhe) - eng am tatsächlichen Gesicht bzw. Schild, NICHT grosszügig oder den halben Bildbereich. Wenn nichts davon sichtbar ist, gib ein leeres Array zurück - nicht raten oder Bereiche ohne wirklich sichtbares Gesicht/Schild markieren.

Antworte AUSSCHLIESSLICH mit validem JSON, ohne Erklärtext, ohne Markdown-Codeblock:
{
  "faces": [{ "x": Zahl 0-1, "y": Zahl 0-1, "width": Zahl 0-1, "height": Zahl 0-1 }],
  "license_plates": [{ "x": Zahl 0-1, "y": Zahl 0-1, "width": Zahl 0-1, "height": Zahl 0-1 }]
}`;
}

function extractJsonText(rawText: string): string {
  return rawText.replace(/```json|```/g, "").trim();
}

function isPlausibleBox(value: unknown): value is BoundingBox {
  if (!value || typeof value !== "object") return false;
  const box = value as Record<string, unknown>;
  const { x, y, width, height } = box;
  if (![x, y, width, height].every((n) => typeof n === "number" && Number.isFinite(n))) return false;
  const n = box as { x: number; y: number; width: number; height: number };
  if (n.width <= 0 || n.height <= 0) return false;
  if (n.x < -0.1 || n.y < -0.1 || n.x > 1.1 || n.y > 1.1 || n.width > 1.1 || n.height > 1.1) return false;
  return true;
}

/**
 * Fail-safe by design: wirft NIE, jeder Fehlerpfad (kein API-Key, API-Fehler,
 * ungültiges JSON) liefert leere Regionen zurück -> das Titelbild wird dann
 * unredigiert erstellt statt die ganze Funktion scheitern zu lassen. Ein
 * Datenschutz-Erkennungsfehler soll das Kernfeature (Titelbild erstellen)
 * nicht blockieren.
 */
export async function detectPrivacyRegions(
  photoBase64: string,
  mediaType: "image/jpeg",
  apiKey: string | undefined
): Promise<PrivacyRegions> {
  if (!apiKey) return EMPTY_REGIONS;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: photoBase64 } },
            { type: "text", text: buildPrompt() },
          ],
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") return EMPTY_REGIONS;

    const parsed: unknown = JSON.parse(extractJsonText(textBlock.text));
    if (!parsed || typeof parsed !== "object") return EMPTY_REGIONS;
    const rawFaces = (parsed as { faces?: unknown }).faces;
    const rawPlates = (parsed as { license_plates?: unknown }).license_plates;

    return {
      faces: Array.isArray(rawFaces) ? rawFaces.filter(isPlausibleBox) : [],
      licensePlates: Array.isArray(rawPlates) ? rawPlates.filter(isPlausibleBox) : [],
    };
  } catch {
    return EMPTY_REGIONS;
  }
}
