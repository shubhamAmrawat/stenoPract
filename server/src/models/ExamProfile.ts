import { Schema, model, type InferSchemaType } from 'mongoose';

/** Exam settings (dictation speed, timer, length, comma rule). Editable by admins: check them against the latest SSC notice. */
const examProfileSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true }, // SSC_C, SSC_D, COMMON
    name: { type: String, required: true },
    wpm: { type: Number, required: true },
    durationMin: { type: Number, required: true },
    words: { type: Number, required: true },
    /** Legacy: pass/fail limits are no longer used (attempts show raw statistics). Kept so older data and the admin API stay compatible. */
    limits: {
      general: Number,
      reserved: Number,
    },
    rules: {
      commas: { type: String, enum: ['ignore', 'half'], default: 'ignore' },
    },
    /** Bump when the grading rules change so old attempts can be told apart from re-evaluated ones. */
    rulesVersion: { type: Number, default: 1 },
    /** False until an admin has confirmed the numbers against SSC's published notice. */
    verifiedAgainstNotice: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export type ExamProfileDoc = InferSchemaType<typeof examProfileSchema>;
export const ExamProfile = model('ExamProfile', examProfileSchema);
