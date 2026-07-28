import Anthropic from "@anthropic-ai/sdk";
import { refineEstimateResultSchema, type RefineEstimateRequest, type RefineEstimateResult } from "@verkaufs-app/shared";
import { repairTruncatedJson } from "../lib/json-repair.js";

const MODEL = "claude-sonnet-5";

// Reiner Text-Call (keine Fotos nötig, siehe Schema-Kommentar in
// packages/shared/schemas/refine-estimate.ts) – deutlich kleineres
// Antwort-Budget als die Foto-Analyse ausreichend.
const MAX_TOKENS = 512;

function buildPrompt(input: RefineEstimateRequest): string {
  const answersList = input.clarifying_answers
    .map((a) => `- ${a.question} -> ${a.selected_option}`)
    .join("\n");

  return `Du bist ein Experte für Occasion-Preise auf Schweizer Plattformen (Tutti.ch, Ricardo.ch, eBay).
Ein Artikel wurde bereits grob analysiert. Da Fotos allein für eine genaue Preisschätzung nicht ausreichten, wurden dem Nutzer gezielte Rückfragen gestellt. Hier ist der Artikel und die Antworten:

- Name: ${input.name}
- Kategorie: ${input.category}
- Zustand (grobe Einschätzung): ${input.condition_guess ?? "unbekannt"}
- Bisherige Schätzung: CHF ${input.current_estimate.estimated_price_chf_min}–${input.current_estimate.estimated_price_chf_max}, Score ${input.current_estimate.sell_score}/10, ca. ${input.current_estimate.estimated_days_to_sell} Tage bis Verkauf

Rückfragen und Antworten des Nutzers:
${answersList}

Aktualisiere die Preis-/Score-Schätzung basierend auf diesen zusätzlichen Informationen. Falls die Antworten die Schätzung nicht wesentlich ändern, gib die bisherigen Werte mit passender Begründung zurück statt sie künstlich zu verändern.

Antworte AUSSCHLIESSLICH mit einem validen JSON-Objekt, ohne Erklärtext, ohne Markdown-Codeblock, exakt in diesem Schema:
{
  "estimated_price_chf_min": Zahl,
  "estimated_price_chf_max": Zahl,
  "sell_score": Zahl von 1 bis 10,
  "estimated_days_to_sell": Zahl,
  "adjustment_reasoning": "max 20 Wörter, was sich geändert hat und warum"
}`;
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

export type RefineOutcome =
  | { status: "ok"; result: RefineEstimateResult }
  | { status: "no_text" }
  | { status: "invalid_json"; rawText: string; error: string };

async function runSingleAttempt(input: RefineEstimateRequest, apiKey: string): Promise<RefineOutcome> {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: buildPrompt(input) }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return { status: "no_text" };
  }

  const cleaned = extractJsonText(textBlock.text);
  let parsedRaw = tryParseJson(cleaned);
  if (parsedRaw === undefined) {
    parsedRaw = tryParseJson(repairTruncatedJson(cleaned));
  }

  if (parsedRaw === undefined) {
    return {
      status: "invalid_json",
      rawText: cleaned,
      error: "JSON konnte auch nach Reparaturversuch nicht geparst werden.",
    };
  }

  const validated = refineEstimateResultSchema.safeParse(parsedRaw);
  if (!validated.success) {
    return { status: "invalid_json", rawText: cleaned, error: validated.error.message };
  }

  return { status: "ok", result: validated.data };
}

// Gleiches Retry-Prinzip wie bei analyzePhotos (ai-analysis.ts): ein
// Wiederholungsversuch bei ungültiger Antwort, statt sofort aufzugeben.
export async function refineEstimate(input: RefineEstimateRequest, apiKey: string): Promise<RefineOutcome> {
  const firstAttempt = await runSingleAttempt(input, apiKey);
  if (firstAttempt.status !== "invalid_json") {
    return firstAttempt;
  }
  return runSingleAttempt(input, apiKey);
}
