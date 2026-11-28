# Meal

- **Meal** — describe a meal and let Grok estimate the macros, or type them in
  yourself. Editing an estimated number saves the meal as your own figures.
  Calories keep the source's reported or estimated total, including in queued
  meals. A rough 4/4/9 comparison (plus ethanol at 7 kcal/g) is
  advisory: differences never block saving or rewrite calories. Total carbs
  include fiber; fiber, sugar alcohols, food-specific factors and rounding can
  make the simple calculation differ from a label's calorie total. Ethanol
  counts on any sitting: its box shows on Alcohol, and on any meal, item or
  dish that holds some, so a dinner with wine keeps its ethanol. An estimate
  that finds ethanol picks Alcohol; picking another sitting keeps it. A meal takes
  a time of day, which starts at the clock; a new meal's sitting follows it until
  you pick one. The form opens on **Describe it**; the templates, then who it
  is for, the sitting and the date come after it, since those start out right
  for most meals. A meal logged on more than one day is offered again. Save it as
  a template to keep your own name, items and grams; tapping one fills the form,
  and the saved macros stay until you estimate again. Templates, and meals
  offered from the log with a dashed edge, are one row of buttons that scrolls
  sideways; **Manage templates** opens the full list to save, edit or remove
  them, and saving the meal on the form as a template is at the end of the
  row. Once every ingredient has its own figures, **Ingredient weights** gives
  each one a slider: a weighed one slides in grams, and a counted one ("2
  eggs", "250ml 2% milk") by how many, which rewrites the count in its name
  ("3 eggs", "1.5 × 250ml 2% milk"). Slid to zero, an item is an option, like a
  second milk: kept with the meal, but out of the description, the macros and
  the logged meal until it is slid up again. Any item can be removed, but not
  the last. Each says what it adds at the amount it is at, "92 kcal", and a
  box at zero is blank, so a number typed into it never reads "0270". A
  counted item's number is how many of whatever its figures were estimated
  for, one cup of milk for "0% milk": 270 typed there is 270 cups, which its
  calories show at once. **weigh in g** beside it takes grams instead, and
  estimates that item once at that weight, in its place. An ingredient added
  there is estimated on its own, once, so the others keep their figures. The
  meal's figures follow to a tenth. **Update this template** keeps what was added,
  removed or slid. A meal filled from a template that gains a food the template
  does not have shows **Update template defaults** above **Save meal**, which
  does the same (`templateAdditions` in `lib/meal-templates.ts`). A fresh **Estimate macros** prices only what is above zero
  and leaves the options as they were. In **Manage templates**, every item
  slides the same way, and **Estimate the new item** prices just the items
  that have no figures yet (`servedItems`, `withAmount` and `itemWithEstimate`
  in `lib/meal-ingredients.ts`). A meal typed and not
  saved yet is kept as a draft; see [Drafts](meal-estimates.md#drafts).
  A meal of two or more items offers **Expand into N items** under its
  figures. The items come from the estimate's working, which lists each item
  with its own figures in brackets. A meal written as several dishes, cut as
  a shared meal's dishes are, at lines, bullets, commas and periods, takes
  its items from the list nearest to that many, so four Chinese dishes open
  into four and not into their oil, starch and broth; a line ending in a
  colon above the others, such as "leftovers:", is a heading and not a dish
  (`listedCount`). Otherwise, and between lists as near, the estimator that
  counts most gives the list. A blend averages the estimators that listed
  the same foods, by their weights: matched by name, or by place when each
  lists exactly the dishes written and no name that matches sits elsewhere,
  since a dish in pinyin, English or Chinese shares no words with itself. An
  estimator weighed at 0 gives the list only when no other gave one. The list is shared out so the items
  add up to the figures already on the meal (`breakdown` in
  `lib/meal-items.ts`). Items saved with the meal open as they were saved, and
  a meal with no figures yet opens into blank items where it was written as
  several, to type in, a heading left out. Each item has a name, its grams, and its own figures:
  a weighed item has a slider, and moving it or typing grams scales that
  item's figures; typing a figure sets them at the grams it is at. One with
  no weight, such as "1 serving", has a size under its figures instead, as a
  dish does, so half a serving is 50% (`scaleItem`); giving it a weight hands
  that over to its grams. Remove an
  item, or add one. While expanded, the meal's figures are the items added
  up and cannot be typed into, and changing a figure or a weight saves the
  meal as your own numbers. Saving keeps the items with the meal, and once
  they were changed, lists them first in the assumptions as "Adjusted item
  by item", so a reply to the estimate reads them. **Collapse into one meal**
  keeps the figures and writes that list in. A reply, or a change of which
  estimates count, makes the items again from the new answer.
  **Meal size**, under the meal's figures, makes the whole meal bigger or
  smaller by a percentage, with the same bar a dish has: there from the
  start, at 100% and quiet. On the meal's own figures it works as a dish's
  does: every figure follows from the meal at 100%, a figure typed meanwhile
  is that figure at the size shown, and a resized estimate saves as your own
  numbers. A meal of weighed ingredients resizes each ingredient's grams, or
  how many of a counted one, and a meal opened up into its items resizes each
  item's grams, or its own size when it has no weight, so the figures follow
  from them as they do from their own sliders. Each resize works from the
  ingredients, items or dishes as they were when the bar first moved them,
  not from what the last resize rounded them to, so a meal taken to 1% and
  back loses nothing, not even 3 g of oil; anything else that changes them
  makes that the new start (`startOf`). An estimate, a reply, a change
  of which estimates count, or a template closes it, since their figures are
  the meal at 100%. Saved resized, the assumptions say "Scaled to 50% of
  1000 kcal." first, or after the list of items, which stays first
  (`sizedAssumptions` in `lib/meal-size.ts`).
  Logging for both splits the meal by dish. Describe it and **Estimate
  macros**, and it comes back dish by dish, each with its own figures and
  assumptions. What you wrote stays at the top, folded to one line, and opens
  again. The phone first cuts the description where it was written as
  dishes: at line breaks and bullets, and at commas and periods, including a
  Chinese comma, an enumeration comma, or a Chinese period, and a semicolon.
  A decimal point stays in the name. "with" is not a new dish,
  and neither is "and", "plus", "+", "&" or "/", so "beef with broccoli" and
  "bean sprouts + chives" stay one dish, and a size or a change, such as
  "12 inch" or "no cheese", stays with its dish (`splitDishText` in
  `lib/dish-split.ts`). The estimate keeps that cut, and makes the one that
  needs to know food: it splits what is plainly two dishes written with only
  a space between them, such as "burger fries", and joins what is plainly
  one. It does not read "with" as a separator. A dish estimated again on its
  own can come back as two, each keeping its share. Several dishes can be
  estimated again at the same time: each answer goes back on the dish it was
  asked for, including when one comes back as two or one of them fails. A
  dish can say how it was shared in brackets after it: "sandwich
  (60% gators 40% hippos)", "fries (80% h 20% g)", "coke (75% g)", "sprouts
  (50% each)", or in pieces, "8pc hongshaorou (5.5pc gators)". A share can
  also be a part of its own after a comma, or a line of its own under the
  dish, without brackets: "1 custard cream donut, 90% g". Glued to the dish,
  "pasta 60% g", it stays part of the name. Either name,
  singular or plural, or its first letter, before or after the number; the %
  or the "pc" is needed, since "60 g" is grams. Pieces are a part of the
  dish's count, the number it starts with ("8pc", "5 shengjianbao", but not
  "250g" or "12 inch") or the one in its quantity box, so 5.5 pc of 8 is
  68.75% and the other has 2.5 of 8; with no count, the pieces written for
  both of you are the count. A dish counted that way gets that count as its
  quantity when it has none, so each part reads "5.5 of 8 pc". Pieces for one
  of you of nothing counted, or more pieces than the dish had, cannot be
  worked out and stay part of the dish. Written for one of you, the other has
  the rest; written for both, the boxes say what was written, and saving says
  so if they do not make 100. Brackets that hold anything else stay part of the
  dish. The share is taken off the dish and into its boxes (`readDishShare` in
  `lib/dish-split.ts`), and no estimate ever reads it, since "gators" could be
  read as food and "3 pc" as a portion. "2 servings", "3 orders" and "8 pieces"
  after a comma say how much of the dish before them, like a size. An estimate
  that keeps the dishes gives each the share written in its place; one that
  split or joined them gives a dish the share written with its name, or with a
  name that holds it or that it holds. So "burger fries (70% h)" split in two
  gives each 70%, and "3 blue crabs, fried with scallion (70% g)", cut at the
  comma by the phone and joined again by the estimate, takes the 70% written at
  its end; dishes joined from different shares stay half each
  (`shareAsWritten` in `lib/meal-dishes.ts`). A share typed into a dish's own
  name moves into its boxes on leaving the name, on estimating that dish, or
  on saving. **Split by dish** makes the phone's cut without estimating, for
  figures typed by hand; figures already on the form stay together as the
  first dish. A dish whose working lists two or more items offers **Expand
  into N items**: each item becomes a dish of its own with the dish's share,
  its own part of the working, and, when weighed, a quantity in grams, so
  one of you can have all of one item. **Same meal for each of you** saves the same meal for each of
  you instead, as Both used to, and the next meal is split again. An estimator
  from before dishes answers for the whole meal, which becomes one dish. Each
  dish has its own figures, typed or estimated from what the
  dish says, and under them the assumptions its estimate gave, to read and
  correct; correcting them leaves the figures the estimate's. A dish typed by
  hand has none to show until it is estimated. Each dish also says whether the
  items its working lists add up to its calories: the items **Expand into N
  items** would make, added up against the dish's calories, or in a blend,
  each estimator's items against that estimator's own figure, which the dish's
  averages. Rounding each item and the total is allowed for; a gap past that
  is said, and one past 5% of the calories stands out. It is advice only: it
  never stops a save and never changes a figure. A working cut short to fit is
  not checked, and a lone item, being the dish itself, is mentioned only when
  it is out (`dishItemCheck` in `lib/meal-items.ts`). A size under each
  dish's figures makes it bigger or smaller by a percentage: one slim row, a
  slider from 0% to 200% in steps of 5 and the size it is at, which takes
  anything from 1% to 1000% typed. Most sizes are between half and a bit
  over whole, so 50% to 125% takes the middle 60% of the track: a step there
  is twice as wide as one below 50% and three times one above 125%. Ticks
  under it at 50, 75, 100 and 125 go to that size when tapped, and the one
  it is at stands out. Dragged, it lands on a whole 5%; the arrow
  keys move it 5% and Page Up and Page Down 25% (`lib/size-track.ts`). The
  slider's left end is 1%, the smallest size: at 0% every figure is 0, and
  nothing could find its way back. It sits at 100% and quiet, and once moved
  says what 100% was, "of 800 kcal". Every figure follows the size from the
  dish's figures at 100%, so sliding back loses nothing; a figure typed
  meanwhile is that figure at the size shown. Back at 100%, the dish is as it
  came (`SizeSlider` in `components/size-slider.tsx`). A scaled estimate saves
  as your own numbers, and since its working was written for 100%, each meal's
  assumptions say "Scaled to 120% of 800 kcal." under the whole dish, and the
  item check holds the working to the dish at 100%. Estimating the dish again
  closes the scale (`scaleDish` in `lib/meal-dishes.ts`). **Meal size**,
  above the shares, resizes every dish together by the same ratio, so a dish
  already at half stays at half of the rest, and each dish's own size moves
  with it. It sits at the dishes' size weighed by their calories at 100%, so
  it says 100% until something is resized, says what the whole table came
  to, and moves when a dish is resized or estimated on its own (`tableSize`
  and `sizeTable` in `lib/meal-size.ts`). Each dish has a share for each
  of you as a percentage of that dish, starting at half each. The two shares
  always add up to 100: typing one sets the other, and blank counts as 0. Each
  of you has a box at your end of a bar, Hippos at the left and Gators at the
  right, and the bar is the dish divided, each part with its percentage on it
  when there is room; drag its handle, or tap the bar, to set both. Under the
  bar are the calories each part holds. Give the dish a quantity, a number and
  then what it counts, such as "8 slices" or "400 g", and each part also reads
  as a count, "3 of 8 slices"; a dish of two or more whole units then slides a
  unit at a time, and anything else a percent at a time, since one of
  something would slide all or nothing. A share between steps is typed into
  the boxes, which read to a tenth until typed in. Saving writes one meal for each
  of you with a share, holding your share of every dish (`splitMeal` in
  `lib/meal-dishes.ts`), so the two meals add up to what was on the table.
  Someone with no share of anything gets no meal, and switching to one of you
  saves only that share. A name left blank becomes each person's own dishes.
  The assumptions give your share of each dish, with the count when it has
  one, and the whole dish's figures, then how that dish's figures were
  reached. A meal reads as estimated when every dish in it was estimated
  and left alone. Each dish's estimate counts towards the daily limit, one runs
  at a time, and a dish cannot wait in the queue for later. Templates and
  replies to an estimate are for a single meal, so a split meal does not offer
  them. The two saved meals are separate entries, edited one at a time.
- **Photos** — **Take photo**, **Library**, **File** and **Paste** sit under the description,
  in one row. Take photo asks the phone for a new picture from the rear camera: the
  phone's own camera takes it, through the file picker's `capture`, so the
  page never reaches the camera itself, and a computer opens a file picker
  instead. Library picks photos and File any file, several at once; on
  Android these open the photo picker and the file browser. On an iPhone or
  iPad both would open iOS's own menu of library, camera and files, which a
  page cannot skip or trim: Safari builds it from the file input, and nothing
  a page can set opens the library alone. So there Library is left out, and
  Take photo, File and Paste share the row. An iPad asking for desktop pages
  calls itself a Mac, and is told from one by its touch screen. The four need
  about 24rem, more than a phone 360 pixels wide gives them, so on a narrow
  Android phone they go two by two until the row is that wide. **Paste** adds
  a picture copied to the clipboard, from Copy in Photos or from a page, which
  is the way past that menu on an iPhone. The browser asks first: Safari shows
  its own Paste button to tap, and Chrome asks once to allow it. A clipboard
  with no picture on it says so. On a computer, **Ctrl+V** (⌘V on a Mac)
  pastes a picture too, while the Meal form is on screen, with the cursor in
  the form or nowhere in particular: a screenshot, Copy image from a page, or
  picture files copied in File Explorer or Finder, which the Paste button
  cannot read, since to the clipboard it reads a copied file is not a picture.
  It needs no permission. Pasted into a box on the form, text wins: Word,
  Excel and OneNote put a picture of what was copied beside its text, so
  pasting that is typing, not a photo. A paste into a dialog, such as a reply
  to the estimate, or into a box outside the form, is left alone, and one with
  six photos already on the form says so. When the Paste button cannot read
  the clipboard, its notice suggests Ctrl+V on a computer
  (`lib/pasted-photos.ts`). Anything that is not a picture the browser can open is turned away. An
  estimate takes six photos at most, and each can be taken off. Several can
  show the same food, from another angle or closer up, and it still counts
  once, as many of it as any one photo or the words show. A menu, receipt or
  label is read for what each dish is, its size, how it is made and any
  calories it prints, and is never counted as food: what was eaten comes from
  the photos of the food or the words beside them, and with only a menu and
  no word of what was eaten, the estimate says so at low confidence. Every photo
  is drawn again on the phone at 1536 px on its long side, as a JPEG of at
  most 1 MB, which also leaves its metadata, the location included, behind.
  One the browser cannot open, such as a HEIC on a computer that cannot read
  it, is turned away with a notice and adds nothing. With a photo the words
  are optional: **Estimate macros** goes on the photo alone, and words
  written beside it add to it and correct it, "large portion, cooked in olive
  oil". With no words, the estimate names the meal after what it sees. A meal
  for both comes back dish by dish from the photo, and its words are notes on
  those dishes rather than a list of them, unless they name them: they are not
  cut into dishes at their commas. Every estimate from
  the form sends its photos, a reply included, so a correction is read
  against the picture. Photos are not kept: not in the draft, so a reload or
  a draft opened again has none, and not with the saved meal, whose
  assumptions say what was seen and how each portion was judged. **Save and
  estimate in background** takes them too, with or without words: the photos
  go to the server first, then the meal, which points to them, so the worker
  estimates from them as the form would. Saved unnamed, it is "Meal from
  photos" until the estimate names it; the words beside the photos stay notes
  on them. Opened again from the Log while it waits, the meal says its photos
  are on the server: queued again, with words added or not, it keeps them, and
  photos added on the form replace them. The server holds them apart from the
  journal, so they reach no backup and no phone, and deletes them once the
  meal is estimated, edited without them or deleted; photos no meal took go
  after a day. Unlike the meal, they cannot
  wait on the phone for a connection: without one nothing is saved, the form
  says so and keeps them. Which estimators look at photos is in
  [Meal estimates](meal-estimates.md#photos) (`components/meal/meal-photos.tsx`,
  `lib/meal-photos.ts`).
