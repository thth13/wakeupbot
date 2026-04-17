import cron from 'node-cron';
import { Telegraf } from 'telegraf';
import { PendingChallenge } from '../models/PendingChallenge';

export function startExpiryJob(bot: Telegraf) {
  // Check every minute for expired challenges
  return cron.schedule('* * * * *', async () => {
    const expired = await PendingChallenge.find({
      answered: false,
      expiresAt: { $lt: new Date() },
    });

    for (const challenge of expired) {
      try {
        if (challenge.messageId) {
          await bot.telegram.editMessageText(
            challenge.chatId,
            challenge.messageId,
            undefined,
            '⏰ Время вышло! Задачка не решена. До завтра 😴'
          );
        }
      } catch {
        // Message may already be deleted or edited — ignore
      }

      await PendingChallenge.deleteOne({ _id: challenge._id });
    }
  });
}
