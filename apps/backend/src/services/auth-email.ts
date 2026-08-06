import type { User } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/client.js";
import { hashPassword, verifyPassword } from "../lib/password.js";

export type RegisterResult = { status: "ok"; user: User } | { status: "email_taken" };

export type LoginResult =
  | { status: "ok"; user: User }
  | { status: "invalid_credentials" }
  | { status: "wrong_provider"; provider: "GOOGLE" | "APPLE" };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function registerWithEmail(email: string, password: string, name?: string): Promise<RegisterResult> {
  const normalizedEmail = normalizeEmail(email);
  const passwordHash = await hashPassword(password);

  try {
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name,
        authProvider: "EMAIL",
        authProviderId: normalizedEmail,
        passwordHash,
      },
    });
    return { status: "ok", user };
  } catch (err) {
    // P2002 = Unique-Constraint-Verletzung. Trifft hier entweder das globale
    // "email @unique" (E-Mail bereits über Google/Apple ODER Email
    // registriert) oder das zusammengesetzte (authProvider, authProviderId)
    // -Unique (praktisch nur bei einem Race: zwei gleichzeitige
    // Registrierungsversuche derselben E-Mail). Beide Fälle sind aus
    // Nutzersicht identisch: "diese E-Mail ist schon vergeben" – andere
    // Fehler (DB down etc.) NICHT abfangen, sondern durchreichen/500 auslösen lassen.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { status: "email_taken" };
    }
    throw err;
  }
}

export async function loginWithEmail(email: string, password: string): Promise<LoginResult> {
  const normalizedEmail = normalizeEmail(email);
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  if (!user) {
    return { status: "invalid_credentials" };
  }
  if (user.authProvider !== "EMAIL") {
    // Bewusst spezifisch statt generisch: bei dieser App-Grösse überwiegt
    // die UX-Hilfe ("geh zu Google/Apple") das geringe Enumeration-Risiko.
    return { status: "wrong_provider", provider: user.authProvider };
  }
  if (!user.passwordHash) {
    // Sollte durch obige Prüfung nie erreichbar sein (EMAIL-Nutzer haben
    // immer einen Hash) – als Sicherheitsnetz trotzdem generisch behandeln
    // statt eine Annahme über die Datenintegrität zu treffen.
    return { status: "invalid_credentials" };
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return { status: "invalid_credentials" };
  }

  return { status: "ok", user };
}
