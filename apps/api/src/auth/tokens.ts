import jwt from 'jsonwebtoken';

export interface TokenClaims {
  sub: string;
}

const USER_TTL = '7d';
const GUEST_TTL = '24h';

export function signToken(secret: string, userId: string, isGuest: boolean): string {
  return jwt.sign({}, secret, {
    subject: userId,
    expiresIn: isGuest ? GUEST_TTL : USER_TTL,
    algorithm: 'HS256',
  });
}

/** Returns the user id, or null for a missing, malformed, tampered or expired token. */
export function verifyToken(secret: string, token: string | undefined): string | null {
  if (!token) return null;
  try {
    const claims = jwt.verify(token, secret, { algorithms: ['HS256'] });
    return typeof claims === 'object' && typeof claims.sub === 'string' ? claims.sub : null;
  } catch {
    return null;
  }
}

export function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}
