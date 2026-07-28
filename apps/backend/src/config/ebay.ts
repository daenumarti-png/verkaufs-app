// eBay hat keine eigenständige Schweizer Plattform (kein ebay.ch) – deutschsprachige
// Schweizer Verkäufer nutzen i.d.R. eBay.de. Falls das eigene eBay-Konto an
// einen anderen Marktplatz gebunden ist, hier anpassen.
export const EBAY_MARKETPLACE_ID = "EBAY_DE";

// Vereinfachte, generische Zustands-Zuordnung (Phase 9 mapToStructuredCondition
// -> eBay condition IDs). eBay bietet je nach Kategorie teils feinere,
// kategoriespezifische Zustands-Enums an – das hier ist ein sinnvoller
// Standard-Fall, keine kategoriegenaue Zuordnung.
export const EBAY_CONDITION_ID: Record<"Neu" | "Wie neu" | "Gebraucht" | "Defekt", string> = {
  Neu: "1000", // New
  "Wie neu": "1500", // New other (see details)
  Gebraucht: "3000", // Used
  Defekt: "7000", // For parts or not working
};
