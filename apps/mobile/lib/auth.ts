import type { AuthResponse, AuthUser } from "@verkaufs-app/shared";
import { getItem, setItem, deleteItem } from "./storage";
import { ApiRequestError } from "./api";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
const AUTH_TOKEN_KEY = "auth_token";
const AUTH_USER_KEY = "auth_user";

async function postAuth(path: string, body: unknown): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const responseBody = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiRequestError(res.status, responseBody);
  }
  return responseBody as AuthResponse;
}

async function persistSession(auth: AuthResponse): Promise<void> {
  await setItem(AUTH_TOKEN_KEY, auth.token);
  await setItem(AUTH_USER_KEY, JSON.stringify(auth.user));
}

export async function completeGoogleSignIn(idToken: string): Promise<AuthUser> {
  const auth = await postAuth("/auth/google", { id_token: idToken });
  await persistSession(auth);
  return auth.user;
}

export async function completeAppleSignIn(identityToken: string, name?: string): Promise<AuthUser> {
  const auth = await postAuth("/auth/apple", { identity_token: identityToken, name });
  await persistSession(auth);
  return auth.user;
}

export async function signOut(): Promise<void> {
  await deleteItem(AUTH_TOKEN_KEY);
  await deleteItem(AUTH_USER_KEY);
}

export async function getStoredUser(): Promise<AuthUser | null> {
  const raw = await getItem(AUTH_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export async function isSignedIn(): Promise<boolean> {
  return (await getItem(AUTH_TOKEN_KEY)) !== null;
}
