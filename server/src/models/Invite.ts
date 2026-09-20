import { Schema, model, type InferSchemaType } from 'mongoose';

/** An email address the owner has allowed to sign in. Managed from Admin → Access. */
const inviteSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    invitedBy: { type: String, trim: true },
  },
  { timestamps: true },
);

export type InviteDoc = InferSchemaType<typeof inviteSchema>;
export const Invite = model('Invite', inviteSchema);
