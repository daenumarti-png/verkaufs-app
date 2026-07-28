import { OAuth2Client } from "google-auth-library";
import type { VerifiedIdentity } from "./user.js";

let client: OAuth2Client | undefined;

export type GoogleVerifyResult =
  | { status: "ok"; identity: VerifiedIdentity }
  | { status: "invalid_token" }
  | { status: "not_configured" };

export async function verifyGoogleIdToken(idToken: string, expectedAudience: string | undefined): Promise<GoogleVerifyResult> {
  if (!expectedAudience) {
    return { status: "not_configured" };
  }

  client ??= new OAuth2Client();

  try {
    const ticket = await client.verifyIdToken({ idToken, audience: expectedAudience });
    const payload = ticket.getPayload();
    // email_verified: Google kann technisch ein Token mit unbestätigter
    // E-Mail ausstellen (z.B. bei bestimmten Workspace-Konfigurationen) –
    // für die Kontoerstellung wollen wir uns nur auf bestätigte E-Mails stützen.
    if (!payload || !payload.sub || !payload.email || payload.email_verified === false) {
      return { status: "invalid_token" };
    }

    return {
      status: "ok",
      identity: {
        authProvider: "GOOGLE",
        authProviderId: payload.sub,
        email: payload.email,
        name: payload.name,
      },
    };
  } catch {
    return { status: "invalid_token" };
  }
}
