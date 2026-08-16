import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { env } from "./config/env.js";
import { MAX_FILE_SIZE_BYTES } from "./config/upload.js";
import { GLOBAL_RATE_LIMIT } from "./config/rate-limit.js";
import { healthRoutes } from "./routes/health.js";
import { itemRoutes } from "./routes/items.js";
import { heroImageRoutes } from "./routes/hero-image.js";
import { detailedDescriptionRoutes } from "./routes/detailed-description.js";
import { authRoutes } from "./routes/auth.js";
import { ebayRoutes } from "./routes/ebay.js";
import { billingRoutes } from "./routes/billing.js";

// Reine App-Konfiguration OHNE .listen() – wiederverwendbar sowohl für den
// lokalen Dev-Server (index.ts ruft .listen() auf) als auch für den
// Firebase-Functions-Einstiegspunkt (functions/src/index.ts), der die
// fertig konfigurierte Instanz stattdessen an eine Cloud Function bindet.
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
  });

  await app.register(helmet);
  await app.register(cors, { origin: env.CORS_ORIGIN });

  // Phase 13 – Sicherheits-Checkliste: globaler Basisschutz gegen Spam. Einzelne
  // Routen mit KI-Calls setzen zusätzlich ein strengeres Routen-Limit
  // (AI_ENDPOINT_RATE_LIMIT), siehe jeweilige route-Dateien.
  await app.register(rateLimit, { global: true, ...GLOBAL_RATE_LIMIT });

  // Nur fileSize wird hier durchgesetzt; die maximale Foto-Anzahl prüft
  // routes/items.ts selbst, damit ein Überschreiten sauber als Warnung im
  // Response landet statt als harter Plugin-Fehler.
  await app.register(multipart, {
    limits: { fileSize: MAX_FILE_SIZE_BYTES },
  });

  await app.register(healthRoutes);
  await app.register(itemRoutes);
  await app.register(heroImageRoutes);
  await app.register(detailedDescriptionRoutes);
  await app.register(authRoutes);
  await app.register(ebayRoutes);
  await app.register(billingRoutes);

  // Phase 13 – Sicherheitsnetz: JEDE Route behandelt ihre erwarteten Fehler
  // bereits explizit mit einer sauberen errorReply(); dieser Handler fängt nur
  // unerwartete/nicht selbst abgefangene Fehler ab und stellt sicher, dass dabei
  // NIE Stack-Traces oder interne Details an den Client gehen (voller Fehler
  // landet aber immer im Server-Log).
  app.setErrorHandler((err, req, reply) => {
    req.log.error(err, "Unbehandelter Fehler");
    const statusCode = err.statusCode ?? 500;

    if (statusCode >= 500) {
      return reply
        .status(500)
        .send({ error: "internal_error", message: "Ein unerwarteter Fehler ist aufgetreten. Bitte später erneut versuchen." });
    }

    // 4xx von Fastify/Plugins (z.B. Rate-Limit, Payload zu gross, ungültiger
    // Content-Type) tragen bereits sichere, generische Meldungen ohne interne Details.
    return reply.status(statusCode).send({ error: "request_error", message: err.message });
  });

  return app;
}
