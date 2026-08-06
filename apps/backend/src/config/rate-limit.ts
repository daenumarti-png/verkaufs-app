// Rate-Limiting (Phase 13, Sicherheits-Checkliste Briefing Abschnitt 8:
// "Rate-Limiting auf API-Ebene gegen Missbrauch und Kostenexplosion").
// Werte sind bewusste Startwerte, keine endgültige Festlegung – bei echtem
// Nutzungsverhalten anpassen. Zählung ist aktuell in-memory (pro
// Server-Prozess) und damit ausreichend für einen einzelnen Dev-/MVP-Prozess;
// bei mehreren Instanzen in Produktion bräuchte es einen gemeinsamen Store
// (z.B. Redis, von @fastify/rate-limit unterstützt).

// Globaler Default für alle Routen – grosszügig, nur ein Grundschutz gegen
// simplen Spam.
export const GLOBAL_RATE_LIMIT = { max: 100, timeWindow: "1 minute" };

// Deutlich strenger für Endpunkte, die einen kostenpflichtigen externen Call
// auslösen (Anthropic/OpenAI/eBay) – hier drohen bei Missbrauch echte Kosten,
// nicht nur Serverlast.
export const EXPENSIVE_ENDPOINT_RATE_LIMIT = { max: 10, timeWindow: "1 minute" };

// Deutlich strenger für Passwort-Login/-Registrierung: anders als bei
// Google/Apple gibt es hier keinen vorgelagerten Provider, der wiederholte
// Rateversuche abfängt – Brute-Force auf Passwörter muss direkt hier
// gebremst werden.
export const AUTH_RATE_LIMIT = { max: 8, timeWindow: "1 minute" };
