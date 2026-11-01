import { test } from "node:test";
import assert from "node:assert/strict";
import { splitDishText } from "./dish-split.ts";

const cases: [string, string[]][] = [
  // What separates dishes.
  ["Margherita pizza, Caesar salad, tiramisu", ["Margherita pizza", "Caesar salad", "tiramisu"]],
  ["pizza, salad, and wine", ["pizza", "salad", "wine"]],
  ["pizza and salad and 2 glasses of red wine", ["pizza", "salad", "2 glasses of red wine"]],
  ["pizza; salad | wine", ["pizza", "salad", "wine"]],
  ["dumplings / noodles + soup & tea", ["dumplings", "noodles", "soup", "tea"]],
  ["burger plus fries", ["burger", "fries"]],
  ["pad thai\ngreen curry\n\n- jasmine rice\n2) mango sticky rice\n• tea", ["pad thai", "green curry", "jasmine rice", "mango sticky rice", "tea"]],
  // What does not.
  ["mac and cheese and wings", ["mac and cheese", "wings"]],
  ["Mac & Cheese, fish n chips", ["Mac & Cheese", "fish n chips"]],
  ["salt and pepper wings; beer", ["salt and pepper wings", "beer"]],
  ["bacon, egg and cheese, coffee", ["bacon, egg and cheese", "coffee"]],
  ["pb&j, apple", ["pb&j", "apple"]],
  ["pizza (ham and pineapple), garlic knots", ["pizza (ham and pineapple)", "garlic knots"]],
  ["burger with lettuce and tomato, fries and a coke", ["burger with lettuce and tomato", "fries", "a coke"]],
  ["sushi platter: 2 rolls and 6 nigiri", ["sushi platter: 2 rolls and 6 nigiri"]],
  ["1/2 pizza, salad", ["1/2 pizza", "salad"]],
  ["steak w/ fries", ["steak w/ fries"]],
  // A size, a weight or a change belongs to the dish before it.
  ["Margherita pizza, 12 inch", ["Margherita pizza, 12 inch"]],
  ["chicken breast, 150 g cooked, rice", ["chicken breast, 150 g cooked", "rice"]],
  ["latte, large, croissant", ["latte, large", "croissant"]],
  ["burger, no cheese, extra pickles, fries", ["burger, no cheese, extra pickles", "fries"]],
  ["wings, sauce on the side; beer", ["wings, sauce on the side", "beer"]],
  // Only spaces between two things is left for the estimate, which knows food.
  ["burger fries shake", ["burger fries shake"]],
  ["", []],
  ["  \n - \n", []],
];

test("a description is cut into dishes where it was written as dishes", () => {
  for (const [text, dishes] of cases) assert.deepEqual(splitDishText(text), dishes, JSON.stringify(text));
});

test("nothing typed is lost, and past the limit the rest share the last dish", () => {
  const text = Array.from({ length: 25 }, (_, index) => `dish ${index + 1}`).join(", ");
  const dishes = splitDishText(text);
  assert.equal(dishes.length, 20);
  assert.equal(dishes[18], "dish 19");
  assert.equal(dishes[19], "dish 20, dish 21, dish 22, dish 23, dish 24, dish 25");
  assert.deepEqual(splitDishText("a, b, c", 2), ["a", "b, c"]);
});
