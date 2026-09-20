import { Schema, model, type InferSchemaType } from 'mongoose';

/** A student flags a possible transcript / video problem; admins triage them. */
const reportSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    dictationId: { type: Schema.Types.ObjectId, ref: 'Dictation', required: true },
    attemptId: { type: Schema.Types.ObjectId, ref: 'Attempt' },
    textVersion: Number,
    wordIndex: Number,
    word: String,
    type: { type: String, enum: ['transcript_error', 'video_issue', 'other'], default: 'transcript_error' },
    message: { type: String, required: true, maxlength: 1000 },
    status: { type: String, enum: ['open', 'resolved', 'rejected'], default: 'open' },
    resolutionNote: String,
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: Date,
  },
  { timestamps: true },
);

reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ dictationId: 1, status: 1 });

export type ReportDoc = InferSchemaType<typeof reportSchema>;
export const Report = model('Report', reportSchema);
