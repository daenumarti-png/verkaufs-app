export const AuthProvider = {
  GOOGLE: "GOOGLE",
  APPLE: "APPLE",
} as const;
export type AuthProvider = (typeof AuthProvider)[keyof typeof AuthProvider];

export const ItemStatus = {
  DRAFT: "DRAFT",
  LISTED: "LISTED",
  SOLD: "SOLD",
  ARCHIVED: "ARCHIVED",
} as const;
export type ItemStatus = (typeof ItemStatus)[keyof typeof ItemStatus];

export const Platform = {
  TUTTI: "TUTTI",
  RICARDO: "RICARDO",
  EBAY: "EBAY",
  OTHER: "OTHER",
} as const;
export type Platform = (typeof Platform)[keyof typeof Platform];
