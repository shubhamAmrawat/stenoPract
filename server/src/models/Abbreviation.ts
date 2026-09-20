import { Schema, model, type InferSchemaType } from 'mongoose';

/** Abbreviation <-> expansion pairs (only used to label the mistake) + words whose trailing "." is part of the word. */
const abbreviationSchema = new Schema(
  {
    abbr: { type: String, required: true, unique: true, lowercase: true, trim: true },
    expansions: { type: [String], default: [] },
    /** True for words like Mr / Dr / No whose trailing full stop is not a sentence end. */
    dotted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type AbbreviationDoc = InferSchemaType<typeof abbreviationSchema>;
export const Abbreviation = model('Abbreviation', abbreviationSchema);
