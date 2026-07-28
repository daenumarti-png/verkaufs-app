import { z } from "zod";
import { itemAnalysisResultSchema } from "./item-analysis.js";

export const photoWarningSchema = z.object({
  filename: z.string(),
  reason: z.string(),
});

// Antwort von POST /items/analyze: die reine KI-Analyse plus Metadaten zu
// Fotos, die unterwegs aussortiert wurden (siehe Phase 2 – "robuste
// Fehlerbehandlung pro Foto", ein einzelnes fehlerhaftes Foto darf den
// restlichen Batch nicht blockieren).
export const analyzeItemsResponseSchema = itemAnalysisResultSchema.extend({
  photo_warnings: z.array(photoWarningSchema),
  photos_used: z.number().int().nonnegative(),
  max_photos_exceeded: z.boolean(),
  truncated_response_repaired: z.boolean(),
  // Serverseitig berechnet (nicht vom Modell): true, wenn die Artikel-Anzahl
  // exakt am Limit liegt – unabhängig vom (ggf. unzuverlässigen)
  // additional_items_likely-Selbsteinschätzung des Modells ein zweites,
  // mechanisches Signal für den Client (Phase 4 – gestufter Flow).
  items_capped: z.boolean(),
  // Deterministischer, serverseitig formulierter Hinweistext für den Client,
  // wenn items_capped oder additional_items_likely zutrifft; sonst null.
  staging_hint: z.string().nullable(),
  // Phase 13: immer vorhanden, damit die UI Preis-/Score-Angaben nie
  // ungekennzeichnet als Garantie darstellen kann (Sicherheits-Checkliste).
  disclaimer: z.string(),
});

export type PhotoWarning = z.infer<typeof photoWarningSchema>;
export type AnalyzeItemsResponse = z.infer<typeof analyzeItemsResponseSchema>;
