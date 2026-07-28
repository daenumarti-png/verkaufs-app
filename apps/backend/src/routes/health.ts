import type { FastifyInstance } from "fastify";
import { prisma } from "../db/client.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    return { status: "ok" };
  });

  app.get("/health/db", async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: "ok" };
    } catch (err) {
      app.log.error(err, "DB health check fehlgeschlagen");
      return reply.status(503).send({ status: "error", message: "Datenbank nicht erreichbar" });
    }
  });
}
