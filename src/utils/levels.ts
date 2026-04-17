import { User } from '../models/User';

export interface LevelDefinition {
  minDays: number;
  maxDays: number | null;
  icon: string;
  title: string;
}

export interface LevelProgressResult {
  previousDays: number;
  currentDays: number;
  previousLevel: LevelDefinition;
  currentLevel: LevelDefinition;
  leveledUp: boolean;
}

const LEVELS: LevelDefinition[] = [
  { minDays: 0, maxDays: 2, icon: '🧟', title: 'Спящий' },
  { minDays: 3, maxDays: 5, icon: '🐢', title: 'Просыпающийся' },
  { minDays: 6, maxDays: 10, icon: '🌱', title: 'Формирующий привычку' },
  { minDays: 11, maxDays: 20, icon: '🔥', title: 'Ранний энтузиаст' },
  { minDays: 21, maxDays: 35, icon: '⚡', title: 'Утренний человек' },
  { minDays: 36, maxDays: 60, icon: '🧠', title: 'Хозяин утра' },
  { minDays: 61, maxDays: 99, icon: '🦾', title: 'Непоколебимый' },
  { minDays: 100, maxDays: null, icon: '👑', title: 'Мастер утра' },
];

export function getLevelForDays(days: number): LevelDefinition {
  const normalizedDays = Math.max(0, days);

  return (
    LEVELS.find((level) => {
      if (level.maxDays === null) {
        return normalizedDays >= level.minDays;
      }

      return normalizedDays >= level.minDays && normalizedDays <= level.maxDays;
    }) ?? LEVELS[0]
  );
}

export function getNextLevelForDays(days: number): LevelDefinition | null {
  const normalizedDays = Math.max(0, days);

  return LEVELS.find((level) => level.minDays > normalizedDays) ?? null;
}

export function formatLevelLabel(level: LevelDefinition): string {
  return `${level.icon} ${level.title}`;
}

export async function applyLevelProgressChange(
  telegramId: number,
  delta: number
): Promise<LevelProgressResult | null> {
  const user = await User.findOne({ telegramId }).select('levelDays');

  if (!user) {
    return null;
  }

  const previousDays = Math.max(0, user.levelDays ?? 0);
  const currentDays = Math.max(0, previousDays + delta);

  if (currentDays !== previousDays) {
    user.levelDays = currentDays;
    await user.save();
  }

  const previousLevel = getLevelForDays(previousDays);
  const currentLevel = getLevelForDays(currentDays);

  return {
    previousDays,
    currentDays,
    previousLevel,
    currentLevel,
    leveledUp: currentLevel.minDays > previousLevel.minDays,
  };
}