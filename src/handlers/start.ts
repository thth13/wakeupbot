import { Context } from 'telegraf';
import { User } from '../models/User';
import { getTimezoneLabel, parseWakeTime } from '../utils/time';
import { mainMenuKeyboard, MENU_BUTTON_COMMANDS } from '../utils/keyboards';

// Conversation state: waiting for wake time
const awaitingWakeTime = new Set<number>();

export function registerStartHandler(bot: import('telegraf').Telegraf) {
  bot.start(async (ctx) => {
    const id = ctx.from.id;
    const existing = await User.findOne({ telegramId: id });

    if (existing) {
      await ctx.reply(
        `👋 Ты уже зарегистрирован!\n\n⏰ Твоё время подъёма: *${existing.targetWakeTime} ${getTimezoneLabel()}*`,
        { parse_mode: 'Markdown', ...mainMenuKeyboard }
      );
      return;
    }

    awaitingWakeTime.add(id);
    await ctx.reply(
      `🌅 Привет, *${ctx.from.first_name}*! Добро пожаловать в челлендж ранних подъёмов!\n\n` +
        `Каждое утро в заданное время я пришлю тебе задачку — реши её, чтобы подтвердить пробуждение.\n\n` +
        `⏰ В котором часу ты хочешь вставать? Часовой пояс: *${getTimezoneLabel()}*\n` +
        `Введи время в формате *ЧЧ:ММ*, например \`05:30\``,
      { parse_mode: 'Markdown' }
    );
  });

  // Handle text messages: menu buttons + wake time input flow
  bot.on('text', async (ctx, next) => {
    const id = ctx.from.id;
    const text = ctx.message.text;

    // Intercept menu button presses (route to the matching command)
    const matchedCommand = MENU_BUTTON_COMMANDS[text];
    if (matchedCommand) {
      // Reuse ctx by faking the message text so other handlers can process it
      (ctx.message as import('telegraf/types').Message.TextMessage).text = matchedCommand;
      (ctx.message.entities as import('telegraf/types').MessageEntity[]) = [
        { type: 'bot_command', offset: 0, length: matchedCommand.split(' ')[0].length },
      ];
      return next();
    }

    if (!awaitingWakeTime.has(id)) return next();
    // Let actual commands pass through even while awaiting input
    if (ctx.message.entities?.some((e) => e.type === 'bot_command')) return next();

    const wakeTime = parseWakeTime(text);
    if (!wakeTime) {
      await ctx.reply('❌ Неверный формат. Введи время в формате *ЧЧ:ММ*, например `05:30`', {
        parse_mode: 'Markdown',
      });
      return;
    }

    awaitingWakeTime.delete(id);

    await User.create({
      telegramId: id,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      targetWakeTime: wakeTime,
    });

    await ctx.reply(
      `✅ Отлично! Каждый день в *${wakeTime} ${getTimezoneLabel()}* я буду присылать тебе задачку.\n\n` +
        `Реши её в течение 10 минут, чтобы засчитался ранний подъём. Удачи! 💪`,
      { parse_mode: 'Markdown', ...mainMenuKeyboard }
    );
  });

  return awaitingWakeTime;
}
