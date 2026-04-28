import { Telegraf, Markup } from 'telegraf';
import { IUser } from '../models/User';
import { User } from '../models/User';
import { PendingChallenge } from '../models/PendingChallenge';
import { generatePuzzle } from './puzzle';
import { bold, TELEGRAM_HTML } from './telegram';

export const ANSWER_WINDOW_MS = parseInt(process.env.ANSWER_WINDOW_MINUTES ?? '5', 10) * 60 * 1000;
const CHALLENGE_SEND_LOCK_MS = 30 * 1000;

export async function sendChallenge(bot: Telegraf, user: IUser): Promise<boolean> {
  const now = new Date();
  const lockUntil = new Date(now.getTime() + CHALLENGE_SEND_LOCK_MS);

  const lockOwner = await User.findOneAndUpdate(
    {
      _id: user._id,
      $or: [
        { challengeDispatchLockUntil: { $exists: false } },
        { challengeDispatchLockUntil: { $lte: now } },
      ],
    },
    { $set: { challengeDispatchLockUntil: lockUntil } },
    { new: true }
  );

  if (!lockOwner) {
    return false;
  }

  try {
    const activeChallenge = await PendingChallenge.findOne({
      telegramId: user.telegramId,
      answered: false,
      expiresAt: { $gt: now },
    });
    if (activeChallenge) {
      return false;
    }

  const puzzle = generatePuzzle();
  const expiresAt = new Date(Date.now() + ANSWER_WINDOW_MS);

  const buttons = puzzle.options.map((opt) =>
    Markup.button.callback(String(opt), `answer:${user.telegramId}:${opt}`)
  );

  const msg = await bot.telegram.sendMessage(
    user.telegramId,
    `🌅 ${bold(`Доброе утро, ${user.firstName}!`)}\n\n` +
      `Реши задачку, чтобы подтвердить пробуждение:\n\n` +
      `➡️ ${bold(puzzle.question)}\n\n` +
      `⏳ У тебя 5 минут!`,
    {
      parse_mode: TELEGRAM_HTML,
      ...Markup.inlineKeyboard([buttons]),
    }
  );

  await PendingChallenge.findOneAndUpdate(
    { telegramId: user.telegramId },
    {
      telegramId: user.telegramId,
      chatId: user.telegramId,
      messageId: msg.message_id,
      question: puzzle.question,
      correctAnswer: puzzle.correctAnswer,
      options: puzzle.options,
      expiresAt,
      answered: false,
    },
    { upsert: true, new: true }
  );

    return true;
  } finally {
    await User.updateOne(
      { _id: user._id },
      { $unset: { challengeDispatchLockUntil: 1 } }
    );
  }
}
