import Anthropic from "@anthropic-ai/sdk";
import { moderationResultSchema, type ModerationResult } from "@verkaufs-app/shared";
import { PROHIBITED_CATEGORIES } from "../config/moderation.js";
import type { ProcessedPhoto } from "./photo-processing.js";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 1024;

const SUBMIT_TOOL_NAME = "submit_moderation_result";

const CATEGORY_LIST = PROHIBITED_CATEGORIES.map((c) => `- ${c.key}: ${c.label} – ${c.description}`).join("\n");

// Erzwungener Tool-Call (tool_choice statt "auto"): Da hier keine Websuche
// nötig ist (reine Bildklassifikation), kann die strukturierte Antwort schon
// im ersten Turn erzwungen werden – noch zuverlässiger als das
// Retry-Pattern der anderen Services.
const submitTool: Anthropic.Tool = {
  name: SUBMIT_TOOL_NAME,
  description: "Reicht das Moderations-Ergebnis für die geprüften Fotos ein.",
  input_schema: {
    type: "object",
    properties: {
      blocked: {
        type: "boolean",
        description: "true, wenn die Fotos einen Artikel aus einer verbotenen Kategorie zeigen (oder im Zweifel).",
      },
      category: {
        type: ["string", "null"],
        enum: [...PROHIBITED_CATEGORIES.map((c) => c.key), null],
        description: "Die zutreffende verbotene Kategorie, falls blocked=true, sonst null.",
      },
      reasoning: {
        type: "string",
        description: "Kurze, für den Nutzer verständliche Begründung (max 25 Wörter) – auch wenn blocked=false.",
      },
    },
    required: ["blocked", "category", "reasoning"],
  },
};

function buildPrompt(): string {
  return `Du prüfst Fotos eines Artikels, der auf einer Schweizer Occasion-Plattform (Tutti.ch, Ricardo.ch, eBay) verkauft werden soll, auf verbotene/anstössige Inhalte – BEVOR eine Verkaufsanalyse stattfindet.

Verbotene Kategorien:
${CATEGORY_LIST}

Wichtig – konservativ bei Unsicherheit: Wenn du unsicher bist, ob ein Artikel in eine verbotene Kategorie fällt (z.B. Deko-Waffe vs. echte Waffe, Antiquität mit unklarem Elfenbein-Anteil), setze "blocked": true mit der wahrscheinlichsten Kategorie – im Zweifel ablehnen statt bewerten. Normale Alltagsartikel (Möbel, Elektronik, Kleidung, Spielzeug, Bücher, Sportartikel etc.) sind NICHT betroffen und sollen nicht fälschlich blockiert werden – die Regel gilt für echte Verdachtsfälle, nicht als pauschale Vorsicht bei allem.

Rufe AUSSCHLIESSLICH das Tool "${SUBMIT_TOOL_NAME}" mit deinem Ergebnis auf.`;
}

export type ModerationOutcome =
  | { status: "ok"; result: ModerationResult }
  | { status: "no_tool_call" }
  | { status: "invalid_json"; rawText: string; error: string };

async function runSingleAttempt(photos: ProcessedPhoto[], apiKey: string): Promise<ModerationOutcome> {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    tools: [submitTool],
    tool_choice: { type: "tool", name: SUBMIT_TOOL_NAME },
    messages: [
      {
        role: "user",
        content: [
          ...photos.map((p) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: p.mediaType, data: p.base64 },
          })),
          { type: "text" as const, text: buildPrompt() },
        ],
      },
    ],
  });

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === SUBMIT_TOOL_NAME
  );
  if (!toolUseBlock) {
    return { status: "no_tool_call" };
  }

  const validated = moderationResultSchema.safeParse(toolUseBlock.input);
  if (!validated.success) {
    return { status: "invalid_json", rawText: JSON.stringify(toolUseBlock.input), error: validated.error.message };
  }

  return { status: "ok", result: validated.data };
}

/**
 * Eigener Prüfschritt VOR der eigentlichen Analyse (Briefing Abschnitt 8,
 * "Nicht verhandelbare Rahmenbedingungen"). Ein Wiederholungsversuch bei
 * ungültiger Antwort wie bei den anderen KI-Services – schlägt auch der
 * zweite Versuch fehl, behandelt der Aufrufer das fail-closed (siehe
 * routes/items.ts): keine Analyse ohne erfolgreiche Moderationsprüfung.
 */
export async function moderatePhotos(photos: ProcessedPhoto[], apiKey: string): Promise<ModerationOutcome> {
  const firstAttempt = await runSingleAttempt(photos, apiKey);
  if (firstAttempt.status === "ok") {
    return firstAttempt;
  }
  return runSingleAttempt(photos, apiKey);
}
