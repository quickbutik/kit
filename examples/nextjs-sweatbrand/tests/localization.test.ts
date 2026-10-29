import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultPreferences,
  formatPrice,
  languages,
  localePath,
  preferredLanguage,
  translate,
} from "../src/lib/localization";
import { messages } from "../src/lib/translations";

test("locale paths prefix every route with the language's locale", () => {
  assert.equal(localePath("sv", "/"), "/sv-SE");
  assert.equal(localePath("dk", "/#shop"), "/da-DK#shop");
  assert.equal(
    localePath("no", "/products/the-heavyweight-tee#product-purchase"),
    "/nb-NO/products/the-heavyweight-tee#product-purchase",
  );
  assert.deepEqual(
    languages.map((language) => localePath(language.code, "/")),
    ["/sv-SE", "/da-DK", "/nb-NO", "/en-GB"],
  );
});

test("visitors without a locale get their best-matching browser language", () => {
  assert.equal(preferredLanguage("sv-SE,sv;q=0.9,en;q=0.8"), "sv");
  assert.equal(preferredLanguage("da"), "dk");
  assert.equal(preferredLanguage("no"), "no");
  assert.equal(preferredLanguage("nn-NO"), "no");
  assert.equal(preferredLanguage("de-DE,en-US;q=0.7"), "en");
  assert.equal(preferredLanguage("en;q=0.5,sv;q=0.9"), "sv");
  assert.equal(preferredLanguage("sv;q=0,fr"), defaultPreferences.language);
  assert.equal(preferredLanguage(""), defaultPreferences.language);
});

test("prices format Quickbutik minor units in the shop's currency", () => {
  assert.match(formatPrice(39900, "SEK", "sv"), /^399\sSEK$/);
  assert.match(formatPrice(39900, "SEK", "en"), /^SEK\s399$/);
  assert.match(formatPrice(24950, "SEK", "sv"), /^249,50\sSEK$/);
  assert.equal(formatPrice(3800, "EUR", "en"), "€38");
  assert.match(formatPrice(17900, "DKK", "dk"), /^179\sDKK$/);
});

test("translations preserve parameters, whitespace, and untranslated names", () => {
  assert.equal(translate("ADD TO BAG", "sv"), "LÄGG I VARUKORGEN");
  assert.equal(
    translate(" Subtotal ({count} items) ", "dk", { count: 3 }),
    " Subtotal (3 varer) ",
  );
  assert.equal(translate("The Heavyweight Tee", "no"), "The Heavyweight Tee");
});

test("translations keep every placeholder and cover catalog option values", () => {
  const keys = messages.map(([source]) => source);
  assert.equal(
    new Set(keys).size,
    keys.length,
    "Duplicate translation sources",
  );
  for (const [source, ...translations] of messages) {
    const parameters = source.match(/\{\w+\}/g)?.sort() ?? [];
    for (const translation of translations) {
      assert.deepEqual(
        translation.match(/\{\w+\}/g)?.sort() ?? [],
        parameters,
        source,
      );
    }
  }
  for (const color of [
    "Washed black",
    "Onyx",
    "Eucalyptus",
    "Grey marl",
    "Espresso",
    "Bone",
    "Forest",
    "Olive",
    "Sage",
    "Oat",
    "Cream / forest",
    "Charcoal",
    "Color",
    "One size",
  ])
    assert(keys.includes(color), `Missing translation: ${color}`);
});
