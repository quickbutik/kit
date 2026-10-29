import type { CustomerClubJoinMethod } from "@quickbutik/kit";

// Existing accounts cannot opt in through the storefront API. Show the
// merchant's actual joining method instead of promising a join action.
export const clubJoinHint: Record<CustomerClubJoinMethod, string> = {
  auto: "Members earn points on everything they buy. You join with your next purchase.",
  auto_and_registration:
    "Members earn points on everything they buy. You join with your next purchase.",
  registration:
    "Club membership isn’t active on this account. Contact the store to join.",
  manual: "Membership is by invitation from the store.",
};
