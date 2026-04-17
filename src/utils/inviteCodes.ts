import { randomInt } from 'crypto';
import { IUser, User } from '../models/User';

const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_CODE_SEGMENT_LENGTH = 4;
const INVITE_CODE_SEGMENT_COUNT = 2;

export const BOOTSTRAP_INVITE_CODE = 'DAWN-FOUNDER-2026';

export function normalizeInviteCode(value: string): string {
  return value.trim().toUpperCase();
}

function generateInviteCodeCandidate(): string {
  const segments: string[] = [];

  for (let segmentIndex = 0; segmentIndex < INVITE_CODE_SEGMENT_COUNT; segmentIndex++) {
    let segment = '';

    for (let charIndex = 0; charIndex < INVITE_CODE_SEGMENT_LENGTH; charIndex++) {
      segment += INVITE_CODE_ALPHABET[randomInt(0, INVITE_CODE_ALPHABET.length)];
    }

    segments.push(segment);
  }

  return segments.join('-');
}

export async function createUniqueInviteCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = generateInviteCodeCandidate();
    const existingUser = await User.exists({ inviteCode: candidate });

    if (!existingUser) {
      return candidate;
    }
  }

  throw new Error('Failed to generate a unique invite code');
}

export async function ensureUserInviteCode(user: IUser): Promise<string> {
  if (user.inviteCode) {
    return user.inviteCode;
  }

  const inviteCode = await createUniqueInviteCode();
  user.inviteCode = inviteCode;
  await user.save();

  return inviteCode;
}