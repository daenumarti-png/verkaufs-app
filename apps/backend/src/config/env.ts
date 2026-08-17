import dotenv from "dotenv";
import { z } from "zod";

// .env.local statt .env: Firebase Functions lädt beim Deploy automatisch
// jede ".env"/".env.<project-id>"-Datei aus dem Funktions-Quellordner und
// versucht deren Werte als normale (nicht-geheime) Umgebungsvariablen zu
// setzen - das kollidiert mit den echten Secrets, die für dieselben Namen
// bereits über den Secret Manager gesetzt sind ("overlaps non secret
// environment variable"). ".env.local" wird von Firebase laut eigener
// Doku bewusst NIE deployt/gelesen, ist aber für die lokale Entwicklung
// (dieser Import hier) weiterhin die einzige benötigte Quelle.
dotenv.config({ path: ".env.local" });

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL fehlt"),
  // Erst ab Phase 2 (Foto-Analyse) zwingend nötig; leerer String (z.B. frisch aus
  // .env.example kopiert) zählt bewusst als "nicht gesetzt", nicht als Validierungsfehler.
  ANTHROPIC_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  // Phase 10 – Auth. GOOGLE_CLIENT_ID/APPLE_CLIENT_ID sind die erwarteten
  // "aud"-Werte in den jeweiligen Provider-Tokens; ohne gesetzten Wert lehnt
  // die jeweilige Verifikation ALLE Tokens ab (fail-closed, nicht offen).
  GOOGLE_CLIENT_ID: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  // Zweite gültige Audience für Google-ID-Tokens, die über Firebase
  // Authentication (Web-Login, siehe login.tsx) statt über den
  // ursprünglichen, manuell konfigurierten OAuth-Client (native/Expo Go)
  // ausgestellt wurden – Firebase provisioniert dafür einen eigenen
  // OAuth-Client mit eigener Client-ID. Optional, damit der native Flow
  // auch ohne diesen Wert unverändert funktioniert.
  GOOGLE_CLIENT_ID_WEB: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  APPLE_CLIENT_ID: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  // Eigenes, intern generiertes Secret (kein externer API-Key) zum Signieren
  // der Session-JWTs. Bewusst PFLICHT (kein stiller Default) – ein fehlendes
  // Secret soll den Start blockieren, nicht Auth unbemerkt deaktivieren.
  JWT_SECRET: z.string().min(32, "JWT_SECRET fehlt oder ist zu kurz (mind. 32 Zeichen)"),

  // Phase 12 – Supabase Storage (Bild-Hosting). SUPABASE_URL ist aus der
  // bestehenden DATABASE_URL ableitbar, hier aber explizit gesetzt, da die
  // Storage-REST-API eine eigene Basis-URL braucht (nicht die Postgres-URL).
  SUPABASE_URL: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  // service_role-Key – wie ein API-Key ein Geheimnis, umgeht Row Level
  // Security, daher NUR serverseitig verwenden, nie im Client.
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  SUPABASE_STORAGE_BUCKET: z.string().default("item-photos"),

  // Phase 12 – eBay Sell API. EBAY_ENVIRONMENT steuert Sandbox- vs.
  // Production-Endpunkte; Sandbox ist der sichere Default für Tests.
  EBAY_CLIENT_ID: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  EBAY_CLIENT_SECRET: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  EBAY_RU_NAME: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  EBAY_ENVIRONMENT: z.enum(["SANDBOX", "PRODUCTION"]).default("SANDBOX"),
  // Eigenes, intern generiertes Secret (kein externer API-Key) zur
  // AES-256-GCM-Verschlüsselung des eBay-Refresh-Tokens vor Ablage in der DB.
  EBAY_TOKEN_ENCRYPTION_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  // eBay verlangt für Produktivzugang einen Endpunkt für "Marketplace
  // Account Deletion"-Benachrichtigungen (siehe routes/ebay.ts) - dieses
  // Token wird beim Einrichten des Endpunkts im eBay-Entwicklerportal
  // hinterlegt und dient dort wie hier zur Challenge-Response-Verifikation
  // (32-80 Zeichen, nur alphanumerisch/_/-, siehe eBay-Doku).
  EBAY_DELETION_VERIFICATION_TOKEN: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),

  // Phase-Abrechnung – Stripe. Alle optional, da der Server auch ohne
  // konfiguriertes Billing starten soll (Endpunkte antworten dann mit
  // 503, siehe services/stripe.ts isStripeConfigured()).
  STRIPE_SECRET_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  // Signatur-Secret des Stripe-Webhook-Endpoints (aus dem Stripe-Dashboard
  // bzw. `stripe listen` bei lokalem Testen) – zur Verifikation eingehender
  // Webhook-Events, damit niemand ungeprüft Abo-Status vortäuschen kann.
  STRIPE_WEBHOOK_SECRET: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  STRIPE_PRICE_ID_BASIC: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  STRIPE_PRICE_ID_PRO: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),

  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CORS_ORIGIN: z.string().default("*"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Ungültige Umgebungsvariablen:", parsed.error.flatten().fieldErrors);
  throw new Error("Server-Start abgebrochen: Umgebungsvariablen prüfen (siehe .env.example)");
}

export const env = parsed.data;
