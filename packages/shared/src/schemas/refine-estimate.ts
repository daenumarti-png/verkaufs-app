import { z } from "zod";

// Antwort des Nutzers auf eine clarifying_question (siehe item-analysis.ts) –
// die angetippte Chip-Option, kein Freitext.
export const clarifyingAnswerSchema = z.object({
  question: z.string().min(1),
  selected_option: z.string().min(1),
});

// Request-Body für POST /items/refine-estimate. Bewusst ohne Fotos: die
// Rückfragen betreffen laut Konzept genau die Informationen, die aus den
// Fotos NICHT ablesbar sind (Masse, Speichergrösse, Vollständigkeit etc.),
// daher genügt der textuelle Artikel-Kontext + die Antworten.
export const refineEstimateRequestSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  condition_guess: z.string().optional(),
  current_estimate: z.object({
    estimated_price_chf_min: z.number().nonnegative(),
    estimated_price_chf_max: z.number().nonnegative(),
    sell_score: z.number().int().min(1).max(10),
    estimated_days_to_sell: z.number().int().nonnegative(),
  }),
  clarifying_answers: z.array(clarifyingAnswerSchema).min(1),
});

export const refineEstimateResultSchema = z.object({
  estimated_price_chf_min: z.number().nonnegative(),
  estimated_price_chf_max: z.number().nonnegative(),
  sell_score: z.number().int().min(1).max(10),
  estimated_days_to_sell: z.number().int().nonnegative(),
  // Kurze, für den Nutzer sichtbare Begründung, was sich geändert hat und
  // warum – Transparenz bei KI-generierten Preisanpassungen (Briefing
  // Abschnitt 8: Schätzungen nie als Garantie darstellen).
  adjustment_reasoning: z.string(),
});

// Wrapper um das reine (KI-generierte) Ergebnis: disclaimer wird serverseitig
// angehängt (siehe routes/items.ts), NICHT vom Modell erzeugt – konsistenter,
// von uns kontrollierter Wortlaut statt variabler KI-Formulierung (Phase 13).
export const refineEstimateResponseSchema = refineEstimateResultSchema.extend({
  disclaimer: z.string(),
});

export type ClarifyingAnswer = z.infer<typeof clarifyingAnswerSchema>;
export type RefineEstimateRequest = z.infer<typeof refineEstimateRequestSchema>;
export type RefineEstimateResult = z.infer<typeof refineEstimateResultSchema>;
export type RefineEstimateResponse = z.infer<typeof refineEstimateResponseSchema>;
