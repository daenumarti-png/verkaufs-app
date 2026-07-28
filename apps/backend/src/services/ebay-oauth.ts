import { SignJWT, jwtVerify } from "jose";
import { env } from "../config/env.js";
import { prisma } from "../db/client.js";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";

// Der eBay-Callback ist ein reiner Browser-Redirect ohne Authorization-Header
// – der "state"-Parameter trägt die Nutzer-Zuordnung stattdessen als kurz
// lebendes, signiertes JWT (10 Min., eigener "purpose"-Claim, damit ein
// normales Session-Token nicht als OAuth-State wiederverwendet werden kann).
const stateSecretKey = new TextEncoder().encode(env.JWT_SECRET);

export async function signOAuthState(userId: string): Promise<string> {
  return new SignJWT({ purpose: "ebay_oauth_state" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(stateSecretKey);
}

export async function verifyOAuthState(state: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(state, stateSecretKey);
    if (payload.purpose !== "ebay_oauth_state" || typeof payload.sub !== "string") return null;
    return payload.sub;
  } catch {
    return null;
  }
}

// sell.inventory: Inventory-Items/Offers anlegen; sell.account: Business
// Policies + Merchant Location abfragen (Phase 12). Scope-Strings sind laut
// eBay-Doku umgebungsunabhängig identisch (auch im Sandbox-Betrieb).
const SCOPES = [
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
].join(" ");

function getAuthBaseUrl(): string {
  return env.EBAY_ENVIRONMENT === "PRODUCTION" ? "https://auth.ebay.com" : "https://auth.sandbox.ebay.com";
}

export function getEbayApiBaseUrl(): string {
  return env.EBAY_ENVIRONMENT === "PRODUCTION" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
}

export function isEbayConfigured(): boolean {
  return Boolean(env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET && env.EBAY_RU_NAME && env.EBAY_TOKEN_ENCRYPTION_KEY);
}

export function buildConsentUrl(state: string): string {
  if (!env.EBAY_CLIENT_ID || !env.EBAY_RU_NAME) {
    throw new Error("eBay ist nicht konfiguriert (EBAY_CLIENT_ID/EBAY_RU_NAME fehlen).");
  }
  const params = new URLSearchParams({
    client_id: env.EBAY_CLIENT_ID,
    redirect_uri: env.EBAY_RU_NAME,
    response_type: "code",
    scope: SCOPES,
    state,
  });
  return `${getAuthBaseUrl()}/oauth2/authorize?${params.toString()}`;
}

function basicAuthHeader(): string {
  return `Basic ${Buffer.from(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`).toString("base64")}`;
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_token_expires_in: number;
  token_type: string;
};

async function requestToken(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(`${getEbayApiBaseUrl()}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: basicAuthHeader(), "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`eBay-Token-Endpunkt antwortete mit ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  if (!env.EBAY_RU_NAME) throw new Error("eBay ist nicht konfiguriert (EBAY_RU_NAME fehlt).");
  return requestToken(
    new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: env.EBAY_RU_NAME })
  );
}

/**
 * Verknüpft ein eBay-Konto mit einem Nutzer: verschlüsselt den Refresh-Token
 * (nie im Klartext in der DB, siehe lib/crypto.ts) und legt/aktualisiert die
 * EbayConnection-Zeile an.
 */
export async function saveEbayConnection(userId: string, tokens: TokenResponse): Promise<void> {
  if (!env.EBAY_TOKEN_ENCRYPTION_KEY) {
    throw new Error("eBay ist nicht konfiguriert (EBAY_TOKEN_ENCRYPTION_KEY fehlt).");
  }
  const encryptedRefreshToken = encryptSecret(tokens.refresh_token, env.EBAY_TOKEN_ENCRYPTION_KEY);
  const refreshTokenExpiresAt = new Date(Date.now() + tokens.refresh_token_expires_in * 1000);

  await prisma.ebayConnection.upsert({
    where: { userId },
    create: { userId, encryptedRefreshToken, refreshTokenExpiresAt, scopes: SCOPES.split(" ") },
    update: { encryptedRefreshToken, refreshTokenExpiresAt, scopes: SCOPES.split(" ") },
  });
}

export type AccessTokenResult =
  | { status: "ok"; accessToken: string }
  | { status: "not_connected" }
  | { status: "refresh_token_expired" };

/**
 * Access-Tokens sind nur ~2h gültig – statt eines Caches wird bei jedem
 * Bedarf einfach neu aus dem gespeicherten Refresh-Token angefragt (einfach,
 * korrekt, für die erwartete Nutzungsfrequenz beim Entwurf-Erstellen
 * ausreichend performant).
 */
export async function getValidAccessTokenForUser(userId: string): Promise<AccessTokenResult> {
  if (!env.EBAY_TOKEN_ENCRYPTION_KEY) {
    throw new Error("eBay ist nicht konfiguriert (EBAY_TOKEN_ENCRYPTION_KEY fehlt).");
  }
  const connection = await prisma.ebayConnection.findUnique({ where: { userId } });
  if (!connection) return { status: "not_connected" };
  if (connection.refreshTokenExpiresAt < new Date()) return { status: "refresh_token_expired" };

  const refreshToken = decryptSecret(connection.encryptedRefreshToken, env.EBAY_TOKEN_ENCRYPTION_KEY);
  const tokens = await requestToken(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, scope: SCOPES })
  );
  return { status: "ok", accessToken: tokens.access_token };
}
