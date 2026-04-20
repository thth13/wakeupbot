import { Schema, model, Document } from 'mongoose';

export interface IDailyReport extends Document {
  reportKey: string;
  participantCount: number;
  sentAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DailyReportSchema = new Schema<IDailyReport>(
  {
    reportKey: { type: String, required: true, unique: true, index: true },
    participantCount: { type: Number, required: true },
    sentAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true }
);

export const DailyReport = model<IDailyReport>('DailyReport', DailyReportSchema);