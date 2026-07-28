# Projekt-Briefing: KI-Verkaufsassistent für Occasion-Artikel

Dieses Dokument fasst den gesamten Wissensstand aus der Konzeptphase (Claude.ai Chat) zusammen und dient als Startpunkt für die technische Umsetzung in Claude Code.

---

## 1. Projektziel

Eine mobile App, die aus Fotos gebrauchter Gegenstände automatisch:
- Titel, Verkaufstext und Preis generiert
- einen **Verkaufs-Score** (verkäuflich ja/nein/wie leicht) und eine **geschätzte Verkaufsdauer** berechnet
- benötigte zusätzliche Fotos vorschlägt und ein anpreisendes Titelbild erzeugt
- **mehrere unterschiedliche Artikel auf einem Foto erkennt** (z.B. mehrere Videospiele) und pro Artikel einen eigenen Score liefert, inkl. Empfehlung "Bundle vs. Einzelverkauf"
- **Raritäten-/Sammlerwert erkennt** (z.B. Lego-Sets, Briefmarken, Münzen) über gezielte Web-Recherche, gibt dafür einen eigenen **Sammlerwert-Score** aus und bezieht diesen in die Preisfindung mit ein
- schlägt vor, **wo** ein Artikel am besten verkauft wird (z.B. Nischenplattform für Sammlerstücke statt Tutti/Ricardo, falls das den Wert besser trifft)
- Inserate für **Tutti.ch, Ricardo.ch, eBay** vorbereitet und veröffentlicht bzw. vorschlägt
- stellt alle generierten Angaben so bereit, dass sie **einfach kopiert** werden können; bei Auswahl einer oder mehrerer Zielplattformen werden die jeweils passenden, plattformspezifischen Eingabefelder angezeigt (z.B. unterschiedliche Feldstruktur/-länge bei Tutti vs. Ricardo vs. eBay)
- **ohne Account** nutzbar, dabei aber auf **maximal 5 erkannte Artikel** limitiert (Anreiz für Account-Erstellung)
- schlägt den **idealen Verkaufszeitpunkt** vor (saisonal/kategoriebedingt, z.B. Sonnenschirm vor/während dem Sommer verkaufen statt im Winter)
- stellt bei Bedarf **gezielte Rückfragen**, wenn Fotos allein für eine genaue Preisschätzung nicht ausreichen (z.B. bei Möbeln: welche Ausstattungsoptionen/Masse; sonstige preisrelevante Merkmale wie Marke, Zustand von Funktionsteilen, Vollständigkeit)

Zielgruppe: Privatverkäufer in der Schweiz. Zentrale Anforderung: durchgehend **mobile-first** und bedienerfreundlich. Qualität, Robustheit und Sicherheit sollen durchgängig ("dreifach") geprüft werden.

---

## 2. Marktumfeld – was es schon gibt

Es existieren etablierte "Cross-Listing"-Tools, aber **keines mit Fokus auf Tutti/Ricardo oder mit Bundle-Score-Logik**:

| Tool | Kernfunktion | Lücke ggü. diesem Projekt |
|---|---|---|
| Vendoo | Foto → Titel/Beschreibung per KI, Cross-Posting auf viele US-Marktplätze | Kein CH-Fokus, keine Verkaufsdauer-Prognose, keine Bundle-Logik |
| Nifty | Cloud-basiert, generiert komplette Listings inkl. SEO-Hashtags aus Foto | Gleiche Lücke, US/international |
| Crosslist | KI-generierte, "publish-ready" Listings aus Fotos | Gleiche Lücke |
| Flyp | Chrome-Extension-basiertes Cross-Listing | Weniger KI-Funktionen, kein Mobile-Fokus |
| List Perfectly | Cross-Listing, KI/Background-Removal nur in teuren Plänen | Browserlastig, kein nativer Mobile-Fokus |
| Listed AI (Google Play) | Reine Foto→Listing-App für Vinted/eBay/Depop | Am nächsten am Grundkonzept, aber ohne Score/Dauer-Prognose, ohne CH-Marktplätze, ohne Multi-Item/Bundle-Logik |

**Fazit:** Die Kombination aus (a) Schweizer Marktplätze, (b) Verkaufs-Score + Dauer-Prognose, (c) Multi-Item-Erkennung mit Bundle-Empfehlung ist die Marktlücke und das USP dieses Projekts.

---

## 3. Kritischer Punkt: Marktplatz-Integration

- **eBay**: hat eine offizielle Public API → automatisches Erstellen/Veröffentlichen von Inseraten ist technisch und rechtlich sauber möglich.
- **Tutti.ch und Ricardo.ch**: haben **keine öffentliche Publish-API** für Privatverkäufer. Automatisiertes Erstellen von Inseraten würde eine Automatisierung der Web-Oberfläche erfordern, was in der Regel gegen die Nutzungsbedingungen dieser Plattformen verstösst und zu Account-/IP-Sperren führen kann.
- **Empfehlung für den MVP:** Für Tutti/Ricardo zunächst **"vorschlagen statt automatisch veröffentlichen"** – die App bereitet Titel, Text, Preis und Fotos vollständig vor, der Nutzer bestätigt mit einem Tap und kopiert/postet final selbst (oder ein Browser-Assistent übernimmt den letzten Schritt lokal auf dem Gerät des Nutzers, nicht als Server-Dauerbetrieb).
- Bevor irgendeine Automatisierung Richtung Tutti/Ricardo gebaut wird: **AGB beider Plattformen aktuell prüfen** (können sich ändern), im Zweifel juristisch abklären lassen.
- **UI-Anforderung "kopierfreundlich":** Nutzer wählt eine oder mehrere Zielplattformen (Tutti/Ricardo/eBay) per Toggle/Checkbox an. Pro gewählter Plattform wird ein eigener, klar abgegrenzter Block mit den passenden Feldern angezeigt (Titel, Beschreibung, Preis, Kategorie etc. – Feldstruktur/-limits je nach Plattform unterschiedlich), jeweils mit Ein-Tap-"Kopieren"-Button pro Feld oder Block. So kann der Nutzer die Angaben direkt in die jeweilige Plattform-App/-Website einfügen, auch bevor/falls eine echte API-Anbindung existiert.

---

## 4. Preislogik / Marktdaten-Strategie

**Entscheid (Stand jetzt):** Fokus liegt klar auf einer **eigenen Datenbank**, nicht auf Scraping fremder Plattformen. Start erfolgt mit reiner KI-Schätzung (allgemeines Modellwissen), wie im Prototyp umgesetzt.

Ursprüngliche Idee war, eine fortlaufende Preisdatenbank aus bestehenden Tutti-/Ricardo-Inseraten aufzubauen (Ricardo zeigt sichtbar, wenn ein Artikel verkauft wurde; Inserate sind ohne Login einsehbar). Diese Option wurde geprüft und bewusst **nicht** als Bauplan übernommen:

- Kontinuierliches automatisiertes Scraping ist ein rechtliches Graufeld (AGB verbieten i.d.R. automatisiertes Auslesen für kommerzielle Zwecke).
- Ricardo hat beim Öffnen von Inseraten eine **aktive Bot-/Zugriffsprüfung** – ein klares Signal, dass automatisiertes Auslesen dort technisch unterbunden werden soll. Das gezielt zu umgehen ist weder Teil dieses Plans noch etwas, das hier ausgearbeitet wird.
- Selbst wenn technisch machbar: Risiko von IP-/Account-Sperren und rechtlichen Konsequenzen bleibt bestehen.

**Priorisierte Strategie für den Aufbau der eigenen Datenbank:**
1. **Start:** reine KI-Schätzung auf Basis von Modellwissen (kein Scraping, sofort einsatzbereit, transparent als Schätzung gekennzeichnet)
2. **Aufbau:** eigene Verkaufshistorie der Nutzer – jeder bestätigte Verkauf (Preis, Dauer bis Verkauf) fliesst in die eigene Datenbank ein
3. **Skalierung:** Crowdsourcing über alle Nutzer hinweg – je mehr Nutzer bestätigte Verkäufe eintragen, desto genauer wird die eigene, sauber lizenzierte Preisdatenbank – ganz ohne Abhängigkeit von fremden Plattform-Daten

**Empfehlung:** Mit Ansatz 1 starten (KI-Schätzung), dann kontinuierlich auf Ansatz 2/3 (eigene Verkäufe + Crowdsourcing) umstellen. Scraping-Automatisierung ist kein Bestandteil der Roadmap, ausser eine spätere juristische Prüfung kommt zu einem anderen Schluss.

**Zusatzfunktion: idealer Verkaufszeitpunkt.** Neben Preis/Score/Dauer soll die App auch eine Empfehlung geben, *wann* der Verkauf gestartet werden sollte – saisonale/kategoriebedingte Nachfrageschwankungen (z.B. Sonnenschirm, Grill, Wintersportartikel, Gartenmöbel). Umsetzung: eigenes Feld in der Analyse-Antwort, z.B. `best_selling_period` (z.B. "März–August") plus kurze Begründung. Kann anfangs aus reinem KI-Wissen kommen (saisonale Muster sind stabil, brauchen keine Live-Recherche wie der Sammlerwert), später ggf. mit eigenen Verkaufsdaten verfeinert werden. Bei Artikeln ohne saisonalen Bezug (z.B. Elektronik) entsprechend "ganzjährig" ausgeben.

**Zusatzfunktion: gezielte Rückfragen bei Preisunsicherheit.** Wenn Fotos allein nicht für eine belastbare Preisschätzung reichen (z.B. bei Möbeln: Ausstattungsvariante, Masse; oder bei Elektronik: Speichergrösse, Zubehör vollständig), soll die Analyse-Antwort ein optionales Feld `clarifying_questions` liefern (Frage + 2-4 kurze Antwortoptionen, ähnlich wie ein Multiple-Choice). Die App zeigt diese als antippbare Auswahl-Chips an (kein Freitext nötig – mobile-first, schnell beantwortbar), sendet die Antworten zurück und aktualisiert Preis/Score entsprechend. Nur auslösen, wenn wirklich nötig – nicht bei jedem Artikel pauschal nachfragen, um den Flow nicht unnötig zu verlangsamen.

---

## 5. Sammlerwert-/Raritäten-Erkennung (neu)

Viele Artikel haben einen Wert, der über den üblichen Occasion-Preis hinausgeht (limitierte Lego-Sets, seltene Briefmarken/Münzen, Vintage-Spielzeug, bestimmte Sammelkarten). Das reine Modellwissen der KI reicht dafür oft nicht aus oder ist veraltet – hier braucht es eine **gezielte Live-Web-Recherche** pro erkanntem Artikel.

**Funktionsweise (Vorschlag):**
1. KI identifiziert zuerst Artikel-Typ/Kategorie und ggf. eine Kennung (Lego-Set-Nummer, Briefmarken-Motiv/Jahr, Münz-Prägejahr/-Land)
2. Gezielte Web-Suche nach aktuellem Sammlerwert/Referenzpreisen für genau diesen Artikel (z.B. auf spezialisierten Referenzseiten/-datenbanken für die jeweilige Sammelkategorie)
3. Daraus wird ein **Sammlerwert-Score** berechnet (z.B. 1–10, wie stark der Sammlerwert den normalen Gebrauchtwert übersteigt)
4. Der Sammlerwert-Score fliesst in die finale Preisspanne mit ein (z.B. deutliche Preisanhebung bei hohem Score, klare Kennzeichnung im UI, warum)
5. Basierend auf Kategorie und Score: **Verkaufsorts-Empfehlung** – z.B. "eher auf spezialisierter Sammler-Plattform/Auktion anbieten als auf Tutti", inkl. kurzer Begründung

**Technische Implikation:** Diese Funktion braucht Zugriff auf Live-Websuche (z.B. Web-Search-Tool der Anthropic API), nicht nur das statische Modellwissen wie im aktuellen Klick-Prototyp. Das ist ein Unterschied zur bisherigen Preislogik in Abschnitt 4 und sollte als eigener Analyseschritt eingeplant werden (ggf. nur bei Verdacht auf Sammlerwert ausgelöst, um Kosten/Latenz zu sparen – nicht bei jedem Alltagsartikel).

**Offen:** Welche Referenzquellen/-plattformen pro Sammelkategorie (Lego, Numismatik, Philatelie, etc.) als vertrauenswürdig gelten sollen, ist noch zu klären – idealerweise mit dir zusammen vor der Umsetzung.

---

## 6. Vorgeschlagene technische Architektur

- **Frontend:** Mobile-first – React Native oder Flutter für native Apps, alternativ PWA für schnelleren Start
- **Backend:** Node.js oder Python (FastAPI), REST-API
- **KI-Schicht:** Anthropic API (Claude, Vision + Text) für Bilderkennung, Titel-/Textgenerierung, Scoring
- **Datenbank:** PostgreSQL für Nutzer, Inserate, Verkaufshistorie/Preisdatenbank
- **Bildverarbeitung:** serverseitige Konvertierung/Kompression (siehe Prototyp-Erkenntnisse unten), Freisteller/Titelbild-Generierung
  - **Titelfoto-Generierung (Detail):** aus den Nutzerfotos automatisch ein anpreisendes "Hero"-Bild erzeugen. Zwei gangbare Ansätze, ggf. kombinierbar:
    1. **Composing-Ansatz** (robuster, günstiger): Artikel per Freisteller (Background Removal) aus dem besten Foto isolieren, vor einen neutralen/ansprechenden Hintergrund setzen, ggf. mit dezenter Lichtwirkung/Schatten – kein generatives Halluzinationsrisiko am Artikel selbst
    2. **Generativer Ansatz:** Bildgenerierungsmodell erstellt eine stimmungsvolle Szene um den Artikel herum (z.B. Sonnenschirm vor Sommer-Kulisse); Risiko: Modell könnte Artikel-Details verfälschen, daher wenn genutzt nur als zusätzliches Stimmungsbild, nicht als einziges Verkaufsfoto
  - **Wichtig:** Das reale, unbearbeitete Foto muss immer zusätzlich vorhanden/einsehbar bleiben – Käufer müssen den Artikel unverfälscht sehen können (Vertrauen, ggf. auch Plattform-Vorgaben)
- **Auth:** Login via Google-Account, Apple-Account, und Nutzung auch **ohne Account** möglich (dort limitiert auf max. 5 erkannte Artikel); verschlüsselte Speicherung von API-Keys serverseitig (nie im Client)
- **Marktplatz-Anbindung:** eBay über offizielle API; Tutti/Ricardo zunächst als "Vorbereiten + manuell bestätigen"-Flow
- **Sammlerwert-Recherche:** Web-Search-Tool (z.B. Anthropic Web-Search-API) als separater, gezielter Analyseschritt für Sammlerwert-Score und Verkaufsorts-Empfehlung (siehe Abschnitt 5)
- **Hinweis Gastnutzung:** Ohne Account (Google/Apple/Gast) können Entwürfe evtl. nur lokal auf dem Gerät gespeichert werden; für den Beitrag zur Crowdsourcing-Preisdatenbank (Abschnitt 4) braucht es einen Account, um Verkäufe einer Nutzerhistorie zuzuordnen – im UI klar kommunizieren, was mit/ohne Account möglich ist

---

## 7. Erkenntnisse aus dem Klick-Prototyp (wichtig, spart Debugging-Zeit!)

Der Prototyp (`verkaufs-app-prototyp.jsx`, liegt bei) hat folgende reale Probleme aufgedeckt:

1. **HEIC-Fotos (iPhone-Standard):** Die Anthropic-API akzeptiert nur JPEG/PNG/GIF/WebP. Jedes Foto muss vor dem Senden serverseitig oder clientseitig zu JPEG konvertiert werden (Canvas-Rendering + Grössenreduktion, z.B. max. 1568px Kantenlänge).
2. **`blob:`-URLs waren in der Sandbox-Testumgebung unzuverlässig** – `data:`-URLs (FileReader.readAsDataURL) funktionierten stabil. Für die echte App ist das evtl. keine Einschränkung mehr, aber auf Konsistenz zwischen iOS/Android testen.
3. **Antwortlänge/Token-Limit:** Im Prototyp künstlich auf 1000 Tokens begrenzt, was bei mehreren Artikeln zu abgeschnittenem JSON führte. Im echten Backend: grosszügigeres Token-Budget einplanen und/oder Streaming nutzen. Trotzdem empfiehlt sich ein **JSON-Reparatur-Fallback** für abgeschnittene/fehlerhafte Modellantworten als Robustheits-Netz.
4. **Mehrere Fotos desselben Artikelsets:** Wenn ein Nutzer ein Gruppenfoto UND Einzel-Nahaufnahmen derselben Artikel hochlädt, muss dem Modell explizit gesagt werden, dass es dieselben Objekte über mehrere Fotos hinweg zusammenführen soll, statt sie zu duplizieren. Ohne diese Anweisung: Gefahr der doppelten Zählung.
5. **Upload-UX:** Getrennte Buttons für "Kamera aufnehmen" vs. "aus Galerie hochladen" nötig – ein einzelner `<input capture="environment">` erzwingt auf manchen Geräten nur die Kamera.
6. **Skalierung bei vielen Artikeln:** Ein einzelner Analyse-Call mit 4 Fotos/3 Artikeln ist nur für Demozwecke ausreichend. Für reale Fälle (z.B. 5+ Spiele in einer Sammlung) braucht es einen getrennten Flow: erst Gruppenübersicht, dann pro erkanntem Artikel gezielt Detailfotos nachfordern – nicht alles in einem Rutsch analysieren.
7. Jeder Analyseschritt braucht robuste Fehlerbehandlung pro Einzelfoto (ein fehlerhaftes Foto darf nicht den ganzen Batch blockieren).
8. **Noch nicht im Prototyp umgesetzt:** Titelfoto-Generierung, Sammlerwert-Recherche und der ideale Verkaufszeitpunkt sind bisher nur konzeptionell beschrieben (siehe Abschnitte 4–6) – der Prototyp deckt nur Text-/Preis-/Score-Analyse ab, keine Bildgenerierung und keine Live-Websuche.

---

## 8. Sicherheits-/Robustheits-Checkliste für den Aufbau

- Input-Validierung für alle Uploads (Dateityp, Grösse, Anzahl)
- Rate-Limiting auf API-Ebene (gegen Missbrauch und Kostenexplosion)
- Sichere serverseitige Verwahrung von API-Keys, keine Secrets im Client-Code
- Datenschutz: Fotos/Inserate-Daten nach Schweizer DSG behandeln, klare Löschfristen
- Keine automatisierte Umgehung von Marktplatz-Schutzmechanismen (Rate-Limits, Captchas) – das wäre sowohl rechtlich als auch reputationstechnisch riskant
- Jede KI-generierte Preis-/Score-Aussage im UI klar als Schätzung kennzeichnen, nie als Garantie
- Sammlerwert-Ergebnisse aus der Web-Recherche mit Quellenangabe anzeigen und bei widersprüchlichen/unsicheren Treffern lieber konservativ schätzen als einen überzogenen Wert suggerieren
- **Content-Moderation:** anstössige oder verbotene Artikel dürfen nicht bewertet/inseriert werden – z.B. Waffen/Munition, Drogen/Betäubungsmittel, gefälschte Markenware, geschützte Tier-/Pflanzenprodukte (z.B. Elfenbein), extremistische Symbole/Material, pornografische Inhalte. Erkennung sollte als eigener Prüfschritt vor der eigentlichen Analyse laufen; bei Treffer: Analyse abbrechen, dem Nutzer transparent mitteilen warum, kein stilles Ignorieren. Grenzfälle (z.B. Antiquitäten mit Elfenbein-Anteil, Deko-Waffen) benötigen klare, konservative Regeln – im Zweifel ablehnen statt bewerten.

---

## 9. Offene Fragen, die vor dem Start geklärt werden sollten

1. Zielplattform: native App (iOS/Android) oder Web/PWA zuerst?
2. Welche Marktplätze im MVP zuerst – nur Tutti/Ricardo, oder auch eBay von Anfang an?
3. Soll die Preisdatenbank zunächst rein aus eigener Verkaufshistorie/Crowdsourcing gespeist werden, oder ist eine rechtliche Prüfung für automatisiertes Auslesen gewünscht?
4. Wer übernimmt Hosting/Backend-Betrieb (eigener Server, Cloud-Anbieter)?
5. Welche Referenzquellen/Plattformen sollen für die Sammlerwert-Recherche pro Kategorie (Lego, Münzen, Briefmarken, ...) herangezogen werden?
6. Wie genau soll mit Grenzfällen bei der Content-Moderation umgegangen werden (z.B. Deko-Waffen, Antiquitäten mit unklarem Material)? Wer definiert/pflegt die Liste verbotener Kategorien?

---

## 10. Vorschlag für den Einstiegs-Prompt in Claude Code

```
Ich baue eine mobile App für den Verkauf gebrauchter Artikel in der Schweiz
(Tutti/Ricardo/eBay). Lies bitte PROJEKT_BRIEFING_CLAUDE_CODE.md und
verkaufs-app-prototyp.jsx im Anhang als Kontext. Lass uns mit [Frontend-Setup /
Backend-API für die Foto-Analyse / Datenmodell] beginnen.
```

Die beiliegende Datei `verkaufs-app-prototyp.jsx` zeigt den funktionierenden UI-Flow (Foto-Upload, KI-Analyse-Aufruf, Ergebnisdarstellung) und kann als Referenz für UI-Logik und Prompt-Struktur dienen, sollte aber für Produktion refactored werden (u.a. serverseitige API-Calls statt Client-seitig, richtiges Token-Budget, echtes State-Management).
