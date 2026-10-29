import assert from "node:assert/strict";
import { test } from "node:test";
import { ShopkitAuthError, ShopkitNetworkError } from "@quickbutik/kit";
import {
  customerErrorMessage,
  isValidPassword,
} from "../src/lib/customer-errors";

test("passwords are 6 to 40 UTF-8 bytes once HTML tags are removed", () => {
  assert(!isValidPassword("12345"));
  assert(isValidPassword("123456"));
  assert(isValidPassword("x".repeat(40)));
  assert(!isValidPassword("x".repeat(41)));
  // å, ä and ö count as two bytes each.
  assert(!isValidPassword("åä"));
  assert(isValidPassword("åäö"));
  assert(!isValidPassword("ö".repeat(21)));
  assert(!isValidPassword("<b>12</b>34"));
});

test("account refusals map to messages, anything else to the fallback", () => {
  const refusal = (code: ConstructorParameters<typeof ShopkitAuthError>[2]) =>
    new ShopkitAuthError("refused", 400, code);
  assert.equal(
    customerErrorMessage(refusal("email_taken"), "Fallback"),
    "There’s already an account with this email. Log in or reset your password.",
  );
  assert.equal(
    customerErrorMessage(refusal("invalid_reset_code"), "Fallback"),
    "That code didn’t work. It may have expired, so request a new one.",
  );
  assert.equal(
    customerErrorMessage(refusal("cart_customer_mismatch"), "Fallback"),
    "Fallback",
  );
  assert.equal(
    customerErrorMessage(new ShopkitNetworkError("offline", null), "Fallback"),
    "Fallback",
  );
});
