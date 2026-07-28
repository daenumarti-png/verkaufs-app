import type { FastifyInstance } from "fastify";
import type {
  PhotoWarning,
  AnalyzeItemsResponse,
  ApiError,
  PrepareListingsResponse,
  RefineEstimateResponse,
  CollectorValueResponse,
} from "@verkaufs-app/shared";
import {
  refineEstimateRequestSchema,
  collectorResearchRequestSchema,
  prepareListingsRequestSchema,
  ESTIMATE_DISCLAIMER,
  COLLECTOR_VALUE_DISCLAIMER,
} from "@verkaufs-app/shared";
import { env } from "../config/env.js";
import { MAX_PHOTOS } from "../config/upload.js";
import { processPhotos } from "../services/photo-processing.js";
import { analyzePhotos, MAX_ITEMS } from "../services/ai-analysis.js";
import { refineEstimate } from "../services/refine-estimate.js";
import { researchCollectorValue } from "../services/collector-research.js";
import { prepareListings } from "../services/listing-formatting.js";
import { moderatePhotos } from "../services/content-moderation.js";
import { resolveAuthContext } from "../lib/auth-context.js";
import { getRemainingGuestQuota, recordGuestItemsAnalyzed } from "../services/guest-usage.js";
import { MAX_GUEST_ITEMS, GUEST_DEVICE_ID_HEADER } from "../config/guest.js";
import { EXPENSIVE_ENDPOINT_RATE_LIMIT } from "../config/rate-limit.js";

function errorReply(error: string, message: string): ApiError {
  return { error, message };
}

export async function itemRoutes(app: FastifyInstance) {
  app.post("/items/analyze", { config: { rateLimit: EXPENSIVE_ENDPOINT_RATE_LIMIT } }, async (req, reply) => {
    if (!env.ANTHROPIC_API_KEY) {
      return reply
        .status(503)
        .send(errorReply("service_unavailable", "Foto-Analyse ist aktuell nicht konfiguriert (kein API-Key hinterlegt)."));
    }

    // Phase 10: eingeloggte Nutzer sind unlimitiert, Gäste brauchen eine
    // Geräte-ID und sind auf MAX_GUEST_ITEMS erkannte Artikel begrenzt
    // (serverseitig durchgesetzt, siehe Briefing Abschnitt 1/6).
    const authContext = await resolveAuthContext(req);
    if (authContext.type === "invalid_token") {
      return reply.status(401).send(errorReply("invalid_token", "Sitzung ungültig oder abgelaufen. Bitte erneut anmelden."));
    }
    if (authContext.type === "missing_guest_device_id") {
      return reply
        .status(400)
        .send(
          errorReply(
            "missing_guest_device_id",
            `Ohne Login wird der Header "${GUEST_DEVICE_ID_HEADER}" mit einer lokal erzeugten Geräte-ID benötigt.`
          )
        );
    }
    if (authContext.type === "guest") {
      const remainingQuota = await getRemainingGuestQuota(authContext.deviceId);
      if (remainingQuota <= 0) {
        return reply.status(403).send(
          errorReply(
            "guest_limit_reached",
            `Gastlimit von ${MAX_GUEST_ITEMS} erkannten Artikeln erreicht. Bitte anmelden, um unbegrenzt weiterzumachen.`
          )
        );
      }
    }

    let parts;
    try {
      parts = req.parts();
    } catch (err) {
      req.log.warn(err, "Multipart-Request konnte nicht gelesen werden");
      return reply.status(400).send(errorReply("invalid_upload", "Upload konnte nicht gelesen werden (multipart/form-data erwartet)."));
    }

    const files: { filename: string; buffer: Buffer }[] = [];
    const uploadWarnings: PhotoWarning[] = [];
    let maxPhotosExceeded = false;

    for await (const part of parts) {
      if (part.type !== "file") continue;

      const filename = part.filename || "unbenanntes Foto";

      if (files.length >= MAX_PHOTOS) {
        maxPhotosExceeded = true;
        part.file.resume(); // Stream verwerfen statt Request blockieren
        continue;
      }

      try {
        const buffer = await part.toBuffer();
        if (part.file.truncated) {
          uploadWarnings.push({
            filename,
            reason: "Foto überschreitet die maximale Dateigrösse und wurde übersprungen.",
          });
          continue;
        }
        files.push({ filename, buffer });
      } catch (err) {
        req.log.warn(err, `Foto "${filename}" konnte nicht gelesen werden`);
        uploadWarnings.push({ filename, reason: "Foto konnte nicht gelesen werden." });
      }
    }

    if (files.length === 0) {
      return reply
        .status(400)
        .send({ ...errorReply("no_photos", "Mindestens ein verwertbares Foto wird benötigt."), photo_warnings: uploadWarnings });
    }

    const { processed, failed: processingWarnings } = await processPhotos(files);
    const photoWarnings = [...uploadWarnings, ...processingWarnings];

    if (processed.length === 0) {
      return reply.status(422).send({
        ...errorReply("no_processable_photos", "Keines der Fotos konnte verarbeitet werden."),
        photo_warnings: photoWarnings,
      });
    }

    // Phase 11 – Content-Moderation, Pflicht-Prüfschritt VOR der eigentlichen
    // Analyse (Briefing Abschnitt 8 / "Nicht verhandelbare Rahmenbedingungen").
    // Fail-closed: Schlägt die Prüfung selbst technisch fehl, wird NICHT
    // trotzdem analysiert (mit Nutzer abgestimmt) – "im Zweifel ablehnen"
    // gilt auch für Systemfehler, nicht nur für den Inhalt.
    let moderationOutcome;
    try {
      moderationOutcome = await moderatePhotos(processed, env.ANTHROPIC_API_KEY);
    } catch (err) {
      req.log.error(err, "Content-Moderation fehlgeschlagen (API-Fehler)");
      return reply
        .status(502)
        .send(errorReply("moderation_failed", "Prüfung der Fotos fehlgeschlagen. Bitte nochmals versuchen."));
    }

    if (moderationOutcome.status !== "ok") {
      req.log.error(
        { moderationOutcome },
        "Content-Moderation ungültig (auch nach Retry-Versuch) – fail-closed"
      );
      return reply
        .status(502)
        .send(errorReply("moderation_failed", "Prüfung der Fotos fehlgeschlagen. Bitte nochmals versuchen."));
    }

    if (moderationOutcome.result.blocked) {
      req.log.warn({ category: moderationOutcome.result.category }, "Artikel durch Content-Moderation blockiert");
      return reply.status(403).send({
        ...errorReply(
          "content_blocked",
          `Dieser Artikel kann nicht analysiert werden: ${moderationOutcome.result.reasoning}`
        ),
        category: moderationOutcome.result.category,
      });
    }

    let outcome;
    try {
      outcome = await analyzePhotos(processed, env.ANTHROPIC_API_KEY);
    } catch (err) {
      req.log.error(err, "Anthropic-API-Aufruf fehlgeschlagen");
      return reply.status(502).send(errorReply("analysis_failed", "Analyse fehlgeschlagen. Bitte nochmals versuchen."));
    }

    if (outcome.status === "no_text") {
      return reply
        .status(502)
        .send(errorReply("analysis_failed", "Keine verwertbare Antwort vom Analyse-Modell erhalten."));
    }

    if (outcome.status === "invalid_json") {
      req.log.error(
        { rawText: outcome.rawText, parseError: outcome.error },
        "Analyse-Antwort ungültig (auch nach Retry-Versuch)"
      );
      return reply
        .status(502)
        .send(errorReply("analysis_invalid", "Analyse-Antwort konnte nicht verarbeitet werden. Bitte nochmals versuchen."));
    }

    if (outcome.bundlePriceSanityWarning) {
      req.log.warn({ warning: outcome.bundlePriceSanityWarning }, "Bundle-Preis-Sanity-Check angeschlagen");
    }

    // Zwei unabhängige Signale, ob die Sammlung grösser als MAX_ITEMS sein
    // könnte (Phase 4 – gestufter Flow für 5+ Artikel): items_capped ist
    // mechanisch (Limit exakt erreicht), additional_items_likely ist die
    // Selbsteinschätzung des Modells anhand der Fotos.
    const itemsCapped = outcome.result.items.length >= MAX_ITEMS;
    const stagingHint =
      itemsCapped || outcome.result.additional_items_likely
        ? "Es könnten weitere Artikel auf den Fotos sein. Fotografiere die restlichen Artikel separat und starte eine weitere Analyse, um sie zu ergänzen."
        : null;

    if (authContext.type === "guest") {
      await recordGuestItemsAnalyzed(authContext.deviceId, outcome.result.items.length);
    }

    const responseBody: AnalyzeItemsResponse = {
      ...outcome.result,
      photo_warnings: photoWarnings,
      photos_used: processed.length,
      max_photos_exceeded: maxPhotosExceeded,
      truncated_response_repaired: outcome.wasRepaired,
      items_capped: itemsCapped,
      staging_hint: stagingHint,
      disclaimer: ESTIMATE_DISCLAIMER,
    };

    return reply.status(200).send(responseBody);
  });

  // Phase 5 – Rückfragen-Flow: nimmt die Chip-Antworten des Nutzers entgegen
  // und liefert eine aktualisierte Preis-/Score-Schätzung. Bewusst kein
  // Foto-Upload nötig (siehe Schema-Kommentar in refine-estimate.ts).
  app.post("/items/refine-estimate", { config: { rateLimit: EXPENSIVE_ENDPOINT_RATE_LIMIT } }, async (req, reply) => {
    if (!env.ANTHROPIC_API_KEY) {
      return reply
        .status(503)
        .send(errorReply("service_unavailable", "Foto-Analyse ist aktuell nicht konfiguriert (kein API-Key hinterlegt)."));
    }

    const parsedBody = refineEstimateRequestSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return reply
        .status(400)
        .send(errorReply("invalid_request", "Anfrage-Body entspricht nicht dem erwarteten Schema."));
    }

    let outcome;
    try {
      outcome = await refineEstimate(parsedBody.data, env.ANTHROPIC_API_KEY);
    } catch (err) {
      req.log.error(err, "Anthropic-API-Aufruf (refine-estimate) fehlgeschlagen");
      return reply.status(502).send(errorReply("refine_failed", "Aktualisierung fehlgeschlagen. Bitte nochmals versuchen."));
    }

    if (outcome.status === "no_text") {
      return reply
        .status(502)
        .send(errorReply("refine_failed", "Keine verwertbare Antwort vom Modell erhalten."));
    }

    if (outcome.status === "invalid_json") {
      req.log.error(
        { rawText: outcome.rawText, parseError: outcome.error },
        "Refine-Estimate-Antwort ungültig (auch nach Retry-Versuch)"
      );
      return reply
        .status(502)
        .send(errorReply("refine_invalid", "Antwort konnte nicht verarbeitet werden. Bitte nochmals versuchen."));
    }

    const responseBody: RefineEstimateResponse = { ...outcome.result, disclaimer: ESTIMATE_DISCLAIMER };
    return reply.status(200).send(responseBody);
  });

  // Phase 7 – Sammlerwert-Recherche: separater, gezielter Analyseschritt mit
  // Live-Websuche. Bewusst ein eigener Endpunkt statt Teil von /items/analyze,
  // damit die (teurere, langsamere) Web-Suche nur ausgelöst wird, wenn der
  // Client das possible_collector_value-Flag aus der Erstanalyse sieht oder
  // der Nutzer es explizit anfordert – nicht bei jedem Alltagsartikel.
  app.post(
    "/items/research-collector-value",
    { config: { rateLimit: EXPENSIVE_ENDPOINT_RATE_LIMIT } },
    async (req, reply) => {
      if (!env.ANTHROPIC_API_KEY) {
        return reply
          .status(503)
          .send(errorReply("service_unavailable", "Foto-Analyse ist aktuell nicht konfiguriert (kein API-Key hinterlegt)."));
      }

      const parsedBody = collectorResearchRequestSchema.safeParse(req.body);
      if (!parsedBody.success) {
        return reply
          .status(400)
          .send(errorReply("invalid_request", "Anfrage-Body entspricht nicht dem erwarteten Schema."));
      }

      let outcome;
      try {
        outcome = await researchCollectorValue(parsedBody.data, env.ANTHROPIC_API_KEY);
      } catch (err) {
        req.log.error(err, "Anthropic-API-Aufruf (collector-research) fehlgeschlagen");
        return reply
          .status(502)
          .send(errorReply("collector_research_failed", "Recherche fehlgeschlagen. Bitte nochmals versuchen."));
      }

      if (outcome.status === "no_tool_call") {
        return reply
          .status(502)
          .send(errorReply("collector_research_failed", "Keine verwertbare Antwort vom Modell erhalten."));
      }

      if (outcome.status === "invalid_json") {
        req.log.error(
          { toolInput: outcome.rawText, validationError: outcome.error },
          "Collector-Research-Antwort ungültig (auch nach Retry-Versuch)"
        );
        return reply
          .status(502)
          .send(errorReply("collector_research_invalid", "Antwort konnte nicht verarbeitet werden. Bitte nochmals versuchen."));
      }

      req.log.info({ searchesUsed: outcome.searchesUsed }, "Sammlerwert-Recherche abgeschlossen");
      const responseBody: CollectorValueResponse = { ...outcome.result, disclaimer: COLLECTOR_VALUE_DISCLAIMER };
      return reply.status(200).send(responseBody);
    }
  );

  // Phase 9 – kopierfertige, plattformspezifische Ausgabe. Reine
  // Formatierungs-/Business-Logik ohne KI-Call, daher kein API-Key nötig.
  // "Ein-Tap-Kopieren" selbst ist eine Client-Interaktion (Zwischenablage);
  // dieser Endpunkt liefert dafür bereits fertig formatierte, gekürzte Werte.
  app.post("/items/prepare-listings", async (req, reply) => {
    const parsedBody = prepareListingsRequestSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return reply
        .status(400)
        .send(errorReply("invalid_request", "Anfrage-Body entspricht nicht dem erwarteten Schema."));
    }

    const { item, platforms } = parsedBody.data;
    const responseBody: PrepareListingsResponse = {
      listings: prepareListings(platforms, item),
    };
    return reply.status(200).send(responseBody);
  });
}
