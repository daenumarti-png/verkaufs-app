import OpenAI from "openai";
import type { GenerateMoodImageRequest } from "@verkaufs-app/shared";

const MODEL = "gpt-image-1";
// "medium" statt "high": guter Kompromiss Qualität/Kosten für ein
// unterstützendes Stimmungsbild, das nie das einzige Verkaufsfoto ist.
const QUALITY = "medium" as const;
const SIZE = "1024x1024" as const;

export const MOOD_IMAGE_DISCLAIMER =
  "KI-generiertes Stimmungsbild – zeigt NICHT den echten Artikel. Das reale Foto bleibt zusätzlich sichtbar.";

// Bewusst KEIN Versuch, den echten Artikel im generierten Bild abzubilden
// (Briefing Abschnitt 6, Ansatz 2: Halluzinationsrisiko an Artikel-Details).
// Stattdessen wird nur eine passende Atmosphäre/Umgebung erzeugt (z.B.
// sommerliche Terrassen-Szene für einen Sonnenschirm) – der Artikel selbst
// wird nicht Teil des generierten Bildes.
function buildPrompt(input: GenerateMoodImageRequest): string {
  const seasonHint = input.best_selling_period
    ? ` Passe die Stimmung/Beleuchtung zur Verkaufssaison "${input.best_selling_period}" an, falls sinnvoll.`
    : "";

  return `Erstelle ein stimmungsvolles, professionelles Atmosphären-/Umgebungsbild (kein Produktfoto) passend zum Verkauf eines gebrauchten Artikels der Kategorie "${input.category}" (${input.name}${input.condition_guess ? `, Zustand: ${input.condition_guess}` : ""}) auf einer Schweizer Occasion-Plattform.

Wichtig: Bilde KEIN konkretes, detailliertes Exemplar dieses Artikels ab – zeige stattdessen nur eine passende, einladende Szene/Umgebung/Lichtstimmung, die zur Kategorie passt (z.B. bei Gartenmöbeln eine sommerliche Terrasse, bei Wintersportartikeln eine verschneite Berglandschaft), warm und einladend, im Stil hochwertiger Lifestyle-Fotografie. Keine Texte, Logos oder Wasserzeichen im Bild.${seasonHint}`;
}

export async function generateMoodImageBase64(
  input: GenerateMoodImageRequest,
  apiKey: string
): Promise<string> {
  const client = new OpenAI({ apiKey });

  const response = await client.images.generate({
    model: MODEL,
    prompt: buildPrompt(input),
    size: SIZE,
    quality: QUALITY,
    n: 1,
  });

  const image = response.data?.[0];
  if (!image?.b64_json) {
    throw new Error("Keine Bilddaten von der Bildgenerierung erhalten.");
  }
  return image.b64_json;
}
