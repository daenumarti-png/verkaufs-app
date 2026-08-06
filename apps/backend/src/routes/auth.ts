import type { FastifyInstance } from "fastify";
import type { ApiError, AuthResponse } from "@verkaufs-app/shared";
import { googleAuthRequestSchema, appleAuthRequestSchema, emailRegisterRequestSchema, emailLoginRequestSchema } from "@verkaufs-app/shared";
import { env } from "../config/env.js";
import { verifyGoogleIdToken } from "../services/auth-google.js";
import { verifyAppleIdentityToken } from "../services/auth-apple.js";
import { registerWithEmail, loginWithEmail } from "../services/auth-email.js";
import { findOrCreateUser } from "../services/user.js";
import { signSessionToken } from "../services/session.js";
import { requireUserId } from "../lib/auth-context.js";
import { prisma } from "../db/client.js";
import { AUTH_RATE_LIMIT } from "../config/rate-limit.js";

function errorReply(error: string, message: string): ApiError {
  return { error, message };
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/google", async (req, reply) => {
    const parsedBody = googleAuthRequestSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return reply
        .status(400)
        .send(errorReply("invalid_request", "Anfrage-Body entspricht nicht dem erwarteten Schema."));
    }

    const result = await verifyGoogleIdToken(parsedBody.data.id_token, env.GOOGLE_CLIENT_ID);

    if (result.status === "not_configured") {
      return reply
        .status(503)
        .send(errorReply("service_unavailable", "Google-Login ist aktuell nicht konfiguriert (kein Client-ID hinterlegt)."));
    }
    if (result.status === "invalid_token") {
      return reply.status(401).send(errorReply("invalid_token", "Google-Token ungültig oder abgelaufen."));
    }

    const user = await findOrCreateUser(result.identity);
    const token = await signSessionToken(user.id);
    const responseBody: AuthResponse = { token, user: { id: user.id, email: user.email, name: user.name } };
    return reply.status(200).send(responseBody);
  });

  app.post("/auth/apple", async (req, reply) => {
    const parsedBody = appleAuthRequestSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return reply
        .status(400)
        .send(errorReply("invalid_request", "Anfrage-Body entspricht nicht dem erwarteten Schema."));
    }

    const result = await verifyAppleIdentityToken(
      parsedBody.data.identity_token,
      env.APPLE_CLIENT_ID,
      parsedBody.data.name
    );

    if (result.status === "not_configured") {
      return reply
        .status(503)
        .send(errorReply("service_unavailable", "Apple-Login ist aktuell nicht konfiguriert (kein Client-ID hinterlegt)."));
    }
    if (result.status === "invalid_token") {
      return reply.status(401).send(errorReply("invalid_token", "Apple-Token ungültig oder abgelaufen."));
    }

    const user = await findOrCreateUser(result.identity);
    const token = await signSessionToken(user.id);
    const responseBody: AuthResponse = { token, user: { id: user.id, email: user.email, name: user.name } };
    return reply.status(200).send(responseBody);
  });

  app.post("/auth/register", { config: { rateLimit: AUTH_RATE_LIMIT } }, async (req, reply) => {
    const parsedBody = emailRegisterRequestSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return reply
        .status(400)
        .send(errorReply("invalid_request", "Anfrage-Body entspricht nicht dem erwarteten Schema."));
    }

    const { email, password, name } = parsedBody.data;
    const result = await registerWithEmail(email, password, name);

    if (result.status === "email_taken") {
      return reply.status(409).send(errorReply("email_taken", "Diese E-Mail-Adresse ist bereits registriert."));
    }

    const token = await signSessionToken(result.user.id);
    const responseBody: AuthResponse = {
      token,
      user: { id: result.user.id, email: result.user.email, name: result.user.name },
    };
    return reply.status(200).send(responseBody);
  });

  app.post("/auth/login", { config: { rateLimit: AUTH_RATE_LIMIT } }, async (req, reply) => {
    const parsedBody = emailLoginRequestSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return reply
        .status(400)
        .send(errorReply("invalid_request", "Anfrage-Body entspricht nicht dem erwarteten Schema."));
    }

    const { email, password } = parsedBody.data;
    const result = await loginWithEmail(email, password);

    if (result.status === "invalid_credentials") {
      return reply.status(401).send(errorReply("invalid_credentials", "E-Mail oder Passwort ungültig."));
    }
    if (result.status === "wrong_provider") {
      const providerName = result.provider === "GOOGLE" ? "Google" : "Apple";
      return reply
        .status(409)
        .send(errorReply("wrong_provider", `Dieses Konto wurde über ${providerName} registriert, bitte dort anmelden.`));
    }

    const token = await signSessionToken(result.user.id);
    const responseBody: AuthResponse = {
      token,
      user: { id: result.user.id, email: result.user.email, name: result.user.name },
    };
    return reply.status(200).send(responseBody);
  });

  // Phase 13 – Datenschutz/Recht auf Löschung (Schweizer DSG, Briefing
  // Abschnitt 8). Löscht den Account und kaskadiert per DB-Constraint auf
  // Items, SaleHistory und EbayConnection (siehe schema.prisma). Bewusst
  // eine einzelne, direkte Aktion ohne separaten Bestätigungs-Flow – eine
  // "sicher?"-Bestätigung gehört ins UI, nicht in die API.
  //
  // Bekannte Lücke: zu diesem Nutzer hochgeladene Fotos in Supabase Storage
  // werden hier NICHT mitgelöscht, da aktuell keine Photo-Datensätze
  // persistiert werden, die Storage-Pfad und userId verknüpfen (Item-
  // Persistierung ist bewusst noch nicht Teil des Backends, siehe Phase 3).
  // Sobald das gebaut wird, muss dieser Endpunkt die zugehörigen
  // Storage-Objekte mitentfernen.
  app.delete("/account", async (req, reply) => {
    const userId = await requireUserId(req, reply);
    if (!userId) return;

    await prisma.user.delete({ where: { id: userId } });
    return reply.status(200).send({ deleted: true });
  });
}
