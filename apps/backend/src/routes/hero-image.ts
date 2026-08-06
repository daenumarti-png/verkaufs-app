import type { FastifyInstance } from "fastify";
import type { ApiError, BoundingBox, HeroImageComposingResult } from "@verkaufs-app/shared";
import { boundingBoxFieldsSchema, composeMarketingHeroImageFieldsSchema } from "@verkaufs-app/shared";
import { processPhotos } from "../services/photo-processing.js";
import { composeHeroImage, composeMarketingHeroImage } from "../services/hero-image-composing.js";

function errorReply(error: string, message: string): ApiError {
  return { error, message };
}

// Phase 4b: liefert die Bounding Box nur, wenn ALLE vier Werte vorhanden/
// gültig sind - fehlt/ist eines ungültig, gibt es null zurück (Fallback:
// hero-image-composing.ts nutzt dann das ganze Foto, wie bisher).
function extractBoundingBox(fields: {
  bbox_x?: number;
  bbox_y?: number;
  bbox_width?: number;
  bbox_height?: number;
}): BoundingBox | null {
  const { bbox_x, bbox_y, bbox_width, bbox_height } = fields;
  if (bbox_x === undefined || bbox_y === undefined || bbox_width === undefined || bbox_height === undefined) {
    return null;
  }
  return { x: bbox_x, y: bbox_y, width: bbox_width, height: bbox_height };
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
    const rawFields: Record<string, string> = {};
    for await (const part of parts) {
      if (part.type !== "file") {
        rawFields[part.fieldname] = String(part.value);
        continue;
      }
      if (file) {
        part.file.resume(); // nur das erste Foto wird verwendet
        continue;
      }
      file = { filename: part.filename || "foto.jpg", buffer: await part.toBuffer() };
    }

    if (!file) {
      return reply.status(400).send(errorReply("no_photo", "Ein Foto wird benötigt."));
    }

    const parsedBoundingBoxFields = boundingBoxFieldsSchema.safeParse(rawFields);
    const boundingBox = parsedBoundingBoxFields.success ? extractBoundingBox(parsedBoundingBoxFields.data) : null;

    const { processed, failed } = await processPhotos([file]);
    if (processed.length === 0) {
      return reply.status(422).send({
        ...errorReply("no_processable_photo", "Foto konnte nicht verarbeitet werden."),
        photo_warnings: failed,
      });
    }

    try {
      const sourceBuffer = Buffer.from(processed[0].base64, "base64");
      const heroImageBuffer = await composeHeroImage(sourceBuffer, boundingBox);
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

  // Marketing-Titelbild (Phase 8, Ansatz 2 – ersetzt das frühere rein
  // generative Stimmungsbild nach Nutzerfeedback: das reale Foto muss
  // erkennbar bleiben). Nimmt denselben Composing-Freisteller wie oben und
  // ergänzt Titel/Preis/Zustand als Text-Overlay statt eines KI-generierten
  // Bildes.
  app.post("/items/hero-image/marketing", async (req, reply) => {
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

    const parsedFields = composeMarketingHeroImageFieldsSchema.safeParse(rawFields);
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

    try {
      const sourceBuffer = Buffer.from(processed[0].base64, "base64");
      const boundingBox = extractBoundingBox(parsedFields.data);
      const heroImageBuffer = await composeMarketingHeroImage(
        sourceBuffer,
        {
          title: parsedFields.data.title,
          priceChf: parsedFields.data.price_chf,
          conditionGuess: parsedFields.data.condition_guess,
        },
        boundingBox
      );
      const result: HeroImageComposingResult = {
        image_base64: heroImageBuffer.toString("base64"),
        media_type: "image/jpeg",
      };
      return reply.status(200).send(result);
    } catch (err) {
      req.log.error(err, "Marketing-Titelbild fehlgeschlagen");
      return reply
        .status(502)
        .send(errorReply("hero_image_failed", "Titelbild konnte nicht erstellt werden. Bitte nochmals versuchen."));
    }
  });
}
