import { onRequest } from "firebase-functions/v2/https";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";

// WICHTIG: "./app.js" bewusst NICHT statisch importiert. Firebases lokale
// "Cannot determine backend specification"-Erkennungsphase beim Deploy hat
// ein hartes ~10s-Zeitlimit fürs Laden dieser Datei - unser Import-Baum
// (Sharp, ONNX-Runtime für den Freisteller, Prisma-Client, Anthropic-SDK,
// Stripe etc., alles über app.ts/die Routen eingebunden) überschreitet das
// beim kalten Laden. Firebases eigene Doku empfiehlt genau deshalb, schwere
// Initialisierung erst beim ersten echten Request per dynamischem import()
// zu laden statt statisch auf Modulebene - das hält diese Datei selbst
// minimal, die eigentliche App wird erst bei getApp() geladen.
let appPromise: Promise<FastifyInstance> | undefined;

async function getApp(): Promise<FastifyInstance> {
  appPromise ??= import("./app.js").then(async ({ buildApp }) => {
    const app = await buildApp();
    await app.ready();
    return app;
  });
  return appPromise;
}

// Firebase Functions v2 puffert den kompletten Roh-Body JEDES Requests
// vorab in "rawBody" (dokumentiertes Verhalten, u.a. für Webhook-
// Signaturprüfungen) – der ursprüngliche Node-Stream ist danach bereits
// verbraucht. Fastifys eigener Multipart-Parser (req.parts(), für
// Foto-Uploads) und der Stripe-Webhook-Handler brauchen aber Zugriff auf
// den Roh-Body. Statt den (verbrauchten) Stream nachzubauen, wird Fastifys
// eigene inject()-API genutzt: sie simuliert einen kompletten HTTP-Request
// direkt aus einem Buffer, komplett ohne echten Socket/Stream – das
// funktioniert identisch für normale JSON-Routen, Multipart-Uploads und
// den Roh-Body-Webhook, da alle drei denselben Fastify-internen
// Body-Parsing-Pfad durchlaufen wie bei einem echten Request.

// Secrets müssen hier explizit gelistet werden, damit Firebase sie zur
// Laufzeit als process.env-Variablen in die Funktion einspeist – sonst
// bleiben sie trotz "firebase functions:secrets:set" unsichtbar für den Code.
const SECRETS = [
  "DATABASE_URL",
  "ANTHROPIC_API_KEY",
  "GOOGLE_CLIENT_ID",
  "JWT_SECRET",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "EBAY_TOKEN_ENCRYPTION_KEY",
  "CORS_ORIGIN",
];

export const api = onRequest(
  {
    region: "europe-west6",
    timeoutSeconds: 300,
    memory: "1GiB",
    cors: true,
    secrets: SECRETS,
    // Cloud Functions v2 ist standardmässig privat (nur authentifizierte
    // Google-Cloud-Principals dürfen aufrufen) - die App braucht öffentlichen
    // Zugriff, da die Mobile-App sich selbst über unsere eigene Session-JWT-
    // Logik authentifiziert, nicht über Google Cloud IAM.
    invoker: "public",
  },
  async (req, res) => {
    const app = await getApp();

    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;

    // "as any" fürs method-Feld: Express liefert alle real vorkommenden
    // HTTP-Methoden als String, aber light-my-requests eigener
    // HTTPMethods-Typ ist ein enger Subset von Fastifys eigenem Typ (z.B.
    // fehlt "search") - zur Laufzeit ist jede hier ankommende Methode
    // ohnehin gültig.
    const result: LightMyRequestResponse = await app.inject({
      method: req.method as any,
      url: req.originalUrl ?? req.url,
      headers: req.headers as Record<string, string>,
      payload: rawBody,
    });

    res.status(result.statusCode);
    for (const [key, value] of Object.entries(result.headers)) {
      if (value !== undefined) res.setHeader(key, value as string | string[]);
    }
    res.end(result.rawPayload);
  }
);
