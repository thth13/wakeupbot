import { Telegraf } from 'telegraf';
import { WakeUpEntry } from '../models/WakeUpEntry';
import { User } from '../models/User';
import { formatLevelLabel, getLevelForDays } from '../utils/levels';
import { displayTime, formatHumanDate, todayInAppTimezone } from '../utils/time';

export function registerStatsHandlers(bot: Telegraf) {
  // /stats — today's leaderboard
  bot.command('stats', async (ctx) => {
    const today = todayInAppTimezone();
    const entries = await WakeUpEntry.find({ date: today, verified: true }).sort({ wakeUpTime: 1 });

    if (entries.length === 0) {
      await ctx.reply(`📊 Сегодня (${today}) ещё никто не отметился. Будь первым!`);
      return;
    }

    const lines = entries.map((e, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      const name = e.username ? `@${e.username}` : e.firstName;
      return `${medal} ${name} — ${displayTime(e.wakeUpTime)}`;
    });

    await ctx.reply(
      `🌅 *Подъёмы за ${today}*\n\n${lines.join('\n')}`,
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
