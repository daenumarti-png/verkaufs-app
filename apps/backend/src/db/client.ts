import { PrismaClient } from "@prisma/client";

// Ein einzelner PrismaClient pro Prozess (empfohlenes Pattern bei tsx watch /
// Serverless-Reloads, verhindert zu viele offene DB-Verbindungen).
declare global {
  var __prisma: PrismaClient | undefined;
}

export const prisma = global.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}
