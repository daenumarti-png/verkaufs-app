import type { FastifyInstance } from "fastify";
import type { ApiError, HeroImageComposingResult, HeroImageGenerativeResult } from "@verkaufs-app/shared";
import { generateMoodImageRequestSchema } from "@verkaufs-app/shared";
import { env } from "../config/env.js";
import { processPhotos } from "../services/photo-processing.js";
import { composeHeroImage } from "../services/hero-image-composing.js";
import { generateMoodImageBase64, MOOD_IMAGE_DISCLAIMER } from "../services/hero-image-generative.js";
import { EXPENSIVE_ENDPOINT_RATE_LIMIT } from "../config/rate-limit.js";

function errorReply(error: string, message: string): ApiError {
  return { error, message };
}

export async function heroImageRoutes(app: FastifyInstance) {
  // Composing-Ansatz (Phase 8, Ansatz 1): Freisteller + neutraler Hintergrund
  // + Schatten. Robust, kein Halluzinationsrisiko am Artikel.
  app.post("/items/hero-image/composing", async (req, reply) => {
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
    for await (const part of parts) {
      if (part.type !== "file") continue;
      if (file) {
        part.file.resume(); // nur das erste Foto wird verwendet
        continue;
      }
      file = { filename: part.filename || "foto.jpg", buffer: await part.toBuffer() };
    }

    if (!file) {
      return reply.status(400).send(errorReply("no_photo", "Ein Foto wird benötigt."));
    }

    const { processed, failed } = await processPhotos([file]);
    if (processed.length === 0) {
      return reply.status(422).send({
        ...errorReply("no_processable_photo", "Foto konnte nicht verarbeitet werden."),
        photo_warnings: failed,
      });
    }

    try {
      const sourceBuffer = Buffer.from(processed[0].base64, "base64");
      const heroImageBuffer = await composeHeroImage(sourceBuffer);
      const result: HeroImageComposingResult = {
        image_base64: heroImageBuffer.toString("base64"),
        media_type: "image/jpeg",
      };
      return reply.status(200).send(result);
    } catch (err) {
      req.log.error(err, "Composing-Titelfoto fehlgeschlagen");
      return reply
        .status(502)
        .send(errorReply("hero_image_failed", "Titelfoto konnte nicht erstellt werden. Bitte nochmals versuchen."));
    }
  });

  // Generativer Ansatz (Phase 8, Ansatz 2): nur auf explizite Anfrage, da
  // Bildgenerierung spürbar mehr kostet als Text/Vision-Calls (siehe
  // Abstimmung mit Nutzer). Erzeugt bewusst nur Atmosphäre/Umgebung, nicht
  // den Artikel selbst.
  app.post(
    "/items/hero-image/generative",
    { config: { rateLimit: EXPENSIVE_ENDPOINT_RATE_LIMIT } },
    async (req, reply) => {
      if (!env.OPENAI_API_KEY) {
        return reply
          .status(503)
          .send(
            errorReply(
              "service_unavailable",
              "Generative Stimmungsbilder sind aktuell nicht konfiguriert (kein OpenAI-API-Key hinterlegt)."
            )
          );
      }

      const parsedBody = generateMoodImageRequestSchema.safeParse(req.body);
      if (!parsedBody.success) {
        return reply
          .status(400)
          .send(errorReply("invalid_request", "Anfrage-Body entspricht nicht dem erwarteten Schema."));
      }

      try {
        const imageBase64 = await generateMoodImageBase64(parsedBody.data, env.OPENAI_API_KEY);
        const result: HeroImageGenerativeResult = {
          image_base64: imageBase64,
          media_type: "image/png",
          disclaimer: MOOD_IMAGE_DISCLAIMER,
        };
        return reply.status(200).send(result);
      } catch (err) {
        req.log.error(err, "Generatives Stimmungsbild fehlgeschlagen");
        return reply
          .status(502)
          .send(errorReply("hero_image_failed", "Stimmungsbild konnte nicht erstellt werden. Bitte nochmals versuchen."));
      }
    }
  );
}
