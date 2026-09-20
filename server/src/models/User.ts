import { Schema, model, type InferSchemaType } from 'mongoose';

const userSchema = new Schema(
  {
    googleId: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    picture: String,
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    active: { type: Boolean, default: true },
    settings: {
      examProfile: { type: String, default: 'SSC_C' },
      category: { type: String, enum: ['general', 'reserved'], default: 'general' },
    },
    lastLoginAt: Date,
  },
  { timestamps: true },
);

export type UserDoc = InferSchemaType<typeof userSchema>;
export const User = model('User', userSchema);
