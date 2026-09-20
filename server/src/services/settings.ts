import { Setting } from '../models/index.js';

const SIGNUP_KEY = 'signupOpen';

/** Whether anyone may create an account. Defaults to open; an admin can switch to invite-only in Admin → Access. */
export async function isSignupOpen(): Promise<boolean> {
  const row = await Setting.findOne({ key: SIGNUP_KEY }).lean();
  return row?.value !== false;
}

export async function setSignupOpen(open: boolean): Promise<void> {
  await Setting.updateOne({ key: SIGNUP_KEY }, { $set: { value: open } }, { upsert: true });
}
