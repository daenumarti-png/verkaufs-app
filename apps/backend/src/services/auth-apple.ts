import { createRemoteJWKSet, jwtVerify } from "jose";
import type { VerifiedIdentity } from "./user.js";

// Strukturell vollständig nach Apple-Spezifikation umgesetzt, aber mangels
// eigenem (kostenpflichtigem) Apple-Developer-Account noch nicht gegen ein
// echtes Identity-Token getestet (siehe Abstimmung Phase 10).
const APPLE_ISSUER = "https://appleid.apple.com";
const jwks = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

export type AppleVerifyResult =
  | { status: "ok"; identity: VerifiedIdentity }
  | { status: "invalid_token" }
  | { status: "not_configured" };

/**
 * name kommt bei Apple NICHT im Identity-Token, sondern nur einmalig beim
 * allerersten Sign-in als separates Feld vom nativen Apple-Sign-in-Flow –
 * der Client muss es beim ersten Login zusätzlich mitschicken.
 */
export async function verifyAppleIdentityToken(
  identityToken: string,
  expectedAudience: string | undefined,
  nameFromFirstSignIn?: string
): Promise<AppleVerifyResult> {
  if (!expectedAudience) {
    return { status: "not_configured" };
  }

  try {
    const { payload } = await jwtVerify(identityToken, jwks, {
      issuer: APPLE_ISSUER,
      audience: expectedAudience,
    });

    // Apple kodiert email_verified/is_private_email als String "true"/"false",
    // nicht als Boolean – bekannte Eigenheit ihrer Tokens.
    const emailVerified = payload.email_verified === true || payload.email_verified === "true";
    const email = typeof payload.email === "string" ? payload.email : undefined;

    if (!payload.sub || !email || !emailVerified) {
      return { status: "invalid_token" };
    }

    return {
      status: "ok",
      identity: {
        authProvider: "APPLE",
        authProviderId: payload.sub,
        email,
        name: nameFromFirstSignIn,
      },
    };
  } catch {
    return { status: "invalid_token" };
  }
}
