// Zentrale, leicht pflegbare Liste verbotener Kategorien für die
// Content-Moderation (Phase 11, Briefing Abschnitt 8 / offene Frage 6,
// mit Nutzer abgestimmt). Bei Bedarf hier erweitern/anpassen – keine
// einmalige, fest zementierte Festlegung.
export const PROHIBITED_CATEGORIES = [
  {
    key: "weapons",
    label: "Waffen & Munition",
    description:
      "Schusswaffen, Waffenteile, Munition. Eindeutig erkennbares Spielzeug bleibt erlaubt. Bei Deko-/Sammlerwaffen, Airsoft/Softair, Messern mit fragwürdigen Merkmalen (Schmetterlingsmesser, Einhandmesser mit Feststellmechanismus) im Zweifel ablehnen.",
  },
  {
    key: "drugs",
    label: "Drogen & Betäubungsmittel",
    description: "Drogen, Betäubungsmittel, eindeutiges Anbauzubehör (z.B. Growboxen mit klarem Cannabis-Bezug).",
  },
  {
    key: "counterfeit",
    label: "Gefälschte Markenware",
    description: "Erkennbare Fälschungen bekannter Marken.",
  },
  {
    key: "protected_species",
    label: "Geschützte Tier-/Pflanzenprodukte",
    description:
      "Elfenbein, Felle/Produkte geschützter Arten. Bei Antiquitäten mit unklarem Materialanteil im Zweifel ablehnen.",
  },
  {
    key: "extremist",
    label: "Extremistische Symbole/Material",
    description: "NS-Symbolik, Symbole/Material verbotener Organisationen.",
  },
  {
    key: "pornographic",
    label: "Pornografische Inhalte",
    description: "Sexuell explizites Material.",
  },
  {
    key: "prescription_drugs",
    label: "Rezeptpflichtige Medikamente",
    description: "Verschreibungspflichtige Arzneimittel, medizinische Betäubungsmittel.",
  },
  {
    key: "hazardous",
    label: "Explosivstoffe & gefährliche Chemikalien",
    description: "Sprengstoff, Feuerwerk ausserhalb erlaubter Verkaufsbedingungen, gefährliche Chemikalien.",
  },
  {
    key: "live_animals",
    label: "Lebende Tiere",
    description: "Tierverkauf ist nicht Teil dieses Occasion-Konzepts.",
  },
  {
    key: "stolen_goods",
    label: "Erkennbar gestohlene Ware",
    description: "Nur bei klaren visuellen/textuellen Indizien (z.B. sichtbar entfernte/manipulierte Seriennummern).",
  },
] as const;

export type ProhibitedCategoryKey = (typeof PROHIBITED_CATEGORIES)[number]["key"];
