const KEY = 'steno-admin-student-view'

/** Admins normally see only the admin console. This flag lets an admin preview the student side for the current tab. */
export function isStudentView(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setStudentView(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(KEY, '1')
    else sessionStorage.removeItem(KEY)
  } catch {
    /* storage blocked: the preview simply will not stick */
  }
}
