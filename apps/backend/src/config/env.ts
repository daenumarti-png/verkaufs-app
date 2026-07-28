import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL fehlt"),
  // Erst ab Phase 2 (Foto-Analyse) zwingend nötig; leerer String (z.B. frisch aus
  // .env.example kopiert) zählt bewusst als "nicht gesetzt", nicht als Validierungsfehler.
  ANTHROPIC_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  // Erst ab Phase 8 (generatives Stimmungsbild) nötig; gleiche
  // "leer = nicht gesetzt"-Behandlung wie beim Anthropic-Key.
  OPENAI_API_KEY: z
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
