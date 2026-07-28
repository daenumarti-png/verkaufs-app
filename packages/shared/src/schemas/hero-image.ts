import { z } from "zod";

// Ergebnis des Composing-Ansatzes (Freisteller + Hintergrund + Schatten,
// Briefing Abschnitt 6, Ansatz 1 – robust, kein Halluzinationsrisiko am
// Artikel selbst, da nur das reale Foto freigestellt/neu hinterlegt wird).
// Wird auch von /items/hero-image/marketing zurückgegeben (gleiche
// Bildform, nur mit zusätzlichem Text-Overlay).
export const heroImageComposingResultSchema = z.object({
  image_base64: z.string().min(1),
  media_type: z.literal("image/jpeg"),
});

// Request-Felder für POST /items/hero-image/marketing (multipart/form-data,
// zusätzlich zum Foto-Datei-Teil). Nimmt dasselbe freigestellte Nutzerfoto
// wie /items/hero-image/composing und ergänzt es um Titel/Preis/Zustand als
// Text-Overlay – bewusst KEIN rein generatives Bild (Nutzerfeedback: das
// reale Foto muss erkennbar bleiben, ergänzt um die wichtigsten Fakten).
export const composeMarketingHeroImageFieldsSchema = z.object({
  title: z.string().min(1).max(120),
  price_chf: z.coerce.number().nonnegative(),
  condition_guess: z.string().max(80).optional(),
});

export type HeroImageComposingResult = z.infer<typeof heroImageComposingResultSchema>;
export type ComposeMarketingHeroImageFields = z.infer<typeof composeMarketingHeroImageFieldsSchema>;
