import type { AuthProvider } from "@prisma/client";
import { prisma } from "../db/client.js";

export type VerifiedIdentity = {
  authProvider: AuthProvider;
  authProviderId: string;
  email: string;
  name?: string;
};

/**
 * Sucht den Nutzer anhand (authProvider, authProviderId) – NICHT anhand der
 * E-Mail, da dieselbe E-Mail theoretisch über beide Provider verknüpft sein
 * könnte und wir keine automatische Konten-Zusammenführung vornehmen wollen
 * (nicht Teil der Anforderungen, potenzielle Sicherheitsfalle).
 */
export async function findOrCreateUser(identity: VerifiedIdentity) {
  const existing = await prisma.user.findUnique({
    where: {
      authProvider_authProviderId: {
        authProvider: identity.authProvider,
        authProviderId: identity.authProviderId,
      },
    },
  });
  if (existing) {
    return existing;
  }

  return prisma.user.create({
    data: {
      authProvider: identity.authProvider,
      authProviderId: identity.authProviderId,
      email: identity.email,
      name: identity.name,
    },
  });
}
