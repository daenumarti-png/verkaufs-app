import { z } from "zod";

// Request-Felder für POST /items/ebay/prepare-draft (multipart/form-data,
// zusätzlich zu den Foto-Datei-Teilen). Bewusst der finale, vom Nutzer
// bestätigte Stand (nach ggf. Rückfragen/Sammlerwert-Recherche), nicht die
// rohe Erstanalyse.
export const ebayDraftFieldsSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(4000),
  price_chf: z.coerce.number().positive(),
  category: z.string().min(1).max(120),
  condition_guess: z.string().max(120).optional(),
});

export const ebayDraftResultSchema = z.object({
  offer_id: z.string(),
  sku: z.string(),
  category_used: z.object({ id: z.string(), name: z.string() }),
  ebay_environment: z.enum(["SANDBOX", "PRODUCTION"]),
  // Erinnerung an den mit dem Nutzer abgestimmten Flow: kein Auto-Publish.
  note: z.string(),
});

export type EbayDraftFields = z.infer<typeof ebayDraftFieldsSchema>;
export type EbayDraftResult = z.infer<typeof ebayDraftResultSchema>;
