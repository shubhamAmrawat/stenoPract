import { Schema, model } from 'mongoose';

/** Small app-wide switches an admin can change from the console (for example whether anyone may create an account). */
const settingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: Schema.Types.Mixed,
  },
  { timestamps: true },
);

export const Setting = model('Setting', settingSchema);
