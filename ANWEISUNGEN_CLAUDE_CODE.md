# Anweisungen für Claude Code: Start der Entwicklung

Lies zuerst `PROJEKT_BRIEFING_CLAUDE_CODE.md` (vollständiges Konzept, Architektur, rechtliche Punkte) und `verkaufs-app-prototyp.jsx` (funktionierender UI-Flow als Referenz). Diese Datei hier definiert das konkrete Vorgehen.

---

## Nicht verhandelbare Rahmenbedingungen

- **Mobile-first**, durchgehend bedienerfreundlich.
- **Kein automatisiertes Scraping** von Tutti/Ricardo – Preisdaten kommen aus KI-Schätzwissen, eigener Verkaufshistorie und Crowdsourcing (siehe Briefing Abschnitt 4).
- **Tutti/Ricardo:** nur "vorbereiten + kopierfertig anzeigen", kein automatisches Veröffentlichen ohne Bestätigung. eBay kann über die offizielle API weitergehen.
- **Content-Moderation ist Pflicht**, nicht optional – verbotene/anstössige Artikel dürfen nie bewertet oder inseriert werden (Prüfschritt läuft vor der eigentlichen Analyse).
- **Jeder Schritt dreifach prüfen:** Funktioniert es (Qualität)? Hält es Fehlern/Edge-Cases stand (Robustheit)? Ist es sicher (keine Secrets im Client, Input-Validierung, Rate-Limits)?
- Reale, unbearbeitete Artikelfotos bleiben immer zusätzlich zum generierten Titelfoto sichtbar.

---

## Vorgehen: MVP zuerst, dann erweitern

Bitte in dieser Reihenfolge vorgehen, nach jeder Phase kurz Rückmeldung geben, bevor die nächste beginnt:

**Phase 1 – Setup**
Tech-Stack-Entscheidung treffen (siehe offene Frage 1 im Briefing – falls unklar, mit mir kurz abstimmen statt anzunehmen). Grundgerüst: Repo-Struktur, Backend-Grundgerüst, Datenbank-Schema-Entwurf für Nutzer/Artikel/Verkaufshistorie.

**Phase 2 – Foto-Analyse-Backend**
Foto-Upload + KI-Analyse serverseitig nachbauen (nicht wie im Prototyp direkt im Client). Dabei die bekannten Prototyp-Probleme von Anfang an lösen: HEIC-Konvertierung, ausreichendes Token-Budget, robuste Fehlerbehandlung pro Foto, korrekte Zusammenführung bei mehreren Fotos desselben Artikelsets.

**Phase 3 – Preislogik-Grundgerüst**
KI-Schätzung als Startpunkt, Datenmodell für eigene Verkaufshistorie und Crowdsourcing-Beiträge vorbereiten (auch wenn die UI dafür erst später kommt).

**Phase 4 – Multi-Item & Bundle-Score**
Erkennung mehrerer Artikel pro Foto, Score pro Artikel, Bundle- vs. Einzelverkauf-Empfehlung.

**Phase 5 – Rückfragen-Flow**
`clarifying_questions` als antippbare Auswahl-Chips, nur wenn nötig.

**Phase 6 – Idealer Verkaufszeitpunkt**
Saisonales Feld in der Analyse-Antwort ergänzen.

**Phase 7 – Sammlerwert-Recherche**
Live-Websuche als separater Analyseschritt, Sammlerwert-Score, Einfluss auf Preisspanne, Verkaufsorts-Empfehlung.

**Phase 8 – Titelfoto-Generierung**
Erst Composing-Ansatz (Freisteller + Hintergrund) umsetzen, generativen Ansatz nur als spätere Ergänzung.

**Phase 9 – Kopierfertige, plattformspezifische Ausgabe**
Plattform-Auswahl (Tutti/Ricardo/eBay), passende Felder pro Plattform, Ein-Tap-Kopieren.

**Phase 10 – Auth**
Google-/Apple-Login, Gastmodus mit 5-Artikel-Limit.

**Phase 11 – Content-Moderation**
Eigener Prüfschritt vor der Analyse, konservative Grenzfall-Regeln (siehe Briefing Abschnitt 8, offene Frage 6).

**Phase 12 – Marktplatz-Integration**
eBay-API-Anbindung; Tutti/Ricardo bleiben beim "vorbereiten + bestätigen"-Flow, ausser eine spätere rechtliche Prüfung erlaubt mehr.

**Phase 13 – Hardening**
Sicherheits-/Robustheits-Checkliste aus dem Briefing (Abschnitt 8) systematisch durchgehen, Tests ergänzen.

---

## Erste konkrete Aufgabe

Bitte mit **Phase 1** beginnen: Tech-Stack-Vorschlag machen (mit Begründung), Projektstruktur aufsetzen, und die offenen Fragen aus dem Briefing (Abschnitt 9) dort auflisten, wo im Code eine Entscheidung notwendig wird – nicht stillschweigend annehmen.
