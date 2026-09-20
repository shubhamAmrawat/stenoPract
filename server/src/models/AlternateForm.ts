import { Schema, model, type InferSchemaType } from 'mongoose';

/** A group of words that are accepted for one another, e.g. Honourable / Hon'ble / Hon. */
const alternateFormSchema = new Schema(
  {
    canonical: { type: String, required: true, unique: true, lowercase: true, trim: true },
    variants: { type: [String], default: [] }, // includes the canonical form
    note: String,
  },
  { timestamps: true },
);

export type AlternateFormDoc = InferSchemaType<typeof alternateFormSchema>;
export const AlternateForm = model('AlternateForm', alternateFormSchema);
