import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptSecret, decryptSecret } from "./crypto.js";

const KEY = randomBytes(32).toString("hex");
const OTHER_KEY = randomBytes(32).toString("hex");

describe("encryptSecret / decryptSecret", () => {
  it("verschlüsselt und entschlüsselt einen Wert korrekt (Round-Trip)", () => {
    const plaintext = "sk-super-geheimes-refresh-token-12345";
    const encrypted = encryptSecret(plaintext, KEY);
    expect(encrypted).not.toContain(plaintext);
    expect(decryptSecret(encrypted, KEY)).toBe(plaintext);
  });

  it("liefert bei jedem Aufruf einen anderen Ciphertext (zufälliger IV)", () => {
    const plaintext = "gleicher-wert";
    const first = encryptSecret(plaintext, KEY);
    const second = encryptSecret(plaintext, KEY);
    expect(first).not.toBe(second);
    expect(decryptSecret(first, KEY)).toBe(plaintext);
    expect(decryptSecret(second, KEY)).toBe(plaintext);
  });

  it("schlägt mit dem falschen Schlüssel fehl (kein stilles Falsch-Entschlüsseln)", () => {
    const encrypted = encryptSecret("geheim", KEY);
    expect(() => decryptSecret(encrypted, OTHER_KEY)).toThrow();
  });

  it("schlägt bei manipuliertem Ciphertext fehl (Auth-Tag-Prüfung)", () => {
    const encrypted = encryptSecret("geheim", KEY);
    const [iv, authTag, ciphertext] = encrypted.split(":");
    // Letztes Byte per XOR mit 0xff kippen – garantiert IMMER einen anderen
    // Wert (im Gegensatz zu einem festen Ersatzwert wie "ff", der beim
    // seltenen Zufall eines bereits "ff"-wertigen letzten Bytes ein
    // No-op wäre und den Test dann fälschlich durchfallen liesse).
    const lastByte = parseInt(ciphertext.slice(-2), 16);
    const flippedByte = (lastByte ^ 0xff).toString(16).padStart(2, "0");
    const tampered = `${iv}:${authTag}:${ciphertext.slice(0, -2)}${flippedByte}`;
    expect(() => decryptSecret(tampered, KEY)).toThrow();
  });

  it("schlägt bei ungültigem Payload-Format fehl", () => {
    expect(() => decryptSecret("kein-gueltiges-format", KEY)).toThrow();
  });
});
