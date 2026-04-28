import { Schema, model, Document } from 'mongoose';

export interface IUser extends Document {
  telegramId: number;
  username?: string;
  firstName: string;
  inviteCode: string;
  inviteCodes: string[];
  invitedByTelegramId?: number;
  invitedWithCode?: string;
  timezone: string;
  targetWakeTime: string; // "HH:MM" in configured app timezone
  isActive: boolean;
  missedChallengesCount: number;
  levelDays: number;
  score: number;
  droppedOutAt?: Date;
  preWakeReminderDate?: string; // "YYYY-MM-DD" last date pre-wake reminder was sent
  wakeConfirmedDate?: string; // "YYYY-MM-DD" date when user pressed the wake button
  wakeWindowClosedDate?: string; // "YYYY-MM-DD" date when wake window miss was recorded
  delayedChallengeAt?: Date; // UTC time when to fire the delayed puzzle
  challengeDispatchLockUntil?: Date;
  createdAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    telegramId: { type: Number, required: true, unique: true, index: true },
    username: { type: String },
    firstName: { type: String, required: true },
    inviteCode: { type: String, required: true, unique: true, index: true },
    inviteCodes: { type: [String], default: [] },
    invitedByTelegramId: { type: Number },
    invitedWithCode: { type: String, index: true },
    timezone: { type: String, required: true, default: 'Europe/Kiev' },
    targetWakeTime: { type: String, required: true }, // e.g. "05:30"
    isActive: { type: Boolean, default: true },
    missedChallengesCount: { type: Number, default: 0 },
    levelDays: { type: Number, default: 0 },
    score: { type: Number, default: 0 },
    droppedOutAt: { type: Date },
    preWakeReminderDate: { type: String },
    wakeConfirmedDate: { type: String },
    wakeWindowClosedDate: { type: String },
    delayedChallengeAt: { type: Date },
    challengeDispatchLockUntil: { type: Date },
  },
  { timestamps: true }
);

export const User = model<IUser>('User', UserSchema);
