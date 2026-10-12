import {
  AVATAR_COLORS,
  type AuthResponse,
  type LoginInput,
  type SignupInput,
} from '@flowsync/shared';
import { Prisma, type User } from '@prisma/client';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signToken } from '../auth/tokens.js';
import type { Db } from '../db.js';
import { conflict, unauthorized } from '../errors.js';
import { toUserDTO } from './mappers.js';

export function randomAvatarColor(): string {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)] as string;
}

export function authResponse(secret: string, user: User): AuthResponse {
  return { token: signToken(secret, user.id, user.isGuest), user: toUserDTO(user) };
}

export async function signup(db: Db, secret: string, input: SignupInput): Promise<AuthResponse> {
  const passwordHash = await hashPassword(input.password);
  try {
    const user = await db.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
        avatarColor: randomAvatarColor(),
      },
    });
    return authResponse(secret, user);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw conflict('An account with that email already exists');
    }
    throw error;
  }
}

export async function login(db: Db, secret: string, input: LoginInput): Promise<AuthResponse> {
  const user = await db.user.findUnique({ where: { email: input.email } });
  const ok = await verifyPassword(input.password, user?.passwordHash ?? null);
  if (!user || !ok) throw unauthorized('Invalid email or password');
  return authResponse(secret, user);
}
