import { ShopkitApiError, ShopkitNetworkError } from "@quickbutik/kit"

const MESSAGES: Record<string, string> = {
  invalid_credentials: "Wrong email or password.",
  customer_blocked: "This account has been paused. Contact us to reactivate it.",
  customer_login_disabled: "Trade accounts are temporarily unavailable.",
  signup_disabled: "We're not accepting new trade accounts right now.",
  email_taken: "There's already an account with this email. Sign in or reset your password.",
  invalid_email: "That doesn't look like a valid email address.",
  invalid_name: "Please enter your first and last name.",
  invalid_password: "The password must be 6–40 characters.",
  invalid_reset_code: "That code didn't work. It may have expired — request a new one.",
  password_changed_login_required: "Your password was changed. Sign in with the new one.",
  rate_limited: "Too many attempts. Please try again in a few minutes.",
  login_required: "Sign in with your trade account to place orders.",
  customer_token_required: "Your session has ended. Please sign in again.",
}

export function errorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (error instanceof ShopkitApiError && error.code && MESSAGES[error.code]) return MESSAGES[error.code]
  if (error instanceof ShopkitNetworkError) return "Couldn't reach the server. Check your connection and try again."
  return fallback
}

export function errorCode(error: unknown): string | null {
  return error instanceof ShopkitApiError ? error.code : null
}
