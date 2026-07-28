import { prisma } from "../db/client.js";
import { MAX_GUEST_ITEMS } from "../config/guest.js";

export async function getRemainingGuestQuota(deviceId: string): Promise<number> {
  const usage = await prisma.guestUsage.findUnique({ where: { deviceId } });
  const used = usage?.itemsAnalyzed ?? 0;
  return Math.max(0, MAX_GUEST_ITEMS - used);
}

/**
 * Erhöht den Zähler NACH einer erfolgreichen Analyse um die Anzahl der
 * tatsächlich erkannten Artikel. Ein einzelner Analyse-Call kann das Limit
 * knapp überschreiten (z.B. 4 verbleibend, 5 Artikel im letzten Call
 * erkannt) – bewusst in Kauf genommen statt Ergebnisse nachträglich
 * abzuschneiden (siehe Phase-10-Abstimmung); weitere Calls werden danach blockiert.
 */
export async function recordGuestItemsAnalyzed(deviceId: string, count: number): Promise<void> {
  await prisma.guestUsage.upsert({
    where: { deviceId },
    create: { deviceId, itemsAnalyzed: count },
    update: { itemsAnalyzed: { increment: count } },
  });
}
