import { Markup, Telegraf } from 'telegraf';
import { User } from '../models/User';
import { PendingChallenge } from '../models/PendingChallenge';
import { WakeUpEntry } from '../models/WakeUpEntry';
import { sendChallenge } from '../utils/challenge';
import { todayInTimezone } from '../utils/time';
import { debugMenuKeyboard, mainMenuKeyboard, DEBUG_BUTTON_COMMANDS } from '../utils/keyboards';
import { TELEGRAM_HTML } from '../utils/telegram';

const ADMIN_IDS: Set<number> = new Set(
  (process.env.DEBUG_ADMIN_IDS ?? '')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n))
);

function isAdmin(id: number): boolean {
  return ADMIN_IDS.size === 0 || ADMIN_IDS.has(id);
}

async function handleDebugArg(
  bot: Telegraf,
  id: number,
  arg: string,
  reply: (text: string, extra?: object) => Promise<unknown>
): Promise<void> {
  if (!arg || arg === 'help') {
    await reply(
      `🛠 <b>Debug mode</b>\n\n` +
        `challenge — отправить себе задачку прямо сейчас\n` +
        `clear — сбросить текущий pending-челлендж\n` +
        `clearentry — удалить свою запись о подъёме за сегодня\n` +
        `reminder — отправить себе pre-wake reminder прямо сейчас\n` +
        `clearreminder — сбросить флаг pre-wake reminder за сегодня`,
      { parse_mode: TELEGRAM_HTML, ...debugMenuKeyboard }
    );
    return;
  }

  if (arg === 'challenge') {
    const user = await User.findOne({ telegramId: id });
    if (!user) {
      await reply('❌ Ты не зарегистрирован. Сначала /start');
      return;
    }

    await PendingChallenge.deleteOne({ telegramId: id });

    try {
      await sendChallenge(bot, user);
      await reply('✅ Задачка отправлена.');
    } catch (err) {
      console.error('[debug] sendChallenge error:', err);
      await reply(`❌ Ошибка: ${(err as Error).message}`);
    }
    return;
  }

  if (arg === 'clear') {
    const deleted = await PendingChallenge.deleteOne({ telegramId: id });
    await reply(
      deleted.deletedCount > 0
        ? '✅ Pending-челлендж удалён.'
        : 'ℹ️ Активных челленджей не было.'
    );
    return;
  }

  if (arg === 'clearentry') {
    const user = await User.findOne({ telegramId: id }).select('timezone').lean();
    const today = todayInTimezone(new Date(), user?.timezone);
    const deleted = await WakeUpEntry.deleteOne({ telegramId: id, date: today });
    await reply(
      deleted.deletedCount > 0
        ? `✅ Запись о подъёме за ${today} удалена.`
        : `ℹ️ Записи за ${today} не было.`
    );
    return;
  }

  if (arg === 'reminder') {
    const user = await User.findOne({ telegramId: id });
    if (!user) {
      await reply('❌ Ты не зарегистрирован. Сначала /start');
      return;
    }

    try {
      await bot.telegram.sendMessage(
        user.telegramId,
        `⏰ Через час твой подъём! Если уже проснулся — жми кнопку.`,
        {
          ...Markup.inlineKeyboard([
            Markup.button.callback('🌅 Я уже проснулся!', `early_wakeup:${user.telegramId}`),
          ]),
        }
      );
      await reply('✅ Pre-wake reminder отправлен.');
    } catch (err) {
      console.error('[debug] reminder error:', err);
      await reply(`❌ Ошибка: ${(err as Error).message}`);
    }
    return;
  }

  if (arg === 'clearreminder') {
    const user = await User.findOne({ telegramId: id }).select('timezone').lean();
    const today = todayInTimezone(new Date(), user?.timezone);
    await User.updateOne(
      { telegramId: id, preWakeReminderDate: today },
      { $unset: { preWakeReminderDate: 1 } }
    );
    await reply(`✅ Флаг pre-wake reminder за ${today} сброшен.`);
    return;
  }

  await reply('❓ Неизвестная команда.');
}

export function registerDebugHandlers(bot: Telegraf): void {
  // /debug command
  bot.command('debug', async (ctx) => {
    const id = ctx.from.id;
    if (!isAdmin(id)) {
      await ctx.reply('⛔ Нет доступа.');
      return;
    }
    const arg = ctx.message.text.split(' ')[1]?.toLowerCase() ?? '';
    await handleDebugArg(bot, id, arg, (text, extra) => ctx.reply(text, extra));
  });

  // /debugmenu command — show the debug keyboard
  bot.command('debugmenu', async (ctx) => {
    const id = ctx.from.id;
    if (!isAdmin(id)) {
      await ctx.reply('⛔ Нет доступа.');
      return;
    }
    await ctx.reply('🛠 Дебаг-меню открыто', debugMenuKeyboard);
  });

  // Handle debug menu button presses
  bot.on('text', async (ctx, next) => {
    const id = ctx.from.id;
    const text = ctx.message.text;

    if (text === '🔙 Главное меню') {
      await ctx.reply('✅ Главное меню', mainMenuKeyboard);
      return;
    }

    const debugArg = DEBUG_BUTTON_COMMANDS[text];
    if (!debugArg) return next();

    if (!isAdmin(id)) {
      await ctx.reply('⛔ Нет доступа.');
      return;
    }

    const arg = debugArg.replace('/debug ', '');
    await handleDebugArg(bot, id, arg, (t, extra) => ctx.reply(t, extra));
  });
}
