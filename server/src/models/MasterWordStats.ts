import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * Per-word miss counts across ALL students for one transcript version.
 * A word that a large share of students "get wrong" is a suspect word: the master text may be wrong.
 */
const masterWordStatsSchema = new Schema(
  {
    dictationId: { type: Schema.Types.ObjectId, ref: 'Dictation', required: true },
    textVersion: { type: Number, required: true },
    wordIndex: { type: Number, required: true },
    word: { type: String, required: true },
    misses: { type: Number, default: 0 },
    kinds: { type: Map, of: Number, default: {} },
  },
  { timestamps: true },
);

masterWordStatsSchema.index({ dictationId: 1, textVersion: 1, wordIndex: 1 }, { unique: true });
masterWordStatsSchema.index({ dictationId: 1, textVersion: 1, misses: -1 });

export type MasterWordStatsDoc = InferSchemaType<typeof masterWordStatsSchema>;
export const MasterWordStats = model('MasterWordStats', masterWordStatsSchema);
