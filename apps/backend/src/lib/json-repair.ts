/**
 * Schliesst offene Strings/Klammern in abgeschnittenem JSON-Text, damit
 * JSON.parse eine sonst valide, aber vorzeitig abgebrochene Modellantwort
 * noch verarbeiten kann. Reines Robustheits-Netz (Prototyp-Erkenntnis #3) –
 * mit dem grosszügigeren Token-Budget in Phase 2 sollte dies selten greifen.
 * Portiert aus verkaufs-app-prototyp.jsx.
 */
export function repairTruncatedJson(text: string): string {
  let inString = false;
  let escape = false;
  const stack: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
  }

  let repaired = text;
  if (inString) repaired += '"';
  for (let i = stack.length - 1; i >= 0; i--) {
    repaired += stack[i] === "{" ? "}" : "]";
  }
  return repaired;
}
