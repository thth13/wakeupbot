import cron from 'node-cron';
import { Telegraf } from 'telegraf';
import { PendingChallenge } from '../models/PendingChallenge';
import { User } from '../models/User';
import { applyLevelProgressChange, formatLevelLabel } from '../utils/levels';
import { applyScoreChange, MISS_SCORE_PENALTY } from '../utils/score';

export function startExpiryJob(bot: Telegraf) {
  // Check every minute for expired challenges
  return cron.schedule('* * * * *', async () => {
    const now = new Date();
    const expired = await PendingChallenge.find({
      answered: false,
      expiresAt: { $lt: now },
    })
      .select('_id')
      .lean();

    for (const expiredChallenge of expired) {
      const challenge = await PendingChallenge.findOneAndDelete({
        _id: expiredChallenge._id,
        answered: false,
        expiresAt: { $lt: now },
      });

      if (!challenge) {
        continue;
      }

      const user = await User.findOneAndUpdate(
        { telegramId: challenge.telegramId, isActive: true },
        {
          $inc: { missedChallengesCount: 1 },
          $unset: { challengeDispatchLockUntil: 1 },
        },
        {
          new: true,
          select: 'missedChallengesCount isActive droppedOutAt',
        }
      );

      const missedChallengesCount = user?.missedChallengesCount ?? 0;
      const shouldDropOut = Boolean(user && missedChallengesCount >= 3);

      if (shouldDropOut) {
        await User.updateOne(
          { telegramId: challenge.telegramId, isActive: true },
          {
            $set: {
              isActive: false,
              droppedOutAt: user?.droppedOutAt ?? now,
            },
          }
        );
      }

      try {
        const progress = await applyLevelProgressChange(challenge.telegramId, -1);
        await applyScoreChange(challenge.telegramId, -MISS_SCORE_PENALTY);
        const progressText = progress
          ? `\n\n📉 Прогресс: -1 день\n🏅 Уровень: ${formatLevelLabel(progress.currentLevel)}\n📊 Дней прогресса: ${progress.currentDays}`
          : '';
        const statusText = shouldDropOut
          ? `\n\n🚫 Это был 3-й пропуск. Ты вылетел из челленджа.`
          : `\n\n❌ Пропусков: ${missedChallengesCount}/3`;

        if (challenge.messageId) {
          await bot.telegram.editMessageText(
            challenge.chatId,
            challenge.messageId,
            undefined,
            `⏰ Время вышло! Задачка не решена.${statusText}${progressText}`
          );
        }
      } catch {
        // Message may already be deleted or edited — ignore
      }
    }
  });
}
