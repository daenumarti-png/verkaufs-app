import { z } from "zod";

// "Ausführliche Beschreibung" – bewusst ein ZUSÄTZLICHES, separates Feld,
// nicht ersetzt suggested_description (die bleibt bei 25 Wörtern für die
// normale Plattform-Ausgabe). Nur auf Wunsch (Button-Tap), zweistufiger Flow:
// 1) POST /items/detailed-description/questions (Foto + Artikel-Kontext) –
//    KI listet bereits aus dem Foto sichtbare Fakten UND stellt gezielte,
//    artikeltyp-spezifische Rückfragen zu dem, was NICHT sichtbar ist
//    (z.B. Baujahr/Kilometerstand bei Fahrzeugen, Kaufdatum/Garantie bei
//    Elektronik) – bewusst KEINE pauschalen Fragen für alle Artikel gleich.
// 2) POST /items/detailed-description/generate (Antworten, optional/
//    lückenhaft erlaubt) – KI formuliert daraus die finale, strukturierte
//    Beschreibung. Erfindet nichts über die gegebenen Fakten hinaus.

export const detailedDescriptionQuestionSchema = z.object({
  question: z.string().min(1).max(150),
  // Kurzes Beispiel, was als Antwort erwartet wird (z.B. "z.B. 2018") – rein
  // fürs UI-Placeholder, kein Pflichtfeld für die Antwort selbst.
  placeholder: z.string().max(60).nullable().default(null),
});

// Request-Felder für POST /items/detailed-description/questions
// (multipart/form-data, zusätzlich zum Foto-Datei-Teil).
export const detailedDescriptionQuestionsFieldsSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  condition_guess: z.string().min(1),
});

export const detailedDescriptionQuestionsResultSchema = z.object({
  // Aus dem Foto bereits erkennbare Fakten – werden dem Nutzer als Kontext
  // gezeigt und fliessen direkt in Schritt 2 (generate) mit ein, ohne dass
  // der Nutzer sie nochmals eintippen muss.
  visible_facts: z.array(z.string().min(1).max(100)).max(10).default([]),
  questions: z.array(detailedDescriptionQuestionSchema).max(6).default([]),
});

export const detailedDescriptionAnswerSchema = z.object({
  question: z.string().min(1),
  answer: z.string().max(300),
});

// Request-Body für POST /items/detailed-description/generate (JSON, kein
// erneuter Foto-Upload nötig – visible_facts kommen bereits aus Schritt 1).
export const detailedDescriptionGenerateRequestSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  condition_guess: z.string().min(1),
  suggested_description: z.string().min(1),
  visible_facts: z.array(z.string()).default([]),
  answers: z.array(detailedDescriptionAnswerSchema).default([]),
});

export const detailedDescriptionResultSchema = z.object({
  detailed_description: z.string().min(1),
});

export type DetailedDescriptionQuestion = z.infer<typeof detailedDescriptionQuestionSchema>;
export type DetailedDescriptionQuestionsFields = z.infer<typeof detailedDescriptionQuestionsFieldsSchema>;
export type DetailedDescriptionQuestionsResult = z.infer<typeof detailedDescriptionQuestionsResultSchema>;
export type DetailedDescriptionAnswer = z.infer<typeof detailedDescriptionAnswerSchema>;
export type DetailedDescriptionGenerateRequest = z.infer<typeof detailedDescriptionGenerateRequestSchema>;
export type DetailedDescriptionResult = z.infer<typeof detailedDescriptionResultSchema>;
