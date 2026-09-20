import { Schema, model, type InferSchemaType } from 'mongoose';

/** A book / volume / playlist that groups dictations, e.g. "Kailash Chandra - Volume 24". */
const dictationSetSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    title: { type: String, required: true, trim: true },
    description: String,
    source: String, // e.g. "Kailash Chandra, Vol. 24"
    youtubePlaylistId: String,
    order: { type: Number, default: 0 },
    published: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type DictationSetDoc = InferSchemaType<typeof dictationSetSchema>;
export const DictationSet = model('DictationSet', dictationSetSchema);
