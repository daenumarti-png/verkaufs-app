import Anthropic from "@anthropic-ai/sdk";
import { itemAnalysisResultSchema, type ItemAnalysisResult } from "@verkaufs-app/shared";
import { repairTruncatedJson } from "../lib/json-repair.js";
import type { ProcessedPhoto } from "./photo-processing.js";

const MODEL = "claude-sonnet-5";

// Prototyp-Erkenntnis #3: 1000 Tokens waren im Demo künstlich zu knapp und
// führten bei mehreren Artikeln zu abgeschnittenem JSON. Deutlich grosszügiger
// budgetiert, damit das bei MAX_ITEMS Artikeln in voller Länge nicht mehr passiert.
const MAX_TOKENS = 4096;

// Bewusst moderat gehalten (nicht "unbegrenzt"): grössere Sammlungen bekommen
// laut Prototyp-Erkenntnis #6 einen eigenen gestuften Flow (Gruppenübersicht →
// gezielte Detailfotos pro Artikel in einem separaten /items/analyze-Aufruf),
// statt alles auf einen Analyse-Call zu packen. MAX_ITEMS wird von routes/items.ts
// mitverwendet, um items_capped serverseitig zu bestimmen.
export const MAX_ITEMS = 5;

function buildPrompt(photoCount: number): string {
  return `Du bist ein Experte für den Verkauf gebrauchter Gegenstände auf Schweizer Occasion-Plattformen (Tutti.ch, Ricardo.ch) und eBay.
Dir werden ${photoCount} Foto(s) desselben Verkaufsvorgangs gezeigt. Diese Fotos können entweder verschiedene, unterschiedliche Artikel zeigen (z.B. mehrere Videospiele nebeneinander), ODER denselben Artikel/dieselbe Artikelgruppe aus mehreren Blickwinkeln bzw. als Nahaufnahme (z.B. ein Gruppenfoto plus Einzel-Nahaufnahmen derselben Gegenstände). Erkenne zuerst, ob es sich um dieselben Objekte auf mehreren Fotos handelt, und führe diese dann zu EINEM Eintrag pro echtem, unterschiedlichem Artikel zusammen – zähle keinen Artikel doppelt, nur weil er auf mehreren Fotos zu sehen ist. Nutze Nahaufnahmen nur, um Zustand/Details eines bereits erkannten Artikels genauer einzuschätzen.

Foto-Index & Bounding Box pro Artikel (source_photo_index, bounding_box): Die dir übergebenen Fotos sind in der Reihenfolge, in der du sie in diesem Aufruf erhältst, 0-indexiert (erstes Foto = Index 0, zweites Foto = Index 1, usw. – exakt diese Reihenfolge, keine eigene Neusortierung). Gib für JEDEN Artikel in "source_photo_index" das Foto (per Index) an, auf dem GENAU DIESER EINE Artikel am klarsten, vollständigsten und am wenigsten von anderen Objekten verdeckt zu sehen ist. Falls du denselben Artikel gemäss der Zusammenführungs-Regel oben auf mehreren Fotos erkannt hast, wähle NUR das eine klarste Foto als Referenz – versuche NICHT, mehrere Fotos oder Bounding Boxes für denselben Artikel zu kombinieren. Gib zusätzlich in "bounding_box" ein möglichst eng um GENAU DIESEN Artikel gezogenes Rechteck an (andere Artikel und Hintergrund sollen möglichst ausserhalb der Box liegen), als Bruchteil (0.0–1.0) der Breite/Höhe DIESES EINEN Fotos: "x"/"y" = linke obere Ecke, "width"/"height" = Breite/Höhe der Box. Falls du unsicher bist oder ein Foto ohnehin nur genau diesen einen Artikel zeigt, setze "bounding_box" auf null statt zu raten.

Maximal ${MAX_ITEMS} unterschiedliche Artikel im Ergebnis. Falls mehr echte, unterschiedliche Artikel erkennbar sind, wähle die ${MAX_ITEMS} eindeutigsten aus und setze "additional_items_likely" auf true, damit der Nutzer die restlichen Artikel in einem weiteren Durchgang separat fotografieren kann. Setze "additional_items_likely" nur dann auf true, wenn du wirklich den Eindruck hast, dass mehr als ${MAX_ITEMS} unterschiedliche Artikel vorhanden sind – nicht vorsorglich.

Bundle- vs. Einzelverkauf-Empfehlung: Empfehle ein Bundle nur, wenn die Artikel wirklich zusammenpassen (z.B. gleiche Kategorie/Sammlung, gleiche wahrscheinliche Käuferschaft, z.B. mehrere Switch-Spiele oder ein Möbel-Set) UND ein gemeinsamer Verkauf für Käufer wie Verkäufer plausibel attraktiver ist als Einzelverkäufe. Bei unterschiedlichen/unzusammenhängenden Artikeln (z.B. eine Lampe und ein Fahrrad) empfiehl Einzelverkauf. "bundle_price_chf" sollte, falls ein Bundle empfohlen wird, plausibel unter der Summe der einzelnen "estimated_price_chf_max"-Werte liegen (Mengenrabatt-Anreiz), aber nicht unrealistisch niedrig. Falls recommended=true, formuliere zusätzlich einen eigenen, verkaufsfertigen "suggested_title" (max 80 Zeichen) und "suggested_description" (Verkaufstext, max 40 Wörter) für das GESAMTE Bundle – nicht einfach die Einzeltitel aneinanderreihen, sondern holistisch als EIN Angebot formulieren (z.B. "2x Nintendo Switch Spiele im Set" statt "Spiel A + Spiel B") – sowie eine passende gemeinsame "category". Falls recommended=false, setze diese drei Felder auf null.

Rückfragen (clarifying_questions): Nur befüllen, wenn Fotos allein wirklich NICHT für eine belastbare Preisschätzung ausreichen, weil eine preisrelevante Eigenschaft nicht sichtbar ist – typische Fälle: bei Möbeln fehlende Masse/Ausstattungsvariante; bei Elektronik unklare Speichergrösse oder ob Zubehör vollständig ist; bei Kleidung unklare Grösse. NICHT bei jedem Artikel pauschal nachfragen – wenn die Fotos für eine vernünftige Schätzung reichen, "clarifying_questions" als leeres Array lassen. Maximal 2 Fragen pro Artikel, jede mit 2-4 kurzen Antwortoptionen (max. 30 Zeichen pro Option, geeignet für antippbare Chips, kein Freitext). "allow_multiple": setze auf true, wenn bei dieser Frage mehrere Optionen gleichzeitig zutreffen können statt sich gegenseitig auszuschliessen (z.B. bei einem Bett mit Zusatz-/Gästebett "welche Matratzengrössen sind enthalten?" - Hauptbett und Gästebett können unterschiedliche Grössen haben, beide treffen zu), sonst false (Standardfall, z.B. "Speichergrösse?" hat immer nur eine richtige Antwort).

Idealer Verkaufszeitpunkt (best_selling_period): Schätze anhand saisonaler/kategoriebedingter Nachfrage, wann der Verkauf gestartet werden sollte, z.B. Sonnenschirm/Grill/Gartenmöbel eher "März–August" (Frühling/Sommer), Wintersportartikel eher "September–Januar". "period" als kurze Monatsspanne (z.B. "März–August") oder bei Artikeln ohne saisonalen Bezug (z.B. Elektronik, Möbel, Werkzeug) exakt "ganzjährig". "reasoning" kurz begründen (max 15 Wörter).

Sammlerwert-Verdacht (possible_collector_value): Setze auf true NUR bei echtem visuellem Verdacht auf einen Sammlerwert über dem üblichen Gebrauchtwert – z.B. Lego-Set mit erkennbarer Set-Nummer/Originalverpackung, Briefmarken/Briefmarkenalben, Münzen, Vintage-Spielzeug in Originalverpackung, limitierte/nummerierte Editionen, alte Sammelkarten. NICHT bei gewöhnlichen Alltagsartikeln (Möbel, gängige Elektronik, normale Kleidung) – im Zweifel false, da dies einen separaten, aufwändigeren Rechercheschritt auslöst.

Plattform-Empfehlung (platform_recommendation): Neben Tutti/Ricardo/eBay gibt es in der Schweiz weitere sinnvolle Verkaufsplattformen je nach Artikeltyp: Vinted (Kleidung/Mode/Accessoires), Facebook Marketplace (sperrige/lokale Artikel wie Möbel, wo Versand unpraktisch ist), Anibis (zweite grosse Schweizer Kleinanzeigen-Plattform, Alternative zu Tutti). Empfehle EINE dieser drei NUR, wenn sie für DIESEN Artikel klar besser geeignet ist als der Standard-Dreier – sonst "platform_recommendation" auf null setzen (nicht bei jedem Artikel pauschal empfehlen). Kurze Begründung (max 15 Wörter).

Antworte AUSSCHLIESSLICH mit einem validen JSON-Objekt, ohne Erklärtext, ohne Markdown-Codeblock, exakt in diesem Schema:
{
  "items": [
    {
      "name": "kurzer Objektname",
      "category": "Kategorie",
      "condition_guess": "Zustand in 1-3 Worten",
      "suggested_title": "verkaufsfertiger Inseratetitel, max 45 Zeichen",
      "suggested_description": "Verkaufstext, max 25 Wörter",
      "estimated_price_chf_min": Zahl,
      "estimated_price_chf_max": Zahl,
      "sell_score": Zahl von 1 bis 10,
      "estimated_days_to_sell": Zahl,
      "missing_photo_suggestions": ["max 2 kurze Tipps"],
      "clarifying_questions": [
        { "question": "kurze Frage, max 120 Zeichen", "options": ["Option 1", "Option 2"], "allow_multiple": true oder false }
      ],
      "best_selling_period": { "period": "z.B. März–August oder ganzjährig", "reasoning": "max 15 Wörter" },
      "possible_collector_value": true oder false,
      "source_photo_index": Zahl (0-indexiert, welches Foto diesen Artikel am klarsten zeigt) oder null,
      "bounding_box": { "x": Zahl 0-1, "y": Zahl 0-1, "width": Zahl 0-1, "height": Zahl 0-1 } oder null,
      "platform_recommendation": { "platform": "TUTTI"|"RICARDO"|"EBAY"|"VINTED"|"ANIBIS"|"FACEBOOK_MARKETPLACE", "reasoning": "max 15 Wörter" } oder null
    }
  ],
  "multi_item_detected": true oder false,
  "bundle_recommendation": {
    "recommended": true oder false,
    "reasoning": "max 15 Wörter",
    "bundle_price_chf": Zahl (Pflicht, falls recommended=true) oder null,
    "suggested_title": "verkaufsfertiger Bundle-Titel, max 80 Zeichen (Pflicht, falls recommended=true)" oder null,
    "suggested_description": "Verkaufstext für das gesamte Bundle, max 40 Wörter (Pflicht, falls recommended=true)" oder null,
    "category": "gemeinsame Kategorie (Pflicht, falls recommended=true)" oder null
  } oder null, falls nur ein Artikel erkannt wurde,
  "additional_items_likely": true oder false
}
Die Preisschätzung basiert nur auf allgemeinem Wissen, nicht auf Live-Marktdaten. Sei bei "sell_score" und "estimated_days_to_sell" realistisch, nicht übertrieben optimistisch. Halte Textfelder knapp, aber inhaltlich vollständig.`;
}

function extractJsonText(rawText: string): string {
  return rawText.replace(/```json|```/g, "").trim();
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export type AnalysisOutcome =
  | { status: "ok"; result: ItemAnalysisResult; wasRepaired: boolean; bundlePriceSanityWarning: string | null }
  | { status: "no_text" }
  | { status: "invalid_json"; rawText: string; error: string };

function checkBundlePriceSanity(result: ItemAnalysisResult): string | null {
  const bundle = result.bundle_recommendation;
  if (!bundle || !bundle.recommended || bundle.bundle_price_chf === null) {
    return null;
  }
  const sumOfMaxPrices = result.items.reduce((sum, item) => sum + item.estimated_price_chf_max, 0);
  if (bundle.bundle_price_chf > sumOfMaxPrices) {
    return `Bundle-Preis (CHF ${bundle.bundle_price_chf}) liegt über der Summe der Einzelpreise (CHF ${sumOfMaxPrices}) – unplausibel, da ein Bundle üblicherweise günstiger sein sollte als Einzelverkäufe.`;
  }
  return null;
}

async function runSingleAttempt(photos: ProcessedPhoto[], apiKey: string): Promise<AnalysisOutcome> {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [
      {
        role: "user",
        content: [
          ...photos.map((p) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: p.mediaType, data: p.base64 },
          })),
          { type: "text" as const, text: buildPrompt(photos.length) },
        ],
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return { status: "no_text" };
  }

  const cleaned = extractJsonText(textBlock.text);

  let parsedRaw = tryParseJson(cleaned);
  let wasRepaired = false;
  if (parsedRaw === undefined) {
    parsedRaw = tryParseJson(repairTruncatedJson(cleaned));
    wasRepaired = parsedRaw !== undefined;
  }

  if (parsedRaw === undefined) {
    return {
      status: "invalid_json",
      rawText: cleaned,
      error: "JSON konnte auch nach Reparaturversuch nicht geparst werden.",
    };
  }

  const validated = itemAnalysisResultSchema.safeParse(parsedRaw);
  if (!validated.success) {
    return { status: "invalid_json", rawText: cleaned, error: validated.error.message };
  }

  return {
    status: "ok",
    result: validated.data,
    wasRepaired,
    bundlePriceSanityWarning: checkBundlePriceSanity(validated.data),
  };
}

/**
 * Ein Wiederholungsversuch bei ungültiger/inkonsistenter Modellantwort (z.B.
 * Bundle empfohlen ohne Preis) – reduziert nutzerseitige Fehlschläge durch
 * einzelne unsaubere Modellantworten, ohne unbegrenzt zu retryen.
 */
export async function analyzePhotos(photos: ProcessedPhoto[], apiKey: string): Promise<AnalysisOutcome> {
  const firstAttempt = await runSingleAttempt(photos, apiKey);
  if (firstAttempt.status !== "invalid_json") {
    return firstAttempt;
  }
  return runSingleAttempt(photos, apiKey);
}
