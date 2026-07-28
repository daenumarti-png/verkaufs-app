import Anthropic from "@anthropic-ai/sdk";
import {
  collectorValueResultSchema,
  type CollectorResearchRequest,
  type CollectorValueResult,
} from "@verkaufs-app/shared";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 2048;

// Kostenkontrolle: Web-Suche wird pro Anthropic-Abrechnung zusätzlich zu
// Tokens verrechnet. Reicht für gezielte Recherche zu einem Artikel, ohne
// dass ein einzelner Request unbegrenzt weitersuchen kann.
const MAX_SEARCHES = 4;

// Vom Nutzer bestätigte Startliste vertrauenswürdiger Referenzquellen pro
// Sammelkategorie (Briefing Abschnitt 5 / offene Frage 5). Bewusst als
// Priorisierung im Prompt, nicht als harte allowed_domains-Einschränkung,
// damit auch Sonderfälle ausserhalb der Liste gefunden werden können.
const REFERENCE_SOURCES = `- Lego: BrickLink, Brickeconomy
- Münzen: Numista
- Briefmarken: Zumstein (Schweizer Standardkatalog), StampWorld
- Sammelkarten: Cardmarket
- Vintage-Spielzeug/Sonstiges: Catawiki, WorthPoint`;

const SUBMIT_TOOL_NAME = "submit_collector_assessment";

// Bewusst ein erzwingbares Tool statt "gib am Ende JSON aus" per Prompt:
// Bei Recherche-Aufgaben mit Web-Suche neigt das Modell dazu, einen
// ausführlichen Markdown-Bericht zu schreiben statt sich strikt an ein
// Text-Format zu halten (empirisch beobachtet). Ein Tool-Call mit
// input_schema wird von der Anthropic-API selbst strukturiert validiert –
// deutlich zuverlässiger als Freitext-JSON-Extraktion nach einer Recherche.
const submitTool: Anthropic.Tool = {
  name: SUBMIT_TOOL_NAME,
  description:
    "Reicht die finale Sammlerwert-Einschätzung ein. Erst aufrufen, nachdem die nötige Web-Recherche abgeschlossen ist.",
  input_schema: {
    type: "object",
    properties: {
      collector_value_score: {
        type: "integer",
        minimum: 1,
        maximum: 10,
        description: "1 = kein nennenswerter Sammlerwert, 10 = sehr hoher Sammlerwert über dem Gebrauchtwert",
      },
      reasoning: { type: "string", description: "Kurze Begründung, max 30 Wörter" },
      adjusted_price_chf_min: { type: "number", minimum: 0 },
      adjusted_price_chf_max: { type: "number", minimum: 0 },
      sales_venue_recommendation: {
        type: "object",
        properties: {
          recommended_venue: {
            type: "string",
            description: "z.B. 'Tutti/Ricardo reichen aus' oder 'spezialisierte Sammler-Plattform/Auktion (z.B. Catawiki)'",
          },
          reasoning: { type: "string", description: "max 20 Wörter" },
        },
        required: ["recommended_venue", "reasoning"],
      },
      sources: {
        type: "array",
        description:
          "Tatsächlich in der Recherche gefundene Quellen. Leer lassen, wenn keine brauchbare Quelle gefunden wurde – niemals eine Quelle erfinden.",
        items: {
          type: "object",
          properties: {
            url: { type: "string" },
            title: { type: "string" },
          },
          required: ["url"],
        },
      },
      confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
        description: "low bei widersprüchlichen/unklaren/fehlenden Treffern – lieber konservativ als überzogen.",
      },
    },
    required: [
      "collector_value_score",
      "reasoning",
      "adjusted_price_chf_min",
      "adjusted_price_chf_max",
      "sales_venue_recommendation",
      "confidence",
    ],
  },
};

function buildPrompt(input: CollectorResearchRequest): string {
  return `Du bist ein Experte für Sammlerwert-Einschätzung (Lego, Numismatik, Philatelie, Vintage-Sammlerstücke) mit Zugriff auf Websuche.

Artikel: ${input.name}
Kategorie: ${input.category}
Zustand: ${input.condition_guess ?? "unbekannt"}
Bisherige (rein modellbasierte) Preisschätzung ohne Sammlerwert-Berücksichtigung: CHF ${input.current_estimate.estimated_price_chf_min}–${input.current_estimate.estimated_price_chf_max}

Aufgabe: Recherchiere gezielt den aktuellen Sammlerwert/Referenzpreise für GENAU diesen Artikel (identifiziere zuerst, falls möglich, eine konkrete Kennung wie Lego-Set-Nummer, Briefmarken-Motiv/Jahr, Münz-Prägejahr/-Land). Nutze dafür bevorzugt diese Referenzquellen, je nach Kategorie:
${REFERENCE_SOURCES}
Wenn diese Quellen keine passenden Treffer liefern, suche breiter im Web, aber bevorzuge seriöse, spezialisierte Sammler-Referenzseiten/-Auktionsplattformen gegenüber allgemeinen Verkaufsanzeigen.

Wichtig – konservativ bei Unsicherheit: Wenn die Treffer widersprüchlich, veraltet oder unklar sind, oder du keine belastbaren Informationen findest, wähle einen niedrigen "collector_value_score" (1-2) und "confidence": "low", statt einen hohen Wert zu suggerieren. Erfinde NIEMALS eine Quelle.

Sobald deine Recherche abgeschlossen ist, rufe AUSSCHLIESSLICH das Tool "${SUBMIT_TOOL_NAME}" mit deinem Ergebnis auf. Schreibe KEINEN zusammenfassenden Text, KEINEN Markdown-Bericht – die Einschätzung gehört ausschliesslich in den Tool-Aufruf.`;
}

export type CollectorResearchOutcome =
  | { status: "ok"; result: CollectorValueResult; searchesUsed: number }
  | { status: "no_tool_call" }
  | { status: "invalid_json"; rawText: string; error: string };

async function runSingleAttempt(
  input: CollectorResearchRequest,
  apiKey: string
): Promise<CollectorResearchOutcome> {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES }, submitTool],
    messages: [{ role: "user", content: buildPrompt(input) }],
  });

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === SUBMIT_TOOL_NAME
  );

  if (!toolUseBlock) {
    return { status: "no_tool_call" };
  }

  const validated = collectorValueResultSchema.safeParse(toolUseBlock.input);
  if (!validated.success) {
    return {
      status: "invalid_json",
      rawText: JSON.stringify(toolUseBlock.input),
      error: validated.error.message,
    };
  }

  return {
    status: "ok",
    result: validated.data,
    searchesUsed: response.usage.server_tool_use?.web_search_requests ?? 0,
  };
}

export async function researchCollectorValue(
  input: CollectorResearchRequest,
  apiKey: string
): Promise<CollectorResearchOutcome> {
  const firstAttempt = await runSingleAttempt(input, apiKey);
  if (firstAttempt.status === "ok") {
    return firstAttempt;
  }
  return runSingleAttempt(input, apiKey);
}
