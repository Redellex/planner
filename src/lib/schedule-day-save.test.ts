import { describe, expect, it } from "vitest";

import type { DayRow } from "./schedule";
import { alreadySaved, changedRows, matchesStored, parseDaySaveForm, sameRows } from "./schedule-day-save";

// Literal fixtures only: every expected row is written out, never built with the helpers under test.

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const S3 = "33333333-3333-4333-8333-333333333333";
const S4 = "44444444-4444-4444-8444-444444444444";
const S5 = "55555555-5555-4555-8555-555555555555";
const ANN = "00000000-0000-4000-8000-00000000000a";
const BOB = "00000000-0000-4000-8000-00000000000b";

/** A FormData from `[name, value]` pairs, so repeated fields keep their order. */
function form(pairs: [string, string][]): FormData {
  const data = new FormData();
  for (const [name, value] of pairs) {
    data.append(name, value);
  }
  return data;
}

/** The fields one row of the day form posts. */
function rowFields(shift: string, was: string, to: string): [string, string][] {
  return [
    ["shift", shift],
    [`was-${shift}`, was],
    [`employee-${shift}`, to],
  ];
}

describe("the day form is read into rows", () => {
  it("reads every row in posted order, with an empty field as Uncovered, and no confirmed rows without confirm", () => {
    expect(
      parseDaySaveForm(
        form([
          ["month", "2026-11"],
          ["day", "2026-11-05"],
          ...rowFields(S2, ANN, ""),
          ...rowFields(S1, "", BOB),
          ...rowFields(S3, BOB, BOB),
        ]),
      ),
    ).toEqual({
      rows: [
        { shift: S2, was: ANN, to: null },
        { shift: S1, was: null, to: BOB },
        { shift: S3, was: BOB, to: BOB },
      ],
      confirmed: null,
    });
  });

  it("ignores confirmed fields unless confirm=override is posted", () => {
    expect(
      parseDaySaveForm(form([...rowFields(S1, ANN, BOB), ["confirmed", `${S1}:${ANN}:${BOB}`]]))?.confirmed,
    ).toBeNull();
  });

  it("reads the confirmed rows with confirm=override", () => {
    expect(
      parseDaySaveForm(
        form([
          ...rowFields(S1, ANN, BOB),
          ...rowFields(S2, BOB, ""),
          ["confirm", "override"],
          ["confirmed", `${S1}:${ANN}:${BOB}`],
          ["confirmed", `${S2}:${BOB}:none`],
        ]),
      ),
    ).toEqual({
      rows: [
        { shift: S1, was: ANN, to: BOB },
        { shift: S2, was: BOB, to: null },
      ],
      confirmed: [
        { shift: S1, was: ANN, to: BOB },
        { shift: S2, was: BOB, to: null },
      ],
    });
  });

  it("reads confirm=override with no confirmed field as an empty confirmed list", () => {
    expect(parseDaySaveForm(form([...rowFields(S1, ANN, BOB), ["confirm", "override"]]))?.confirmed).toEqual([]);
  });

  it.each<[string, [string, string][]]>([
    ["no shift field", [["month", "2026-11"]]],
    ["a shift that is not a uuid", rowFields("s1", ANN, BOB)],
    ["a duplicate shift", [...rowFields(S1, ANN, BOB), ...rowFields(S1, ANN, BOB)]],
    [
      "a missing was- field",
      [
        ["shift", S1],
        [`employee-${S1}`, BOB],
      ],
    ],
    [
      "a missing employee- field",
      [
        ["shift", S1],
        [`was-${S1}`, ANN],
      ],
    ],
    ["a repeated employee- field", [...rowFields(S1, ANN, BOB), [`employee-${S1}`, ANN]]],
    ["a was- value that is not a uuid", rowFields(S1, "ann", BOB)],
    ["an employee- value that is not a uuid", rowFields(S1, ANN, "none")],
    ["a malformed confirmed row", [...rowFields(S1, ANN, BOB), ["confirm", "override"], ["confirmed", `${S1}:${ANN}`]]],
    [
      "more rows than a station day holds (5)",
      [
        ...rowFields(S1, ANN, BOB),
        ...rowFields(S2, ANN, BOB),
        ...rowFields(S3, ANN, BOB),
        ...rowFields(S4, ANN, BOB),
        ...rowFields(S5, ANN, BOB),
      ],
    ],
  ])("is null for %s", (_name, pairs) => {
    expect(parseDaySaveForm(form(pairs))).toBeNull();
  });

  it("reads a full 6×4 day (4 rows)", () => {
    expect(
      parseDaySaveForm(
        form([
          ...rowFields(S1, ANN, BOB),
          ...rowFields(S2, "", ""),
          ...rowFields(S3, BOB, ANN),
          ...rowFields(S4, "", ANN),
        ]),
      ),
    ).toEqual({
      rows: [
        { shift: S1, was: ANN, to: BOB },
        { shift: S2, was: null, to: null },
        { shift: S3, was: BOB, to: ANN },
        { shift: S4, was: null, to: ANN },
      ],
      confirmed: null,
    });
  });
});

describe("only rows whose choice differs are changes", () => {
  it("keeps rows with a new assignee, a newly Uncovered or a newly covered shift, in order", () => {
    expect(
      changedRows([
        { shift: S1, was: ANN, to: BOB },
        { shift: S2, was: BOB, to: BOB },
        { shift: S3, was: null, to: null },
      ]),
    ).toEqual([{ shift: S1, was: ANN, to: BOB }]);
    expect(
      changedRows([
        { shift: S1, was: ANN, to: null },
        { shift: S2, was: null, to: BOB },
      ]),
    ).toEqual([
      { shift: S1, was: ANN, to: null },
      { shift: S2, was: null, to: BOB },
    ]);
  });

  it("has no changes when every choice equals what was seen", () => {
    expect(changedRows([{ shift: S1, was: null, to: null }])).toEqual([]);
  });
});

const STORED = [
  { id: S1, employee_id: ANN },
  { id: S2, employee_id: null },
  { id: S3, employee_id: BOB },
];

describe("the rows match the stored day only when the manager saw it as stored", () => {
  it("matches the same shifts in another order, Uncovered included", () => {
    const rows: DayRow[] = [
      { shift: S3, was: BOB, to: ANN },
      { shift: S1, was: ANN, to: ANN },
      { shift: S2, was: null, to: BOB },
    ];
    expect(matchesStored(rows, STORED)).toBe(true);
  });

  it.each<[string, DayRow[]]>([
    [
      "a seen assignee that differs",
      [
        { shift: S1, was: BOB, to: BOB },
        { shift: S2, was: null, to: null },
        { shift: S3, was: BOB, to: BOB },
      ],
    ],
    [
      "a seen Uncovered where someone is stored",
      [
        { shift: S1, was: null, to: ANN },
        { shift: S2, was: null, to: null },
        { shift: S3, was: BOB, to: BOB },
      ],
    ],
    [
      "a seen assignee where Uncovered is stored",
      [
        { shift: S1, was: ANN, to: ANN },
        { shift: S2, was: ANN, to: ANN },
        { shift: S3, was: BOB, to: BOB },
      ],
    ],
    [
      "a missing shift",
      [
        { shift: S1, was: ANN, to: ANN },
        { shift: S2, was: null, to: null },
      ],
    ],
    [
      "a shift that is not stored on the day",
      [
        { shift: S1, was: ANN, to: ANN },
        { shift: S2, was: null, to: null },
        { shift: "44444444-4444-4444-8444-444444444444", was: BOB, to: BOB },
      ],
    ],
    [
      "a repeated shift",
      [
        { shift: S1, was: ANN, to: ANN },
        { shift: S1, was: ANN, to: ANN },
        { shift: S3, was: BOB, to: BOB },
      ],
    ],
  ])("does not match with %s", (_name, rows) => {
    expect(matchesStored(rows, STORED)).toBe(false);
  });
});

describe("the day is already saved when every choice is what is stored", () => {
  it("is saved when every to equals the stored assignee, in any order, Uncovered included", () => {
    expect(
      alreadySaved(
        [
          { shift: S2, was: ANN, to: null },
          { shift: S3, was: ANN, to: BOB },
          { shift: S1, was: null, to: ANN },
        ],
        STORED,
      ),
    ).toBe(true);
  });

  it("is not saved when one choice differs from what is stored", () => {
    expect(
      alreadySaved(
        [
          { shift: S1, was: ANN, to: BOB },
          { shift: S2, was: null, to: null },
          { shift: S3, was: BOB, to: BOB },
        ],
        STORED,
      ),
    ).toBe(false);
  });

  it("is not saved for a different set of shifts, even when every listed choice is stored", () => {
    expect(
      alreadySaved(
        [
          { shift: S1, was: BOB, to: ANN },
          { shift: S3, was: ANN, to: BOB },
        ],
        STORED,
      ),
    ).toBe(false);
  });
});

describe("two row lists are compared as sets", () => {
  const listed: DayRow[] = [
    { shift: S1, was: ANN, to: BOB },
    { shift: S2, was: null, to: ANN },
  ];

  it("is the same set in another order", () => {
    expect(
      sameRows(listed, [
        { shift: S2, was: null, to: ANN },
        { shift: S1, was: ANN, to: BOB },
      ]),
    ).toBe(true);
    expect(sameRows([], [])).toBe(true);
  });

  it.each<[string, DayRow[]]>([
    [
      "a changed choice",
      [
        { shift: S1, was: ANN, to: BOB },
        { shift: S2, was: null, to: BOB },
      ],
    ],
    [
      "Uncovered instead of someone",
      [
        { shift: S1, was: ANN, to: BOB },
        { shift: S2, was: null, to: null },
      ],
    ],
    [
      "a changed seen assignee",
      [
        { shift: S1, was: BOB, to: BOB },
        { shift: S2, was: null, to: ANN },
      ],
    ],
    ["a missing row", [{ shift: S1, was: ANN, to: BOB }]],
    [
      "an extra row",
      [
        { shift: S1, was: ANN, to: BOB },
        { shift: S2, was: null, to: ANN },
        { shift: S3, was: BOB, to: BOB },
      ],
    ],
  ])("differs with %s", (_name, other) => {
    expect(sameRows(listed, other)).toBe(false);
  });
});
