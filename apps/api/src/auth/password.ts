import bcrypt from 'bcryptjs';

const COST = 10;
// Compared against when the email is unknown, so a miss costs as much as a hit
// and response timing does not reveal which emails have accounts.
const DUMMY_HASH = bcrypt.hashSync('flowsync-timing-equaliser', COST);

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  const ok = await bcrypt.compare(password, hash ?? DUMMY_HASH);
  return ok && hash !== null;
}
