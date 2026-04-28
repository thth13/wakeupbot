import cron from 'node-cron';
import { Telegraf, Markup } from 'telegraf';
import { User } from '../models/User';
import { PendingChallenge } from '../models/PendingChallenge';
import { WakeUpEntry } from '../models/WakeUpEntry';
import { sendChallenge } from '../utils/challenge';
import { formatTimeInTimezone, resolveTimezone, todayInTimezone } from '../utils/time';
import { applyLevelProgressChange, formatLevelLabel } from '../utils/levels';
import { applyScoreChange, MISS_SCORE_PENALTY } from '../utils/score';

export function startScheduler(bot: Telegraf) {
  // Runs every minute at :00 seconds
  return cron.schedule('* * * * *', async () => {
    const now = new Date();
    const users = await User.find({ isActive: true });

    // ── Pre-wake reminder: 1 hour before target wake time ───────────────────
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

    for (const user of users) {
      try {
        const timezone = resolveTimezone(user.timezone);
        const oneHourLaterTime = formatTimeInTimezone(oneHourLater, timezone);
        const wakeDate = todayInTimezone(oneHourLater, timezone);

        if (user.targetWakeTime !== oneHourLaterTime) continue;

        const alreadyVerified = await WakeUpEntry.findOne({
          telegramId: user.telegramId,
          date: wakeDate,
          verified: true,
        });
        if (alreadyVerified) continue;

        // Atomic guard: set preWakeReminderDate only if not already today
        const claimed = await User.findOneAndUpdate(
          { _id: user._id, preWakeReminderDate: { $ne: wakeDate } },
          { $set: { preWakeReminderDate: wakeDate } }
        );
        if (!claimed) continue;

        try {
          await bot.telegram.sendMessage(
            user.telegramId,
            `⏰ Через час твой подъём!\n\nЕсли уже проснулся — нажми кнопку. У тебя будет 10 минут после сигнала будильника, чтобы подтвердить пробуждение.`,
            {
              ...Markup.inlineKeyboard([
                Markup.button.callback('🌅 Я проснулся!', `early_wakeup:${user.telegramId}`),
              ]),
            }
          );
        } catch (err) {
          await User.updateOne(
            { _id: user._id, preWakeReminderDate: wakeDate },
            { $unset: { preWakeReminderDate: 1 } }
          );
          throw err;
        }
      } catch (err) {
        console.error(`[scheduler] Failed to send pre-wake reminder to ${user.telegramId}:`, err);
      }
    }

    // ── Wake window closed: 10 min after target wake time ───────────────────
    // If user hasn't confirmed wakeup → record a miss
    const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000);

    for (const user of users) {
      try {
        const timezone = resolveTimezone(user.timezone);
        const tenMinAgoTime = formatTimeInTimezone(tenMinAgo, timezone);
        const wakeDate = todayInTimezone(tenMinAgo, timezone);

        if (user.targetWakeTime !== tenMinAgoTime) continue;

        // Skip if user already confirmed wakeup today
        if (user.wakeConfirmedDate === wakeDate) continue;

        // Skip if already verified via puzzle
        const alreadyVerified = await WakeUpEntry.findOne({
          telegramId: user.telegramId,
          date: wakeDate,
          verified: true,
        });
        if (alreadyVerified) continue;

        // Atomic guard to prevent double-recording
        const claimed = await User.findOneAndUpdate(
          { _id: user._id, wakeWindowClosedDate: { $ne: wakeDate } },
          { $set: { wakeWindowClosedDate: wakeDate } }
        );
        if (!claimed) continue;

        // Record miss
        const updated = await User.findOneAndUpdate(
          { telegramId: user.telegramId, isActive: true },
          { $inc: { missedChallengesCount: 1 }, $unset: { challengeDispatchLockUntil: 1 } },
          { new: true }
        );

        const missedCount = updated?.missedChallengesCount ?? 0;
        const shouldDropOut = Boolean(updated && missedCount >= 3);

        if (shouldDropOut) {
          await User.updateOne(
            { telegramId: user.telegramId, isActive: true },
            { $set: { isActive: false, droppedOutAt: now } }
          );
        }

        const progress = await applyLevelProgressChange(user.telegramId, -1);
        await applyScoreChange(user.telegramId, -MISS_SCORE_PENALTY);

        const progressText = progress
          ? `\n\n📉 Прогресс: -1 день\n🏅 Уровень: ${formatLevelLabel(progress.currentLevel)}\n📊 Дней прогресса: ${progress.currentDays}`
          : '';
        const statusText = shouldDropOut
          ? `\n\n🚫 Это был 3-й пропуск. Ты вылетел из челленджа.`
          : `\n\n❌ Пропусков: ${missedCount}/3`;

        await bot.telegram.sendMessage(
          user.telegramId,
          `😴 Ты не подтвердил пробуждение — пропуск засчитан.${statusText}${progressText}`
        );
      } catch (err) {
        console.error(`[scheduler] Failed to record miss for ${user.telegramId}:`, err);
      }
    }

    // ── Delayed challenge: send puzzle at scheduled random time ─────────────
    const usersWithDelay = await User.find({
      isActive: true,
      delayedChallengeAt: { $exists: true, $lte: now },
    });

    for (const user of usersWithDelay) {
      try {
        // Atomic: clear delayedChallengeAt before sending to prevent double-dispatch
        const claimed = await User.findOneAndUpdate(
          { _id: user._id, delayedChallengeAt: { $exists: true, $lte: now } },
          { $unset: { delayedChallengeAt: 1 } }
        );
        if (!claimed) continue;

        const timezone = resolveTimezone(user.timezone);
        const today = todayInTimezone(now, timezone);

        // Belt and suspenders: skip if already verified today
        const alreadyVerified = await WakeUpEntry.findOne({
          telegramId: user.telegramId,
          date: today,
          verified: true,
        });
        if (alreadyVerified) continue;

        await sendChallenge(bot, user);
      } catch (err) {
        console.error(`[scheduler] Failed to dispatch delayed challenge for ${user.telegramId}:`, err);
      }
    }
  });
}

