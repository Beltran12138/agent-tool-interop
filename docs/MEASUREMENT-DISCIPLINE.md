# Measurement discipline

Every rule below is here because breaking it produced a confident wrong number **in this
repository**, and the run that produced it is still on disk. This is not a list of best
practices. It is an incident log with the practices reverse-engineered out of it.

Read it that way. A rule you cannot attach an incident to is a rule you have not earned, and
several things that look like they belong on such a list are deliberately absent from this one.

Receipts are given as `run-id` (under [`../bench/runs/`](../bench/runs/), indexed in its
`README.md`) and short commit hashes.

---

## 1. Pre-register the dependent variable and the kill conditions — before writing the code that computes them

**Why.** A measurement design written after the numbers exist is not evidence that the design
preceded them, no matter how honestly it is written.

**Incident, positive.** Slice 0.4's central prediction — that a payload contradicting the
specified dialect would elevate adoption *in both directions* — **failed**. Only one direction
showed anything. Because the prediction and its three kill conditions were written into
[`BENCH-DESIGN.md`](BENCH-DESIGN.md) before the grid ran (`cc75074`, run
`2026-08-26T03-34-05-263Z`), the failure was recorded as a failure. Written afterwards, the
same data reads as "we found an asymmetric effect", which is the same sentence with the
falsification quietly removed.

**Incident, negative.** Slice 0's §4 falsification conditions were stated on a dependent
variable that then saturated twice, so they could not fire in either direction. That is
recorded as a dated **Amendment** appended to the design document rather than an edit to §4 —
because a design document that silently comes to match its results has stopped being evidence.

**Mechanical check.** The design file's git history shows the prediction committed before the
run directory exists.

---

## 2. Audit every harness parameter for correlation with the independent variable

**Why.** A parameter that co-varies with the thing you are manipulating is a confound wearing
the costume of a constant.

**Incidents.** Three, all in this bench:

- `max_tokens` was 1024. Prompt-embedded envelopes spend output tokens on the envelope itself;
  a native tool schema does not. So truncation hit the prompt-embedded forms and never the
  native one — **a difference that would have been reported as a property of the envelope**.
  Receipt: [`../bench/backends.js`](../bench/backends.js) lines 95-97, raised to 4096.
- `MAX_TURNS` was 6. Per-turn overhead differs by form, so the cap converted overhead into
  failure for one form while another still had slack. Isolated by moving only that parameter:
  run `2026-08-25T13-59-18-477Z`.
- The request timeout was 120 s against a measured 63 s reply from one backend — close enough
  that a slower day would have produced `ERROR` cells clustered on one model, which reads as a
  property of that model. Raised to 300 s (`REQ_TIMEOUT_MS`).

**Mechanical check.** For each harness constant, ask: does the value I need differ by
condition? If yes, it is not a constant, it is an uncontrolled variable.

---

## 3. A binary "did it work" saturates — and then reports 0.00 spread with total confidence

**Why.** Once every backend can complete every task, the outcome rate stops varying while
everything interesting keeps varying.

**Incident.** Slice 0 saturated at 0.98 (`4151747`, run `2026-08-25T07-44-29-649Z`). The
response — harder tasks — saturated again at 0.98 (`342e9b1`, run `2026-08-25T09-04-29-292Z`).
The problem was never task difficulty. It was the **choice of dependent variable**.

**What fixed it.** Making conformance part of the outcome: score under a scaffold that accepts
only the syntax it specified. The forms separated immediately — native 0.96, prompt-JSON 1.00,
prompt-XML 0.74 (`f231421`, run `2026-08-25T14-05-02-161Z`).

**Mechanical check.** Refuse to evaluate a spread condition when the aggregate is above 0.90 or
below 0.10. The harness prints the guard rather than the verdict; it was added after Slice 0's
report announced a falsification at spread 0.00 with mean 1.00.

---

## 4. Report strict and tolerant side by side — the gap is a finding, not a footnote

**Why.** A lenient parser silently absorbs syntax the prompt never specified. The absorbed
difference is exactly what a real consumer would have rejected.

**Incident.** The same cells read 0.74 strict and 0.93 tolerant for the prompt-XML form. **A
lenient benchmark would have reported 0.93 and seen none of it** — and the missing 0.19 was
entirely conformance, and entirely one model.

**Mechanical check.** Two columns, always. If a report has only one, ask which parser produced
it, and what it forgave.

---

## 5. Gate on competence with a no-protocol baseline — then read the baseline, because the finding may be in it

**Why.** A backend that cannot do the task with no tool protocol at all cannot tell you
anything about the envelope it failed with.

**Incident, the gate working.** `minimax/T8` fails its no-tools baseline and is therefore
excluded from every gated view. Without the gate its envelope failures would have been counted
as evidence about envelopes.

**Incident, the part nobody plans for.** In Slice 0.4 the **strongest result of the entire
slice came out of the baseline, not the grid**. Asked to reproduce five lines of literal text
with no tools and no envelope present, one model silently rewrote them into its own dialect and
failed the copy, while three others copied both variants faithfully. That single cell showed
the dialect prior under study **survives the removal of the entire tool protocol** — so it was
never evidence about envelopes at all, and two unlike causes had been pooled under one flag.

**Mechanical check.** Print baseline outcomes per (backend, task), not just a pass count. The
count would have shown `3/4` and hidden which task and what happened.

---

## 6. Compute a new metric over old traces before spending a run on it

**Why.** A new dependent variable is exactly where an artifact hides, and the cheapest place to
discover that is data you have already paid for.

**Incident.** `dialectDrift` was written for Slice 0.4 and run first over Slice 0.3's persisted
traces. Two things fell out before a single new cell was purchased:

1. **The base rate was not zero.** One no-payload cell drifted, which would have made the
   effect condition's 2/5 look like a clean signal.
2. **The measure was the wrong one.** The payload lives in the *task prompt*, so it is in
   context before the first call, and a model can adopt it from turn 1 — contamination with no
   drift. Slice 0.3's own data contained exactly that cell. A drift-only measure would have
   scored the strongest case as no effect.

The primary measure was changed to adoption-against-base-rate as a result. **That change cost
one offline re-analysis; discovering it after the run would have cost the run.**

**Mechanical check.** Analysis lives in a separate program from execution
([`../bench/analyze.js`](../bench/analyze.js) vs [`../bench/run.js`](../bench/run.js)), so that
adding a metric can never require paying for the grid again. A number that cannot be recomputed
from disk cannot appear in a report.

---

## 7. Never let a parser drop silently

**Why.** A silent drop does not merely lose data. **It manufactures the opposite finding**, and
it does so in the direction the analyst already expects, which is why review does not catch it.

**Incident.** The parser read the first tool call in a message and discarded the rest. Slice 0.1
therefore published "parallelism appeared only in the native form — prompt-XML 0/28". Re-scanning
every persisted trace found 5 of 181 blocks containing more than one call, **including one in
the very run that claim was published from**. The contradicting evidence was on disk at the
moment of publication. Retracted in `f231421`; the retraction is at the top of
[`../bench/FINDINGS-SLICE0.1.md`](../bench/FINDINGS-SLICE0.1.md), not in a changelog.

**Mechanical check.** Every parse path returns *all* matches or an explicit failure. There is no
branch that takes the first of several and returns normally.

---

## 8. "Absent", "unreadable" and "wrong" are three different outcomes

**Why.** Collapsing them destroys the distinction most benches exist to measure.

**Incidents.**

- The classifier reported "every turn produced an envelope that could not be read" as "emitted
  nothing tool-shaped at all" — **the exact distinction the bench is organised around, inverted
  inside the code that enforces it**.
- A model emitted `<parameter name="path>` (quote never closed) and `<parameter>content>42<`
  (no name marker). Zero parameters parse from either. The first analysis described this as the
  model *omitting arguments* — attributing to reasoning what belonged to syntax, which points
  in exactly the wrong direction for a project about exposure form. The parser now counts tags
  present against parameters read and raises a distinct flag when they disagree.

**Mechanical check.** The parse contract has three kinds — `call`, `none` (affirmative
absence), `malformed` — and never defaults or guesses. The classifier is a single shared module
so that the runner and the offline analyser cannot drift apart:
[`../bench/classify.js`](../bench/classify.js).

---

## 9. The terminal state is the verdict; recovery is a flag

**Why.** Naming the first anomaly rather than the final one produces a code that describes the
stumble instead of the outcome.

**Incident.** A cell that emitted a bad argument, was corrected, then wrote a **wrong value**
was reported as a schema violation rather than a wrong-value failure. Both facts are real; only
one is the outcome.

**Mechanical check.** Recovery flags are attached to the record, never returned as the code.
Test: an `OK` cell with `recovered: true` must be expressible.

---

## 10. A transport failure is never evidence about a model

**Why.** Counting infrastructure faults as model failures makes the busiest backend look like
the worst one.

**Incidents.** A gateway outage produced 52 `ERROR` cells in 113 and destroyed a run — that run
is deliberately **not** on disk, and its absence is stated in the index. Later, rate-limit
responses that were not retriable turned our own request pacing into `ERROR` cells, silently
removing measurements.

**Mechanical check.** `ERROR` is excluded from every rate and reported separately, with
clustering by form and by backend printed next to it — because 4 errors clustered on one
backend and 4 spread evenly mean different things. Retries are bounded, apply to transport
faults only, and the attempt count is reported.

---

## 11. The check on a test suite is that the assertion count went up

**Why.** Assertions that cannot fail are worse than no assertions, because they produce the
feeling of coverage.

**Incidents, two.** Assertions were once appended *after* the summary and `process.exit(1)`, so
they neither counted nor could fail the run (recorded in
[`../bench/FINDINGS-SLICE0.1.md`](../bench/FINDINGS-SLICE0.1.md)). Separately, an in-place edit
silently failed to match and the "new" assertions were never added at all.

**Mechanical check.** The suite prints `N passed`. Compare N before and after. Not "the tests
are green" — green is what both failures looked like.

---

## 12. The sampling unit is the model, not the cell

**Why.** Tasks inside one backend share a checkpoint and its priors. They are not independent
observations, and **adding tasks adds no statistical power** — only pseudo-replication.

**Incident.** Slice 0.2's headline rested on 20 cells per form, which is four clusters, one of
which deviated. The natural next step — more tasks, or more backends — was wrong on the first
count and unaffordable on the second. What worked instead was a **within-subject design**:
Slice 0.3 ran the same form twice with one thing changed, making each backend its own control.
Available credentials reach three independent model lineages, and that did not have to change.

**Mechanical check.** Before reporting a rate, count the clusters, not the cells. Prefer a
paired analysis over both conditions of the same unit; report the discordant pairs, which in
Slice 0.3 were 2 against 3 and therefore nothing.

---

## 13. Two causes can raise the same flag

**Why.** Pooling them doubles the apparent evidence for whichever one you were hoping to see.

**Incident.** Slice 0.3 reported "2/2 dialect violations landed on the payload task". Slice 0.4
showed those two cells had different causes: one backend uses the other dialect **everywhere**,
including when merely copying text with no tool protocol present; the other used it **only** on
the payload task, only in the payload's direction, and only after handling it. One is a
text-level prior. One is contamination. They raise an identical flag.

**Mechanical check.** For every flagged cell, ask what the same backend does on the cells where
the hypothesised cause is absent. If that was never computed, the flag count is not evidence.

---

## 14. Publish the traces, index the runs, retract in place

**Why.** A finding is worth what its evidence is worth, and evidence that cannot be inspected is
not evidence — it is testimony.

**Practices.**

- Every raw request and response is persisted per cell, and every run directory is listed in
  [`../bench/runs/README.md`](../bench/runs/README.md) with what it is and, when discarded, why.
  Runs deliberately absent are named as absent. **A run kept only because it was expensive is a
  run that will eventually be quoted.**
- Retractions and narrowings are prepended **to the document that made the claim**, because that
  is the page a reader lands on. Two exist so far: a retraction on Slice 0.1 and a narrowing on
  Slice 0.3.
- Outcome codes may be *recomputed* from disk when a rule changes, and every cell whose code
  moves is printed. But a **parser** change alters what the model sees next, so it changes the
  trajectory and not merely the score — those runs are re-run, not re-scored.
- Corollary, learned the expensive way: data whose trace cannot be published is not neutral.
  A fourth model lineage was available through a gateway whose traces could not ship with the
  repository, and was **rejected for that reason**, leaving one hypothesis openly undecided
  instead of privately decided.

**Mechanical check.** Number of run directories equals number of indexed runs. It has been off
by one exactly once — an empty directory created by a rejected invocation, because the harness
made the directory before validating its arguments.

---

## 15. Availability is a result, and empty is not a value

**Why.** Which backends could be reached, and how hard, belongs in the report rather than in the
gaps of a table.

**Incidents.** Availability is printed before any score. And: sourcing an `.env` file declaring
`FOO=` overwrote a good exported credential with an empty string, producing a 401
indistinguishable from a revoked key. **An empty credential is missing configuration, never a
credential** — see [`../bench/backends.js`](../bench/backends.js), `cred()`.

---

## What is deliberately not here

- **Anything about how to choose tasks.** Two slices of task-difficulty escalation taught only
  that the dependent variable was wrong. No transferable rule was earned.
- **Statistical machinery.** With three model lineages, nothing here supports a significance
  claim, and adding tests would dress up an n that does not carry them. The strength of these
  results is mechanistic — which flag fired in which cell, with the trace on disk — and saying
  so is more useful than a p-value that would not survive contact with a fourth model.
- **Anything about prompts.** This bench manipulates envelopes, not prompt quality, and has
  nothing earned to say about the latter.
