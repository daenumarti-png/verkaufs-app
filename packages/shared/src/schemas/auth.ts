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
export type AuthUser = z.infer<typeof authUserSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
