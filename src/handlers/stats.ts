import { Telegraf } from 'telegraf';
import { WakeUpEntry } from '../models/WakeUpEntry';
import { User } from '../models/User';
import { formatLevelLabel, getLevelForDays, getNextLevelForDays } from '../utils/levels';
import { displayTime, formatHumanDate, todayInAppTimezone } from '../utils/time';

export function registerStatsHandlers(bot: Telegraf) {
  // /stats — overall leaderboard
  bot.command('stats', async (ctx) => {
    const users = await User.find({ levelDays: { $gt: 0 } })
      .select('telegramId firstName levelDays')
      .sort({ levelDays: -1, firstName: 1 })
      .lean();

    if (users.length === 0) {
      await ctx.reply('📊 Пока нет подтверждённых подъёмов. Будь первым в общем рейтинге!');
      return;
    }

    const streaks = await calculateStreaks(users.map((user) => user.telegramId));
    const rankedUsers = users
      .map((user) => ({
        ...user,
        streak: streaks.get(user.telegramId) ?? 0,
        level: getLevelForDays(user.levelDays ?? 0),
      }))
      .sort((left, right) => {
        if ((right.levelDays ?? 0) !== (left.levelDays ?? 0)) {
          return (right.levelDays ?? 0) - (left.levelDays ?? 0);
        }

        if (right.streak !== left.streak) {
          return right.streak - left.streak;
        }

        return left.firstName.localeCompare(right.firstName, 'ru');
      });

    const topUsers = rankedUsers.slice(0, 10);

    const lines = topUsers.map((entry, index) => {
      const levelTitle = entry.level.title;
      return `${index + 1}. ${entry.level.icon} ${entry.firstName} — ${levelTitle} | ${entry.levelDays} дн. | стрик ${entry.streak} дн.`;
    });

    const currentUserIndex = rankedUsers.findIndex((entry) => entry.telegramId === ctx.from.id);
    const currentUser = currentUserIndex >= 0 ? rankedUsers[currentUserIndex] : null;
    const userAhead = currentUserIndex > 0 ? rankedUsers[currentUserIndex - 1] : null;

    let footer = '';

    if (currentUser) {
      footer += `\n\n📈 *ТЫ НА ${currentUserIndex + 1} МЕСТЕ*`;

      if (userAhead) {
        footer += `\n\nТебя обгоняет:\n${userAhead.level.icon} ${userAhead.firstName} — ${userAhead.levelDays} дн.`;
      }

      const nextLevel = getNextLevelForDays(currentUser.levelDays ?? 0);

      if (nextLevel) {
        const daysLeft = nextLevel.minDays - (currentUser.levelDays ?? 0);
        footer += `\n\nДо следующего уровня:\n+${daysLeft} ${formatDayWord(daysLeft)} → ${formatLevelLabel(nextLevel)}`;
      } else {
        footer += `\n\nДо следующего уровня:\nМаксимальный уровень достигнут`;
      }
    }

    await ctx.reply(
      `🏆 *РЕЙТИНГ РАННИХ ПОДЪЁМОВ*\n\n${lines.join('\n')}${footer}`,
      {
        parse_mode: 'Markdown',
      }
    );
  });

  // /mystats — personal streak & history
  bot.command('mystats', async (ctx) => {
    const id = ctx.from.id;
    const user = await User.findOne({ telegramId: id });

    if (!user) {
      await ctx.reply('Сначала зарегистрируйся через /start');
      return;
    }

    const entries = await WakeUpEntry.find({ telegramId: id, verified: true })
      .sort({ date: -1 })
      .limit(7);

    const streak = await calculateStreak(id);
    const total = await WakeUpEntry.countDocuments({ telegramId: id, verified: true });
    const level = getLevelForDays(user.levelDays ?? 0);

    let text = `📈 *Твоя статистика*\n\n`;
    text += `🏅 Уровень: *${formatLevelLabel(level)}*\n`;
    text += `🔥 Текущий стрик: *${streak} дн.*\n`;
    text += `✅ Всего подъёмов: *${total}*\n`;
    text += `⏰ Цель: *${user.targetWakeTime}*\n\n`;

    if (entries.length > 0) {
      text += `*Последние 7 подъёмов:*\n`;
      text += entries.map((e) => `• ${formatHumanDate(e.date)} - ${displayTime(e.wakeUpTime)}`).join('\n');
    }

    await ctx.reply(text, { parse_mode: 'Markdown' });
  });
}

async function calculateStreak(telegramId: number): Promise<number> {
  const entries = await WakeUpEntry.find({ telegramId, verified: true })
    .sort({ date: -1 })
    .select('date');

  if (entries.length === 0) return 0;

  let streak = 0;
  const today = new Date();
  const todayKey = todayInAppTimezone(today);
  const todayStart = new Date(`${todayKey}T00:00:00Z`);

  for (let i = 0; i < entries.length; i++) {
    const entryDate = new Date(entries[i].date + 'T00:00:00Z');
    const diffDays = Math.round((todayStart.getTime() - entryDate.getTime()) / 86400000);

    if (diffDays === i || diffDays === i + 1) {
      // allow yesterday to still count
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

async function calculateStreaks(telegramIds: number[]): Promise<Map<number, number>> {
  const streaks = new Map<number, number>();

  if (telegramIds.length === 0) {
    return streaks;
  }

  const entries = await WakeUpEntry.find({ telegramId: { $in: telegramIds }, verified: true })
    .sort({ telegramId: 1, date: -1 })
    .select('telegramId date')
    .lean();

  const datesByUser = new Map<number, string[]>();

  for (const entry of entries) {
    const current = datesByUser.get(entry.telegramId) ?? [];
    current.push(entry.date);
    datesByUser.set(entry.telegramId, current);
  }

  for (const telegramId of telegramIds) {
    streaks.set(telegramId, calculateStreakFromDates(datesByUser.get(telegramId) ?? []));
  }

  return streaks;
}

function calculateStreakFromDates(dates: string[]): number {
  if (dates.length === 0) {
    return 0;
  }

  let streak = 0;
  const today = new Date();
  const todayKey = todayInAppTimezone(today);
  const todayStart = new Date(`${todayKey}T00:00:00Z`);

  for (let index = 0; index < dates.length; index++) {
    const entryDate = new Date(dates[index] + 'T00:00:00Z');
    const diffDays = Math.round((todayStart.getTime() - entryDate.getTime()) / 86400000);

    if (diffDays === index || diffDays === index + 1) {
      streak++;
      continue;
    }

    break;
  }

  return streak;
}

function formatDayWord(days: number): string {
  const absDays = Math.abs(days) % 100;
  const lastDigit = absDays % 10;

  if (absDays >= 11 && absDays <= 14) {
    return 'дней';
  }

  if (lastDigit === 1) {
    return 'день';
  }

  if (lastDigit >= 2 && lastDigit <= 4) {
    return 'дня';
  }

  return 'дней';
}
