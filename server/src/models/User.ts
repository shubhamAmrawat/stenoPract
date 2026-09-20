import { Schema, model, type InferSchemaType } from 'mongoose';

/** Colour themes a student can pick on the Profile page. Keep in step with client/src/lib/themes.ts. */
export const THEMES = ['teal', 'forest', 'sky', 'slate', 'plum', 'indigo'] as const;
export type ThemeId = (typeof THEMES)[number];

const userSchema = new Schema(
  {
    /** Set for accounts that signed in with Google (Google has verified the email). Password-only accounts have none. */
    googleId: { type: String },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    /** The Google profile picture, refreshed at every Google sign-in. */
    picture: String,
    /** Object key of a photo the student uploaded (in the R2 bucket). When set it is shown instead of `picture`. */
    avatarKey: String,
    /** True once the student has edited their name, so a later Google sign-in stops overwriting it. */
    nameCustomised: { type: Boolean, default: false },
    /** scrypt hash (see services/password.ts). Only accounts created with "Create account" have one. Never sent to the client. */
    passwordHash: String,
    /** Optional details the student can add on the Profile page. */
    phone: String,
    gender: { type: String, enum: ['female', 'male', 'other', 'prefer-not-to-say'] },
    bio: { type: String, maxlength: 200 },
    /** The colour theme the student chose. Unset means the platform default. */
    theme: { type: String, enum: THEMES },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    active: { type: Boolean, default: true },
    settings: {
      examProfile: { type: String, default: 'SSC_C' },
      category: { type: String, enum: ['general', 'reserved'], default: 'general' },
    },
    lastLoginAt: Date,
    /** Wrong-password counter and lock, reset on a successful sign-in. */
    failedLogins: { type: Number, default: 0 },
    lockedUntil: Date,
    /** Sessions remember the value they were issued with; bumping it signs the user out everywhere. */
    sessionVersion: { type: Number, default: 0 },
  },
  // Indexes are built by ensureIndexes() at startup, after an old googleId index has been dropped, so mongoose must not race it.
  { timestamps: true, autoIndex: false },
);

// Unique only where a Google id exists, so any number of password accounts can have none.
userSchema.index({ googleId: 1 }, { unique: true, partialFilterExpression: { googleId: { $type: 'string' } } });

export type UserDoc = InferSchemaType<typeof userSchema>;
export const User = model('User', userSchema);
