import { describe, it, expect } from "vitest";
import { signSessionToken, verifySessionToken } from "./session.js";

describe("Session-JWT", () => {
  it("signiert und verifiziert ein Token für dieselbe userId (Round-Trip)", async () => {
    const token = await signSessionToken("user-123");
    const result = await verifySessionToken(token);
    expect(result).toEqual({ userId: "user-123" });
  });

  it("lehnt ein syntaktisch ungültiges Token ab (null statt Fehler)", async () => {
    const result = await verifySessionToken("kompletter-unsinn");
    expect(result).toBeNull();
  });

  it("lehnt ein leeres Token ab", async () => {
    const result = await verifySessionToken("");
    expect(result).toBeNull();
  });
});
