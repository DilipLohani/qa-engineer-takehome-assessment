# HFC (High-Frequency Checks) Engine — Test Plan

**Scope:** the on-device, cross-question quality-check engine described in
`2.Survey Builder Tool Capabilities.html` §11 and exercised by
`formChecks[]` in `3.Sample Survey Schema.json`. This plan targets the
engine's *decision logic* (does a rule fire, what action does it take),
not the Survey Builder's authoring UI.

**Rules under test (from the assignment):**
- R1: `IF Age < 15 AND Education = 'College' THEN action = reask_and_flag`
- R2: `IF Sleep Well = Yes AND Sleep Hours < 6 THEN action = reask_and_flag`

**Primary risk being tested:** the engine must block/re-ask on genuinely
bad data, but must never trap the enumerator in a loop they cannot
escape — every `reask_*` action has to resolve to an accepted (possibly
flagged) answer within a bounded number of prompts.

| # | Category | Scenario | Input sequence | Expected behavior | Why it matters |
|---|----------|----------|-----------------|--------------------|-----------------|
| 1 | Positive | R1 fires on a clear match | Age=12, Education=College | `reask_and_flag`: enumerator is re-prompted, answer is flagged (`show_sup`) regardless of what they re-enter | Core happy path |
| 2 | Positive | R1 fires at the inclusive boundary | Age=14, Education=College | Fires (`<15` includes 14) | Off-by-one on the comparator is the most common HFC bug |
| 3 | Negative | R1 does not fire at the exclusive boundary | Age=15, Education=College | Does not fire | Confirms `<` was implemented, not `<=` |
| 4 | Negative | R1 — one leg of AND is false | Age=12, Education='High School' | Does not fire | `match: "all"` must require every `logic[]` entry true |
| 5 | Positive | R2 fires on a clear match | Sleep Well=Yes, Sleep Hours=4 | Fires `reask_and_flag` | Second rule's happy path |
| 6 | Negative | R2 short-circuits on first false leg | Sleep Well=No, Sleep Hours=4 | Does not fire, even though hours alone would match a naive single-condition check | Catches engines that evaluate each `logic[]` entry independently instead of as a combined AND |
| 7 | Negative | R2 boundary | Sleep Hours=6 exactly | Does not fire (`<6`, not `<=6`) | Boundary regression |
| 8 | Edge | R2 with decimal input | Sleep Hours=5.9 | Fires | Confirms numeric comparison, not string comparison (`"5.9" < "6"` as strings is a classic bug) |
| 9 | Edge | Target question never answered (hidden by skip logic) | `q_2` (Sleep Well) hidden/unanswered because an earlier answer skipped it | Engine treats the attr as empty; rule must not crash and must not fire a numeric comparison against `undefined` | `attr` can point at a question the respondent never saw |
| 10 | Edge | **Infinite-loop guard — `reask_once`** | Enumerator gives the same implausible answer again after the one re-ask | Engine accepts the answer, sets the flag, and advances — does **not** ask a third time | Direct test of the "don't trap the user" requirement |
| 11 | Edge | **Infinite-loop guard — `reask_and_flag`** | Enumerator re-enters the same (or another) flagged value after being re-asked | Engine still advances after exactly one re-ask prompt; flag is recorded; form is never blocked | `reask_and_flag` re-asks but must never become a hard stop |
| 12 | Positive | `block` severity actually blocks | A rule configured with `action: block`, `severity: Critical` fires | Enumerator **cannot** advance past the question until the value is corrected to something that no longer matches the rule | Distinguishes `block` from the `reask_*` family, which must always be escapable |
| 13 | Positive | `flag_silently` produces no prompt | Rule configured `flag_silently` fires | No dialog/toast shown to enumerator; flag is present in the synced payload / supervisor review | Silent flags must not leak into the field-worker UI at all |
| 14 | Positive | `match: "any"` (OR) | Only one of two `logic[]` conditions true | Rule fires | Confirms OR semantics are distinct from the AND default |
| 15 | Negative | `match: "all"` with 3+ conditions | Two of three true | Does not fire | AND must require *all*, not "most" |
| 16 | Edge | Two independent HFC rules on the same question both match | Input satisfies both rules simultaneously | Both flags are recorded independently (not overwritten); if either is `reask_*`, enumerator is not re-asked twice back-to-back for the same question in a jarring way | Multiple `formChecks[]` entries can coexist on one question |
| 17 | Edge | `show_sup` flag visibility | One rule `show_sup: 1`, another `show_sup: 0` | Supervisor review surfaces only the `show_sup: 1` flag; both are present in raw synced data | Supervisor-facing filtering is separate from data completeness |
| 18 | Edge | Re-answering an earlier question after a flag fired | Answer that originally triggered R1/R2 is edited to a non-matching value before submission | Flag clears (or is explicitly superseded) rather than persisting against stale data | Tests re-evaluation timing, not just first-pass evaluation |
| 19 | Edge | Fully offline execution | Device has no connectivity when the flagged answer is entered | Engine still evaluates and fires locally — HFC is on-device logic, not a server round-trip | Core architectural constraint for this product |
| 20 | Edge | `attr` resolves via Core Attribute code shared across two different forms | Form A's AGE question is `q_3`, Form B's AGE question is `q_1`, both mapped to the same Core Attribute `AGE`; an HFC rule references `attr: "AGE"` | Rule fires correctly in both forms despite different `questionId`s | Validates the indirection documented in §4 ("Core Attribute mapping") that HFC relies on |
| 21 | Negative | Malformed/missing `logic[]` entry (e.g. the schema bug found in this assessment — missing comma, `questioID` instead of `attr`) | Load a form whose `formChecks` JSON is malformed | Engine fails to parse that one rule gracefully (logs/reports a schema error) without crashing the whole form render or blocking unrelated questions | Directly ties to the bug found in `3.Sample Survey Schema.json` — see README |

## What's automated vs. manual

- Rows 1–9, 14, 15 are pure input→boolean logic: best covered by **unit
  tests on the rule-evaluation function** in isolation (fast, no UI needed).
- Rows 10–13, 16–18 need the **on-device prompt/flow behavior** and are
  best covered by **Espresso/UI Automator tests on the Android app**
  once it exists, or exploratory testing against a build.
- Rows 19–21 are **integration/exploratory**: offline mode, cross-form
  attribute resolution, and malformed-schema handling are easiest to
  catch by hand first, then lock in as regression tests once reproduced.
