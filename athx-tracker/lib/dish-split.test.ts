import { test } from "node:test";
import assert from "node:assert/strict";
import { readDishShare, splitDishText, withoutShares, writtenDishes } from "./dish-split.ts";

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

test("a share written in brackets is read for either of you, by name or by letter", () => {
  const cases: [string, ReturnType<typeof readDishShare>][] = [
    ["sandwich (60% gators 40% hippos)", { name: "sandwich", share: { gators: 60, hippos: 40 } }],
    ["fries (80% h 20% g)", { name: "fries", share: { hippos: 80, gators: 20 } }],
    ["coke (75% g)", { name: "coke", share: { gators: 75 } }],
    ["Pizza [Gators 62.5%, Hippos: 37.5%]", { name: "Pizza", share: { gators: 62.5, hippos: 37.5 } }],
    ["salad {100%h}", { name: "salad", share: { hippos: 100 } }],
    ["wings (60% hippo / 40% gator) with ranch", { name: "wings with ranch", share: { hippos: 60, gators: 40 } }],
    ["pizza, 12 inch, (70% g)", { name: "pizza, 12 inch", share: { gators: 70 } }],
  ];
  for (const [text, read] of cases) assert.deepEqual(readDishShare(text), read, text);
});

test("brackets that say anything else keep every word, and give no share", () => {
  for (const text of [
    "pizza (ham and pineapple)",
    "chicken (60 g)",
    "dark chocolate (85%)",
    "milk (2% fat)",
    "drink (60% gatorade)",
    "pasta (60% g 30% g)",
    "pasta (120% h)",
    "pasta 60% g",
    "pasta ()",
  ]) assert.deepEqual(readDishShare(text), { name: text, share: null }, text);
  // Saying the same thing twice is still one share.
  assert.deepEqual(readDishShare("pasta (60% g, g 60%)").share, { gators: 60 });
});

test("a description is cut into dishes with their shares, and an estimate reads it without them", () => {
  const text = "sandwich (60% gators 40% hippos)\nfries (80% h 20% g)\ncoke (75% g)\npickle";
  assert.deepEqual(writtenDishes(text), [
    { name: "sandwich", share: { gators: 60, hippos: 40 } },
    { name: "fries", share: { hippos: 80, gators: 20 } },
    { name: "coke", share: { gators: 75 } },
    { name: "pickle", share: null },
  ]);
  assert.equal(withoutShares(text), "sandwich\nfries\ncoke\npickle");
  assert.equal(withoutShares("burger (70% h), fries and a coke (g 100%)"), "burger, fries and a coke");
  // A share with "and" in it stays in its brackets, and does not cut the dish.
  assert.deepEqual(writtenDishes("ramen (60% g and 40% h), gyoza"), [
    { name: "ramen", share: { gators: 60, hippos: 40 } },
    { name: "gyoza", share: null },
  ]);
  // A share on its own belongs to the dish before it, and a size after one still does.
  assert.deepEqual(writtenDishes("pizza\n(70% g)\nsalad"), [
    { name: "pizza", share: { gators: 70 } },
    { name: "salad", share: null },
  ]);
  assert.deepEqual(writtenDishes("pizza (70% g), 12 inch"), [{ name: "pizza, 12 inch", share: { gators: 70 } }]);
  assert.deepEqual(writtenDishes("(70% g)"), []);
  // Brackets that are not a share are left alone.
  assert.equal(withoutShares("pizza (ham and pineapple)"), "pizza (ham and pineapple)");
});
