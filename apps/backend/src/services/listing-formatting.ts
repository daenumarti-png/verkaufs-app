import type { ListingField, ListingPlatform, PlatformListing, PrepareListingsRequest } from "@verkaufs-app/shared";

type ItemInput = PrepareListingsRequest["item"];

// Grenzwerte nach bestem aktuellem Wissen – Plattformen ändern Feldlimits
// gelegentlich. Vor produktivem Einsatz gegen die aktuellen Hilfe-Seiten der
// Plattformen verifizieren (analog zur AGB-Prüfung im Briefing vor jeder
// Automatisierung Richtung Tutti/Ricardo).
const TITLE_MAX_LENGTH: Record<ListingPlatform, number> = {
  TUTTI: 65,
  RICARDO: 64,
  EBAY: 80,
};

const PLATFORM_NOTES: Record<ListingPlatform, string[]> = {
  TUTTI: ["Tutti hat keine öffentliche Publish-API – Angaben hier manuell in die Tutti-App/-Website einfügen."],
  RICARDO: ["Ricardo hat keine öffentliche Publish-API – Angaben hier manuell in die Ricardo-App/-Website einfügen."],
  EBAY: ["eBay kann über die offizielle API angebunden werden (geplant für Phase 12) – bis dahin ebenfalls manuell einfügen."],
};

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function formatPriceChf(value: number): string {
  return `CHF ${Math.round(value)}`;
}

export type StructuredCondition = "Neu" | "Wie neu" | "Gebraucht" | "Defekt";

// Best-effort-Zuordnung, da condition_guess aus der Analyse Freitext ist
// (kein strukturiertes Enum in Phase 2). Für Plattformen mit festem
// Zustands-Dropdown (Ricardo, eBay, und die echte eBay-API in Phase 12)
// reicht eine grobe Einordnung als Ausgangspunkt – der Nutzer kann sie beim
// Einfügen jederzeit korrigieren. Exportiert zur Wiederverwendung.
export function mapToStructuredCondition(conditionGuess: string | undefined): StructuredCondition {
  const text = (conditionGuess ?? "").toLowerCase();
  if (/(defekt|kaputt|nicht funktionsf|ersatzteile)/.test(text)) return "Defekt";
  if (/(ungeöffnet|originalverpackt|\bovp\b|^neu$)/.test(text)) return "Neu";
  if (/(wie neu|neuwertig|kaum gebraucht|sehr guter zustand)/.test(text)) return "Wie neu";
  return "Gebraucht";
}

// Obere Schätzung als Listing-Ausgangspreis (übliche Verhandlungsspanne nach
// unten bei Occasion-Plattformen) – die volle Spanne bleibt zusätzlich als
// Kontext im Feldwert sichtbar, damit der Nutzer selbst entscheiden kann.
function suggestedListPrice(item: ItemInput): number {
  return Math.round(item.estimated_price_chf_max);
}

function buildFields(platform: ListingPlatform, item: ItemInput): ListingField[] {
  const titleMax = TITLE_MAX_LENGTH[platform];
  const title = truncate(item.suggested_title, titleMax);
  const price = formatPriceChf(suggestedListPrice(item));
  const priceContext = `(Schätzung: CHF ${Math.round(item.estimated_price_chf_min)}–${Math.round(item.estimated_price_chf_max)})`;

  const titleAndDescription: ListingField[] = [
    { key: "title", label: "Titel", value: title, max_length: titleMax },
    { key: "description", label: "Beschreibung", value: item.suggested_description },
  ];
  const categoryField: ListingField = {
    key: "category",
    label: "Kategorie (Vorschlag)",
    value: item.category,
  };

  switch (platform) {
    case "TUTTI":
      return [
        ...titleAndDescription,
        { key: "price", label: "Preis", value: `${price} ${priceContext}` },
        { key: "condition", label: "Zustand", value: item.condition_guess ?? "unbekannt" },
        categoryField,
      ];
    case "RICARDO":
      return [
        ...titleAndDescription,
        { key: "condition", label: "Zustand", value: mapToStructuredCondition(item.condition_guess) },
        { key: "price", label: "Sofortkauf-Preis", value: `${price} ${priceContext}` },
        categoryField,
      ];
    case "EBAY":
      return [
        ...titleAndDescription,
        { key: "condition", label: "Zustand", value: mapToStructuredCondition(item.condition_guess) },
        { key: "price", label: "Sofort-Kaufen-Preis", value: `${price} ${priceContext}` },
        categoryField,
      ];
  }
}

function buildFullText(fields: ListingField[]): string {
  return fields.map((f) => `${f.label}: ${f.value}`).join("\n");
}

export function prepareListingForPlatform(platform: ListingPlatform, item: ItemInput): PlatformListing {
  const fields = buildFields(platform, item);
  return {
    platform,
    fields,
    full_text: buildFullText(fields),
    notes: PLATFORM_NOTES[platform],
  };
}

export function prepareListings(platforms: ListingPlatform[], item: ItemInput): PlatformListing[] {
  return platforms.map((platform) => prepareListingForPlatform(platform, item));
}
