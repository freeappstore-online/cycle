// Whether this device has seen (or skipped) the first-run introduction.
// A plain flag in localStorage; it holds no cycle data.

const KEY = 'cycle:onboarding-seen'

export function onboardingSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return true // Storage blocked: don't nag on every launch.
  }
}

export function markOnboardingSeen() {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    // Ignore: worst case the introduction shows again.
  }
}

export function clearOnboardingSeen() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Ignore.
  }
}
