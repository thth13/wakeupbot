import { Context, Telegraf } from 'telegraf';
import { User } from '../models/User';
import {
  appendUserInviteCode,
  createUniqueInviteCode,
  ensureUserInviteCode,
  getUserInviteCodes,
  BOOTSTRAP_INVITE_CODE,
  normalizeInviteCode,
} from '../utils/inviteCodes';
import { formatLevelLabel, getLevelForDays } from '../utils/levels';
import { parseWakeTime } from '../utils/time';
import { mainMenuKeyboard, MENU_BUTTON_COMMANDS } from '../utils/keyboards';

// Conversation state: waiting for invite code or wake time
const awaitingInviteCode = new Set<number>();
const awaitingWakeTime = new Set<number>();
const pendingInviterIds = new Map<number, number | null>();
const pendingInviteCodes = new Map<number, string | null>();

async function notifyUsersAboutNewMember(bot: Telegraf, newUserTelegramId: number, newUserFirstName: string) {
  const recipients = await User.find({ telegramId: { $ne: newUserTelegramId } }).select('telegramId').lean();

  if (recipients.length === 0) {
    return;
  }

  const message = `🎉 К нам присоединился новый участник — ${newUserFirstName}!`;

  await Promise.allSettled(
    recipients.map(({ telegramId }) =>
      bot.telegram.sendMessage(telegramId, message, {
      })
    )
  );
}

async function handleInviteCodeStep(ctx: Context & { message: { text: string; entities?: { type: string }[] } }) {
  if (!ctx.from) {
    return;
  }

  const id = ctx.from.id;
  const submittedCode = normalizeInviteCode(ctx.message.text);
  const usersCount = await User.countDocuments();
  const isBootstrapAllowed = usersCount === 0;

  let inviterTelegramId: number | null = null;

  if (isBootstrapAllowed) {
    if (submittedCode !== BOOTSTRAP_INVITE_CODE) {
      await ctx.reply('❌ Неверный код приглашения. Проверь код и попробуй ещё раз.');
      return;
    }
  } else {
    const inviter = await User.findOne({
      $or: [{ inviteCode: submittedCode }, { inviteCodes: submittedCode }],
    }).select('telegramId');

    if (!inviter) {
      await ctx.reply('❌ Неверный код приглашения. Проверь код и попробуй ещё раз.');
      return;
    }

    const alreadyUsed = await User.exists({ invitedWithCode: submittedCode });

    if (alreadyUsed) {
      await ctx.reply('❌ Этот инвайт-код уже использован. Попроси новый код приглашения.');
      return;
    }

    inviterTelegramId = inviter.telegramId;
  }

  awaitingInviteCode.delete(id);
  awaitingWakeTime.add(id);
  pendingInviterIds.set(id, inviterTelegramId);
  pendingInviteCodes.set(id, isBootstrapAllowed ? null : submittedCode);

  const startingLevel = getLevelForDays(0);

  await ctx.reply(
    `🎉 Добро пожаловать в челлендж ранних подъёмов!\n\n` +
      `⏰ Задай время, в которое хочешь просыпаться, и начинай участвовать.\n\n` +
      `🧩 Чтобы подтвердить подъём, я пришлю тебе простую задачку в нужное время.\n` +
      `🔁 Потом пришлю ещё одну проверку через 30 минут, чтобы убедиться, что ты не уснул снова.\n\n` +
      `🏆 У нас действует система уровней. Поднимайся всё выше и дойди до финального ранга.\n\n` +
      `🌱 Твой стартовый уровень: *${formatLevelLabel(startingLevel)}*\n\n` +
      `⏰ Введи время подъёма в формате *ЧЧ:ММ*, например \`05:30\``,
    { parse_mode: 'Markdown' }
  );
}

export function registerStartHandler(bot: Telegraf) {
  bot.start(async (ctx) => {
    if (!ctx.from) {
      return;
    }

    const id = ctx.from.id;
    const existing = await User.findOne({ telegramId: id });

    if (existing) {
      const inviteCodes = await getUserInviteCodes(existing);
      const inviteCodesText = inviteCodes.map((inviteCode, index) => `${index + 1}. *${inviteCode}*`).join('\n');

      await ctx.reply(
        `👋 Ты уже зарегистрирован!\n\n` +
          `⏰ Твоё время подъёма: *${existing.targetWakeTime}*\n` +
          `🗝 Твои инвайт-коды:\n${inviteCodesText}`,
        { parse_mode: 'Markdown', ...mainMenuKeyboard }
      );
      return;
    }

    awaitingInviteCode.add(id);
    awaitingWakeTime.delete(id);
    pendingInviterIds.delete(id);
    pendingInviteCodes.delete(id);

    await ctx.reply(
      `🔐 Введи код приглашения, чтобы вступить в челлендж ранних подъёмов.`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('invite', async (ctx) => {
    if (!ctx.from) {
      return;
    }

    const user = await User.findOne({ telegramId: ctx.from.id });

    if (!user) {
      await ctx.reply('Сначала зарегистрируйся через /start');
      return;
    }

    const inviteCode = await appendUserInviteCode(user);
    const inviteCodes = await getUserInviteCodes(user);

    await ctx.reply(
      `🗝 Новый инвайт-код готов: *${inviteCode}*\n\n` +
        `👤 Ограничение: один код можно использовать только для одного приглашённого.\n` +
        `📦 Активных кодов сейчас: *${inviteCodes.length}*\n` +
        `♻️ Если нужен следующий инвайт, снова используй /invite.`,
      { parse_mode: 'Markdown' }
    );
  });

  // /welcome — отправить onboarding-сообщение сразу (полезно для тестирования)
  bot.command('welcome', async (ctx) => {
    if (!ctx.from) return;

    const id = ctx.from.id;

    // Ставит пользователя в состояние ввода времени подъёма
    awaitingInviteCode.delete(id);
    awaitingWakeTime.add(id);
    pendingInviterIds.delete(id);
    pendingInviteCodes.delete(id);

    const startingLevel = getLevelForDays(0);

    await ctx.reply(
      `🎉 Добро пожаловать в челлендж ранних подъёмов!\n\n` +
        `⏰ Задай время, в которое хочешь просыпаться, и начинай участвовать.\n\n` +
        `🧩 Чтобы подтвердить подъём, я пришлю тебе простую задачку в нужное время.\n` +
        `🔁 Потом пришлю ещё одну проверку через 30 минут, чтобы убедиться, что ты не уснул снова.\n\n` +
        `🏆 У нас действует система уровней. Поднимайся всё выше и дойди до финального ранга.\n\n` +
        `🌱 Твой стартовый уровень: *${formatLevelLabel(startingLevel)}*\n\n` +
        `⏰ Введи время подъёма в формате *ЧЧ:ММ*, например \`05:30\``,
      { parse_mode: 'Markdown' }
    );
  });

  // Handle text messages: menu buttons + wake time input flow
  bot.on('text', async (ctx, next) => {
    if (!ctx.from) {
      return next();
    }

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

    if (awaitingInviteCode.has(id)) {
      if (ctx.message.entities?.some((entity) => entity.type === 'bot_command')) return next();
      await handleInviteCodeStep(ctx as Context & { message: { text: string; entities?: { type: string }[] } });
      return;
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

    const firstName = ctx.from.first_name?.trim() || 'Новый участник';

    const primaryInviteCode = await createUniqueInviteCode();

    await User.create({
      telegramId: id,
      username: ctx.from.username,
      firstName,
      inviteCode: primaryInviteCode,
      inviteCodes: [primaryInviteCode],
      invitedByTelegramId: pendingInviterIds.get(id) ?? undefined,
      invitedWithCode: pendingInviteCodes.get(id) ?? undefined,
      targetWakeTime: wakeTime,
    });

    pendingInviterIds.delete(id);
    pendingInviteCodes.delete(id);

    await ctx.reply(
      `✅ Готово. Каждый день в *${wakeTime}* я буду присылать тебе задачку для подтверждения подъёма.\n\n` +
        `Реши её вовремя, а потом подтверди бодрствование повторной проверкой через 30 минут.`,
      { parse_mode: 'Markdown', ...mainMenuKeyboard }
    );

    await notifyUsersAboutNewMember(bot, id, firstName);
  });

  return awaitingWakeTime;
}
