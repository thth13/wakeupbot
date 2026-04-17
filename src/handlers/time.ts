import { Telegraf } from 'telegraf';
import { User } from '../models/User';
import { getTimezoneLabel, parseWakeTime } from '../utils/time';

const awaitingTimeChange = new Set<number>();

export function registerTimeHandler(bot: Telegraf, awaitingFromStart: Set<number>) {
  bot.command('time', async (ctx) => {
    const id = ctx.from.id;
    const user = await User.findOne({ telegramId: id });

    if (!user) {
      await ctx.reply('Сначала зарегистрируйся через /start');
      return;
    }

    awaitingTimeChange.add(id);
    await ctx.reply(
      `⏰ Текущее время подъёма: *${user.targetWakeTime} ${getTimezoneLabel()}*\n\n` +
        `Введи новое время в формате *ЧЧ:ММ*:`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.on('text', async (ctx, next) => {
    const id = ctx.from.id;
    if (!awaitingTimeChange.has(id) || awaitingFromStart.has(id)) return next();
    // Let commands pass through even while awaiting input
    if (ctx.message.entities?.some((e) => e.type === 'bot_command')) return next();

    const wakeTime = parseWakeTime(ctx.message.text);
    if (!wakeTime) {
      await ctx.reply('❌ Неверный формат. Введи время как `05:30`', { parse_mode: 'Markdown' });
      return;
    }

    awaitingTimeChange.delete(id);

    await User.updateOne({ telegramId: id }, { targetWakeTime: wakeTime });

    await ctx.reply(`✅ Время подъёма изменено на *${wakeTime} ${getTimezoneLabel()}*`, { parse_mode: 'Markdown' });
  });
}
