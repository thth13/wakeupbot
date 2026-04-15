import { config } from "dotenv";
import { Markup, Telegraf } from "telegraf";
import {
  Challenge,
  ChatState,
  MongoStorage,
  OverallWakeStats,
  PendingChallenge,
  WakeStats
} from "./storage";

config();

const token = process.env.BOT_TOKEN;
const mongoUri = process.env.MONGODB_URI;
const mongoDbName = process.env.MONGODB_DB_NAME ?? "wakeupbot";
const schedulerIntervalMs = 30_000;
const statsButtonText = "My stats";
const overallStatsButtonText = "Overall stats";
const wakeupSlots = [
  {
    key: "morning",
    hour: 6,
    minute: 0,
    label: "06:00"
  },
  {
    key: "check",
    hour: 6,
    minute: 30,
    label: "06:30"
  }
] as const;

if (!token) {
  throw new Error("BOT_TOKEN is required in the environment");
}

if (!mongoUri) {
  throw new Error("MONGODB_URI is required in the environment");
}

const bot = new Telegraf(token);
const storage = new MongoStorage(mongoUri, mongoDbName);
const mainKeyboard = Markup.keyboard([[statsButtonText, overallStatsButtonText]]).resize();

const getDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const formatTime = (date: Date): string => {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${hours}:${minutes}`;
};

const formatMinutesAsTime = (totalMinutes: number): string => {
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const minutes = String(totalMinutes % 60).padStart(2, "0");

  return `${hours}:${minutes}`;
};

const chunk = <T>(items: T[], size: number): T[][] => {
  const result: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }

  return result;
};

const formatStatsMessage = (stats: WakeStats): string => {
  const streakSquares = stats.streakDays.map((day) => (day.status === "success" ? "🟩" : "🟥"));
  const lines = [
    "Your wake-up stats.",
    `Wake days: ${stats.totalWakeDays}`,
    `Fully confirmed days: ${stats.fullyConfirmedDays}`,
    `Current streak: ${stats.currentStreak}`,
    `Average wake-up time: ${
      stats.averageWakeUpMinutes !== undefined
        ? formatMinutesAsTime(stats.averageWakeUpMinutes)
        : "not enough data"
    }`,
    `First recorded day: ${stats.firstWakeDate ?? "not enough data"}`,
    `Last recorded day: ${stats.lastWakeDate ?? "not enough data"}`
  ];

  if (stats.streakDays.length > 0) {
    lines.push("Last 21 days: old to new");

    for (const row of chunk(streakSquares, 7)) {
      lines.push(row.join(""));
    }
  }

  if (stats.recentWakeDays.length > 0) {
    lines.push("Recent days:");

    for (const wakeDay of stats.recentWakeDays) {
      const kinds = new Set(wakeDay.wakeEvents.map((event) => event.kind));
      const wakeTime = wakeDay.wokeUpAt ? formatTime(wakeDay.wokeUpAt) : "--:--";
      const status = kinds.has("morning") && kinds.has("check") ? "full" : "partial";

      lines.push(`${wakeDay.wakeDate}: ${wakeTime} (${status})`);
    }
  }

  return lines.join("\n");
};

const formatOverallStatsMessage = (stats: OverallWakeStats): string => {
  const lines = ["Overall stats.", `Users: ${stats.totalUsers}`];

  if (stats.users.length > 0) {
    lines.push("Users list:");

    for (const user of stats.users) {
      const squares = user.recentDays.map((day) => (day.status === "success" ? "🟩" : "🟥")).join("");

      lines.push(`${user.displayName}: ${squares || "no data"}`);
    }
  }

  return lines.join("\n");
};

const shuffleNumbers = (numbers: number[]): number[] => {
  const result = [...numbers];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const currentValue = result[index];

    result[index] = result[swapIndex];
    result[swapIndex] = currentValue;
  }

  return result;
};

const createAnswerOptions = (correctAnswer: number): number[] => {
  const options = new Set<number>([correctAnswer]);

  while (options.size < 4) {
    const delta = Math.floor(Math.random() * 140) + 10;
    const direction = Math.random() < 0.5 ? -1 : 1;
    const candidate = correctAnswer + delta * direction;

    if (candidate > 0) {
      options.add(candidate);
    }
  }

  return shuffleNumbers([...options]);
};

const sendStats = async (chatId: number, reply: (message: string) => Promise<unknown>): Promise<void> => {
  const chatState = await storage.getChat(chatId);

  if (!chatState) {
    await reply("This chat is not subscribed yet. Use /start.");
    return;
  }

  const stats = await storage.getWakeStats(chatId);
  await reply(formatStatsMessage(stats));
};

const sendOverallStats = async (chatId: number, reply: (message: string) => Promise<unknown>): Promise<void> => {
  const chatState = await storage.getChat(chatId);

  if (!chatState) {
    await reply("This chat is not subscribed yet. Use /start.");
    return;
  }

  const stats = await storage.getOverallWakeStats();
  await reply(formatOverallStatsMessage(stats));
};

const createChallenge = (): Challenge => {
  const firstNumber = Math.floor(Math.random() * 900) + 100;
  const secondNumber = Math.floor(Math.random() * 900) + 100;
  const answer = firstNumber + secondNumber;

  return {
    expression: `${firstNumber} + ${secondNumber}`,
    answer,
    options: createAnswerOptions(answer)
  };
};

const sendChallengeToChat = async (
  chatState: ChatState,
  kind: PendingChallenge["kind"],
  label: string,
  now: Date
): Promise<void> => {
  const challenge = createChallenge();
  const challengeId = `${kind}-${now.toISOString()}`;

  await bot.telegram.sendMessage(
    chatState.chatId,
    [
      `${label} wake-up check.`,
      `Solve: ${challenge.expression}`,
      "Choose the correct answer:"
    ].join("\n"),
    Markup.inlineKeyboard(
      challenge.options.map((option) => [
        Markup.button.callback(String(option), `answer:${challengeId}:${option}`)
      ])
    )
  );

  await storage.setPendingChallenge(chatState.chatId, kind, challenge, challengeId, now);
};

const runSchedulerTick = async (): Promise<void> => {
  const now = new Date();
  const currentTime = formatTime(now);
  const currentDate = getDateKey(now);

  for (const slot of wakeupSlots) {
    if (currentTime !== slot.label) {
      continue;
    }

    if (await storage.wasSlotDispatched(slot.key, currentDate)) {
      continue;
    }

    const chats = await storage.listChats();

    for (const chatState of chats) {
      try {
        await sendChallengeToChat(chatState, slot.key, slot.label, now);
      } catch (error) {
        console.error(`Failed to send ${slot.key} challenge to chat ${chatState.chatId}`, error);
      }
    }

    await storage.markSlotDispatched(slot.key, currentDate, now);
  }
};

const startScheduler = (): void => {
  void runSchedulerTick();
  setInterval(() => {
    void runSchedulerTick();
  }, schedulerIntervalMs);
};

bot.start(async (context) => {
  const firstName = context.from?.first_name ?? "there";

  await storage.upsertChat(context.chat.id, {
    firstName: context.from?.first_name,
    username: context.from?.username,
    userId: context.from?.id
  });

  await context.reply(
    [
      `Hello, ${firstName}.`,
      "Wakeupbot is online.",
      "Every day at 06:00 and 06:30 I will send a math task.",
      "Each task is a quiz with answer options.",
      "Use /stop if you want to unsubscribe.",
      `Tap \"${statsButtonText}\" to see your stats.`,
      `Tap \"${overallStatsButtonText}\" to see all users.`
    ].join("\n"),
    mainKeyboard
  );
});

bot.command("stop", async (context) => {
  const wasRemoved = await storage.removeChat(context.chat.id);

  await context.reply(
    wasRemoved
      ? "You are unsubscribed. Daily wake-up checks are disabled for this chat."
      : "This chat is not subscribed yet. Use /start first.",
    wasRemoved ? Markup.removeKeyboard() : mainKeyboard
  );
});

bot.command("status", async (context) => {
  const chatState = await storage.getChat(context.chat.id);

  if (!chatState) {
    await context.reply("This chat is not subscribed yet. Use /start.");
    return;
  }

  await context.reply(
    [
      "Wake-up checks are enabled.",
      `Active tasks: ${chatState.pendingChallenges.length}`,
      "Schedule: 06:00 and 06:30 server local time."
    ].join("\n"),
    mainKeyboard
  );
});

bot.command("stats", async (context) => {
  await sendStats(context.chat.id, async (message) => context.reply(message, mainKeyboard));
});

bot.command("overall", async (context) => {
  await sendOverallStats(context.chat.id, async (message) => context.reply(message, mainKeyboard));
});

bot.hears(statsButtonText, async (context) => {
  await sendStats(context.chat.id, async (message) => context.reply(message, mainKeyboard));
});

bot.hears(overallStatsButtonText, async (context) => {
  await sendOverallStats(context.chat.id, async (message) => context.reply(message, mainKeyboard));
});

bot.action(/^answer:([^:]+):(-?\d+)$/, async (context) => {
  const [, challengeId, selectedAnswerRaw] = context.match;
  const selectedAnswer = Number.parseInt(selectedAnswerRaw, 10);
  const chatId = context.callbackQuery.message?.chat.id;

  await context.answerCbQuery();

  if (!Number.isInteger(selectedAnswer) || chatId === undefined) {
    return;
  }

  const chatState = await storage.upsertChat(chatId, {
    firstName: context.from?.first_name,
    username: context.from?.username,
    userId: context.from?.id
  });
  const solvedAt = new Date();
  const matchingChallenge = await storage.findChallengeById(chatId, challengeId, solvedAt);

  if (!matchingChallenge) {
    await context.reply("This task is no longer active.");
    return;
  }

  if (selectedAnswer !== matchingChallenge.answer) {
    await context.reply("Wrong answer. Try another option.");
    return;
  }

  await storage.clearChallenge(chatId, matchingChallenge.id, solvedAt);
  await storage.recordWakeSuccess(chatState, matchingChallenge, solvedAt);

  await context.editMessageReplyMarkup(undefined);
  await context.reply(
    matchingChallenge.kind === "morning"
      ? "Correct. First wake-up check passed."
      : "Correct. Second wake-up check passed."
  );
});

bot.on("text", async (context) => {
  const text = context.message.text.trim();

  if (text.startsWith("/")) {
    return;
  }

  const chatState = await storage.getChat(context.chat.id);
  const hasPendingChallenges = (chatState?.pendingChallenges.length ?? 0) > 0;

  if (hasPendingChallenges) {
    await context.reply("Choose one of the answer buttons under the task.");
  }
});

const launch = async (): Promise<void> => {
  await storage.connect();

  await bot.telegram.setMyCommands([
    {
      command: "start",
      description: "Enable daily wake-up tasks"
    },
    {
      command: "status",
      description: "Show wake-up check status"
    },
    {
      command: "stats",
      description: "Show wake-up statistics"
    },
    {
      command: "overall",
      description: "Show overall users statistics"
    },
    {
      command: "stop",
      description: "Disable daily wake-up tasks"
    }
  ]);

  await bot.launch();
  startScheduler();

  console.log("Wakeupbot is running");
};

void launch();

const shutdown = async (signal: "SIGINT" | "SIGTERM"): Promise<void> => {
  bot.stop(signal);
  await storage.close();
};

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});