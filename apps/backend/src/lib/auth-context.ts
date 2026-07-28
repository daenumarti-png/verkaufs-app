import type { FastifyReply, FastifyRequest } from "fastify";
import { verifySessionToken } from "../services/session.js";
import { GUEST_DEVICE_ID_HEADER } from "../config/guest.js";

export type AuthContext =
  | { type: "user"; userId: string }
  | { type: "guest"; deviceId: string }
  | { type: "invalid_token" }
  | { type: "missing_guest_device_id" };

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Ein vorhandener Authorization-Header MUSS gültig sein (401 bei ungültig/
 * abgelaufen) – kein stilles Zurückfallen auf Gastmodus, das würde
 * Token-Probleme verschleiern. Fehlt der Header komplett, gilt der Request
 * als Gast und braucht stattdessen die Geräte-ID (Phase 10 – 5-Artikel-Limit).
 */
export async function resolveAuthContext(req: FastifyRequest): Promise<AuthContext> {
  const authHeader = getHeaderValue(req.headers.authorization);
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const session = await verifySessionToken(token);
    if (!session) return { type: "invalid_token" };
    return { type: "user", userId: session.userId };
  }

  const deviceId = getHeaderValue(req.headers[GUEST_DEVICE_ID_HEADER]);
  if (!deviceId) return { type: "missing_guest_device_id" };
  return { type: "guest", deviceId };
}

/**
 * Für Endpunkte, die zwingend einen Account brauchen (kein Gastmodus) – z.B.
 * eBay-Kontoverknüpfung (Phase 12). Sendet bei Bedarf selbst die 401-Antwort
 * und gibt null zurück, damit der Aufrufer nur `if (!userId) return;` braucht.
 */
export async function requireUserId(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  const authHeader = getHeaderValue(req.headers.authorization);
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    reply.status(401).send({ error: "invalid_token", message: "Bitte anmelden, um fortzufahren." });
    return null;
  }
  return session.userId;
}
