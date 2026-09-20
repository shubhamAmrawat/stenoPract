import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * One dictation exercise. NOTE: the transcript is deliberately NOT stored here -
 * it lives in DictationText so it can never leak through a catalog query by accident.
 */
const videoSchema = new Schema(
  {
    youtubeVideoId: { type: String, required: true },
    baseWpm: { type: Number, required: true, min: 40, max: 200 },
    title: String,
  },
  { _id: false },
);

const dictationSchema = new Schema(
  {
    setId: { type: Schema.Types.ObjectId, ref: 'DictationSet', required: true },
    exerciseNo: { type: Number, required: true },
    title: { type: String, required: true, trim: true },
    videos: { type: [videoSchema], default: [] },
    masterWordCount: { type: Number, default: 0 },
    tags: { type: [String], default: [] },
    /** Which DictationText version is live for students (null until a version is verified). */
    activeTextVersion: { type: Number, default: null },
    published: { type: Boolean, default: false },
  },
  { timestamps: true },
);

dictationSchema.index({ setId: 1, exerciseNo: 1 }, { unique: true });
dictationSchema.index({ published: 1, setId: 1 });

export type DictationDoc = InferSchemaType<typeof dictationSchema>;
export const Dictation = model('Dictation', dictationSchema);
