import { Schema, model, type InferSchemaType } from 'mongoose';

/** A downloadable file (usually a PDF) shown on the student "Resources" pages: either a link to somewhere else (Drive), or a PDF uploaded to our own storage. */
const resourceSchema = new Schema(
  {
    /** Slug of the ResourceGroup it sits in. */
    group: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    /** Where the file is. For an uploaded file this is only a fallback; the address is built from fileKey so a new public domain never breaks old files. */
    url: { type: String, trim: true, maxlength: 1000, default: '' },
    /** Set for files uploaded to our storage: their object key. Removing the resource removes the object. */
    fileKey: { type: String },
    fileSize: { type: Number },
    order: { type: Number, default: 0 },
    published: { type: Boolean, default: true },
  },
  { timestamps: true },
);

resourceSchema.index({ group: 1, order: 1, title: 1 });

export type ResourceDoc = InferSchemaType<typeof resourceSchema>;
export const Resource = model('Resource', resourceSchema);
