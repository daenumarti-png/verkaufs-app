import { z } from "zod";

// Muss mit den Keys in apps/backend/src/config/moderation.ts übereinstimmen
// (Phase 11, Briefing Abschnitt 8 / offene Frage 6, mit Nutzer abgestimmt).
export const prohibitedCategoryKeySchema = z.enum([
  "weapons",
  "drugs",
  "counterfeit",
  "protected_species",
  "extremist",
  "pornographic",
  "prescription_drugs",
  "hazardous",
  "live_animals",
  "stolen_goods",
]);

export const moderationResultSchema = z.object({
  blocked: z.boolean(),
  // Nur gesetzt, wenn blocked=true.
  category: prohibitedCategoryKeySchema.nullable(),
  // Immer vorhanden – auch bei blocked=false eine kurze Begründung, z.B.
  // "keine Auffälligkeiten" (Transparenz, kein stilles Durchwinken).
  reasoning: z.string().min(1),
});

export type ProhibitedCategoryKey = z.infer<typeof prohibitedCategoryKeySchema>;
export type ModerationResult = z.infer<typeof moderationResultSchema>;
