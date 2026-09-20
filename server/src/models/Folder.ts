import { Schema, model, type InferSchemaType } from 'mongoose';

const folderSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    color: { type: String, default: '#4F46E5' },
  },
  { timestamps: true },
);

folderSchema.index({ userId: 1, name: 1 }, { unique: true });

export type FolderDoc = InferSchemaType<typeof folderSchema>;
export const Folder = model('Folder', folderSchema);
