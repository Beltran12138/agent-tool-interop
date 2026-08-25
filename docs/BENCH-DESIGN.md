# toolschema-bench — design note (pre-implementation)

**Status:** design only. No code written. This document exists to fix the measurement
before writing the harness, because every prior project in this line failed at the
measurement, not the implementation.

## 1. The question

> Holding the task and the backend fixed, does **the form in which tools are exposed**
> change whether the backend emits a tool call the harness can execute?

`SPEC.md` §6 defers a conformance suite. This is that suite's v1, scoped to the half of
drivability that is actually measurable at scale.

### 1.1 An honest scope shift, stated up front

Drivability is a joint property:

```
drivable(agent, backend) = f( how the agent exposes tools , whether the backend can emit against that form )
```

`analysis/01` measured the **agent** side with n=2 directly observed CLIs. That side does
not scale: you cannot make a shipped CLI advertise a different schema without patching it,
which this project does not do.

The **backend** side does scale. A harness we control can hold everything fixed and vary
only the exposure form. So this bench measures:

> For each schema form S and backend B: can B emit a well-formed call against S, and does
> the referenced tool then execute correctly?

**This is not the same claim as `analysis/01` and must not be reported as if it were.**
It is the general function whose special case Family B illustrates. Where `analysis/01`
says "this vendor's wrapping is not drivable," this bench says "here is the drivability
surface across schema forms, for backends anyone can rent."

## 2. Design

**Independent variable — the only one that moves:** the tool-exposure form.

| id | Form | Notes |
|---|---|---|
| `S1` | OpenAI-style `tools:[{type:"function",function:{…}}]` → `tool_calls` | the de facto baseline |
| `S2` | Anthropic-style `tools:[{name,input_schema}]` → `tool_use` blocks | different envelope, same semantics |
| `S3` | Responses-style (flattened `type:"function"`, `developer` role) | the shape matrix row 4 needed a bridge for |
| `S4` | Prompt-embedded XML (`<tool_call><function=X><parameter=Y>`) | ships in real scaffolds |
| `S5` | Prompt-embedded JSON, **no native tool field at all** | the floor case |
| `S6` | MCP-declared, translated down to the backend's native form | tests whether standardization actually neutralizes the variable |

**Held fixed:** task set, tool implementations, `temperature=0`, turn cap, system prompt
skeleton, retry policy.

**Second factor, deliberately crossed:** backend model (≥3, at least one non-reasoning).
Without it, "schema is brittle" and "this one model is brittle" are collinear — the same
mistake that voided the first self-preference design in the sibling project.

**Tasks:** small, deterministic, side-effect-checkable — write a file with given content;
read a file and write a transformed copy; a two-step chain that requires a second tool call
informed by the first result. Scored by inspecting the filesystem, never by reading the
model's prose.

## 3. Six rules carried over from prior failures

These are not general good practice. Each one is a bug that already shipped somewhere in
this line of work.

1. **Two positive controls, not one.** Every (model, schema) cell runs a control whose
   outcome is known. But an *easy* control certifies a sensitivity that does not exist at
   realistic difficulty — measured elsewhere in this line as discriminative power falling
   from 1.00 to 0.10–0.20 once the target was embedded in plausible surrounding content.
   So: one trivial control (single tool, no distractor) **and** one at realistic density
   (5 tools, one plausible distractor). A cell that passes the easy control and fails the
   dense one is reported, not averaged away.

2. **⭐ "Did not emit" and "could not read" must never collapse into the same bucket.** A
   parser default is a fabrication mechanism: it converts *measurement failure* into
   *measurement success with value zero*. This exact bug — `parseFloat` reading a reasoning
   preamble as `0` — nearly produced a clean, large, literature-consistent, and entirely
   false headline in the sibling project. Here the equivalent false headline is
   "Model X cannot drive schema Y." Therefore:
   - `F0` (no tool call emitted) may be recorded **only** on an affirmative check that no
     tool-call structure is present in the raw response.
   - An unparseable or truncated response is `ERROR`, a distinct outcome, never `F0`.
   - Raw responses are persisted for every cell. A claim not re-readable from disk is not
     a result.

3. **Failure is stratified, not binary.** `SPEC.md`'s `compatible` / `dialog-only` split
   merges at least five distinct diseases:

   | code | meaning |
   |---|---|
   | `OK` | executed, correct side effect |
   | `F0` | no tool call emitted — advisory text only |
   | `F1` | tool call emitted, wrong tool selected |
   | `F2` | right tool, arguments violate the declared schema |
   | `F3` | right tool, valid arguments, wrong values |
   | `F4` | executed, but the side effect is absent or wrong |
   | `ERROR` | transport/parse failure — **not evidence about the model** |

   `F0` and `F2` have opposite implications: `F0` says the form was not recognized as tools
   at all; `F2` says it was recognized and the model then failed the schema. Reporting them
   as one number destroys the finding.

4. **No silent drops.** Timeouts and API rejections are a stratum until proven otherwise.
   Report per-cell drop counts; compute drop-set overlap across repeated runs. In the
   sibling project the dropped items reproduced exactly across independent runs (Jaccard
   1.00) and traced to a single mechanism — they were structure, not noise. The harness
   exits non-zero on unexplained drops rather than reporting a smaller n.

5. **Report cell availability separately from cell scores.** Some (model, schema) pairs will
   be rejected at the API layer — a gateway that will not accept an Anthropic-shaped `tools`
   field, for instance. Dropping those cells silently biases the table in the direction of
   whichever schema the vendors happen to serve. Availability gets its own row; it is a
   result, not preprocessing.

6. **Run the construct check on this bench itself.** The question "am I measuring schema
   robustness or model quality?" has a cheap control: a schema-free baseline where the model
   is asked to emit a shell command as plain text, scored by executing it. A model that
   fails everywhere including the baseline is weak, not schema-sensitive. **The finding is
   the within-model spread across schemas, never the absolute score.**

## 4. What would falsify this

Stated before the first run, so the result cannot be retrofitted:

- **Within-model spread across schemas < between-model spread** → schema form is a second-
  order effect and the headline is wrong. Publish that; a negative result here directly
  qualifies the Family A/B claim and is worth more than a soft positive.
- **All models handle all forms at comparable rates** → drivability is a property of agents
  alone and does not generalize to backends. `analysis/01`'s claim narrows accordingly.
- **`S6` (MCP) does not compress the spread** → standardization does not in fact neutralize
  the variable, which is a stronger and more surprising claim than the main one, and must be
  checked twice before being stated once.

## 5. Scope

**Slice 0, before committing further effort:** 3 models × 3 forms (`S1`, `S4`, `S5`) × 3
tasks = 27 cells, plus controls. Runnable in a day. Its only job is to answer whether the
within-model spread is large enough to be worth measuring properly. If it is not, this
document's §4 first bullet fires and the bench stops there.

Full grid follows only if Slice 0 clears.

## 6. Prior art this must cite honestly

- Tool-schema fragmentation is independently documented from the model-training side, with
  more data than this project has — see [`../RELATED-WORK.md`](../RELATED-WORK.md) §3. What
  is not published is the *portability measurement*: their released evaluation code runs a
  single agent strategy against two standard leaderboards.
- Tool-calling benchmarks themselves have a documented validity problem — evaluator-human
  disagreement measured in the high teens across four widely used suites, with false
  negatives dominating. **This bench's own scoring is a deterministic side-effect check
  precisely to stay out of that failure mode**, and that choice should be stated as the
  reason, not discovered later as a defence.

---

## Amendment, 2026-08-25 — after Slice 0 and Slice 0.1

The sections above are left as written, before any cell had run. Two runs have now happened
and one of the design's own choices did not survive them. Recording that here rather than
editing §4 in place: a design document that quietly matches its results is no longer evidence
that the design preceded them.

**§4's falsification conditions are stated on the binary OK rate, and the binary OK rate has
now saturated twice** — at 0.98 with tasks that the `S0` construct check confirms are within
every backend's competence. A dependent variable that sits at the rail cannot fire a
falsification condition in either direction. The conditions are not wrong; they are not
evaluable on that measure.

What replaces it is not "harder tasks" — Slice 0.1 already tried that. It is a change of
measure:

- score under **strict** parsing by default, with tolerant reported alongside, so that
  conformance to the specified syntax is part of the outcome rather than a footnote
- keep the **graded and mechanism measures** — turns to completion, coercions required,
  parallelism available, dialect drift, malformed-and-recovered — as first-class results.
  These kept varying after `OK` stopped. See `../bench/FINDINGS-SLICE0.1.md`.

**Rule 1 also needs strengthening.** It warns that an easy positive control certifies a
sensitivity that does not exist. In Slice 0 that happened at the level of the *entire grid*,
and both controls passed while the grid measured nothing. A third control at grid difficulty
was added for Slice 0.1. The general form of the rule is: **a control can only speak to the
range it spans, and a grid needs a control at its own hardest point, not below it.**
