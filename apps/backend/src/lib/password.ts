import bcrypt from "bcryptjs";

// Cost-Faktor 12: gute Balance für eine Low-Traffic-App auf persönlicher
// Skala – deutlich über dem oft empfohlenen Minimum von 10 (mehr Schutz
// gegen Offline-Brute-Force bei einem DB-Leak), aber nicht so hoch, dass
// Login-Latenz spürbar leidet (kein High-Traffic-Auth-Server).
const SALT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
