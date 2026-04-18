import cron from 'node-cron';
import { Telegraf, Markup } from 'telegraf';
import { User } from '../models/User';
import { PendingChallenge } from '../models/PendingChallenge';
import { WakeUpEntry } from '../models/WakeUpEntry';
import { sendChallenge } from '../utils/challenge';
import { formatTimeInTimezone, resolveTimezone, todayInTimezone } from '../utils/time';

export function startScheduler(bot: Telegraf) {
  // Runs every minute at :00 seconds
  return cron.schedule('* * * * *', async () => {
    const now = new Date();
    const users = await User.find({ isActive: true });

    for (const user of users) {
      try {
        const timezone = resolveTimezone(user.timezone);
        const currentTime = formatTimeInTimezone(now, timezone);
        const today = todayInTimezone(now, timezone);

        if (user.targetWakeTime !== currentTime) continue;

        // Skip if already has a verified entry today
        const alreadyVerified = await WakeUpEntry.findOne({
          telegramId: user.telegramId,
          date: today,
          verified: true,
        });
        if (alreadyVerified) continue;

        // Skip if already has a pending (unanswered) challenge
        const existing = await PendingChallenge.findOne({
          telegramId: user.telegramId,
          answered: false,
          expiresAt: { $gt: now },
        });
        if (existing) continue;

        await sendChallenge(bot, user);
      } catch (err) {
        console.error(`[scheduler] Failed to send challenge to ${user.telegramId}:`, err);
      }
    }

    // Pre-wake reminder: 1 hour before target wake time
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

        const existing = await PendingChallenge.findOne({
          telegramId: user.telegramId,
          answered: false,
          expiresAt: { $gt: now },
        });
        if (existing) continue;

        // Atomic guard: set preWakeReminderDate only if not already today
        // If another instance already did it, findOneAndUpdate returns null
        const claimed = await User.findOneAndUpdate(
          { _id: user._id, preWakeReminderDate: { $ne: wakeDate } },
          { $set: { preWakeReminderDate: wakeDate } }
        );
        if (!claimed) continue;

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
  });
}
