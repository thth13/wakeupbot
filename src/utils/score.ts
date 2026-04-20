import { User } from '../models/User';

export const WAKE_SCORE_REWARD = 10;
export const MISS_SCORE_PENALTY = 5;

export interface ScoreChangeResult {
  previousScore: number;
  currentScore: number;
  appliedDelta: number;
}

export async function applyScoreChange(
  telegramId: number,
  delta: number
): Promise<ScoreChangeResult | null> {
  const user = await User.findOne({ telegramId }).select('score');

  if (!user) {
    return null;
  }

  const previousScore = Math.max(0, user.score ?? 0);
  const currentScore = Math.max(0, previousScore + delta);

  if (currentScore !== previousScore) {
    user.score = currentScore;
    await user.save();
  }

  return {
    previousScore,
    currentScore,
    appliedDelta: currentScore - previousScore,
  };
}