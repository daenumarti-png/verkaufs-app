import { z } from "zod";

// Request-Body für POST /items/research-collector-value. Wie bei
// refine-estimate.ts bewusst ohne Foto-Upload – der Name/die Kategorie aus
// der Erstanalyse reichen als Ausgangspunkt für die Web-Recherche.
export const collectorResearchRequestSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  condition_guess: z.string().optional(),
  current_estimate: z.object({
    estimated_price_chf_min: z.number().nonnegative(),
    estimated_price_chf_max: z.number().nonnegative(),
  }),
});

export const collectorSourceSchema = z.object({
  url: z.string().min(1),
  title: z.string().optional(),
});

export const salesVenueRecommendationSchema = z.object({
  recommended_venue: z.string().min(1),
  reasoning: z.string().min(1),
});

export const collectorValueResultSchema = z.object({
  collector_value_score: z.number().int().min(1).max(10),
  reasoning: z.string().min(1),
  adjusted_price_chf_min: z.number().nonnegative(),
  adjusted_price_chf_max: z.number().nonnegative(),
  sales_venue_recommendation: salesVenueRecommendationSchema,
  // Bewusst kein .min(1): Der Recherche-Prompt verlangt Quellenangaben,
  // aber wenn die Websuche wirklich nichts Verlässliches findet, soll das
  // Modell ein leeres Array + niedrige confidence liefern statt eine Quelle
  // zu erfinden, nur um die Validierung zu bestehen.
  sources: z.array(collectorSourceSchema).default([]),
  // Sicherheits-Checkliste (Briefing Abschnitt 8): bei widersprüchlichen/
  // unsicheren Treffern konservativ schätzen statt einen überzogenen Wert
  // zu suggerieren – confidence macht diese Unsicherheit fürs UI explizit.
  confidence: z.enum(["low", "medium", "high"]),
});

// Wrapper um das reine (KI-generierte) Ergebnis: disclaimer wird serverseitig
// angehängt (siehe routes/items.ts), NICHT vom Modell erzeugt (Phase 13).
export const collectorValueResponseSchema = collectorValueResultSchema.extend({
  disclaimer: z.string(),
});

export type CollectorResearchRequest = z.infer<typeof collectorResearchRequestSchema>;
export type CollectorSource = z.infer<typeof collectorSourceSchema>;
export type SalesVenueRecommendation = z.infer<typeof salesVenueRecommendationSchema>;
export type CollectorValueResult = z.infer<typeof collectorValueResultSchema>;
export type CollectorValueResponse = z.infer<typeof collectorValueResponseSchema>;
