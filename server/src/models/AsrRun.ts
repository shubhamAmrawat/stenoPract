import { Schema, model, type InferSchemaType } from 'mongoose';

/** Output of a speech-to-text engine for a dictation video (admin scripts only). */
const asrRunSchema = new Schema(
  {
    dictationId: { type: Schema.Types.ObjectId, ref: 'Dictation', required: true },
    engine: { type: String, required: true }, // 'openai' | 'gemini' | ...
    model: { type: String, required: true },
    text: { type: String, required: true },
    words: { type: [{ text: String, start: Number, end: Number, _id: false }], default: undefined },
    costUsd: Number,
    /** Word error rate against the verified master text, once one exists (from our own evaluator). */
    werVsMaster: Number,
  },
  { timestamps: true },
);

asrRunSchema.index({ dictationId: 1, createdAt: -1 });

export type AsrRunDoc = InferSchemaType<typeof asrRunSchema>;
export const AsrRun = model('AsrRun', asrRunSchema);
