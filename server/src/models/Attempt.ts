import { Schema, model, type InferSchemaType } from 'mongoose';

const diffOpSchema = new Schema(
  {
    t: { type: String, enum: ['m', 's', 'd', 'i'], required: true },
    m: String,
    a: String,
    k: { type: [String], default: undefined },
  },
  { _id: false },
);

const mistakeSchema = new Schema(
  {
    kind: { type: String, required: true },
    weight: { type: Number, enum: [1, 0.5], required: true },
    pos: { type: Number, required: true },
    masterIndex: Number,
    master: String,
    attempt: String,
  },
  { _id: false },
);

const resultSchema = new Schema(
  {
    full: Number,
    half: Number,
    masterWords: Number,
    attemptWords: Number,
    errorPct: Number,
    limitPct: Number,
    passed: Boolean,
    breakdown: { type: Schema.Types.Mixed },
    diff: { type: [diffOpSchema], default: undefined },
  },
  { _id: false },
);

const evaluationHistorySchema = new Schema(
  {
    at: { type: Date, default: Date.now },
    textVersion: Number,
    rulesVersion: Number,
    full: Number,
    half: Number,
    errorPct: Number,
  },
  { _id: false },
);

const attemptSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    dictationId: { type: Schema.Types.ObjectId, ref: 'Dictation', required: true },
    textVersion: { type: Number, required: true },
    examProfile: { type: String, required: true },
    category: { type: String, enum: ['general', 'reserved'], required: true },
    status: { type: String, enum: ['draft', 'submitted'], default: 'draft' },
    typedText: { type: String, default: '' },
    /** Speed the student listened at (base wpm x playback rate), if the client reported it. */
    listenedWpm: Number,
    startedAt: { type: Date, default: Date.now },
    deadlineAt: { type: Date, required: true },
    submittedAt: Date,
    timeTakenSec: Number,
    autoSubmitted: { type: Boolean, default: false },
    result: resultSchema,
    mistakes: { type: [mistakeSchema], default: undefined },
    /** True once userWordStats / masterWordStats have been updated for this attempt (idempotency guard). */
    statsApplied: { type: Boolean, default: false },
    evaluationHistory: { type: [evaluationHistorySchema], default: [] },
  },
  { timestamps: true },
);

attemptSchema.index({ userId: 1, submittedAt: -1 });
attemptSchema.index({ userId: 1, dictationId: 1, submittedAt: -1 });
// At most one open draft per student per dictation.
attemptSchema.index(
  { userId: 1, dictationId: 1 },
  { unique: true, partialFilterExpression: { status: 'draft' } },
);

export type AttemptDoc = InferSchemaType<typeof attemptSchema>;
export const Attempt = model('Attempt', attemptSchema);
