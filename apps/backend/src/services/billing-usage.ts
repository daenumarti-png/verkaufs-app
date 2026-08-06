import { prisma } from "../db/client.js";
import { SUBSCRIPTION_TIERS, type SubscriptionTierKey } from "../config/subscription.js";

export type QuotaResult =
  | { hasSubscription: false }
  | { hasSubscription: true; tier: SubscriptionTierKey; remaining: number };

/**
 * Kontingent pro Nutzer und laufender Abrechnungsperiode (identifiziert
 * über die von Stripe synchronisierte currentPeriodStart der Subscription-
 * Zeile). Ohne aktives Abo (kein Abo oder Status != ACTIVE) gibt es kein
 * Kontingent – das entsprechende Verhalten (blockieren statt Overage
 * erlauben) setzt routes/items.ts um, da ohne Stripe-Abo keine Rechnung
 * für zusätzlichen Verbrauch gestellt werden könnte.
 */
export async function getRemainingQuota(userId: string): Promise<QuotaResult> {
  const subscription = await prisma.subscription.findUnique({ where: { userId } });
  if (!subscription || subscription.status !== "ACTIVE") {
    return { hasSubscription: false };
  }

  const usage = await prisma.usageRecord.findUnique({
    where: { userId_periodStart: { userId, periodStart: subscription.currentPeriodStart } },
  });
  const used = usage?.analysesUsed ?? 0;
  const included = SUBSCRIPTION_TIERS[subscription.tier].includedAnalyses;
  return { hasSubscription: true, tier: subscription.tier, remaining: Math.max(0, included - used) };
}

/**
 * Erhöht den Verbrauchszähler NACH einem erfolgreichen /items/analyze-Aufruf
 * um genau 1 (Abrechnungseinheit ist "pro Analyse-Vorgang", nicht pro
 * erkanntem Artikel). Ohne bestehendes Abo ein No-op – es gäbe nichts,
 * dem der Verbrauch zugeordnet werden könnte (dieser Fall wird von
 * routes/items.ts ohnehin schon vorher blockiert, siehe getRemainingQuota).
 */
export async function recordAnalysisUsage(userId: string): Promise<void> {
  const subscription = await prisma.subscription.findUnique({ where: { userId } });
  if (!subscription) return;

  await prisma.usageRecord.upsert({
    where: { userId_periodStart: { userId, periodStart: subscription.currentPeriodStart } },
    create: { userId, periodStart: subscription.currentPeriodStart, analysesUsed: 1 },
    update: { analysesUsed: { increment: 1 } },
  });
}
