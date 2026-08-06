import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "../db/client.js";
import { registerWithEmail, loginWithEmail } from "./auth-email.js";

// Echte Integrationstests gegen die konfigurierte Postgres-DB (kein Mock) –
// konsistent mit der Testphilosophie in diesem Projekt. Räumt seine eigenen
// Testdaten danach wieder auf.
const testEmails: string[] = [];

function newTestEmail(): string {
  const email = `vitest-${crypto.randomUUID()}@example.com`;
  testEmails.push(email);
  return email;
}

afterEach(async () => {
  if (testEmails.length > 0) {
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
    testEmails.length = 0;
  }
});

describe("E-Mail/Passwort-Registrierung", () => {
  it("registriert einen neuen Nutzer mit gehashtem Passwort", async () => {
    const email = newTestEmail();
    const result = await registerWithEmail(email, "sicheres-passwort-123");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.user.authProvider).toBe("EMAIL");
    expect(result.user.email).toBe(email);
    expect(result.user.passwordHash).not.toBeNull();
    expect(result.user.passwordHash).not.toBe("sicheres-passwort-123");
  });

  it("lehnt eine doppelte Registrierung derselben E-Mail ab", async () => {
    const email = newTestEmail();
    await registerWithEmail(email, "erstes-passwort-123");
    const second = await registerWithEmail(email, "zweites-passwort-456");

    expect(second.status).toBe("email_taken");
  });

  it("lehnt Registrierung ab, wenn die E-Mail bereits über Google verknüpft ist", async () => {
    const email = newTestEmail();
    await prisma.user.create({
      data: { email, authProvider: "GOOGLE", authProviderId: `google-${crypto.randomUUID()}` },
    });

    const result = await registerWithEmail(email, "irgendein-passwort-123");
    expect(result.status).toBe("email_taken");
  });
});

describe("E-Mail/Passwort-Login", () => {
  it("meldet mit korrekten Zugangsdaten an", async () => {
    const email = newTestEmail();
    await registerWithEmail(email, "korrektes-passwort-123");

    const result = await loginWithEmail(email, "korrektes-passwort-123");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.user.email).toBe(email);
  });

  it("lehnt ein falsches Passwort generisch ab", async () => {
    const email = newTestEmail();
    await registerWithEmail(email, "korrektes-passwort-123");

    const result = await loginWithEmail(email, "falsches-passwort-999");
    expect(result.status).toBe("invalid_credentials");
  });

  it("lehnt eine unbekannte E-Mail mit derselben generischen Meldung ab", async () => {
    const result = await loginWithEmail("nie-registriert@example.com", "irgendein-passwort");
    expect(result.status).toBe("invalid_credentials");
  });

  it("weist bei einem Google-Konto auf den richtigen Provider hin", async () => {
    const email = newTestEmail();
    await prisma.user.create({
      data: { email, authProvider: "GOOGLE", authProviderId: `google-${crypto.randomUUID()}` },
    });

    const result = await loginWithEmail(email, "irgendein-passwort");
    expect(result.status).toBe("wrong_provider");
    if (result.status !== "wrong_provider") return;
    expect(result.provider).toBe("GOOGLE");
  });
});
