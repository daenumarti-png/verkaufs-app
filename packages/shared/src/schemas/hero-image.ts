import { z } from "zod";

// Ergebnis des Composing-Ansatzes (Freisteller + Hintergrund + Schatten,
// Briefing Abschnitt 6, Ansatz 1 – robust, kein Halluzinationsrisiko am
// Artikel selbst, da nur das reale Foto freigestellt/neu hinterlegt wird).
export const heroImageComposingResultSchema = z.object({
  image_base64: z.string().min(1),
  media_type: z.literal("image/jpeg"),
});

// Request für das generative Stimmungsbild – bewusst kein Foto-Upload, da
// NICHT versucht wird, den echten Artikel neu abzubilden (Halluzinationsrisiko,
// siehe Briefing Abschnitt 6, Ansatz 2), sondern nur eine passende
// Atmosphäre/Umgebung generiert wird.
export const generateMoodImageRequestSchema = z.object({
  name: z.string().min(1).max(120),
  category: z.string().min(1).max(80),
  condition_guess: z.string().max(80).optional(),
  best_selling_period: z.string().max(60).optional(),
});

export const heroImageGenerativeResultSchema = z.object({
  image_base64: z.string().min(1),
  media_type: z.literal("image/png"),
  // Für den Client verpflichtend anzuzeigen: macht deutlich, dass dies KEIN
  // Foto des echten Artikels ist. Das reale Foto muss laut Briefing immer
  // zusätzlich sichtbar bleiben – dieses Bild ersetzt es nie.
  disclaimer: z.string().min(1),
});

export type HeroImageComposingResult = z.infer<typeof heroImageComposingResultSchema>;
export type GenerateMoodImageRequest = z.infer<typeof generateMoodImageRequestSchema>;
export type HeroImageGenerativeResult = z.infer<typeof heroImageGenerativeResultSchema>;
