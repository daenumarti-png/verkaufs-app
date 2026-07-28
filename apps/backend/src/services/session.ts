import { SignJWT, jwtVerify } from "jose";
import { env } from "../config/env.js";

const SESSION_DURATION = "30d";
const secretKey = new TextEncoder().encode(env.JWT_SECRET);

export async function signSessionToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(secretKey);
}

export type VerifiedSession = { userId: string };

/**
 * Gibt null statt zu werfen, wenn das Token fehlt/abgelaufen/ungültig ist –
 * der Aufrufer (Auth-Middleware) entscheidet, ob das ein 401 auslöst oder
 * (z.B. bei optionalen Endpunkten) als "kein eingeloggter Nutzer" behandelt wird.
 */
export async function verifySessionToken(token: string): Promise<VerifiedSession | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey);
    if (typeof payload.sub !== "string") return null;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}
