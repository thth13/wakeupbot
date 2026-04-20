import { Markup, Telegraf } from 'telegraf';
import { WakeUpEntry } from '../models/WakeUpEntry';
import { User } from '../models/User';
import { formatLevelLabel, getLevelForDays } from '../utils/levels';
import { MISS_REMOVAL_COST } from '../utils/score';
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
    const view = await buildPersonalStatsView(id);

    if (!view) {
      await ctx.reply('Сначала зарегистрируйся через /start');
      return;
    }

    await ctx.reply(view.text, {
      parse_mode: TELEGRAM_HTML,
      ...view.keyboard,
    });
  });

  bot.action(/^buy_miss_removal:(\d+)$/, async (ctx) => {
    const telegramId = parseInt(ctx.match[1], 10);

    if (ctx.from.id !== telegramId) {
      await ctx.answerCbQuery('Это не твоя кнопка!');
      return;
    }

    const user = await User.findOne({ telegramId });

    if (!user) {
      await ctx.answerCbQuery('Пользователь не найден.');
      return;
    }

    if ((user.missedChallengesCount ?? 0) <= 0) {
      await ctx.answerCbQuery('У тебя нет пропусков для удаления.');
      await refreshPersonalStatsMessage(ctx, telegramId);
      return;
    }

    if ((user.score ?? 0) < MISS_REMOVAL_COST) {
      await ctx.answerCbQuery(`Нужно ${MISS_REMOVAL_COST} баллов.`);
      await refreshPersonalStatsMessage(ctx, telegramId);
      return;
    }

    const nextMisses = Math.max(0, (user.missedChallengesCount ?? 0) - 1);
    const wasDroppedOut = !user.isActive;

    user.score = Math.max(0, (user.score ?? 0) - MISS_REMOVAL_COST);
    user.missedChallengesCount = nextMisses;

    if (nextMisses < 3) {
      user.isActive = true;
      user.droppedOutAt = undefined;
    }

    await user.save();
    await refreshPersonalStatsMessage(ctx, telegramId);

    await ctx.answerCbQuery(
      wasDroppedOut && nextMisses < 3
        ? 'Пропуск удалён. Ты снова в игре.'
        : 'Пропуск удалён.'
    );
  });

  bot.action(/^buy_miss_removal_disabled:(\d+)$/, async (ctx) => {
    const telegramId = parseInt(ctx.match[1], 10);

    if (ctx.from.id !== telegramId) {
      await ctx.answerCbQuery('Это не твоя кнопка!');
      return;
    }

    const user = await User.findOne({ telegramId }).select('score missedChallengesCount');

    if (!user) {
      await ctx.answerCbQuery('Пользователь не найден.');
      return;
    }

    if ((user.missedChallengesCount ?? 0) <= 0) {
      await ctx.answerCbQuery('У тебя нет пропусков для удаления.');
      return;
    }

    await ctx.answerCbQuery(`Недостаточно баллов. Нужно ${MISS_REMOVAL_COST}.`);
  });
}

async function buildPersonalStatsView(telegramId: number) {
  const user = await User.findOne({ telegramId });

  if (!user) {
    return null;
  }

  const entries = await WakeUpEntry.find({ telegramId, verified: true })
    .sort({ date: -1 })
    .limit(7);

  const streak = await calculateStreak(telegramId);
  const total = await WakeUpEntry.countDocuments({ telegramId, verified: true });
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

  return {
    text,
    keyboard: buildMissRemovalKeyboard(user.telegramId, user.score ?? 0, user.missedChallengesCount ?? 0),
  };
}

function buildMissRemovalKeyboard(telegramId: number, score: number, missedChallengesCount: number) {
  if (missedChallengesCount <= 0) {
    return undefined;
  }

  if (score < MISS_REMOVAL_COST) {
    return Markup.inlineKeyboard([
      [Markup.button.callback(`⛔ Удалить пропуск за ${MISS_REMOVAL_COST} баллов`, `buy_miss_removal_disabled:${telegramId}`)],
    ]);
  }

  return Markup.inlineKeyboard([
    [Markup.button.callback(`🩹 Удалить пропуск за ${MISS_REMOVAL_COST} баллов`, `buy_miss_removal:${telegramId}`)],
  ]);
}

async function refreshPersonalStatsMessage(ctx: unknown, telegramId: number) {
  const view = await buildPersonalStatsView(telegramId);

  if (!view) {
    return;
  }

  await (ctx as unknown as { editMessageText: (text: string, extra: Record<string, unknown>) => Promise<unknown> }).editMessageText(view.text, {
    parse_mode: TELEGRAM_HTML,
    ...view.keyboard,
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
