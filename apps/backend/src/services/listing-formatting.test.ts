import { describe, it, expect } from "vitest";
import { prepareListingForPlatform, mapToStructuredCondition } from "./listing-formatting.js";

const baseItem = {
  name: "Test-Artikel",
  category: "Möbel / Schränke",
  condition_guess: "sehr guter Zustand",
  suggested_title:
    "IKEA PAX Kleiderschrank 236x201cm weiss mit Spiegeltüren und komplettem Innenausbau, sehr guter Zustand, kaum genutzt",
  suggested_description: "Eine Beschreibung.",
  estimated_price_chf_min: 100,
  estimated_price_chf_max: 250,
};

describe("mapToStructuredCondition", () => {
  it("erkennt 'Defekt' bei entsprechenden Signalwörtern", () => {
    expect(mapToStructuredCondition("defekt, Display kaputt")).toBe("Defekt");
    expect(mapToStructuredCondition("nur für Ersatzteile")).toBe("Defekt");
  });

  it("erkennt 'Neu' bei Originalverpackung/ungeöffnet", () => {
    expect(mapToStructuredCondition("neu, originalverpackt")).toBe("Neu");
    expect(mapToStructuredCondition("ungeöffnet")).toBe("Neu");
  });

  it("erkennt 'Wie neu' bei entsprechenden Formulierungen", () => {
    expect(mapToStructuredCondition("wie neu, kaum benutzt")).toBe("Wie neu");
    expect(mapToStructuredCondition("sehr guter Zustand")).toBe("Wie neu");
  });

  it("fällt auf 'Gebraucht' zurück, wenn nichts Spezifisches erkannt wird", () => {
    expect(mapToStructuredCondition("normal genutzt, funktioniert")).toBe("Gebraucht");
    expect(mapToStructuredCondition(undefined)).toBe("Gebraucht");
  });
});

describe("prepareListingForPlatform", () => {
  it("kürzt den Titel für Tutti auf 65 Zeichen inkl. Ellipse", () => {
    const listing = prepareListingForPlatform("TUTTI", baseItem);
    const title = listing.fields.find((f) => f.key === "title")!;
    expect(title.max_length).toBe(65);
    expect(title.value.length).toBe(65);
    expect(title.value.endsWith("…")).toBe(true);
  });

  it("kürzt den Titel für Ricardo auf 64 Zeichen", () => {
    const listing = prepareListingForPlatform("RICARDO", baseItem);
    const title = listing.fields.find((f) => f.key === "title")!;
    expect(title.value.length).toBe(64);
  });

  it("kürzt den Titel für eBay auf 80 Zeichen", () => {
    const listing = prepareListingForPlatform("EBAY", baseItem);
    const title = listing.fields.find((f) => f.key === "title")!;
    expect(title.value.length).toBe(80);
  });

  it("lässt kurze Titel unverändert (keine unnötige Kürzung)", () => {
    const shortItem = { ...baseItem, suggested_title: "Kurzer Titel" };
    const listing = prepareListingForPlatform("TUTTI", shortItem);
    const title = listing.fields.find((f) => f.key === "title")!;
    expect(title.value).toBe("Kurzer Titel");
  });

  it("verwendet den strukturierten Zustand für Ricardo/eBay, Freitext für Tutti", () => {
    const tutti = prepareListingForPlatform("TUTTI", baseItem);
    const ricardo = prepareListingForPlatform("RICARDO", baseItem);
    expect(tutti.fields.find((f) => f.key === "condition")!.value).toBe("sehr guter Zustand");
    expect(ricardo.fields.find((f) => f.key === "condition")!.value).toBe("Wie neu");
  });

  it("baut full_text aus allen Feldern zusammen", () => {
    const listing = prepareListingForPlatform("TUTTI", baseItem);
    for (const field of listing.fields) {
      expect(listing.full_text).toContain(`${field.label}: ${field.value}`);
    }
  });

  it("nimmt den oberen Schätzwert als Listenpreis, zeigt aber die volle Spanne", () => {
    const listing = prepareListingForPlatform("TUTTI", baseItem);
    const price = listing.fields.find((f) => f.key === "price")!;
    expect(price.value).toContain("CHF 250");
    expect(price.value).toContain("100");
    expect(price.value).toContain("250");
  });
});
