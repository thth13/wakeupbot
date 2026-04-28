import { Telegraf } from 'telegraf';
import { PendingChallenge } from '../models/PendingChallenge';
import { WakeUpEntry } from '../models/WakeUpEntry';
import { User } from '../models/User';
import { applyLevelProgressChange, formatLevelLabel } from '../utils/levels';
import { applyScoreChange, WAKE_SCORE_REWARD } from '../utils/score';
import { displayTime, formatTimeInTimezone, resolveTimezone, todayInTimezone } from '../utils/time';
import { bold, isTelegramMessageNotModifiedError, TELEGRAM_HTML } from '../utils/telegram';

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
      try {
        await ctx.editMessageReplyMarkup(undefined);
      } catch (error) {
        if (!isTelegramMessageNotModifiedError(error)) {
          throw error;
        }
      }
      return;
    }

    if (new Date() > challenge.expiresAt) {
      await PendingChallenge.deleteOne({ _id: challenge._id });
      await ctx.answerCbQuery('⏰ Время вышло!');
      try {
        await ctx.editMessageText('⏰ Время на ответ вышло. До завтра!');
      } catch (error) {
        if (!isTelegramMessageNotModifiedError(error)) {
          throw error;
        }
      }
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
    await applyScoreChange(telegramId, WAKE_SCORE_REWARD);

    try {
      await ctx.editMessageText('✅ Задачка решена!');
    } catch (error) {
      if (!isTelegramMessageNotModifiedError(error)) {
        throw error;
      }
    }

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

  // Early wakeup: user pressed "I woke up" from the pre-wake reminder
  bot.action(/^early_wakeup:(\d+)$/, async (ctx) => {
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

    const timezone = resolveTimezone(user.timezone);
    const now = new Date();
    const today = todayInTimezone(now, timezone);

    const alreadyVerified = await WakeUpEntry.findOne({ telegramId, date: today, verified: true });
    if (alreadyVerified) {
      await ctx.answerCbQuery('Подъём уже засчитан сегодня!');
      try {
        await ctx.editMessageReplyMarkup(undefined);
      } catch (error) {
        if (!isTelegramMessageNotModifiedError(error)) throw error;
      }
      return;
    }

    // Check if already confirmed (button pressed earlier)
    if (user.wakeConfirmedDate === today) {
      await ctx.answerCbQuery('Ты уже подтвердил пробуждение — жди задачку!');
      try {
        await ctx.editMessageReplyMarkup(undefined);
      } catch (error) {
        if (!isTelegramMessageNotModifiedError(error)) throw error;
      }
      return;
    }

    // Check if the 10-minute wake window is still open
    // Compute wake time UTC: delta = (wakeTime in local mins) - (current local mins)
    const currentTimeStr = formatTimeInTimezone(now, timezone);
    const [wH, wM] = user.targetWakeTime.split(':').map(Number);
    const [curH, curM] = currentTimeStr.split(':').map(Number);
    let deltaMins = (wH * 60 + wM) - (curH * 60 + curM);
    if (deltaMins > 720) deltaMins -= 1440;
    if (deltaMins < -720) deltaMins += 1440;
    const wakeTimeUTC = new Date(now.getTime() + deltaMins * 60 * 1000);

    // If more than 10 minutes past the scheduled wake time → too late
    if (now.getTime() > wakeTimeUTC.getTime() + 10 * 60 * 1000) {
      await ctx.answerCbQuery('Время подъёма уже прошло.');
      try {
        await ctx.editMessageText('⏰ Окно подъёма закрыто. Пропуск будет засчитан.');
      } catch (error) {
        if (!isTelegramMessageNotModifiedError(error)) throw error;
      }
      return;
    }

    // Schedule delayed challenge: random moment within 1 hour after wake time
    const startMs = Math.max(now.getTime(), wakeTimeUTC.getTime());
    const delayedChallengeAt = new Date(startMs + Math.floor(Math.random() * 60 * 60 * 1000));

    await User.updateOne(
      { _id: user._id },
      { $set: { wakeConfirmedDate: today, delayedChallengeAt } }
    );

    try {
      await ctx.editMessageText(
        '✅ Принято! В течение часа тебе придёт задачка — у тебя будет 5 минут на ответ. Не пропусти!'
      );
    } catch (error) {
      if (!isTelegramMessageNotModifiedError(error)) throw error;
    }
    await ctx.answerCbQuery('Подъём отмечен! Жди задачку 👀');
  });
}
