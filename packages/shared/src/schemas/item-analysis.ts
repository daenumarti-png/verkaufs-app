import { z } from "zod";
import { listingPlatformSchema } from "./listing-export.js";

// Eine Rückfrage bei Preisunsicherheit, wenn Fotos allein nicht reichen
// (Briefing Abschnitt 4). Antworten sind bewusst kurze Optionen statt
// Freitext, damit die App sie als antippbare Auswahl-Chips darstellen kann
// (mobile-first, schnell beantwortbar) statt einer Texteingabe.
export const clarifyingQuestionSchema = z.object({
  question: z.string().min(1).max(120),
  options: z.array(z.string().min(1).max(30)).min(2).max(4),
});

// Idealer Verkaufszeitpunkt (Briefing Abschnitt 4). Immer befüllt – bei
// Artikeln ohne saisonalen Bezug (z.B. Elektronik) lautet period "ganzjährig"
// statt das Feld wegzulassen, damit das UI nicht zwischen "kein Wert" und
// "kein saisonaler Bezug" unterscheiden muss.
export const bestSellingPeriodSchema = z.object({
  period: z.string().min(1).max(60),
  reasoning: z.string().min(1).max(150),
});

// Bruchteile (0.0-1.0) relativ zu Breite/Höhe des EINEN Fotos, auf dem der
// Artikel laut Modell zu sehen ist (source_photo_index) - NICHT relativ zum
// gesamten Analyse-Aufruf. Bewusst ohne .min(0).max(1)-Constraint: das Modell
// kann leicht daneben liegen oder halluzinieren, und ein hartes Schema-Reject
// hier würde die GESAMTE Artikel-Analyse scheitern lassen wegen eines rein
// kosmetischen Felds. Plausibilitätsprüfung/Clamping passiert erst downstream
// beim Crop (hero-image-composing.ts), nicht hier.
export const boundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

// Phase Plattform-Empfehlung: nur befüllt, wenn EINE Plattform aus
// listingPlatformSchema für DIESEN Artikel klar besser geeignet ist als
// der Standard-Dreier (Tutti/Ricardo/eBay) - z.B. Vinted für Kleidung.
// Nutzt bewusst dasselbe Enum wie der Export-Feature (listing-export.ts),
// damit KI-Empfehlung und tatsächlich unterstützte Plattformen nie
// auseinanderlaufen können.
export const platformRecommendationSchema = z.object({
  platform: listingPlatformSchema,
  reasoning: z.string(),
});

/**
 * Vertrag für das Ergebnis der Foto-Analyse (Claude Vision).
 * Feldnamen bewusst snake_case, da dies das Schema ist, das dem Modell im
 * Prompt vorgegeben wird und das die rohe Modellantwort validiert (Phase 2).
 */
export const analyzedItemSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  condition_guess: z.string().min(1),
  suggested_title: z.string().min(1).max(80),
  suggested_description: z.string().min(1),
  estimated_price_chf_min: z.number().nonnegative(),
  estimated_price_chf_max: z.number().nonnegative(),
  sell_score: z.number().int().min(1).max(10),
  estimated_days_to_sell: z.number().int().nonnegative(),
  missing_photo_suggestions: z.array(z.string()).default([]),
  // Phase 5: nur befüllt, wenn Fotos allein für eine belastbare
  // Preisschätzung nicht ausreichen (z.B. Möbel-Masse, Speichergrösse bei
  // Elektronik). Max. 2 Fragen, nicht bei jedem Artikel pauschal.
  clarifying_questions: z.array(clarifyingQuestionSchema).max(2).default([]),
  // Phase 6: saisonale/kategoriebedingte Verkaufszeitpunkt-Empfehlung.
  best_selling_period: bestSellingPeriodSchema,
  // Phase 7: nur true bei echtem visuellem Verdacht auf Sammlerwert (Lego-Set
  // mit Nummer, Briefmarken/Münzen, Vintage-Spielzeug in Originalverpackung,
  // limitierte Editionen etc.). Löst KEINE Web-Recherche automatisch aus –
  // ist nur das Signal für den Client, POST /items/research-collector-value
  // anzubieten (separater, kostenpflichtiger Analyseschritt mit Live-Suche,
  // siehe Briefing Abschnitt 5, nicht bei jedem Alltagsartikel pauschal).
  possible_collector_value: z.boolean(),
  // Phase 4b: welches der hochgeladenen Fotos (0-indexiert, exakt in der
  // Reihenfolge des API-Aufrufs) diesen EINEN Artikel am klarsten zeigt,
  // plus eine enge Bounding Box darauf - fürs Freistellen des Titelfotos,
  // damit bei mehreren Artikeln auf einem Gruppenfoto nicht jedes Titelfoto
  // das ganze Gruppenfoto zeigt. Nullable + default(null): Modell liefert das
  // evtl. nicht oder unplausibel -> Fallback ist "kein Wert", was
  // hero-image-composing.ts als "kein Crop, ganzes Foto wie bisher"
  // interpretiert (fail-safe).
  source_photo_index: z.number().int().nullable().default(null),
  bounding_box: boundingBoxSchema.nullable().default(null),
  platform_recommendation: platformRecommendationSchema.nullable().default(null),
});

export const bundleRecommendationSchema = z
  .object({
    recommended: z.boolean(),
    reasoning: z.string(),
    bundle_price_chf: z.number().nonnegative().nullable(),
    // Phase 4b: analog zu bundle_price_chf - nur befüllt, wenn recommended=true.
    // Ohne diese Felder liesse sich das Bundle nicht als eigenes, vollwertiges
    // Inserat exportieren (Export-/eBay-Draft-Pipeline braucht suggested_title/
    // suggested_description/category als flache Pflichtfelder).
    suggested_title: z.string().max(80).nullable().default(null),
    suggested_description: z.string().nullable().default(null),
    category: z.string().nullable().default(null),
  })
  // Geschäftsregel: eine Bundle-Empfehlung ohne Preis/Titel/Beschreibung/
  // Kategorie ist nicht verwertbar. Erzwingt Konsistenz statt einer
  // stillschweigend unvollständigen Antwort.
  .refine((val) => !val.recommended || val.bundle_price_chf !== null, {
    message: "bundle_price_chf darf nicht null sein, wenn recommended=true",
    path: ["bundle_price_chf"],
  })
  .refine((val) => !val.recommended || (val.suggested_title?.trim().length ?? 0) > 0, {
    message: "suggested_title darf nicht leer sein, wenn recommended=true",
    path: ["suggested_title"],
  })
  .refine((val) => !val.recommended || (val.suggested_description?.trim().length ?? 0) > 0, {
    message: "suggested_description darf nicht leer sein, wenn recommended=true",
    path: ["suggested_description"],
  })
  .refine((val) => !val.recommended || (val.category?.trim().length ?? 0) > 0, {
    message: "category darf nicht leer sein, wenn recommended=true",
    path: ["category"],
  });

export const itemAnalysisResultSchema = z.object({
  items: z.array(analyzedItemSchema).min(1),
  multi_item_detected: z.boolean(),
  bundle_recommendation: bundleRecommendationSchema.nullable(),
  // Phase 4: true, wenn das Modell den Eindruck hat, dass mehr unterschiedliche
  // Artikel auf den Fotos zu sehen sind, als im gedeckelten Ergebnis Platz hatten
  // (siehe Prototyp-Erkenntnis #6 – grosse Sammlungen brauchen einen gestuften
  // Flow statt eines einzigen Analyse-Calls).
  additional_items_likely: z.boolean(),
});

export type ClarifyingQuestion = z.infer<typeof clarifyingQuestionSchema>;
export type BestSellingPeriod = z.infer<typeof bestSellingPeriodSchema>;
export type BoundingBox = z.infer<typeof boundingBoxSchema>;
export type PlatformRecommendation = z.infer<typeof platformRecommendationSchema>;
export type AnalyzedItem = z.infer<typeof analyzedItemSchema>;
export type BundleRecommendation = z.infer<typeof bundleRecommendationSchema>;
export type ItemAnalysisResult = z.infer<typeof itemAnalysisResultSchema>;
