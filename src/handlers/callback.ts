import { Telegraf } from 'telegraf';
import { PendingChallenge } from '../models/PendingChallenge';
import { WakeUpEntry } from '../models/WakeUpEntry';
import { User } from '../models/User';
import { displayTime, todayInAppTimezone } from '../utils/time';
import { sendChallenge } from '../utils/challenge';

export function registerCallbackHandler(bot: Telegraf) {
  // Callback data format: "answer:<telegramId>:<value>"
  bot.action(/^answer:(\d+):(-?\d+)$/, async (ctx) => {
    const telegramId = parseInt(ctx.match[1], 10);
    const answeredValue = parseInt(ctx.match[2], 10);

    // Only the owner can answer their own challenge
    if (ctx.from.id !== telegramId) {
      await ctx.answerCbQuery('Это не твоя задачка!');
      return;
    }

    const challenge = await PendingChallenge.findOne({ telegramId, answered: false });

    if (!challenge) {
      await ctx.answerCbQuery('Время вышло или задачка уже решена.');
      await ctx.editMessageReplyMarkup(undefined);
      return;
    }

    if (new Date() > challenge.expiresAt) {
      await PendingChallenge.deleteOne({ _id: challenge._id });
      await ctx.answerCbQuery('⏰ Время вышло!');
      await ctx.editMessageText('⏰ Время на ответ вышло. До завтра!');
      return;
    }

    if (answeredValue !== challenge.correctAnswer) {
      await ctx.answerCbQuery('❌ Неверно! Попробуй ещё раз.');
      return;
    }

    // Correct answer — mark as answered
    challenge.answered = true;
    await challenge.save();

    const now = new Date();
    const today = todayInAppTimezone(now);

    const user = await User.findOne({ telegramId });

    // Upsert wake-up entry (idempotent)
    await WakeUpEntry.findOneAndUpdate(
      { telegramId, date: today },
      {
        userId: user?._id,
        telegramId,
        username: ctx.from.username,
        firstName: ctx.from.first_name,
        date: today,
        wakeUpTime: now,
        verified: true,
      },
      { upsert: true, new: true }
    );

    await ctx.editMessageText('✅ Задачка решена!');

    await ctx.telegram.sendMessage(
      telegramId,
      `🌅 *Доброе утро, ${user?.firstName ?? ctx.from.first_name}!*\n\nПодъём засчитан в *${displayTime(now)}* 🎉\nОтличное начало дня!`,
      { parse_mode: 'Markdown' }
    );

    await ctx.answerCbQuery('🌅 Отличный подъём!');
  });

  // Early wakeup: user pressed "I already woke up" from the pre-wake reminder
  bot.action(/^early_wakeup:(\d+)$/, async (ctx) => {
    const telegramId = parseInt(ctx.match[1], 10);

    if (ctx.from.id !== telegramId) {
      await ctx.answerCbQuery('Это не твоя кнопка!');
      return;
    }

    const today = todayInAppTimezone(new Date());

    const alreadyVerified = await WakeUpEntry.findOne({ telegramId, date: today, verified: true });
    if (alreadyVerified) {
      await ctx.answerCbQuery('Ты уже засчитан сегодня!');
      await ctx.editMessageReplyMarkup(undefined);
      return;
    }

    const existing = await PendingChallenge.findOne({ telegramId, answered: false });
    if (existing) {
      if (new Date() <= existing.expiresAt) {
        // Valid unanswered challenge exists — let the user answer it
        await ctx.answerCbQuery('Задачка уже отправлена, реши её!');
        await ctx.editMessageReplyMarkup(undefined);
        return;
      }
      // Expired — delete and send fresh one
      await PendingChallenge.deleteOne({ _id: existing._id });
    }

    const user = await User.findOne({ telegramId });
    if (!user) {
      await ctx.answerCbQuery('Пользователь не найден.');
      return;
    }

    await ctx.editMessageText('👍 Отлично, раньше будильника! Держи задачку:');
    await sendChallenge(bot, user);
    await ctx.answerCbQuery('🌅 Проснулся раньше — молодец!');
  });
}
