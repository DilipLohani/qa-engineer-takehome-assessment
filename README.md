# QA Engineer Take-Home Assessment

Submission for the CAPI Survey Builder + offline-first Android field app QA
assessment. This README covers setup, the hands-on automation, and every
written/strategy question from Parts 1–4.

## Quick start

```bash
npm install
npx playwright install chromium   # downloads the browser Playwright drives
npm test                          # runs both suites below
npm run test:api                  # API-only
npm run test:web                  # web-only
npm run report                    # open the last HTML report
```

Running `npm test` starts two local processes automatically (via
Playwright's `webServer` config) and tears them down after:

- a mock Express server (`mock-server/server.js`, port 4000) implementing
  the `POST /sync-survey` endpoint from Scenario A
- a tiny static file server (`mock-web/serve.js`, port 5000) serving a
  minimal HTML page that **dynamically renders a real survey from the
  sample JSON schema**, so the skip-logic test exercises actual rendering
  logic rather than a hand-built fixture page

Both suites currently pass (8/8).

## Repo structure

```
0.QA Assessment.docx                 — the brief (reference, unmodified)
1.Android App Specification.html     — reference (unmodified)
2.Survey Builder Tool Capabilities.html — reference (unmodified)
3.Sample Survey Schema.json          — reference (unmodified — see bug note below)

mock-server/server.js                — Scenario A: /sync-survey with dedup logic
mock-web/                            — Scenario B: dynamic form renderer fixture
  schema-fixed.json                  — corrected copy of the sample schema (see below)
  index.html / render.js / serve.js

tests/api/sync-survey.spec.ts        — Scenario A automation
tests/web/skip-logic.spec.ts         — Scenario B automation

test-plans/hfc-engine-test-plan.md   — Scenario E test plan
playwright.config.ts, package.json   — tooling
```

## Tooling choices and why

- **Playwright, for both API and web.** Playwright has first-class API
  testing (`request` fixture) as well as browser automation, so one
  toolchain and one `npm test` covers Scenario A and Scenario B instead of
  splitting across Postman + Cypress. Lower setup friction for whoever
  reviews this.
- **A real (if tiny) Express server instead of only stubbing responses.**
  The interesting part of Scenario A is the *dedup logic itself* — keying
  on `deviceId + localId` instead of `localId` alone, plus a
  `submissionId` idempotency key for retries. Mocking the HTTP layer
  entirely would have let me assert on canned responses without ever
  proving the dedup logic is correct. A real in-memory server means the
  tests exercise actual server-side state.
- **A real dynamic renderer instead of a hardcoded HTML fixture.** Scenario
  B's premise is specifically that the *mobile app renders a schema it
  doesn't control*, and that's where regressions happen. A static page
  with the hobby question hardcoded would test nothing about schema-driven
  rendering. `mock-web/render.js` reads `visibilityLogic` off the JSON the
  same way the spec describes (§8 of doc 2) and evaluates it generically
  for any question, so the test is really exercising the rule engine, not
  a specific page.

## Bug found in the provided fixtures

While wiring the sample schema into `mock-web`'s renderer, `3.Sample
Survey Schema.json` failed to parse. Two issues in the second survey's
`formChecks[].logic` array (around line 157–160):

1. Missing comma between the two logic entries — invalid JSON outright.
2. The entries use `"questioID"` as the key, but
   `2.Survey Builder Tool Capabilities.html` §11 documents the field as
   `"attr"` (`<attr> references a Core Attribute code or a questionId`).
   `questioID` is also misspelled (missing the second `n`).

I didn't want to edit the reference file you gave me, so
`mock-web/schema-fixed.json` is a corrected copy used only to drive the
demo renderer, with the discrepancy noted at the top of that file. This
is also exactly the class of bug Scenario B and E are both worried about —
see test-plan row 21 for a dedicated regression test for it.

---

## Part 1 — Strategy answers

### Scenario A: testing Android background sync under poor network

Tools: **Charles Proxy / Proxyman** as the MITM proxy on the test
device's Wi-Fi, **ADB** for device-level network control, and **Android
Studio's Network Profiler** to see the actual transfer in progress.

To hit the exact "network drops at 99% of a photo upload" case:

1. Route the device's traffic through Charles/Proxyman (install its root
   CA on the test device so HTTPS can be inspected — note if the app
   pins certificates in release builds, a debug/staging flavor without
   pinning is needed for this, which is itself worth flagging as a gap
   if it doesn't exist).
2. Use **Throttling** to set an upload bandwidth low enough to watch the
   transfer progress in real time, and a **Breakpoint** or **Map Local**
   rule on the upload request to interrupt the connection once a known
   byte count (≈99% of the known file size) has been sent — Charles lets
   you drop the connection mid-response via a breakpoint "Abort" action,
   or you can throttle to near-zero right before completion.
3. Alternatively (more scriptable, no proxy needed): point the app's
   base URL at a tiny local Node server that accepts the multipart
   upload stream and calls `req.socket.destroy()` after N bytes — this
   is more deterministic than timing a proxy breakpoint by hand and is
   the approach I'd actually automate for CI.
4. Watch what happens with **ADB**: `adb shell dumpsys jobscheduler` to
   confirm WorkManager's retry is scheduled with backoff, `adb logcat`
   filtered on the app's sync tag to see the retry attempt, and re-open
   the app's Room DB (see Scenario C below) to confirm the survey row is
   still marked "pending," never "synced," and the photo isn't silently
   dropped.
5. Also test the inverse edge case: connection drops *after* the server
   received 100% of the bytes but *before* the client receives the ack
   — this is the actual root cause of the duplicate-ID problem in
   Scenario A (client retries a "successful" upload because it never saw
   the response), which is why the mock API's dedup key is
   `deviceId + localId` plus an idempotent `submissionId`, not just
   "did the client get a 200."

### Scenario B: regression strategy for a JSON-schema-driven UI

The key design decision: **test the rendering engine, not the screens.**
Screens aren't fixed artifacts here — they're a projection of whatever
JSON the builder currently produces, so a regression suite built around
specific screens (e.g. "the hobby question looks right") breaks every
time a form author edits content, which trains the team to ignore test
failures.

What I'd automate:
- **A rule-engine test matrix**, independent of any specific form: one
  parametrized test per `visibilityLogic` condition (`equals`,
  `not_equals`, `contains`, `greater_than`, `less_than`, `is_empty`,
  `is_not_empty`) against a minimal synthetic fixture, the way
  `tests/web/skip-logic.spec.ts` does for `equals`. This is what catches
  "a new feature broke existing form logic," because it tests the
  interpreter, not any one form's content.
- **A JSON Schema / contract test** that validates whatever the builder
  exports against a formal schema (question types, required fields,
  `visibilityLogic`/`formChecks` shapes) and runs in CI on every builder
  PR. This is the single highest-leverage test here — most "builder
  change broke mobile" incidents are a shape change the mobile app wasn't
  told about, and a contract test catches that before it ships, not after
  a field worker hits it. The bug I found in `3.Sample Survey Schema.json`
  (§ above) is exactly what this would have caught.
- **One rendering smoke test per input type** (all 20), asserting each
  type renders its control and reports a value — cheap, high coverage of
  "did we silently drop a type."
- **HFC logic unit tests**, independent of UI (see `test-plans/`).

What I'd leave manual/exploratory:
- Visual layout, spacing, and feel on real low-end devices — automated
  screenshot diffing is high-maintenance against a tool whose whole point
  is that content changes constantly, and it won't catch "this is
  confusing for a low-literacy user" anyway.
- Complex rosters with deep nesting or unusual type combinations authors
  might create — combinatorially large, low frequency, better caught by
  a human occasionally stress-testing the builder with a weird form.
- Translation/localization rendering (Hindi/Marathi/Gujarati/Kannada) —
  automatable for "does text fit the layout," but accuracy/tone needs a
  human reviewer regardless.

### Scenario C: inspecting Room/WorkManager from a release APK

**1. Extract and inspect the local Room database (unrooted device):**
- If the build under test is a debug or `debuggable="true"` build (the
  normal case for QA, even against a "release-config" build variant):
  `adb shell run-as <package> cp /data/data/<package>/databases/survey.db /sdcard/`
  then `adb pull /sdcard/survey.db`, and open it with **DB Browser for
  SQLite** (or `sqlite3` on the command line) to check table contents.
- If it's genuinely a non-debuggable production release and the device
  is unrooted, `run-as` won't work. Fallback, in order of preference:
  (a) ask for a debug-flavored build of the same code for QA use — the
  cleanest answer; (b) if the app declares `android:allowBackup="true"`,
  `adb backup -f backup.ab <package>` then unpack the `.ab` (it's a
  modified tar) to get at app data without root; (c) add a debug-only
  "export DB" action to the app behind a hidden menu, gated out of
  release builds, if neither of the above is available.
- Once extracted, open it and confirm: the survey row exists, its sync
  status column is `pending`/not yet `synced`, and the answer payload
  matches what was entered — *before* touching connectivity, to prove
  offline save genuinely worked independent of sync.

**2. Force the WorkManager job to run immediately via ADB:**
- `adb shell dumpsys jobscheduler | grep -A 20 <package>` to find the
  job ID WorkManager registered under the hood (WorkManager on API 23+
  is backed by `JobScheduler`).
- `adb shell cmd jobscheduler run -f <package> <jobId>` forces that job
  to execute immediately regardless of its constraints (network,
  battery, idle), which is exactly what's needed to test sync without
  waiting for a real connectivity-change event or the job's backoff
  timer.

**3. Simulate a 500 and verify retry without data loss:**
- Proxy the device through Charles/Proxyman, add a **Rewrite** rule (or
  a Map Local response) that returns `500` for the `/sync-survey` request
  instead of hitting the real backend.
- Trigger the sync (step 2), confirm the app surfaces the failure
  gracefully (no crash, no "success" UI state) and that **the Room row
  is unchanged** — still present, still marked un-synced — by re-pulling
  the DB as in step 1.
- Confirm a retry is actually scheduled: `adb shell dumpsys jobscheduler`
  again should show the job re-enqueued per WorkManager's
  `BackoffPolicy` (exponential by default), and `adb logcat` should show
  the retry attempt. Remove the Rewrite rule and confirm the next
  attempt succeeds and the row flips to `synced` — proving no data was
  lost across the failure.

---

## Part 2 — Complex scenarios

### Scenario D: ANR after 3–4 training videos on low-RAM devices

**Reproduce:**
- Prefer a **real low-end device** (closest to the 4GB RAM target) over
  a high-end one; if none is available, create an **AVD with RAM
  explicitly capped** (AVD Manager → hardware profile → set RAM to
  1–2GB) to approximate the constraint, since emulators let you dial
  this down precisely, unlike most physical office devices.
- Reproduce the literal repro steps from the report: watch 3–4 training
  videos back-to-back without closing the app, and watch for the ANR
  dialog.

**Debug:**
- Attach **Android Studio Profiler → Memory** before starting, and watch
  the heap across each "Watch Video" tap. A classic cause here is each
  fake video player (or its thumbnail/Bitmap) never being released —
  heap climbs step-wise with each video and eventually the main thread
  stalls under GC pressure, which is what actually produces the ANR
  (not an OOM crash, a *frozen* main thread).
- `adb shell dumpsys meminfo <package>` before and after each video for
  a quick PSS delta without the profiler attached.
- If the dev can add a debug dependency, **LeakCanary** will directly
  name the leaked Activity/Bitmap/MediaPlayer reference instead of
  making me infer it from a heap graph.
- Pull the actual ANR trace: `adb bugreport` (works unrooted) bundles
  the `/data/anr/traces.txt`-equivalent trace; it names the exact
  blocked thread and stack at the moment of the ANR, which is the single
  most convincing artifact to hand a developer.

**Simulate the constraint directly, without guessing:**
- Emulator RAM profile (above) is the most reliable lever for memory.
- For storage pressure: `adb push` large dummy files until free space is
  near zero, or Developer Options → "Background process limit" set to
  "No background processes" to approximate an aggressively memory-capped
  device killing things the app assumed would stay alive.

**Proving root cause to a developer:** hand over (1) the exact repro
steps plus the device/AVD RAM profile, (2) a Profiler heap snapshot
showing memory climbing per video and never dropping, (3) the
`adb bugreport` ANR trace showing the blocked thread, and (4) if
possible, a LeakCanary report naming the retained object. Steps +
evidence + named root cause, not just "it crashes on cheap phones."

### Scenario E: HFC engine test plan

See [`test-plans/hfc-engine-test-plan.md`](./test-plans/hfc-engine-test-plan.md)
— 21 cases covering both example rules at their boundaries, AND/OR
combinators, all four actions (`flag_silently`, `reask_once`,
`reask_and_flag`, `block`), and — the specific risk called out in the
prompt — dedicated cases (#10, #11) proving `reask_*` actions always
resolve within one re-prompt instead of looping.

---

## Part 3 — QA process & AI integration

### First 30 days (devs currently self-test and push straight to the Play Store)

**Week 1 — observe, don't gate.** Sit in on how releases actually happen
today, read the same reference docs given in this assessment, and start
a running list of bugs found just by exploring — quick, visible wins
that build credibility before asking anyone to change their workflow.
No process changes yet.

**Week 2 — introduce a staging step, not a blocking gate.** Add a Play
Internal Testing (or equivalent) track between "dev's build" and
"production," so there's *somewhere* QA and a few real users see a build
before the public does. Define minimal entry/exit criteria in writing:
entry to merge = the PR's own tests pass + it doesn't touch
sync/HFC/skip-logic without a reviewer from that area; exit to release =
the automated regression suite is green + a short manual pass on one
budget-tier device + no new Critical/Hard HFC regressions. Deliberately
light — the goal is a net, not a wall.

**Week 3 — automate the highest-risk, highest-frequency regressions
first.** This is exactly the triage done in Part 1: the schema-driven
rendering engine, the HFC engine, and sync/dedup logic, because they're
cheap to test (pure logic, no UI) and expensive to get wrong silently in
the field. Wire these into CI on every PR so failures show up before
merge, not after release.

**Week 4 — formalize and retro.** Lightweight templates for test plans
and bug reports, a short retro with the dev team on what's slowed them
down vs. what's already caught something, and a prioritized device lab
list led by a real budget 4GB-RAM device. Adjust criteria based on actual
friction reported, not on a process written in week 1 in a vacuum.

Throughout: show up in standups and PR reviews as a collaborator who
tests *with* the team early (pairing on acceptance criteria before code
is written), not a checkpoint that only appears at the end holding up a
release.

### Leveraging AI

Day-to-day, I use AI tools for: scaffolding test boilerplate (page
objects, API client stubs) so I spend my time on the assertions that
matter rather than setup; generating edge-case checklists from a written
spec (feed it the spec, ask what's missing, then prune); and summarizing
large diffs to scope how much regression testing a change actually
needs.

Concretely for Scenario B: I'd feed an LLM the actual survey JSON schema
and ask it to **enumerate every reachable visibility state** — every
combination of upstream answers and which questions become
visible/hidden as a result — effectively auto-generating the
state-transition table for skip logic, which I'd turn into one
parametrized test case per state instead of writing them by hand. The
same technique (feed the schema + the spec doc, ask what's
inconsistent) is literally how the `questioID`/`attr` and missing-comma
bug in this assessment's fixture would get caught automatically rather
than by someone manually cross-referencing two documents.

### Automation tooling — what to automate first, and why these tools

I automate in order of **(frequency of regression) × (cost of a miss in
the field) ÷ (cost to automate)**. Deterministic, pure-logic engines with
a large blast radius — the skip-logic engine, the HFC engine, sync
dedup — sit at the top: they're cheap to test (no UI, no device needed)
and a silent regression in any of them corrupts or loses field data.
Pure visual/UX concerns (Part 4) sit at the bottom: expensive to automate
reliably (fonts, contrast, glare, "does this feel confusing") and cheap
for a human to catch by actually looking, so they stay manual/exploratory
on a device, not scripted.

For Part 1 specifically: Playwright for both API and web, because it
covers Scenario A and B in one toolchain and one command, and it has a
proper API-testing fixture so I didn't need Postman + a separate browser
tool. A small Express server instead of pure response-mocking, because
the thing actually worth testing in Scenario A is the dedup *logic*, and
that only gets exercised by hitting something real. Both choices
prioritized "the reviewer can clone this and run one command" over using
the maximum number of different tools.

---

## Part 4 — UI/UX & user-centric QA

### Scenario: "Training Video Hub" (video player + 3 paragraphs + a standard "Next" button at the bottom of a scrollable page)

**Beyond functional testing**, I'd evaluate this screen against the
stated user: low literacy, budget small screens, bright outdoor light,
icon/color-dependent comprehension. Functional QA ("does the video play,
does Next advance") tells me nothing about whether this screen actually
works for that user.

**At least 5 specific issues I'd flag:**

1. **Three paragraphs of dense text is a literacy mismatch.** The rest
   of the training flow (per the Android spec) deliberately avoids heavy
   reading — fake videos plus icon-based, color-coded quizzes. A wall of
   text here contradicts that pattern and will simply not be read by the
   target user. Should be 1 short sentence plus icons, or a short audio
   cue, not three paragraphs.
2. **A standard-size "Next" button at the bottom of a scrollable page is
   a discoverability failure.** A user who doesn't realize there's more
   below the video may think the screen is just "done" and get stuck,
   especially on a small budget screen where the video + 3 paragraphs
   push the button well below the fold on first load.
3. **Standard touch target size risks falling under accessibility
   minimums** (~48dp) on lower-DPI budget screens, compounded by field
   conditions (one-handed use, outdoors, possibly gloved or dusty
   fingers) — the button needs to be clearly larger than "standard" here,
   not just technically tappable.
4. **Contrast/legibility hasn't been verified for outdoor sunlight.**
   Text and controls that look fine on an office monitor routinely wash
   out in direct sun on a budget screen. This needs an explicit contrast
   check (WCAG AA, ≥4.5:1) and a real outdoor test, not an assumption
   that "it looked fine in the office."
5. **No defined offline/low-bandwidth behavior for the video player.**
   On 2G or no connectivity, a "standard video player" built assuming a
   network is present may just spin indefinitely with no feedback. It
   needs an explicit cached/downloading/offline state, matching the
   product's whole offline-first premise.
6. *(bonus)* **No visible progress/completion indicator consistent with
   the dashboard's own status language** ("Pending / In Progress /
   Completed" per the Android spec) — this screen should visually
   confirm progress in the same vocabulary the rest of the app uses, or
   it'll feel disconnected from the home screen the user just came from.

**How I'd systematically test for these:**
- Cover the paragraph text and judge whether icons/video alone convey
  the action — a literacy-proxy walkthrough.
- Run an automated accessibility scan (e.g. Android Accessibility
  Scanner) for contrast ratios and touch-target size flags, as a
  baseline before the manual check.
- Physically test outdoors in direct sunlight on the actual
  budget-tier device, not just the office monitor/emulator.
- Test in airplane mode with nothing pre-cached to see the video
  player's actual offline behavior rather than assuming it degrades
  gracefully.
- Run a silent cognitive walkthrough (sound off, no narration) with
  someone unfamiliar with the screen to see if layout alone communicates
  what to do next.

**How I'd communicate these as non-functional findings:** phrase each as
a specific, user-impact statement tied to the brief's own stated
constraints ("our target user has limited reading skills, so three
paragraphs here will not be read" — not "this looks bad to me"), attach
evidence (an outdoor photo, the accessibility scanner report) rather than
opinion, and propose a concrete fix alongside the finding rather than
just flagging a problem. I'd tag these with a distinct label (e.g.
"Field-usability") separate from functional-bug severity, so they're
tracked and prioritized seriously without being treated as a release
blocker the same way a functional defect would be — unless, like the
sticky-Next-button issue, they plausibly block task completion
entirely, in which case I'd escalate them as such.
