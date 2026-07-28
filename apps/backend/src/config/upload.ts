// Input-Validierungs-Grenzwerte für Foto-Uploads (Sicherheits-Checkliste,
// Briefing Abschnitt 8: "Input-Validierung für alle Uploads – Dateityp,
// Grösse, Anzahl").

// Mehr als der Prototyp (4), um Gruppenfoto + mehrere Nahaufnahmen zu erlauben,
// aber weiterhin fest begrenzt. Grössere Sammlungen (5+ Artikel) bekommen in
// Phase 4 einen eigenen gestuften Flow (erst Übersicht, dann Detailfotos je Artikel).
export const MAX_PHOTOS = 6;

// iPhone-HEIC-Originalfotos können 5-15 MB gross sein, daher grosszügiger als
// ein reines JPEG-Limit.
export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

// Claude-Vision-Empfehlung: längste Kante ~1568px ist für die Bilderkennung
// ausreichend und hält Request-Grösse/Kosten im Rahmen.
export const MAX_IMAGE_DIMENSION = 1568;
export const JPEG_QUALITY = 85;
