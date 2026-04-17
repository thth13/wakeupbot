import { Schema, model, Document } from 'mongoose';

export interface IUser extends Document {
  telegramId: number;
  username?: string;
  firstName: string;
  inviteCode: string;
  invitedByTelegramId?: number;
  targetWakeTime: string; // "HH:MM" in configured app timezone
  isActive: boolean;
  levelDays: number;
  preWakeReminderDate?: string; // "YYYY-MM-DD" last date pre-wake reminder was sent
  challengeDispatchLockUntil?: Date;
  createdAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    telegramId: { type: Number, required: true, unique: true, index: true },
    username: { type: String },
    firstName: { type: String, required: true },
    inviteCode: { type: String, required: true, unique: true, index: true },
    invitedByTelegramId: { type: Number },
    targetWakeTime: { type: String, required: true }, // e.g. "05:30"
    isActive: { type: Boolean, default: true },
    levelDays: { type: Number, default: 0 },
    preWakeReminderDate: { type: String },
    challengeDispatchLockUntil: { type: Date },
  },
  { timestamps: true }
);

export const User = model<IUser>('User', UserSchema);
