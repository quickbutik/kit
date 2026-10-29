import { ShopkitAuthError, type CustomerAuthErrorCode } from "@quickbutik/kit";

// English source strings for the customer-account refusals; the UI translates
// them. Registration and reset may reveal that an email is known: Quickbutik
// accepts that by design, so the wording stays neutral rather than hidden.
const messages: Partial<Record<CustomerAuthErrorCode, string>> = {
  invalid_credentials: "Wrong email or password.",
  // A lockout anyone can trigger with an email address: not an alarm.
  rate_limited: "Too many attempts. Try again in a few minutes.",
  customer_blocked: "This account can’t log in. Contact the store for help.",
  customer_login_disabled: "Customer accounts aren’t available right now.",
  signup_disabled: "Sign-ups aren’t open right now.",
  email_taken:
    "There’s already an account with this email. Log in or reset your password.",
  invalid_email: "Enter a valid email address.",
  invalid_name: "Enter your first and last name.",
  invalid_password: "Use a password of 6 to 40 characters.",
  invalid_reset_code:
    "That code didn’t work. It may have expired, so request a new one.",
  password_changed_login_required:
    "Your password is changed. Log in with your new password.",
};

export function customerErrorMessage(error: unknown, fallback: string) {
  return (
    (error instanceof ShopkitAuthError && messages[error.code]) || fallback
  );
}

// Quickbutik counts a password in UTF-8 bytes after removing HTML tags, so
// å, ä and ö count twice. Checked here only to answer before the request.
export function isValidPassword(password: string) {
  const bytes = new TextEncoder().encode(
    password.replace(/<[^>]*>/g, ""),
  ).length;
  return bytes >= 6 && bytes <= 40;
}
