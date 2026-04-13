import { config } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Telegraf } from "telegraf";

config();

interface PendingChallenge {
  id: string;
  kind: "morning" | "check";
  expression: string;
  answer: number;
  sentAt: string;
}

interface ChatState {
  chatId: number;
  firstName?: string;
  username?: string;
  userId?: number;
  registeredAt: string;
  lastInteractionAt: string;
  pendingChallenges: PendingChallenge[];
}

interface BotState {
  chats: Record<string, ChatState>;
  lastDispatchBySlot: Record<string, string>;
}

interface Challenge {
  expression: string;
  answer: number;
}

const token = process.env.BOT_TOKEN;
const stateFilePath = path.join(process.cwd(), "data", "bot-state.json");
const schedulerIntervalMs = 30_000;
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

let botState: BotState = {
  chats: {},
  lastDispatchBySlot: {}
};

if (!token) {
  throw new Error("BOT_TOKEN is required in the environment");
}

const bot = new Telegraf(token);

const createDefaultState = (): BotState => ({
  chats: {},
  lastDispatchBySlot: {}
});

const ensureStateDirectory = async (): Promise<void> => {
  await mkdir(path.dirname(stateFilePath), { recursive: true });
};

const saveState = async (): Promise<void> => {
  await ensureStateDirectory();
  await writeFile(stateFilePath, JSON.stringify(botState, null, 2));
};

const loadState = async (): Promise<void> => {
  try {
    const rawState = await readFile(stateFilePath, "utf8");
    const parsedState = JSON.parse(rawState) as Partial<BotState>;

    botState = {
      chats: parsedState.chats ?? {},
      lastDispatchBySlot: parsedState.lastDispatchBySlot ?? {}
    };
  } catch (error) {
    const isMissingFile =
      error instanceof Error && "code" in error && error.code === "ENOENT";

    if (!isMissingFile) {
      throw error;
    }

    botState = createDefaultState();
    await saveState();
  }
};

const toChatKey = (chatId: number): string => String(chatId);

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

const pruneStaleChallenges = (challenges: PendingChallenge[], now: Date): PendingChallenge[] => {
  const maxAgeMs = 24 * 60 * 60 * 1000;

  return challenges.filter((challenge) => {
    const sentAt = Date.parse(challenge.sentAt);

    if (Number.isNaN(sentAt)) {
      return false;
    }

    return now.getTime() - sentAt <= maxAgeMs;
  });
};

const createChallenge = (): Challenge => {
  const firstNumber = Math.floor(Math.random() * 900) + 100;
  const secondNumber = Math.floor(Math.random() * 900) + 100;

  return {
    expression: `${firstNumber} + ${secondNumber}`,
    answer: firstNumber + secondNumber
  };
};

const upsertChat = async (
  chatId: number,
  details: {
    firstName?: string;
    username?: string;
    userId?: number;
  }
): Promise<void> => {
  const nowIso = new Date().toISOString();
  const chatKey = toChatKey(chatId);
  const existingChat = botState.chats[chatKey];

  botState.chats[chatKey] = {
    chatId,
    firstName: details.firstName ?? existingChat?.firstName,
    username: details.username ?? existingChat?.username,
    userId: details.userId ?? existingChat?.userId,
    registeredAt: existingChat?.registeredAt ?? nowIso,
    lastInteractionAt: nowIso,
    pendingChallenges: pruneStaleChallenges(existingChat?.pendingChallenges ?? [], new Date())
  };

  await saveState();
};

const removeChat = async (chatId: number): Promise<boolean> => {
  const chatKey = toChatKey(chatId);

  if (!botState.chats[chatKey]) {
    return false;
  }

  delete botState.chats[chatKey];
  await saveState();

  return true;
};

const setPendingChallenge = async (
  chatId: number,
  kind: PendingChallenge["kind"],
  challenge: Challenge,
  sentAt: Date
): Promise<void> => {
  const chatKey = toChatKey(chatId);
  const existingChat = botState.chats[chatKey];

  if (!existingChat) {
    return;
  }

  existingChat.pendingChallenges = [
    ...pruneStaleChallenges(existingChat.pendingChallenges, sentAt).filter(
      (pendingChallenge) => pendingChallenge.kind !== kind
    ),
    {
      id: `${kind}-${sentAt.toISOString()}`,
      kind,
      expression: challenge.expression,
      answer: challenge.answer,
      sentAt: sentAt.toISOString()
    }
  ];
  existingChat.lastInteractionAt = sentAt.toISOString();

  await saveState();
};

const findMatchingChallenge = (
  chatId: number,
  answer: number,
  now: Date
): PendingChallenge | undefined => {
  const chatState = botState.chats[toChatKey(chatId)];

  if (!chatState) {
    return undefined;
  }

  chatState.pendingChallenges = pruneStaleChallenges(chatState.pendingChallenges, now);

  return [...chatState.pendingChallenges]
    .sort((left, right) => Date.parse(right.sentAt) - Date.parse(left.sentAt))
    .find((challenge) => challenge.answer === answer);
};

const clearChallenge = async (chatId: number, challengeId: string): Promise<void> => {
  const chatState = botState.chats[toChatKey(chatId)];

  if (!chatState) {
    return;
  }

  chatState.pendingChallenges = chatState.pendingChallenges.filter(
    (challenge) => challenge.id !== challengeId
  );
  chatState.lastInteractionAt = new Date().toISOString();

  await saveState();
};

const sendChallengeToChat = async (
  chatState: ChatState,
  kind: PendingChallenge["kind"],
  label: string,
  now: Date
): Promise<void> => {
  const challenge = createChallenge();

  await bot.telegram.sendMessage(
    chatState.chatId,
    [
      `${label} wake-up check.`,
      `Solve: ${challenge.expression}`,
      "Send only the number as your answer."
    ].join("\n")
  );

  await setPendingChallenge(chatState.chatId, kind, challenge, now);
};

const runSchedulerTick = async (): Promise<void> => {
  const now = new Date();
  const currentTime = formatTime(now);
  const currentDate = getDateKey(now);

  for (const slot of wakeupSlots) {
    if (currentTime !== slot.label) {
      continue;
    }

    if (botState.lastDispatchBySlot[slot.key] === currentDate) {
      continue;
    }

    const chats = Object.values(botState.chats);

    for (const chatState of chats) {
      try {
        await sendChallengeToChat(chatState, slot.key, slot.label, now);
      } catch (error) {
        console.error(`Failed to send ${slot.key} challenge to chat ${chatState.chatId}`, error);
      }
    }

    botState.lastDispatchBySlot[slot.key] = currentDate;
    await saveState();
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

  await upsertChat(context.chat.id, {
    firstName: context.from?.first_name,
    username: context.from?.username,
    userId: context.from?.id
  });

  await context.reply(
    [
      `Hello, ${firstName}.`,
      "Wakeupbot is online.",
      "Every day at 06:00 and 06:30 I will send a math task.",
      "Reply with the sum as a number.",
      "Use /stop if you want to unsubscribe."
    ].join("\n")
  );
});

bot.command("stop", async (context) => {
  const wasRemoved = await removeChat(context.chat.id);

  await context.reply(
    wasRemoved
      ? "You are unsubscribed. Daily wake-up checks are disabled for this chat."
      : "This chat is not subscribed yet. Use /start first."
  );
});

bot.command("status", async (context) => {
  const chatState = botState.chats[toChatKey(context.chat.id)];

  if (!chatState) {
    await context.reply("This chat is not subscribed yet. Use /start.");
    return;
  }

  await context.reply(
    [
      "Wake-up checks are enabled.",
      `Active tasks: ${chatState.pendingChallenges.length}`,
      "Schedule: 06:00 and 06:30 server local time."
    ].join("\n")
  );
});

bot.on("text", async (context) => {
  const text = context.message.text.trim();

  if (text.startsWith("/")) {
    return;
  }

  const numericAnswer = Number.parseInt(text, 10);

  if (!Number.isInteger(numericAnswer) || String(numericAnswer) !== text) {
    return;
  }

  await upsertChat(context.chat.id, {
    firstName: context.from?.first_name,
    username: context.from?.username,
    userId: context.from?.id
  });

  const matchingChallenge = findMatchingChallenge(context.chat.id, numericAnswer, new Date());

  if (!matchingChallenge) {
    const chatState = botState.chats[toChatKey(context.chat.id)];
    const hasPendingChallenges = (chatState?.pendingChallenges.length ?? 0) > 0;

    if (hasPendingChallenges) {
      await context.reply("Wrong answer. Try again.");
    }

    return;
  }

  await clearChallenge(context.chat.id, matchingChallenge.id);

  await context.reply(
    matchingChallenge.kind === "morning"
      ? "Correct. First wake-up check passed."
      : "Correct. Second wake-up check passed."
  );
});

const launch = async (): Promise<void> => {
  await loadState();

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
      command: "stop",
      description: "Disable daily wake-up tasks"
    }
  ]);

  await bot.launch();
  startScheduler();

  console.log("Wakeupbot is running");
};

void launch();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));