import { Schema, model, type InferSchemaType } from 'mongoose';

/** Versioned master transcript. Old versions are kept so past attempts can be re-evaluated. */
const wordTimingSchema = new Schema(
  { i: Number, text: String, start: Number, end: Number },
  { _id: false },
);

const dictationTextSchema = new Schema(
  {
    dictationId: { type: Schema.Types.ObjectId, ref: 'Dictation', required: true },
    version: { type: Number, required: true },
    masterText: { type: String, required: true },
    words: { type: [wordTimingSchema], default: undefined },
    /** Word numbers where the book prints a "100 words" marker, used to verify the video against the book. */
    checkpoints: { type: [Number], default: [] },
    source: { type: String, enum: ['book', 'asr', 'manual'], default: 'manual' },
    reviewStatus: { type: String, enum: ['draft', 'in_review', 'verified'], default: 'draft' },
    notes: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    /** How many submitted attempts were evaluated against this version (denominator for word stats). */
    attemptCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

dictationTextSchema.index({ dictationId: 1, version: 1 }, { unique: true });

export type DictationTextDoc = InferSchemaType<typeof dictationTextSchema>;
export const DictationText = model('DictationText', dictationTextSchema);
