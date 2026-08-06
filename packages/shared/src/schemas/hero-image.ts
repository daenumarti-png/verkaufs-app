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
// Phase 4b: optionale Bounding-Box-Felder (flach, als multipart-Textfelder),
// damit das Titelfoto nur den einen erkannten Artikel freistellt statt des
// ganzen Fotos (relevant bei mehreren Artikeln auf einem Gruppenfoto).
// Best-effort, nie hart ablehnend: dies ist eine visuelle Qualitäts-
// Verbesserung, keine kritische Geschäftsdaten. .catch(undefined) sorgt
// dafür, dass auch ein ungültiger Wert (z.B. "abc" bei bbox_x) die
// Feld-Validierung nicht scheitern lässt, sondern still auf "nicht
// angegeben" zurückfällt -> Route bleibt nutzbar, Crop wird nur
// stillschweigend übersprungen (Fallback: ganzes Foto).
export const boundingBoxFieldsSchema = z.object({
  bbox_x: z.coerce.number().optional().catch(undefined),
  bbox_y: z.coerce.number().optional().catch(undefined),
  bbox_width: z.coerce.number().optional().catch(undefined),
  bbox_height: z.coerce.number().optional().catch(undefined),
});

export const composeMarketingHeroImageFieldsSchema = z
  .object({
    title: z.string().min(1).max(120),
    price_chf: z.coerce.number().nonnegative(),
    condition_guess: z.string().max(80).optional(),
  })
  .merge(boundingBoxFieldsSchema);

export type HeroImageComposingResult = z.infer<typeof heroImageComposingResultSchema>;
export type ComposeMarketingHeroImageFields = z.infer<typeof composeMarketingHeroImageFieldsSchema>;
export type BoundingBoxFields = z.infer<typeof boundingBoxFieldsSchema>;
