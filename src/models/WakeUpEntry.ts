import { Schema, model, Document, Types } from 'mongoose';

export interface IWakeUpEntry extends Document {
  userId: Types.ObjectId;
  telegramId: number;
  username?: string;
  firstName: string;
  date: string; // "YYYY-MM-DD"
  wakeUpTime: Date;
  verified: boolean;
  createdAt: Date;
}

const WakeUpEntrySchema = new Schema<IWakeUpEntry>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    telegramId: { type: Number, required: true },
    username: { type: String },
    firstName: { type: String, required: true },
    date: { type: String, required: true, index: true }, // "YYYY-MM-DD"
    wakeUpTime: { type: Date, required: true },
    verified: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// One entry per user per day
WakeUpEntrySchema.index({ telegramId: 1, date: 1 }, { unique: true });

export const WakeUpEntry = model<IWakeUpEntry>('WakeUpEntry', WakeUpEntrySchema);
