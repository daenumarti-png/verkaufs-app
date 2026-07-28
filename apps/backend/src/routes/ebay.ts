import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ApiError, EbayDraftResult } from "@verkaufs-app/shared";
import { ebayDraftFieldsSchema } from "@verkaufs-app/shared";
import { requireUserId } from "../lib/auth-context.js";
import { env } from "../config/env.js";
import { MAX_PHOTOS } from "../config/upload.js";
import { EBAY_CONDITION_ID } from "../config/ebay.js";
import {
  isEbayConfigured,
  buildConsentUrl,
  signOAuthState,
  verifyOAuthState,
  exchangeCodeForTokens,
  saveEbayConnection,
  getValidAccessTokenForUser,
} from "../services/ebay-oauth.js";
import {
  getBusinessPolicies,
  getMerchantLocationKey,
  suggestCategory,
  createDraftOffer,
} from "../services/ebay-listing.js";
import { processPhotos } from "../services/photo-processing.js";
import { uploadPhotoToStorage } from "../services/photo-storage.js";
import { mapToStructuredCondition } from "../services/listing-formatting.js";
import { prisma } from "../db/client.js";
import { EXPENSIVE_ENDPOINT_RATE_LIMIT } from "../config/rate-limit.js";

function errorReply(error: string, message: string): ApiError {
  return { error, message };
}

// /ebay/callback spiegelt eBay-Query-Parameter (potenziell durch einen
// präparierten Link beeinflussbar) in eine HTML-Antwort – ohne Escaping wäre
// das eine reflektierte XSS-Lücke.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function ebayRoutes(app: FastifyInstance) {
  app.get("/ebay/connect", async (req, reply) => {
    const userId = await requireUserId(req, reply);
    if (!userId) return;

    if (!isEbayConfigured()) {
      return reply
        .status(503)
        .send(errorReply("service_unavailable", "eBay-Anbindung ist aktuell nicht konfiguriert."));
    }

    const state = await signOAuthState(userId);
    return reply.status(200).send({ consent_url: buildConsentUrl(state) });
  });

  // Reiner Browser-Redirect-Endpunkt (eBay leitet den Nutzer hierher zurück),
  // daher HTML-Antwort statt JSON.
  app.get("/ebay/callback", async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;

    if (query.error) {
      const safeMessage = escapeHtml(query.error_description ?? query.error);
      return reply.status(200).type("text/html").send(`<h1>eBay-Verknüpfung abgebrochen</h1><p>${safeMessage}</p>`);
    }

    if (!query.code || !query.state) {
      return reply.status(400).type("text/html").send("<h1>Ungültige Rückgabe von eBay</h1>");
    }

    const userId = await verifyOAuthState(query.state);
    if (!userId) {
      return reply
        .status(400)
        .type("text/html")
        .send("<h1>Sitzung abgelaufen</h1><p>Bitte die eBay-Verknüpfung erneut starten.</p>");
    }

    try {
      const tokens = await exchangeCodeForTokens(query.code);
      await saveEbayConnection(userId, tokens);
    } catch (err) {
      req.log.error(err, "eBay Token-Exchange fehlgeschlagen");
      return reply
        .status(502)
        .type("text/html")
        .send("<h1>Verknüpfung fehlgeschlagen</h1><p>Bitte nochmals versuchen.</p>");
    }

    return reply
      .status(200)
      .type("text/html")
      .send("<h1>eBay-Konto verknüpft</h1><p>Du kannst jetzt zur App zurückkehren.</p>");
  });

  app.get("/ebay/status", async (req, reply) => {
    const userId = await requireUserId(req, reply);
    if (!userId) return;

    const connection = await prisma.ebayConnection.findUnique({ where: { userId } });
    return reply.status(200).send({ connected: Boolean(connection) });
  });

  // Phase 12 – legt über die echte eBay-API einen Entwurf an (Inventory Item
  // + Offer), OHNE ihn zu veröffentlichen (mit Nutzer abgestimmt). Braucht
  // Login (kein Gastmodus) und eine bestehende eBay-Kontoverknüpfung.
  app.post("/items/ebay/prepare-draft", { config: { rateLimit: EXPENSIVE_ENDPOINT_RATE_LIMIT } }, async (req, reply) => {
    const userId = await requireUserId(req, reply);
    if (!userId) return;

    if (!isEbayConfigured()) {
      return reply
        .status(503)
        .send(errorReply("service_unavailable", "eBay-Anbindung ist aktuell nicht konfiguriert."));
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

    const files: { filename: string; buffer: Buffer }[] = [];
    const rawFields: Record<string, string> = {};
    for await (const part of parts) {
      if (part.type === "file") {
        if (files.length < MAX_PHOTOS) {
          files.push({ filename: part.filename || "foto.jpg", buffer: await part.toBuffer() });
        } else {
          part.file.resume();
        }
        continue;
      }
      rawFields[part.fieldname] = String(part.value);
    }

    const parsedFields = ebayDraftFieldsSchema.safeParse(rawFields);
    if (!parsedFields.success) {
      return reply
        .status(400)
        .send(errorReply("invalid_request", "Formularfelder entsprechen nicht dem erwarteten Schema."));
    }
    if (files.length === 0) {
      return reply.status(400).send(errorReply("no_photos", "Mindestens ein Foto wird benötigt."));
    }

    let tokenResult;
    try {
      tokenResult = await getValidAccessTokenForUser(userId);
    } catch (err) {
      req.log.error(err, "eBay-Access-Token konnte nicht beschafft werden");
      return reply
        .status(502)
        .send(errorReply("ebay_token_failed", "Verbindung zu eBay fehlgeschlagen. Bitte nochmals versuchen."));
    }
    if (tokenResult.status === "not_connected") {
      return reply
        .status(409)
        .send(errorReply("ebay_not_connected", "Kein eBay-Konto verknüpft. Bitte zuerst über /ebay/connect verknüpfen."));
    }
    if (tokenResult.status === "refresh_token_expired") {
      return reply
        .status(409)
        .send(errorReply("ebay_reconnect_required", "eBay-Verknüpfung abgelaufen. Bitte erneut verknüpfen."));
    }
    const accessToken = tokenResult.accessToken;

    const { processed, failed } = await processPhotos(files);
    if (processed.length === 0) {
      return reply.status(422).send({
        ...errorReply("no_processable_photos", "Keines der Fotos konnte verarbeitet werden."),
        photo_warnings: failed,
      });
    }

    let imageUrls: string[];
    try {
      const uploaded = await Promise.all(
        processed.map((p) => uploadPhotoToStorage(Buffer.from(p.base64, "base64"), p.mediaType))
      );
      imageUrls = uploaded.map((u) => u.url);
    } catch (err) {
      req.log.error(err, "Foto-Upload zu Supabase Storage fehlgeschlagen");
      return reply
        .status(502)
        .send(errorReply("photo_upload_failed", "Fotos konnten nicht hochgeladen werden. Bitte nochmals versuchen."));
    }

    let policies;
    let merchantLocationKey: string | null;
    let category;
    try {
      [policies, merchantLocationKey, category] = await Promise.all([
        getBusinessPolicies(accessToken),
        getMerchantLocationKey(accessToken),
        suggestCategory(accessToken, parsedFields.data.category),
      ]);
    } catch (err) {
      req.log.error(err, "eBay-API-Aufruf (Policies/Lagerort/Kategorie) fehlgeschlagen");
      return reply
        .status(502)
        .send(errorReply("ebay_api_error", "eBay-Anfrage fehlgeschlagen. Bitte nochmals versuchen."));
    }

    if (!policies) {
      return reply.status(422).send(
        errorReply(
          "missing_business_policies",
          "Im eBay-Konto fehlen Zahlungs-/Rückgabe-/Versandrichtlinien. Bitte zuerst im eBay Seller Hub einrichten."
        )
      );
    }
    if (!merchantLocationKey) {
      return reply.status(422).send(
        errorReply(
          "missing_merchant_location",
          "Im eBay-Konto ist kein Lagerort/Versandursprung hinterlegt. Bitte zuerst im eBay Seller Hub einrichten."
        )
      );
    }
    if (!category) {
      return reply
        .status(422)
        .send(errorReply("category_not_found", "Keine passende eBay-Kategorie für diesen Artikel gefunden."));
    }

    const conditionId = EBAY_CONDITION_ID[mapToStructuredCondition(parsedFields.data.condition_guess)];
    const sku = `verkaufsapp-${randomUUID()}`;

    try {
      const { offerId } = await createDraftOffer(accessToken, {
        sku,
        title: parsedFields.data.title,
        description: parsedFields.data.description,
        conditionId,
        priceChf: parsedFields.data.price_chf,
        imageUrls,
        categoryId: category.categoryId,
        policies,
        merchantLocationKey,
      });

      const responseBody: EbayDraftResult = {
        offer_id: offerId,
        sku,
        category_used: { id: category.categoryId, name: category.categoryName },
        ebay_environment: env.EBAY_ENVIRONMENT,
        note: "Entwurf im eBay-Verkäuferkonto angelegt, aber NICHT veröffentlicht. Bitte in der eBay-App/-Website final prüfen und veröffentlichen.",
      };
      return reply.status(200).send(responseBody);
    } catch (err) {
      req.log.error(err, "eBay-Angebot konnte nicht erstellt werden");
      return reply
        .status(502)
        .send(errorReply("ebay_offer_failed", "Angebot konnte bei eBay nicht angelegt werden. Bitte nochmals versuchen."));
    }
  });
}
