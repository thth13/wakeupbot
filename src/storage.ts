import { Collection, Db, MongoClient } from "mongodb";

export interface Challenge {
  expression: string;
  answer: number;
  options: number[];
}

export interface PendingChallenge {
  id: string;
  kind: "morning" | "check";
  expression: string;
  answer: number;
  options: number[];
  sentAt: Date;
}

export interface ChatProfile {
  firstName?: string;
  username?: string;
  userId?: number;
}

export interface ChatState extends ChatProfile {
  _id: string;
  chatId: number;
  registeredAt: Date;
  lastInteractionAt: Date;
  pendingChallenges: PendingChallenge[];
}

export interface WakeEvent {
  kind: PendingChallenge["kind"];
  challengeId: string;
  challengeSentAt: Date;
  solvedAt: Date;
}

export interface WakeDayRecord extends ChatProfile {
  _id: string;
  chatId: number;
  wakeDate: string;
  wokeUpAt?: Date;
  fellAsleepAt?: Date;
  wakeEvents: WakeEvent[];
  createdAt: Date;
  updatedAt: Date;
}

export interface StreakDay {
  date: string;
  status: "success" | "missed";
}

export interface WakeStats {
  totalWakeDays: number;
  fullyConfirmedDays: number;
  firstWakeDate?: string;
  lastWakeDate?: string;
  averageWakeUpMinutes?: number;
  currentStreak: number;
  streakDays: StreakDay[];
  recentWakeDays: WakeDayRecord[];
}

interface SchedulerState {
  _id: string;
  lastDispatchDate?: string;
  updatedAt: Date;
}

const staleChallengeMaxAgeMs = 24 * 60 * 60 * 1000;

const getDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const parseDateKey = (dateKey: string): Date => {
  const [yearRaw, monthRaw, dayRaw] = dateKey.split("-");
  const year = Number.parseInt(yearRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  const day = Number.parseInt(dayRaw, 10);

  return new Date(year, month - 1, day);
};

const shiftDateKey = (dateKey: string, deltaDays: number): string => {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + deltaDays);

  return getDateKey(date);
};

const maxDateKey = (left: string, right: string): string => {
  return left > right ? left : right;
};

const pruneStaleChallenges = (challenges: PendingChallenge[], now: Date): PendingChallenge[] => {
  return challenges.filter((challenge) => {
    const sentAtTime = challenge.sentAt.getTime();

    if (Number.isNaN(sentAtTime)) {
      return false;
    }

    return now.getTime() - sentAtTime <= staleChallengeMaxAgeMs;
  });
};

const buildProfileFields = (profile: ChatProfile): ChatProfile => {
  const result: ChatProfile = {};

  if (profile.firstName !== undefined) {
    result.firstName = profile.firstName;
  }

  if (profile.username !== undefined) {
    result.username = profile.username;
  }

  if (profile.userId !== undefined) {
    result.userId = profile.userId;
  }

  return result;
};

const buildChatState = (
  chatId: number,
  now: Date,
  pendingChallenges: PendingChallenge[],
  profile: ChatProfile,
  registeredAt: Date
): ChatState => ({
  _id: String(chatId),
  chatId,
  ...buildProfileFields(profile),
  registeredAt,
  lastInteractionAt: now,
  pendingChallenges
});

export class MongoStorage {
  private readonly client: MongoClient;
  private readonly db: Db;
  private readonly chats: Collection<ChatState>;
  private readonly schedulerState: Collection<SchedulerState>;
  private readonly wakeDays: Collection<WakeDayRecord>;

  public constructor(uri: string, dbName: string) {
    this.client = new MongoClient(uri);
    this.db = this.client.db(dbName);
    this.chats = this.db.collection<ChatState>("chat_subscriptions");
    this.schedulerState = this.db.collection<SchedulerState>("scheduler_state");
    this.wakeDays = this.db.collection<WakeDayRecord>("wake_days");
  }

  public async connect(): Promise<void> {
    await this.client.connect();

    await Promise.all([
      this.chats.createIndex({ chatId: 1 }, { unique: true }),
      this.wakeDays.createIndex({ chatId: 1, wakeDate: -1 }),
      this.wakeDays.createIndex({ userId: 1, wakeDate: -1 }, { sparse: true })
    ]);
  }

  public async close(): Promise<void> {
    await this.client.close();
  }

  public async upsertChat(chatId: number, profile: ChatProfile): Promise<ChatState> {
    const now = new Date();
    const chatKey = String(chatId);
    const existingChat = await this.chats.findOne({ _id: chatKey });
    const nextProfile: ChatProfile = {
      firstName: profile.firstName ?? existingChat?.firstName,
      username: profile.username ?? existingChat?.username,
      userId: profile.userId ?? existingChat?.userId
    };
    const nextChat = buildChatState(
      chatId,
      now,
      pruneStaleChallenges(existingChat?.pendingChallenges ?? [], now),
      nextProfile,
      existingChat?.registeredAt ?? now
    );

    await this.chats.replaceOne({ _id: chatKey }, nextChat, { upsert: true });

    return nextChat;
  }

  public async getChat(chatId: number): Promise<ChatState | null> {
    return this.chats.findOne({ _id: String(chatId) });
  }

  public async listChats(): Promise<ChatState[]> {
    return this.chats.find({}).toArray();
  }

  public async removeChat(chatId: number): Promise<boolean> {
    const result = await this.chats.deleteOne({ _id: String(chatId) });

    return result.deletedCount === 1;
  }

  public async setPendingChallenge(
    chatId: number,
    kind: PendingChallenge["kind"],
    challenge: Challenge,
    challengeId: string,
    sentAt: Date
  ): Promise<void> {
    const chatKey = String(chatId);
    const existingChat = await this.chats.findOne({ _id: chatKey });

    if (!existingChat) {
      return;
    }

    const nextChat: ChatState = {
      ...existingChat,
      lastInteractionAt: sentAt,
      pendingChallenges: [
        ...pruneStaleChallenges(existingChat.pendingChallenges, sentAt).filter(
          (pendingChallenge) => pendingChallenge.kind !== kind
        ),
        {
          id: challengeId,
          kind,
          expression: challenge.expression,
          answer: challenge.answer,
          options: challenge.options,
          sentAt
        }
      ]
    };

    await this.chats.replaceOne({ _id: chatKey }, nextChat);
  }

  public async findChallengeById(
    chatId: number,
    challengeId: string,
    now: Date
  ): Promise<PendingChallenge | undefined> {
    const chatKey = String(chatId);
    const existingChat = await this.chats.findOne({ _id: chatKey });

    if (!existingChat) {
      return undefined;
    }

    const pendingChallenges = pruneStaleChallenges(existingChat.pendingChallenges, now);

    if (pendingChallenges.length !== existingChat.pendingChallenges.length) {
      await this.chats.updateOne(
        { _id: chatKey },
        {
          $set: {
            pendingChallenges,
            lastInteractionAt: now
          }
        }
      );
    }

    return pendingChallenges.find((challenge) => challenge.id === challengeId);
  }

  public async clearChallenge(chatId: number, challengeId: string, clearedAt: Date): Promise<void> {
    const chatKey = String(chatId);
    const existingChat = await this.chats.findOne({ _id: chatKey });

    if (!existingChat) {
      return;
    }

    const nextChat: ChatState = {
      ...existingChat,
      lastInteractionAt: clearedAt,
      pendingChallenges: existingChat.pendingChallenges.filter(
        (challenge) => challenge.id !== challengeId
      )
    };

    await this.chats.replaceOne({ _id: chatKey }, nextChat);
  }

  public async wasSlotDispatched(slotKey: string, dateKey: string): Promise<boolean> {
    const state = await this.schedulerState.findOne({ _id: slotKey });

    return state?.lastDispatchDate === dateKey;
  }

  public async markSlotDispatched(slotKey: string, dateKey: string, updatedAt: Date): Promise<void> {
    await this.schedulerState.updateOne(
      { _id: slotKey },
      {
        $set: {
          lastDispatchDate: dateKey,
          updatedAt
        }
      },
      { upsert: true }
    );
  }

  public async recordWakeSuccess(
    chat: ChatProfile & { chatId: number },
    challenge: PendingChallenge,
    solvedAt: Date
  ): Promise<void> {
    const wakeDate = getDateKey(solvedAt);
    const dayId = `${chat.chatId}:${wakeDate}`;
    const existingDay = await this.wakeDays.findOne({ _id: dayId }, { projection: { wokeUpAt: 1 } });

    await this.wakeDays.updateOne(
      { _id: dayId },
      {
        $set: {
          chatId: chat.chatId,
          wakeDate,
          ...buildProfileFields(chat),
          wokeUpAt: existingDay?.wokeUpAt ?? solvedAt,
          updatedAt: solvedAt
        },
        $setOnInsert: {
          createdAt: solvedAt,
          wakeEvents: []
        },
        $push: {
          wakeEvents: {
            kind: challenge.kind,
            challengeId: challenge.id,
            challengeSentAt: challenge.sentAt,
            solvedAt
          }
        }
      },
      { upsert: true }
    );
  }

  public async getWakeStats(chatId: number, recentLimit = 7, streakWindowDays = 21): Promise<WakeStats> {
    const chat = await this.chats.findOne({ _id: String(chatId) }, { projection: { registeredAt: 1 } });
    const wakeDays = await this.wakeDays
      .find({ chatId, wokeUpAt: { $exists: true } })
      .sort({ wakeDate: -1 })
      .toArray();
    const wakeDateSet = new Set(wakeDays.map((wakeDay) => wakeDay.wakeDate));
    const todayKey = getDateKey(new Date());
    const yesterdayKey = shiftDateKey(todayKey, -1);
    const earliestWindowDate = shiftDateKey(todayKey, -(streakWindowDays - 1));
    const registrationDate = chat?.registeredAt ? getDateKey(chat.registeredAt) : todayKey;
    const streakStartDate = maxDateKey(earliestWindowDate, registrationDate);
    const streakAnchor = wakeDateSet.has(todayKey)
      ? todayKey
      : wakeDateSet.has(yesterdayKey)
        ? yesterdayKey
        : undefined;
    let currentStreak = 0;

    if (streakAnchor) {
      let cursorDate = streakAnchor;

      while (wakeDateSet.has(cursorDate)) {
        currentStreak += 1;
        cursorDate = shiftDateKey(cursorDate, -1);
      }
    }

    const streakDays = [];
    let streakCursorDate = streakStartDate;

    while (streakCursorDate <= todayKey) {
      streakDays.push({
        date: streakCursorDate,
        status: wakeDateSet.has(streakCursorDate) ? "success" : "missed"
      });

      streakCursorDate = shiftDateKey(streakCursorDate, 1);
    }

    const fullyConfirmedDays = wakeDays.filter((wakeDay) => {
      const kinds = new Set(wakeDay.wakeEvents.map((event) => event.kind));

      return kinds.has("morning") && kinds.has("check");
    }).length;

    const wakeMinutes = wakeDays
      .map((wakeDay) => wakeDay.wokeUpAt)
      .filter((wokeUpAt): wokeUpAt is Date => wokeUpAt instanceof Date)
      .map((wokeUpAt) => wokeUpAt.getHours() * 60 + wokeUpAt.getMinutes());

    const averageWakeUpMinutes =
      wakeMinutes.length > 0
        ? Math.round(wakeMinutes.reduce((sum, minutes) => sum + minutes, 0) / wakeMinutes.length)
        : undefined;

    return {
      totalWakeDays: wakeDays.length,
      fullyConfirmedDays,
      firstWakeDate: wakeDays.at(-1)?.wakeDate,
      lastWakeDate: wakeDays[0]?.wakeDate,
      averageWakeUpMinutes: averageWakeUpMinutes,
      currentStreak,
      streakDays,
      recentWakeDays: wakeDays.slice(0, recentLimit)
    };
  }
}