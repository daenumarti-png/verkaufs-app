import Anthropic from "@anthropic-ai/sdk";
import {
  detailedDescriptionQuestionsResultSchema,
  detailedDescriptionResultSchema,
  type DetailedDescriptionQuestionsFields,
  type DetailedDescriptionQuestionsResult,
  type DetailedDescriptionGenerateRequest,
  type DetailedDescriptionResult,
} from "@verkaufs-app/shared";
import { repairTruncatedJson } from "../lib/json-repair.js";
import type { ProcessedPhoto } from "./photo-processing.js";

const MODEL = "claude-sonnet-5";
const QUESTIONS_MAX_TOKENS = 1024;
const GENERATE_MAX_TOKENS = 1024;

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

function buildQuestionsPrompt(fields: DetailedDescriptionQuestionsFields): string {
  return `Der Nutzer möchte für den Artikel "${fields.name}" (Kategorie: ${fields.category}, Zustand: ${fields.condition_guess}) zusätzlich zur kurzen Verkaufsbeschreibung eine AUSFÜHRLICHE, detaillierte Beschreibung erstellen (wie ein professionelles Datenblatt) – besonders sinnvoll bei komplexen/hochwertigen Artikeln wie Fahrzeugen, Wohnwagen, Maschinen oder Sammlerstücken.

Schritt 1 – "visible_facts": Liste alle aus dem Foto sichtbaren, für eine ausführliche Beschreibung relevanten Fakten auf (max 10, je max 100 Zeichen) – z.B. sichtbare Marke/Modell/Typenschild-Angaben, sichtbare Ausstattungsmerkmale, sichtbarer Zustand/Abnutzung/Beschädigungen, sichtbare Beschriftungen/Aufkleber/Etiketten. Nur tatsächlich Erkennbares angeben, nichts vermuten oder erfinden.

Schritt 2 – "questions": Formuliere bis zu 6 kurze, konkrete Rückfragen zu Informationen, die NICHT aus dem Foto ersichtlich sind, aber für eine ausführliche, professionelle Beschreibung DIESES Artikeltyps typischerweise wichtig wären. Passe die Fragen an die tatsächliche Kategorie an (Beispiele, nicht pauschal übernehmen): bei Fahrzeugen/Wohnwagen z.B. Baujahr, Kilometerstand/Nutzung, letzte Prüfung/Service, technische Ausstattung, Masse/Gewichte; bei Elektronik z.B. Kaufdatum, Garantie, Zubehörumfang; bei Möbeln z.B. exakte Masse, Material, Hersteller. Erfinde keine Fragen, die für diesen konkreten Artikeltyp keinen Sinn ergeben – wenn kaum sinnvolle Zusatzfragen existieren, gib entsprechend wenige oder gar keine zurück. Jede Frage max 150 Zeichen, "placeholder" optional ein kurzes Beispiel (max 60 Zeichen), was für eine Antwort erwartet wird (z.B. "z.B. 2018"), sonst null.

Antworte AUSSCHLIESSLICH mit validem JSON, ohne Erklärtext, ohne Markdown-Codeblock, exakt in diesem Schema:
{
  "visible_facts": ["kurzer Fakt", "..."],
  "questions": [{ "question": "kurze Frage", "placeholder": "z.B. ..." oder null }]
}`;
}

function buildGeneratePrompt(input: DetailedDescriptionGenerateRequest): string {
  const factsList = input.visible_facts.length > 0 ? input.visible_facts.map((f) => `- ${f}`).join("\n") : "- (keine)";
  const answeredOnly = input.answers.filter((a) => a.answer.trim().length > 0);
  const answersList =
    answeredOnly.length > 0 ? answeredOnly.map((a) => `- ${a.question}: ${a.answer.trim()}`).join("\n") : "- (keine)";

  return `Erstelle eine ausführliche, professionelle Verkaufsbeschreibung für den Artikel "${input.name}" (Kategorie: ${input.category}, Zustand: ${input.condition_guess}) für Schweizer Occasion-Plattformen.

Bereits vorhandene kurze Verkaufsbeschreibung (als Kontext, nicht einfach wiederholen): "${input.suggested_description}"

Aus dem Foto bereits bekannte Fakten:
${factsList}

Zusätzliche Angaben vom Verkäufer:
${answersList}

Anforderungen:
- Strukturiere die Beschreibung übersichtlich, z.B. mit kurzen thematischen Abschnitten/Aufzählungspunkten (wie ein Datenblatt) – wähle passende Gruppen zum Artikeltyp (z.B. bei Fahrzeugen: Zustand/Prüfungen, Ausstattung, technische Daten; bei anderen Artikeln passende eigene Gruppen).
- Verwende NUR Fakten aus den obigen Angaben oder der kurzen Basis-Beschreibung – erfinde nichts (keine Baujahre, Masse, Prüfdaten o.ä., die nicht angegeben wurden).
- Wenn kaum Zusatzinformationen vorhanden sind, halte die Beschreibung entsprechend kürzer statt Lücken mit Vermutungen zu füllen.
- Länge angepasst an die vorhandene Faktenmenge, grob 40–220 Wörter.
- Sachlich-werblicher Ton, keine Übertreibungen.

Antworte AUSSCHLIESSLICH mit validem JSON, ohne Erklärtext, ohne Markdown-Codeblock: {"detailed_description": "..."}`;
}

export type DetailedDescriptionQuestionsOutcome =
  | { status: "ok"; result: DetailedDescriptionQuestionsResult }
  | { status: "no_text" }
  | { status: "invalid_json"; rawText: string; error: string };

export type DetailedDescriptionGenerateOutcome =
  | { status: "ok"; result: DetailedDescriptionResult }
  | { status: "no_text" }
  | { status: "invalid_json"; rawText: string; error: string };

async function runQuestionsAttempt(
  photo: ProcessedPhoto,
  fields: DetailedDescriptionQuestionsFields,
  apiKey: string
): Promise<DetailedDescriptionQuestionsOutcome> {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: QUESTIONS_MAX_TOKENS,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: photo.mediaType, data: photo.base64 } },
          { type: "text", text: buildQuestionsPrompt(fields) },
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
  if (parsedRaw === undefined) {
    parsedRaw = tryParseJson(repairTruncatedJson(cleaned));
  }
  if (parsedRaw === undefined) {
    return { status: "invalid_json", rawText: cleaned, error: "JSON konnte auch nach Reparaturversuch nicht geparst werden." };
  }

  const validated = detailedDescriptionQuestionsResultSchema.safeParse(parsedRaw);
  if (!validated.success) {
    return { status: "invalid_json", rawText: cleaned, error: validated.error.message };
  }

  return { status: "ok", result: validated.data };
}

export async function generateDetailedDescriptionQuestions(
  photo: ProcessedPhoto,
  fields: DetailedDescriptionQuestionsFields,
  apiKey: string
): Promise<DetailedDescriptionQuestionsOutcome> {
  const firstAttempt = await runQuestionsAttempt(photo, fields, apiKey);
  if (firstAttempt.status !== "invalid_json") {
    return firstAttempt;
  }
  return runQuestionsAttempt(photo, fields, apiKey);
}

async function runGenerateAttempt(
  input: DetailedDescriptionGenerateRequest,
  apiKey: string
): Promise<DetailedDescriptionGenerateOutcome> {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: GENERATE_MAX_TOKENS,
    messages: [{ role: "user", content: buildGeneratePrompt(input) }],
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
    return { status: "invalid_json", rawText: cleaned, error: "JSON konnte auch nach Reparaturversuch nicht geparst werden." };
  }

  const validated = detailedDescriptionResultSchema.safeParse(parsedRaw);
  if (!validated.success) {
    return { status: "invalid_json", rawText: cleaned, error: validated.error.message };
  }

  return { status: "ok", result: validated.data };
}

export async function generateDetailedDescription(
  input: DetailedDescriptionGenerateRequest,
  apiKey: string
): Promise<DetailedDescriptionGenerateOutcome> {
  const firstAttempt = await runGenerateAttempt(input, apiKey);
  if (firstAttempt.status !== "invalid_json") {
    return firstAttempt;
  }
  return runGenerateAttempt(input, apiKey);
}
