import { Telegraf } from 'telegraf';
import { PendingChallenge } from '../models/PendingChallenge';
import { WakeUpEntry } from '../models/WakeUpEntry';
import { User } from '../models/User';
import { applyLevelProgressChange, formatLevelLabel } from '../utils/levels';
import { displayTime, resolveTimezone, todayInTimezone } from '../utils/time';
import { sendChallenge } from '../utils/challenge';
import { bold, TELEGRAM_HTML } from '../utils/telegram';

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

    const user = await User.findOne({ telegramId });
    const timezone = resolveTimezone(user?.timezone);
    const now = new Date();
    const today = todayInTimezone(now, timezone);

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

    const progress = await applyLevelProgressChange(telegramId, 1);

    await ctx.editMessageText('✅ Задачка решена!');

    await ctx.telegram.sendMessage(
      telegramId,
      `🌅 ${bold(`Доброе утро, ${user?.firstName ?? ctx.from.first_name}!`)}\n\nПодъём засчитан в ${bold(displayTime(now, timezone))} 🎉${
        progress
          ? `\n🏅 Текущий уровень: ${bold(formatLevelLabel(progress.currentLevel))}\n📊 Проснулся дней: ${bold(String(progress.currentDays))}`
          : ''
      }\n\nОтличное начало дня!`,
      { parse_mode: TELEGRAM_HTML }
    );

    if (progress?.leveledUp) {
      await ctx.telegram.sendMessage(
        telegramId,
        `🎉 <b>Новый уровень!</b>\n\nТеперь твой ранг — ${bold(formatLevelLabel(progress.currentLevel))}\nПродолжай в том же темпе!`,
        { parse_mode: TELEGRAM_HTML }
      );
    }

    await ctx.answerCbQuery('🌅 Отличный подъём!');
  });

  // Early wakeup: user pressed "I already woke up" from the pre-wake reminder
  bot.action(/^early_wakeup:(\d+)$/, async (ctx) => {
    const telegramId = parseInt(ctx.match[1], 10);

    if (ctx.from.id !== telegramId) {
      await ctx.answerCbQuery('Это не твоя кнопка!');
      return;
    }

    const user = await User.findOne({ telegramId });
    const timezone = resolveTimezone(user?.timezone);
    const today = todayInTimezone(new Date(), timezone);

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

    if (!user) {
      await ctx.answerCbQuery('Пользователь не найден.');
      return;
    }

    await ctx.editMessageText('👍 Отлично, раньше будильника! Держи задачку:');
    await sendChallenge(bot, user);
    await ctx.answerCbQuery('🌅 Проснулся раньше — молодец!');
  });
}
