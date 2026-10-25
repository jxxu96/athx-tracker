/** Picking beats typing on a phone, with a way out for anything not listed. */
export const EXERCISES: { group: string; items: string[] }[] = [
  {
    // The lifts the programme is built around, first because they are typed most.
    group: "Main lifts",
    items: [
      "Deadlift",
      "Back squat",
      "Overhead press",
      "Push press",
      "Split jerk",
    ],
  },
  {
    // Named exactly as the MetCon stations name them, so a lift and a station
    // read the same in the log. Opening and closing row stay distinct; Row is
    // the plain erg when it was not one of those two.
    group: "ATHX stations",
    items: [
      "Opening row",
      "DB ground to overhead",
      "DB bench press",
      "Sandbag squats",
      "Sandbag carry",
      "Burpees over bench",
      "Closing row",
      "Row",
    ],
  },
  {
    group: "Lower body",
    items: [
      "Front squat",
      "Goblet squat",
      "Romanian deadlift",
      "Hip thrust",
      "Walking lunge",
      "Bulgarian split squat",
      "Step-up",
    ],
  },
  {
    group: "Upper push",
    items: ["Bench press", "Incline bench press", "Dip", "Push-up", "Lu Raises"],
  },
  {
    group: "Upper pull",
    items: [
      "Pull-up",
      "Curls",
      "Barbell row",
      "Dumbbell row",
      "Lat pulldown",
      "Face pull",
    ],
  },
  {
    group: "Power",
    items: [
      "Power clean",
      "Clean and jerk",
      "Snatch",
      "Thruster",
      "Dumbbell snatch",
      "Kettlebell swing",
    ],
  },
  {
    group: "Carries and strongman",
    items: ["Farmer carry", "Sandbag clean", "Sled push", "Sled pull"],
  },
  {
    group: "Conditioning",
    items: ["Bike erg", "Ski erg", "Run", "Burpee", "Wall ball", "Box jump", "Double under"],
  },
];
