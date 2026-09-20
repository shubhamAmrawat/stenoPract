import { Schema, model, type InferSchemaType } from 'mongoose';

/** A shelf on the student "Resources" area (for example "KC Magazines", "Syllabus", "Announcements"). Files belong to one by its slug. */
const resourceGroupSchema = new Schema(
  {
    /** The address of the shelf (/resources/<slug>). Made from the title once and never changed, so links keep working. */
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 60 },
    title: { type: String, required: true, trim: true, maxlength: 80 },
    blurb: { type: String, trim: true, maxlength: 200, default: '' },
    order: { type: Number, default: 0 },
    published: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export type ResourceGroupDoc = InferSchemaType<typeof resourceGroupSchema>;
export const ResourceGroup = model('ResourceGroup', resourceGroupSchema);

/** "Previous Years' Papers" -> "previous-years-papers". */
export function slugify(title: string): string {
  const s = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return s || 'group';
}
