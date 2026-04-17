import { Schema, model, Document } from 'mongoose';

export interface IPendingChallenge extends Document {
  telegramId: number;
  chatId: number;
  messageId?: number;
  question: string;
  correctAnswer: number;
  options: number[];
  expiresAt: Date;
  answered: boolean;
}

const PendingChallengeSchema = new Schema<IPendingChallenge>({
  telegramId: { type: Number, required: true, unique: true, index: true },
  chatId: { type: Number, required: true },
  messageId: { type: Number },
  question: { type: String, required: true },
  correctAnswer: { type: Number, required: true },
  options: [{ type: Number }],
  expiresAt: { type: Date, required: true, index: true },
  answered: { type: Boolean, default: false },
});

export const PendingChallenge = model<IPendingChallenge>('PendingChallenge', PendingChallengeSchema);
