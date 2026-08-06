import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "../db/client.js";
import { getRemainingQuota, recordAnalysisUsage } from "./billing-usage.js";
import { SUBSCRIPTION_TIERS } from "../config/subscription.js";

// Echte Integrationstests gegen die konfigurierte Postgres-DB (kein Mock) –
// konsistent mit der Testphilosophie in diesem Projekt. Räumt seine eigenen
// Testdaten danach wieder auf.
const testUserIds: string[] = [];

async function newTestUser(): Promise<string> {
  const email = `vitest-${crypto.randomUUID()}@example.com`;
  const user = await prisma.user.create({
    data: { email, authProvider: "EMAIL", authProviderId: email, passwordHash: "irrelevant-for-this-test" },
  });
  testUserIds.push(user.id);
  return user.id;
}

async function newActiveSubscription(
  userId: string,
  tier: "BASIC" | "PRO",
  periodStart: Date = new Date("2026-01-01T00:00:00Z"),
  periodEnd: Date = new Date("2026-02-01T00:00:00Z")
) {
  await prisma.subscription.create({
    data: {
      userId,
      stripeCustomerId: `cus_vitest_${crypto.randomUUID()}`,
      stripeSubscriptionId: `sub_vitest_${crypto.randomUUID()}`,
      tier,
      status: "ACTIVE",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    },
  });
}

afterEach(async () => {
  if (testUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
    testUserIds.length = 0;
  }
});

describe("Abo-Kontingent", () => {
  it("startet mit dem vollen Tier-Kontingent ohne bisherigen Verbrauch", async () => {
    const userId = await newTestUser();
    await newActiveSubscription(userId, "BASIC");

    const quota = await getRemainingQuota(userId);
    expect(quota.hasSubscription).toBe(true);
    if (!quota.hasSubscription) return;
    expect(quota.remaining).toBe(SUBSCRIPTION_TIERS.BASIC.includedAnalyses);
  });

  it("reduziert das Kontingent nach recordAnalysisUsage um 1 pro Aufruf, nicht pro Artikel", async () => {
    const userId = await newTestUser();
    await newActiveSubscription(userId, "BASIC");

    await recordAnalysisUsage(userId);
    await recordAnalysisUsage(userId);
    await recordAnalysisUsage(userId);

    const quota = await getRemainingQuota(userId);
    expect(quota.hasSubscription).toBe(true);
    if (!quota.hasSubscription) return;
    expect(quota.remaining).toBe(SUBSCRIPTION_TIERS.BASIC.includedAnalyses - 3);
  });

  it("vermischt den Verbrauch nicht über unterschiedliche Abrechnungsperioden hinweg", async () => {
    const userId = await newTestUser();
    await newActiveSubscription(userId, "BASIC", new Date("2026-01-01T00:00:00Z"), new Date("2026-02-01T00:00:00Z"));
    await recordAnalysisUsage(userId);
    await recordAnalysisUsage(userId);

    // Neue Periode beginnt (z.B. nach Verlängerung) – Verbrauch der alten
    // Periode darf die neue nicht beeinflussen.
    await prisma.subscription.update({
      where: { userId },
      data: { currentPeriodStart: new Date("2026-02-01T00:00:00Z"), currentPeriodEnd: new Date("2026-03-01T00:00:00Z") },
    });

    const quota = await getRemainingQuota(userId);
    expect(quota.hasSubscription).toBe(true);
    if (!quota.hasSubscription) return;
    expect(quota.remaining).toBe(SUBSCRIPTION_TIERS.BASIC.includedAnalyses);
  });

  it("hat kein Kontingent ohne bestehendes Abo", async () => {
    const userId = await newTestUser();
    const quota = await getRemainingQuota(userId);
    expect(quota.hasSubscription).toBe(false);
  });

  it("recordAnalysisUsage ist ein No-op ohne bestehendes Abo", async () => {
    const userId = await newTestUser();
    await expect(recordAnalysisUsage(userId)).resolves.toBeUndefined();
  });
});
