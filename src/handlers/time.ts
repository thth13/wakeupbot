import { Telegraf } from 'telegraf';
import { User } from '../models/User';
import { parseWakeTime, resolveTimezone } from '../utils/time';
import { bold, codeInline, TELEGRAM_HTML } from '../utils/telegram';

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
    const timezone = resolveTimezone(user.timezone);
    await ctx.reply(
      `⏰ Текущее время подъёма: ${bold(user.targetWakeTime)}\n\n` +
        `🌍 Текущая таймзона: ${bold(timezone)}\n\n` +
        `Введи новое время в формате <b>ЧЧ:ММ</b> для своей таймзоны:`,
      { parse_mode: TELEGRAM_HTML }
    );
  });

  bot.on('text', async (ctx, next) => {
    const id = ctx.from.id;
    if (!awaitingTimeChange.has(id) || awaitingFromStart.has(id)) return next();
    // Let commands pass through even while awaiting input
    if (ctx.message.entities?.some((e) => e.type === 'bot_command')) return next();

    const wakeTime = parseWakeTime(ctx.message.text);
    if (!wakeTime) {
      await ctx.reply(`❌ Неверный формат. Введи время как ${codeInline('05:30')}`, { parse_mode: TELEGRAM_HTML });
      return;
    }

    awaitingTimeChange.delete(id);

    await User.updateOne({ telegramId: id }, { targetWakeTime: wakeTime });

    await ctx.reply(`✅ Время подъёма изменено на ${bold(wakeTime)}`, { parse_mode: TELEGRAM_HTML });
  });
}
