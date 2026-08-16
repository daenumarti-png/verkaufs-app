import type { FastifyInstance } from "fastify";
import type { ApiError, DetailedDescriptionQuestionsResult, DetailedDescriptionResult } from "@verkaufs-app/shared";
import { detailedDescriptionQuestionsFieldsSchema, detailedDescriptionGenerateRequestSchema } from "@verkaufs-app/shared";
import { env } from "../config/env.js";
import { processPhotos } from "../services/photo-processing.js";
import { generateDetailedDescriptionQuestions, generateDetailedDescription } from "../services/detailed-description.js";
import { EXPENSIVE_ENDPOINT_RATE_LIMIT } from "../config/rate-limit.js";

function errorReply(error: string, message: string): ApiError {
  return { error, message };
}

// "Ausführliche Beschreibung" (Zusatzfeature, opt-in) – zweistufiger Flow,
// siehe Kommentar in packages/shared/src/schemas/detailed-description.ts.
// Wie bei /items/refine-estimate und /items/research-collector-value bewusst
// OHNE zusätzliche Abo-Kontingent-Prüfung (nur ANTHROPIC_API_KEY + Rate-
// Limit) – konsistent mit dem bestehenden Muster für diese Zusatzschritte.
export async function detailedDescriptionRoutes(app: FastifyInstance) {
  app.post(
    "/items/detailed-description/questions",
    { config: { rateLimit: EXPENSIVE_ENDPOINT_RATE_LIMIT } },
    async (req, reply) => {
      if (!env.ANTHROPIC_API_KEY) {
        return reply
          .status(503)
          .send(errorReply("service_unavailable", "Foto-Analyse ist aktuell nicht konfiguriert (kein API-Key hinterlegt)."));
      }

      let parts;
      try {
        parts = req.parts();
      } catch (err) {
        req.log.warn(err, "Multipart-Request konnte nicht gelesen werden");
        return reply
          .status(400)
          .send(errorReply("invalid_upload", "Upload konnte nicht gelesen werden (multipart/form-data erwartet)."));
      }

      let file: { filename: string; buffer: Buffer } | null = null;
      const rawFields: Record<string, string> = {};
      for await (const part of parts) {
        if (part.type === "file") {
          if (file) {
            part.file.resume(); // nur das erste Foto wird verwendet
            continue;
          }
          file = { filename: part.filename || "foto.jpg", buffer: await part.toBuffer() };
          continue;
        }
        rawFields[part.fieldname] = String(part.value);
      }

      if (!file) {
        return reply.status(400).send(errorReply("no_photo", "Ein Foto wird benötigt."));
      }

      const parsedFields = detailedDescriptionQuestionsFieldsSchema.safeParse(rawFields);
      if (!parsedFields.success) {
        return reply
          .status(400)
          .send(errorReply("invalid_request", "Anfrage-Felder entsprechen nicht dem erwarteten Schema."));
      }

      const { processed, failed } = await processPhotos([file]);
      if (processed.length === 0) {
        return reply.status(422).send({
          ...errorReply("no_processable_photo", "Foto konnte nicht verarbeitet werden."),
          photo_warnings: failed,
        });
      }

      let outcome;
      try {
        outcome = await generateDetailedDescriptionQuestions(processed[0], parsedFields.data, env.ANTHROPIC_API_KEY);
      } catch (err) {
        req.log.error(err, "Anthropic-API-Aufruf (detailed-description/questions) fehlgeschlagen");
        return reply
          .status(502)
          .send(errorReply("detailed_description_failed", "Rückfragen konnten nicht erstellt werden. Bitte nochmals versuchen."));
      }

      if (outcome.status === "no_text") {
        return reply
          .status(502)
          .send(errorReply("detailed_description_failed", "Keine verwertbare Antwort vom Modell erhalten."));
      }
      if (outcome.status === "invalid_json") {
        req.log.error(
          { rawText: outcome.rawText, parseError: outcome.error },
          "Detailed-Description-Questions-Antwort ungültig (auch nach Retry-Versuch)"
        );
        return reply
          .status(502)
          .send(errorReply("detailed_description_invalid", "Antwort konnte nicht verarbeitet werden. Bitte nochmals versuchen."));
      }

      const responseBody: DetailedDescriptionQuestionsResult = outcome.result;
      return reply.status(200).send(responseBody);
    }
  );

  app.post(
    "/items/detailed-description/generate",
    { config: { rateLimit: EXPENSIVE_ENDPOINT_RATE_LIMIT } },
    async (req, reply) => {
      if (!env.ANTHROPIC_API_KEY) {
        return reply
          .status(503)
          .send(errorReply("service_unavailable", "Foto-Analyse ist aktuell nicht konfiguriert (kein API-Key hinterlegt)."));
      }

      const parsedBody = detailedDescriptionGenerateRequestSchema.safeParse(req.body);
      if (!parsedBody.success) {
        return reply
          .status(400)
          .send(errorReply("invalid_request", "Anfrage-Body entspricht nicht dem erwarteten Schema."));
      }

      let outcome;
      try {
        outcome = await generateDetailedDescription(parsedBody.data, env.ANTHROPIC_API_KEY);
      } catch (err) {
        req.log.error(err, "Anthropic-API-Aufruf (detailed-description/generate) fehlgeschlagen");
        return reply
          .status(502)
          .send(errorReply("detailed_description_failed", "Beschreibung konnte nicht erstellt werden. Bitte nochmals versuchen."));
      }

      if (outcome.status === "no_text") {
        return reply
          .status(502)
          .send(errorReply("detailed_description_failed", "Keine verwertbare Antwort vom Modell erhalten."));
      }
      if (outcome.status === "invalid_json") {
        req.log.error(
          { rawText: outcome.rawText, parseError: outcome.error },
          "Detailed-Description-Generate-Antwort ungültig (auch nach Retry-Versuch)"
        );
        return reply
          .status(502)
          .send(errorReply("detailed_description_invalid", "Antwort konnte nicht verarbeitet werden. Bitte nochmals versuchen."));
      }

      const responseBody: DetailedDescriptionResult = outcome.result;
      return reply.status(200).send(responseBody);
    }
  );
}
