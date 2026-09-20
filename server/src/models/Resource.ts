import { Schema, model, type InferSchemaType } from 'mongoose';

export const RESOURCE_GROUPS = ['kc-magazines', 'ssc-previous-years'] as const;
export type ResourceGroup = (typeof RESOURCE_GROUPS)[number];

/** A downloadable file (usually a PDF) shown on the student "Resources" pages. We only store the link, never the file. */
const resourceSchema = new Schema(
  {
    group: { type: String, enum: RESOURCE_GROUPS, required: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    url: { type: String, required: true, trim: true, maxlength: 1000 },
    order: { type: Number, default: 0 },
    published: { type: Boolean, default: true },
  },
  { timestamps: true },
);

resourceSchema.index({ group: 1, order: 1, title: 1 });

export type ResourceDoc = InferSchemaType<typeof resourceSchema>;
export const Resource = model('Resource', resourceSchema);
