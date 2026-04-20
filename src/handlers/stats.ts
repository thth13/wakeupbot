import { Telegraf } from 'telegraf';
import { WakeUpEntry } from '../models/WakeUpEntry';
import { User } from '../models/User';
import { formatLevelLabel, getLevelForDays } from '../utils/levels';
import { MISS_SCORE_PENALTY, WAKE_SCORE_REWARD } from '../utils/score';
import { displayTime, formatHumanDate, formatHumanDateTime, resolveTimezone, todayInTimezone } from '../utils/time';
import { bold, escapeHtml, TELEGRAM_HTML } from '../utils/telegram';

export function registerStatsHandlers(bot: Telegraf) {
  // /stats — overall leaderboard
  bot.command('stats', async (ctx) => {
    // Показываем все зарегистрированные пользователи, даже если у них 0 подъёмов
    const users = await User.find()
      .select('telegramId firstName levelDays targetWakeTime timezone isActive missedChallengesCount droppedOutAt')
      .sort({ levelDays: -1, firstName: 1 })
      .lean();

    if (users.length === 0) {
      await ctx.reply('📊 Пока нет зарегистрированных пользователей. Будь первым в общем рейтинге!');
      return;
    }

    const streaks = await calculateStreaks(users.map((user) => ({
      telegramId: user.telegramId,
      timezone: user.timezone,
    })));
    const totals = await calculateVerifiedTotals(users.map((user) => user.telegramId));
    const rankedUsers = users
      .map((user) => ({
        ...user,
        streak: streaks.get(user.telegramId) ?? 0,
        total: totals.get(user.telegramId) ?? 0,
        level: getLevelForDays(user.levelDays ?? 0),
      }))
      .sort((left, right) => {
        if (left.isActive !== right.isActive) {
          return left.isActive ? -1 : 1;
        }

        if ((right.levelDays ?? 0) !== (left.levelDays ?? 0)) {
          return (right.levelDays ?? 0) - (left.levelDays ?? 0);
        }

        if (right.streak !== left.streak) {
          return right.streak - left.streak;
        }

        return left.firstName.localeCompare(right.firstName, 'ru');
      });

    const topUsers = rankedUsers.slice(0, 10);
    const currentUserId = ctx.from.id;

    const lines = topUsers.map((entry, index) => {
      const firstLine = `${index + 1}. ${entry.isActive ? entry.level.icon : '❌'} ${escapeHtml(entry.firstName)} — ${escapeHtml(entry.isActive ? entry.level.title : 'Вылетел')}`;
      const secondLine = `   ⏰ ${entry.targetWakeTime} | 🔥 ${entry.streak} дн. | 📊 всего: ${entry.total} дн.`;

      const parts: string[] = [firstLine, secondLine];

      if (entry.isActive) {
        const misses = entry.missedChallengesCount ?? 0;
        if (misses > 0) {
          parts.push(`   ❌ Пропусков: ${misses}/3`);
        }
      } else {
        parts.push(`   🚫 Статус: вылетел после ${entry.missedChallengesCount ?? 3} пропусков`);
      }

      const joined = parts.join('\n');

      if (entry.telegramId === currentUserId) {
        return `<b>${parts.map((p) => p).join('</b>\n<b>')}</b>`;
      }

      return joined;
    });

    await ctx.reply(`🏆 <b>РЕЙТИНГ РАННИХ ПОДЪЁМОВ</b>\n\n${lines.join('\n')}`, {
      parse_mode: TELEGRAM_HTML,
    });
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
    const timezone = resolveTimezone(user.timezone);

    let text = `📈 <b>Твоя статистика</b>\n\n`;
    text += `🏅 Уровень: ${bold(formatLevelLabel(level))}\n`;
    text += `🔥 Текущий стрик: ${bold(`${streak} дн.`)}\n`;
    text += `💠 Баллы: ${bold(String(user.score ?? 0))}\n`;
    text += `✅ Всего подъёмов: ${bold(String(total))}\n`;
    text += `❌ Пропусков: ${bold(`${user.missedChallengesCount ?? 0}/3`)}\n`;
    text += `📅 Стартовал: ${bold(formatHumanDateTime(user.createdAt, timezone))}\n`;
    if (user.droppedOutAt) {
      text += `🚪 Вылетел: ${bold(formatHumanDateTime(user.droppedOutAt, timezone))}\n`;
    }
    text += `🌍 Таймзона: ${bold(timezone)}\n`;
    text += `⏰ Цель: ${bold(user.targetWakeTime)}\n\n`;

    if (entries.length > 0) {
      text += `<b>Последние 7 подъёмов:</b>\n`;
      text += entries
        .map((entry) => `• ${escapeHtml(formatHumanDate(entry.date, timezone))} - ${escapeHtml(displayTime(entry.wakeUpTime, timezone))}`)
        .join('\n');
    }

    await ctx.reply(text, { parse_mode: TELEGRAM_HTML });
  });
}

async function calculateStreak(telegramId: number): Promise<number> {
  const entries = await WakeUpEntry.find({ telegramId, verified: true })
    .sort({ date: -1 })
    .select('date');

  const user = await User.findOne({ telegramId }).select('timezone').lean();
  const todayKey = todayInTimezone(new Date(), user?.timezone);

  return calculateStreakFromDates(
    entries.map((entry) => entry.date),
    todayKey
  );
}

async function calculateStreaks(
  users: Array<{ telegramId: number; timezone?: string }>
): Promise<Map<number, number>> {
  const streaks = new Map<number, number>();

  if (users.length === 0) {
    return streaks;
  }

  const telegramIds = users.map((user) => user.telegramId);
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

  for (const user of users) {
    const todayKey = todayInTimezone(new Date(), user.timezone);
    streaks.set(user.telegramId, calculateStreakFromDates(datesByUser.get(user.telegramId) ?? [], todayKey));
  }

  return streaks;
}

async function calculateVerifiedTotals(telegramIds: number[]): Promise<Map<number, number>> {
  const totals = new Map<number, number>();

  if (telegramIds.length === 0) {
    return totals;
  }

  const rows = await WakeUpEntry.aggregate<{ _id: number; total: number }>([
    { $match: { telegramId: { $in: telegramIds }, verified: true } },
    { $group: { _id: '$telegramId', total: { $sum: 1 } } },
  ]);

  for (const row of rows) {
    totals.set(row._id, row.total);
  }

  return totals;
}

function calculateStreakFromDates(dates: string[], todayKey: string): number {
  if (dates.length === 0) {
    return 0;
  }

  let streak = 0;
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
