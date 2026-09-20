import { Schema, model, type InferSchemaType } from 'mongoose';

/** How often a student gets a particular master word wrong (feeds the "weak words" list). */
const userWordStatsSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    word: { type: String, required: true }, // lower-cased core form
    misses: { type: Number, default: 0 },
    weightedMisses: { type: Number, default: 0 }, // full = 1, half = 0.5
    kinds: { type: Map, of: Number, default: {} },
    lastMissedAt: Date,
  },
  { timestamps: true },
);

userWordStatsSchema.index({ userId: 1, word: 1 }, { unique: true });
userWordStatsSchema.index({ userId: 1, weightedMisses: -1 });

export type UserWordStatsDoc = InferSchemaType<typeof userWordStatsSchema>;
export const UserWordStats = model('UserWordStats', userWordStatsSchema);
