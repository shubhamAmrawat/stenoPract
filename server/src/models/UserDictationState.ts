import { Schema, model, type InferSchemaType } from 'mongoose';

/** Per-student bookkeeping for one dictation: seen / favourite / folders / best score. */
const userDictationStateSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    dictationId: { type: Schema.Types.ObjectId, ref: 'Dictation', required: true },
    seen: { type: Boolean, default: false },
    favourite: { type: Boolean, default: false },
    folderIds: { type: [Schema.Types.ObjectId], default: [] },
    attemptsCount: { type: Number, default: 0 },
    bestErrorPct: Number,
    lastErrorPct: Number,
    lastAttemptAt: Date,
  },
  { timestamps: true },
);

userDictationStateSchema.index({ userId: 1, dictationId: 1 }, { unique: true });
userDictationStateSchema.index({ userId: 1, favourite: 1 });
userDictationStateSchema.index({ userId: 1, folderIds: 1 });

export type UserDictationStateDoc = InferSchemaType<typeof userDictationStateSchema>;
export const UserDictationState = model('UserDictationState', userDictationStateSchema);
