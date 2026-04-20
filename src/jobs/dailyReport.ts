import cron from 'node-cron';
import { Telegraf } from 'telegraf';
import { DailyReport } from '../models/DailyReport';
import { PendingChallenge } from '../models/PendingChallenge';
import { User, IUser } from '../models/User';
import { WakeUpEntry } from '../models/WakeUpEntry';
import { ANSWER_WINDOW_MS } from '../utils/challenge';
import { displayTime, formatTimeInTimezone, resolveTimezone, todayInTimezone } from '../utils/time';
import { bold, escapeHtml, TELEGRAM_HTML } from '../utils/telegram';

interface ParticipantState {
  telegramId: number;
  firstName: string;
  timezone: string;
  targetWakeTime: string;
  reportDate: string;
}

interface WakeResult {
  telegramId: number;
  firstName: string;
  timezone: string;
  wakeUpTime: Date;
}

export function startDailyReportJob(bot: Telegraf) {
  return cron.schedule('* * * * *', async () => {
    const now = new Date();
    const users = await User.find({ isActive: true })
      .select('telegramId firstName timezone targetWakeTime')
      .lean<IUser[]>();

    if (users.length === 0) {
      return;
    }

    const activePendingTelegramIds = new Set(
      (
        await PendingChallenge.find({
          answered: false,
          expiresAt: { $gt: now },
          telegramId: { $in: users.map((user) => user.telegramId) },
        })
          .select('telegramId')
          .lean()
      ).map((challenge) => challenge.telegramId)
    );

    const participantStates = users.map((user) => buildParticipantState(user, now));
    const everyoneFinished = participantStates.every((state) => {
      if (activePendingTelegramIds.has(state.telegramId)) {
        return false;
      }

      return hasWakeWindowPassed(now, state.targetWakeTime, state.timezone);
    });

    if (!everyoneFinished) {
      return;
    }

    const reportKey = participantStates
      .map((state) => `${state.telegramId}:${state.reportDate}`)
      .sort()
      .join('|');

    const claimedReport = await DailyReport.updateOne(
      { reportKey },
      {
        $setOnInsert: {
          reportKey,
          participantCount: participantStates.length,
          sentAt: now,
        },
      },
      { upsert: true }
    );

    if (claimedReport.upsertedCount === 0) {
      return;
    }

    const wakeEntries = await loadWakeEntries(participantStates);
    const wakeResults = participantStates
      .map<WakeResult | null>((state) => {
        const entry = wakeEntries.get(buildEntryKey(state.telegramId, state.reportDate));
        if (!entry) {
          return null;
        }

        return {
          telegramId: state.telegramId,
          firstName: state.firstName,
          timezone: state.timezone,
          wakeUpTime: entry.wakeUpTime,
        };
      })
      .filter((result): result is WakeResult => result !== null)
      .sort((left, right) => left.wakeUpTime.getTime() - right.wakeUpTime.getTime());

    const sleepingResults = participantStates
      .filter((state) => !wakeEntries.has(buildEntryKey(state.telegramId, state.reportDate)))
      .sort((left, right) => left.firstName.localeCompare(right.firstName, 'ru'));

    await Promise.allSettled(
      users.map(async (recipient) => {
        const text = buildReportMessage({
          wakeResults,
          sleepingResults,
          viewerTimezone: recipient.timezone,
        });

        await bot.telegram.sendMessage(recipient.telegramId, text, {
          parse_mode: TELEGRAM_HTML,
        });
      })
    );
  });
}

function buildParticipantState(user: Pick<IUser, 'telegramId' | 'firstName' | 'timezone' | 'targetWakeTime'>, now: Date): ParticipantState {
  const timezone = resolveTimezone(user.timezone);
  const currentMinutes = parseTimeToMinutes(formatTimeInTimezone(now, timezone));
  const targetMinutes = parseTimeToMinutes(user.targetWakeTime);
  const deadlineMinutes = targetMinutes + Math.floor(ANSWER_WINDOW_MS / 60000);
  const deadlineOverflowsToNextDay = deadlineMinutes >= MINUTES_IN_DAY;
  const afterMidnightOverflowWindow = deadlineOverflowsToNextDay && currentMinutes < targetMinutes;

  const reportDate = afterMidnightOverflowWindow
    ? todayInTimezone(new Date(now.getTime() - 24 * 60 * 60 * 1000), timezone)
    : todayInTimezone(now, timezone);

  return {
    telegramId: user.telegramId,
    firstName: user.firstName,
    timezone,
    targetWakeTime: user.targetWakeTime,
    reportDate,
  };
}

async function loadWakeEntries(participantStates: ParticipantState[]) {
  const filters = participantStates.map((state) => ({
    telegramId: state.telegramId,
    date: state.reportDate,
    verified: true,
  }));

  const entries = filters.length
    ? await WakeUpEntry.find({ $or: filters })
        .select('telegramId date wakeUpTime')
        .lean()
    : [];

  return new Map(entries.map((entry) => [buildEntryKey(entry.telegramId, entry.date), entry]));
}

function hasWakeWindowPassed(now: Date, targetWakeTime: string, timezone: string): boolean {
  const currentMinutes = parseTimeToMinutes(formatTimeInTimezone(now, timezone));
  const targetMinutes = parseTimeToMinutes(targetWakeTime);
  const deadlineMinutes = targetMinutes + Math.floor(ANSWER_WINDOW_MS / 60000);

  if (deadlineMinutes < MINUTES_IN_DAY) {
    return currentMinutes >= deadlineMinutes;
  }

  if (currentMinutes >= targetMinutes) {
    return false;
  }

  return currentMinutes >= deadlineMinutes - MINUTES_IN_DAY;
}

function buildReportMessage(params: {
  wakeResults: WakeResult[];
  sleepingResults: ParticipantState[];
  viewerTimezone?: string | null;
}): string {
  const { wakeResults, sleepingResults, viewerTimezone } = params;
  const timezone = resolveTimezone(viewerTimezone);

  const lines: string[] = [
    `📋 ${bold('Итоги сегодняшнего дня')}`,
    '',
    `✅ Проснулись: ${bold(String(wakeResults.length))}`,
    `😴 Остались спать: ${bold(String(sleepingResults.length))}`,
  ];

  if (wakeResults.length > 0) {
    lines.push('', '<b>Проснулись:</b>');
    lines.push(
      ...wakeResults.map((result, index) => (
        `${index + 1}. ${escapeHtml(result.firstName)} — ${bold(displayTime(result.wakeUpTime, timezone))}`
      ))
    );
  }

  if (sleepingResults.length > 0) {
    lines.push('', '<b>Остались спать:</b>');
    lines.push(...sleepingResults.map((result) => `• ${escapeHtml(result.firstName)}`));
  }

  return lines.join('\n');
}

function parseTimeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function buildEntryKey(telegramId: number, date: string): string {
  return `${telegramId}:${date}`;
}

const MINUTES_IN_DAY = 24 * 60;