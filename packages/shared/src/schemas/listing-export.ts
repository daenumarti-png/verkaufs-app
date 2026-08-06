import { z } from "zod";

// eBay kann über die offizielle API angebunden werden (Phase 12); Tutti/Ricardo
// haben keine öffentliche Publish-API und bleiben beim "vorbereiten +
// manuell bestätigen"-Flow (Briefing Abschnitt 3 / "Nicht verhandelbare
// Rahmenbedingungen"). OTHER aus dem Platform-Enum (Prisma) ist hier bewusst
// nicht wählbar, da es keine bekannte Feldstruktur dafür gibt.
// VINTED/ANIBIS/FACEBOOK_MARKETPLACE ergänzt: strukturell alle mit dem
// generischen Titel/Beschreibung/Preis/Kategorie-Format abbildbar (siehe
// listing-formatting.ts). Stark spezialisierte Plattformen (Fahrzeuge,
// Sammlerstücke) brauchen ein eigenes Feld-Modell und sind bewusst noch
// nicht Teil dieses Enums.
export const listingPlatformSchema = z.enum([
  "TUTTI",
  "RICARDO",
  "EBAY",
  "VINTED",
  "ANIBIS",
  "FACEBOOK_MARKETPLACE",
]);

export const prepareListingsRequestSchema = z.object({
  item: z.object({
    name: z.string().min(1).max(120),
    category: z.string().min(1).max(80),
    condition_guess: z.string().max(80).optional(),
    suggested_title: z.string().min(1).max(200),
    suggested_description: z.string().min(1).max(2000),
    estimated_price_chf_min: z.number().nonnegative(),
    estimated_price_chf_max: z.number().nonnegative(),
    best_selling_period: z.string().max(60).optional(),
  }),
  platforms: z.array(listingPlatformSchema).min(1),
});

// Ein einzelnes kopierfertiges Feld. value ist bereits fertig formatiert
// (inkl. Kürzung auf max_length) – der Client muss nichts mehr nachbearbeiten,
// nur noch per Ein-Tap-Button in die Zwischenablage kopieren.
export const listingFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string(),
  max_length: z.number().int().positive().optional(),
});

export const platformListingSchema = z.object({
  platform: listingPlatformSchema,
  fields: z.array(listingFieldSchema).min(1),
  // Alle Felder als ein zusammenhängender, ebenfalls kopierfertiger Textblock
  // (Briefing: "Ein-Tap-Kopieren-Button pro Feld ODER Block").
  full_text: z.string().min(1),
  notes: z.array(z.string()).default([]),
});

export const prepareListingsResponseSchema = z.object({
  listings: z.array(platformListingSchema).min(1),
});

export type ListingPlatform = z.infer<typeof listingPlatformSchema>;
export type PrepareListingsRequest = z.infer<typeof prepareListingsRequestSchema>;
export type ListingField = z.infer<typeof listingFieldSchema>;
export type PlatformListing = z.infer<typeof platformListingSchema>;
export type PrepareListingsResponse = z.infer<typeof prepareListingsResponseSchema>;
