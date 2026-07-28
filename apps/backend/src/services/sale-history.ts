import type { Platform } from "@prisma/client";
import { prisma } from "../db/client.js";

// Bewusst noch kein öffentlicher HTTP-Endpunkt für recordSale() (Phase 3
// bereitet laut Anweisungen nur das Datenmodell vor, "auch wenn die UI dafür
// erst später kommt"). Ein Endpunkt bräuchte ausserdem echte Nutzer-Auth
// (Phase 10), um userId nicht vom Client vertrauen zu müssen.

export type RecordSaleInput = {
  userId: string;
  itemId?: string;
  category: string;
  itemName: string;
  conditionGuess?: string;
  finalPriceChf: number;
  daysToSell: number;
  platform?: Platform;
};

export async function recordSale(input: RecordSaleInput) {
  return prisma.$transaction(async (tx) => {
    const sale = await tx.saleHistory.create({
      data: {
        userId: input.userId,
        itemId: input.itemId,
        category: input.category,
        itemName: input.itemName,
        conditionGuess: input.conditionGuess,
        finalPriceChf: input.finalPriceChf,
        daysToSell: input.daysToSell,
        platform: input.platform,
      },
    });

    if (input.itemId) {
      await tx.item.update({
        where: { id: input.itemId },
        data: { status: "SOLD" },
      });
    }

    return sale;
  });
}

export function getUserSaleHistory(userId: string) {
  return prisma.saleHistory.findMany({
    where: { userId },
    orderBy: { soldAt: "desc" },
  });
}

export type CrowdsourcedPriceInsight = {
  category: string;
  sampleSize: number;
  avgPriceChf: number;
  minPriceChf: number;
  maxPriceChf: number;
  avgDaysToSell: number;
};

// Crowdsourcing über ALLE Nutzer hinweg (Briefing Abschnitt 4, Strategie-Stufe 3),
// nicht nach userId gefiltert. Unter minSamples liefert die Stichprobe keine
// verlässliche Aussage -> lieber null als eine irreführende Schätzung
// (gleiches konservatives Prinzip wie bei der Sammlerwert-Recherche, Abschnitt 8).
export async function getCrowdsourcedPriceInsight(
  category: string,
  minSamples = 3
): Promise<CrowdsourcedPriceInsight | null> {
  const stats = await prisma.saleHistory.aggregate({
    where: { category },
    _avg: { finalPriceChf: true, daysToSell: true },
    _min: { finalPriceChf: true },
    _max: { finalPriceChf: true },
    _count: { _all: true },
  });

  if (stats._count._all < minSamples) {
    return null;
  }

  return {
    category,
    sampleSize: stats._count._all,
    avgPriceChf: Math.round(stats._avg.finalPriceChf ?? 0),
    minPriceChf: stats._min.finalPriceChf ?? 0,
    maxPriceChf: stats._max.finalPriceChf ?? 0,
    avgDaysToSell: Math.round(stats._avg.daysToSell ?? 0),
  };
}
