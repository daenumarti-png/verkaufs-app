import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "../db/client.js";
import { getRemainingGuestQuota, recordGuestItemsAnalyzed } from "./guest-usage.js";
import { MAX_GUEST_ITEMS } from "../config/guest.js";

// Echte Integrationstests gegen die konfigurierte Postgres-DB (kein Mock) –
// konsistent mit der Testphilosophie in diesem Projekt. Räumt seine eigenen
// Testdaten danach wieder auf.
const testDeviceIds: string[] = [];

function newDeviceId(): string {
  const id = `vitest-${crypto.randomUUID()}`;
  testDeviceIds.push(id);
  return id;
}

afterEach(async () => {
  if (testDeviceIds.length > 0) {
    await prisma.guestUsage.deleteMany({ where: { deviceId: { in: testDeviceIds } } });
    testDeviceIds.length = 0;
  }
});

describe("Guest-Usage-Quota", () => {
  it("startet für eine neue Geräte-ID mit vollem Kontingent", async () => {
    const deviceId = newDeviceId();
    expect(await getRemainingGuestQuota(deviceId)).toBe(MAX_GUEST_ITEMS);
  });

  it("reduziert das Kontingent nach erfassten Artikeln", async () => {
    const deviceId = newDeviceId();
    await recordGuestItemsAnalyzed(deviceId, 2);
    expect(await getRemainingGuestQuota(deviceId)).toBe(MAX_GUEST_ITEMS - 2);
  });

  it("klemmt das Kontingent bei Überschreiten auf 0 statt negativ zu werden", async () => {
    const deviceId = newDeviceId();
    await recordGuestItemsAnalyzed(deviceId, MAX_GUEST_ITEMS + 3);
    expect(await getRemainingGuestQuota(deviceId)).toBe(0);
  });

  it("akkumuliert über mehrere Aufrufe hinweg", async () => {
    const deviceId = newDeviceId();
    await recordGuestItemsAnalyzed(deviceId, 1);
    await recordGuestItemsAnalyzed(deviceId, 1);
    await recordGuestItemsAnalyzed(deviceId, 1);
    expect(await getRemainingGuestQuota(deviceId)).toBe(MAX_GUEST_ITEMS - 3);
  });
});
