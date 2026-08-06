import { z } from "zod";

export const googleAuthRequestSchema = z.object({
  id_token: z.string().min(1),
});

export const appleAuthRequestSchema = z.object({
  identity_token: z.string().min(1),
  // Apple liefert den Namen NICHT im Token, sondern nur einmalig beim
  // allerersten nativen Sign-in als separates Feld – der Client muss ihn
  // dann hier mitschicken, danach ist er bereits in unserer DB gespeichert.
  name: z.string().max(120).optional(),
});

// E-Mail/Passwort-Registrierung. Passwort-Mindestlänge 8 Zeichen, Obergrenze
// 128 (bcrypt kappt ohnehin bei 72 Bytes, aber eine saubere Validierungs-
// Fehlermeldung ist besser als sich stillschweigend darauf zu verlassen).
export const emailRegisterRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
  name: z.string().max(120).optional(),
});

// Beim Login bewusst NUR min(1) statt min(8): ein zu kurzes Passwort soll
// über die generische "ungültige Anmeldedaten"-Antwort abgelehnt werden,
// nicht über einen 400er, der die Passwort-Richtlinie verraten würde.
export const emailLoginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});

export const authUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
});

export const authResponseSchema = z.object({
  token: z.string(),
  user: authUserSchema,
});

export type GoogleAuthRequest = z.infer<typeof googleAuthRequestSchema>;
export type AppleAuthRequest = z.infer<typeof appleAuthRequestSchema>;
export type EmailRegisterRequest = z.infer<typeof emailRegisterRequestSchema>;
export type EmailLoginRequest = z.infer<typeof emailLoginRequestSchema>;
export type AuthUser = z.infer<typeof authUserSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
