# Open coding 02: reading another team's 6,204 trajectories

> ⛔ **CORRECTION, 2026-10-04 ([`../bench/FINDINGS-SLICE0.5.md`](../bench/FINDINGS-SLICE0.5.md),
> K3 arm).** §3.4 calls the Kimi K3 / OpenHands omissions "a schema interaction" and
> "conditional-required arguments inside a multiplexed tool". A controlled test that held the
> backend fixed and moved only the decomposition found **0 of 24** `create` omissions under a
> multiplexed tool (pre-registered kill condition K1). The finding is restated: it is **a harness
> interaction whose component is unidentified.** The facts in §3.4 stand: 48 rejections per 1,000
> calls, valid JSON, the same provider, 57% identical repeats. Only their attribution to the
> decomposition is withdrawn. The rest of this document is not edited.


**Status:** secondary analysis of released data, not a bench slice. No model calls were made.
Subject: *Finding the Right Fit: Model–Harness Interactions across Agent Tasks* (Li et al., NTU,
arXiv:2610.00917v1, 2026-10-01), and its released trajectories
(`huggingface.co/datasets/yixuanli97/finding-the-right-fit`, CC BY-NC 4.0) and code
(`github.com/liyix/finding-the-right-fit` @ `0cd55e1`).

**Date:** 2026-10-04 · **Coder:** one (an LLM assistant, under the maintainer's direction) ·
**Inter-rater agreement:** none measured. See §6.

Scripts: [`../analysis/right-fit/`](../analysis/right-fit/). Every number below is printed by one
of them. The dataset is not redistributed here; `fetch.py` downloads it and checks file sizes.

---

## 1. Why this exists

The paper evaluates 66 model–harness configurations (four configurable harnesses × five models ×
three benchmarks, plus Codex–GPT and Claude Code–Claude). Its claims: model rankings reverse
across harnesses; for four of five models the best harness changes between benchmarks;
openJiuwen gives Kimi K3 its best score on all three benchmarks; native harnesses are not
reliably best. Its headline sits next to this repository's own: **a score is conditional on the
layer the model acts through.** The paper measures that at the outcome level, with whole harnesses
as the unit. This repository measures it at the protocol level, one variable at a time.

A first reading of the PDF raised two hypotheses and one instrument check. They were written
down before any trajectory was opened:

- **H1.** Some of what the paper scores as harness or model failure is transport failure. The
  paper's own sentence: *"Turns cut off by provider stream errors (25 of Kimi's 62 PI runs on
  TB4) and sandbox stalls are scored as failures; we attribute them to harness resilience rather
  than model behavior"* (§5.1). [`MEASUREMENT-DISCIPLINE.md`](MEASUREMENT-DISCIPLINE.md) rule 8
  says an `ERROR` is never a verdict about the model, and the harness is not obviously the right
  owner either.
  *Kill condition:* removing transport-terminated tasks leaves Kimi's openJiuwen leads unchanged.
- **H2.** "Kimi often issues malformed tool calls" (abstract) may be partly serialization.
  Every model is reached through OpenRouter, an unmeasured intermediary in exactly the layer where
  malformation is recorded. [`OPEN-CODING-01.md`](OPEN-CODING-01.md) C1 found a serving stack
  truncating native `arguments` before the client saw them.
  *Kill condition:* the arguments arrive as valid JSON, and the errors are confined to one tool
  schema while the same provider serves the other harnesses.
- **E1 check.** OpenHands' stuck detector ends runs on "repeated identical actions". Before
  trusting it, confirm that those actions are invocations and not quotations, the error this
  repository made in Slices 0.3 and 0.4.

One test was **added after** seeing the results table, and is labelled as such: whether "the
best harness changes across benchmarks" survives task-sampling noise (§3.1).

## 2. Data and definitions

- 6,204 runs (one counted run per task per configuration, as released). 6,067 carry a
  conversation. `results/task_level.tsv` reproduces the per-configuration scores the paper reports
  (for example Kimi K3 / openJiuwen / TB4 = 28.57, Claude Opus 5 / OpenHands / TB4 = 57.14).
- **Transport-terminal run:** the run has a harness event of an error type (`assistant_error`,
  `model_error`, `turn_end`, `llm_retry`, `context_compaction_failed`) whose text matches
  provider or transport failure (stream ended, connection lost, idle timeout, provider returned
  error, 5xx/429/413, credits exhausted, …), at or after the last assistant message
  (`census.py`). This definition reproduces the paper's count exactly: **25 transport-terminal
  runs for Kimi / PI / Terminal-Bench 4**, and none of the 25 scored above zero.
- **Tool-call states**, following `BENCH-DESIGN.md` rule 2: *absent* (tool-shaped text with no
  structured call), *unreadable* (`arguments` not valid JSON), *readable but rejected* (the tool
  result reports a missing or invalid argument).

## 3. Findings

### 3.1 "The best harness changes across benchmarks" is mostly inside task-sampling noise *(added after seeing the table)*

For each (benchmark, model): the top harness against the runner-up, an exact sign test on
discordant tasks, and the share of 5,000 task-level bootstrap resamples in which the top harness
stays on top (`argmax_stability.py`).

| benchmark | model | best | runner-up | lead | tasks better–worse | sign p | argmax stable |
|---|---|---|---|---|---|---|---|
| TB4 | Kimi K3 | openJiuwen | DSH | 11.11 | 8–1 | **0.039** | **0.99** |
| ALE | Kimi K3 | openJiuwen | PI | 6.91 | 25–13 | 0.073 | **0.98** |
| TB4 | Claude Opus 5 | OpenHands | Claude Code | 7.94 | 11–6 | 0.332 | 0.86 |
| TUA | Kimi K3 | openJiuwen | PI | 5.61 | 22–13 | 0.175 | 0.86 |
| TUA | Claude Opus 5 | Claude Code | openJiuwen | 3.50 | 13–7 | 0.263 | 0.82 |
| TUA | DeepSeek V4 Pro | openJiuwen | PI | 5.01 | 26–16 | 0.164 | 0.81 |
| *other 9 cells* | | | | 0.15–4.76 | | 0.51–1.00 | 0.50–0.76 |

In 13 of 15 cells the runner-up cannot be separated from the winner. A "best harness" that
flips between benchmarks is what near-ties produce under resampling alone. This captures **task
sampling only**. Run-to-run variance, which the paper states it did not measure (§Limitations),
would add to it.

The paper's headline reversal is not in this category. Claude Opus 5 on Terminal-Bench 4 does
better under OpenHands than under PI on 20 tasks and worse on 3 (p = 0.0005). The GPT side of
the same reversal (PI against OpenHands, 10–3) gives p = 0.09. **The rank reversal is real, and
it is mostly Claude collapsing under PI.**

### 3.2 H1: partly confirmed. Transport accounts for most of the PI gap on Terminal-Bench 4, but not for the gap to the runner-up

`kimi_reanalysis.py`, Kimi K3, openJiuwen against each other harness. "Clean" drops any task
where either side's run was transport-terminal.

| benchmark | vs | lead (paper) | better–worse | p | tasks dropped | lead (clean) | better–worse | p |
|---|---|---|---|---|---|---|---|---|
| TB4 | **PI** | **17.46** | 12–1 | 0.003 | 29 | **5.88** | 3–1 | **0.625** |
| TB4 | DSH (runner-up) | 11.11 | 8–1 | 0.039 | 6 | 10.53 | 7–1 | 0.070 |
| TB4 | OpenHands | 17.46 | 14–3 | 0.013 | 6 | 17.54 | 13–3 | 0.021 |
| ALE | PI (runner-up) | 6.91 | 25–13 | 0.073 | 2 | 7.05 | 25–13 | 0.073 |
| ALE | DSH | 13.22 | 30–14 | 0.023 | 5 | 14.76 | 30–13 | 0.014 |
| TUA | PI (runner-up) | 5.61 | 22–13 | 0.175 | 0 | 5.61 | 22–13 | 0.175 |

- Against PI on TB4, two thirds of the lead was transport. Once the 29 affected tasks are
  dropped, it is not distinguishable from zero.
- The paper's headline margins are against the **runner-up**, and those barely move. H1's kill
  condition is met for the headline numbers and not met for the PI comparison.
- What survives with p < 0.05 after cleaning is openJiuwen against **OpenHands** on all three
  benchmarks, and against DSH on ALE. The OpenHands gap has a specific mechanism (§3.4).
- **Dropping tasks is not random.** Long tasks provoke more stream errors and may also be harder,
  so the clean comparison is conditional on a selected subset.

### 3.3 The scored transport failures name providers that the configuration excludes

The study configuration pins Kimi K3 to `provider_only: [moonshotai/mxfp4]` with
`allow_fallbacks: false` (`experiment.yaml`). The error text of the scored runs
(`providers.py`):

| Kimi K3 / PI / TB4 batch (`source.run_id`) | provider named in the error | runs |
|---|---|---|
| `…daytona-cpu63-c50-20260911-r3` | **Sail Research** ("the stream ended unexpectedly") | **20** |
| `…daytona-recovery27-c27-20260911-r1` | **Morph** (internal server error) | 2 |
| `…local-infra5-rep2-20260915-r1` | Moonshot AI | 4 |

All 20 Sail Research failures come from one batch: run at concurrency 50, on one day. In every
other configuration where a provider is named, it is the first-party one. The release does not
record which provider served the *successful* generations, so this shows only that the pin did not
hold for the failing requests in that batch. It does not show how many Kimi–PI calls were served
off-pin. Under the paper's policy, infrastructure failures are rerun and stream errors are not,
because they are classed as harness resilience. So a routing failure clustered in one batch
stayed in the score as a harness property.

Two smaller items from the same census, reported here and not pursued:
- 4 DeepSeek V4 Pro / openJiuwen / ALE runs carry a `model_substitution` event: 49–91% of their
  responses were served by `deepseek/deepseek-v4.1-flash`. Two of them scored 1.0.
- DSH has `unresolved_zero` on 90 of 1,410 runs (6.4%; 12–17 per model on ALE). Every other
  harness is at or below 1.0%. Six GPT-6 Astra / DSH / TB4 runs hit "request would exceed your
  available credits"; four scored 0. That configuration is the paper's high-cost example: PI
  60.32% at $4.66 per task against DSH 52.38% at $19.94.

### 3.4 H2: falsified for the dominant mechanism. The "malformed calls" are readable, and they are a schema interaction

`census.py`, all 20 model × harness pairs with structured calls:

- **Unreadable** `arguments` (invalid JSON): 0.08–0.87 per 1,000 calls everywhere. Kimi under
  OpenHands is 0.14. The arguments reach the harness intact.
- **Absent** (tool-shaped text without a structured call): 0–2 messages per configuration.
- **Readable but rejected:** Kimi K3 under OpenHands is **48.0 per 1,000 calls**. The other 19
  pairs are 0.5–4.1. Kimi under PI, DSH and openJiuwen is 2.7, 1.5 and 1.2.

This is the strongest model × harness interaction in the dataset. Its content
(`kimi_openhands.py`):

| tool error returned | n |
|---|---|
| `Parameter file_text is required for command: create.` | 520 |
| `Parameter old_str is required for command: str_replace.` | 111 |
| `Parameter new_str is required for command: str_replace.` | 15 |

524 of Kimi's 1,294 `file_editor create` calls (40%) carry no `file_text`. A typical one is
`{"command":"create","path":"/tmp/decode.js","summary":"Create decoder script","view_range":[]}`.
It is well-formed, it includes an argument that `create` does not use, and it omits the one
argument `create` needs. OpenHands exposes a single multiplexed `file_editor` whose arguments are
**conditionally required by `command`**. The harnesses where Kimi does not fail expose separate
write and edit tools. The same first-party provider (Moonshot AI) is named in the OpenHands error
events, so the serving route does not differ.

H2's kill condition is met. The dominant failure is not serialization. In this repository's
terms it is **a backend failing a specific exposure form**: conditional-required arguments inside
a multiplexed tool. The paper's term "malformed" puts it in the envelope family (A in
`OPEN-CODING-01`), where it does not belong.

*Caveat:* the harnesses differ in more than the schema (system prompt, tool descriptions,
history handling). That the schema shape is the cause is an inference, not an isolation.

### 3.5 E1 check: passes

Every Kimi stuck-detector run (48) ends with four assistant turns that are structured calls. In
47 the last tool result is the argument error, and in 36 the four calls are byte-identical apart
from call ids. The detector fired on real invocations. One GLM-5.3 run is different: it ends with
a call followed by three empty assistant turns. **Count discrepancy, unresolved:** this census
finds 58 stuck-detector runs (Kimi 48, DeepSeek 7, GLM 3) with none scoring above zero. The paper
reports 55 runs, 48 of them Kimi, and one scoring above zero.

### 3.6 Recovery: the feedback was usable, and it was ignored

After a `file_editor` argument error, Kimi's next call (`kimi_openhands.py`, `OPEN-CODING-01`
D-codes):

| next call | share |
|---|---|
| D2 identical repeat | 57.1% |
| D1 fixed, same tool | 13.6% |
| D4 abandon the tool for `terminal` | 13.3% |
| D2b changed arguments, still missing the required one | 8.7% |
| run ends | 7.3% |

The paper's general mechanism is that fit depends on *"whether the harness hands failures back
in a form the model can use."* Here the harness returned the exact missing parameter by name, and
57% of the responses repeated the call byte-for-byte. For this pair, fit is about the
exposure form, not about the quality of feedback. The paper also observes the openJiuwen tool split,
but it lists that as one of three co-equal causes.

## 4. What this means for this repository

1. **Positioning.** The paper owns breadth: 66 configurations and three benchmarks. It states that
   it does not *"isolate the causal effect of any single component"*. That isolation is this
   repository's slot. [`../RELATED-WORK.md`](../RELATED-WORK.md) §5 records the split.
2. *(Restated 2026-10-04: see the correction at the top. The decomposition alone does not reproduce it.)* **The one strong interaction in 6,204 runs is a tool-schema interaction.** That puts this
   repository's construct (exposure form × backend) at the centre of the largest public
   model–harness dataset. The evidence there is observational, though. It is the natural next
   slice: same backend, native form, a multiplexed `file_editor(command, file_text?, old_str?,
   new_str?)` against split `write_file` / `edit_file`, with conditional-required omission as the
   pre-registered dependent variable. Kimi K3 is the predicted positive, and at least one other
   backend is the predicted null.
3. **It supports nothing about in-band contamination.** The claim retracted on 2026-09-25 is
   still retracted. None of the findings above involve payload data entering the control channel.
4. **Rules confirmed on someone else's data.** Rule 8 (`ERROR` is not a verdict) changes a 17-point
   comparison into a 6-point non-result (§3.2). The routing intermediary failed silently in one
   batch (§3.3), which is why this repository refused an unmeasured gateway as a fourth lineage. A
   ranking taken at the argmax with no resolution check is the same failure as a saturated grid:
   the tool prints an answer it cannot support (§3.1).

## 5. What would falsify this

- **§3.1** is wrong if repeated runs show run-to-run variance small enough that the near-tied
  winners replicate.
- **§3.2** is wrong if rerunning the 25 transport-terminal Kimi–PI tasks on a working route scores
  near zero again. That would make the failures task-driven and not route-driven.
- **§3.3** is wrong if "Upstream error from Sail Research" is OpenRouter's label for a
  sub-deployment of the pinned endpoint and not a separate provider.
- **§3.4** is wrong if Kimi K3 omits conditionally-required arguments at a comparable rate under a
  split-tool schema when everything else is held fixed, or if a multiplexed schema shows no
  omission with OpenHands' prompt removed.

## 6. Limits

- **One coder**, who formed H1 and H2 from the paper before reading the data. The argmax test
  was added after seeing the table.
- **Transport classification is a regular expression** over harness event text. It reproduces the
  paper's 25/62 on the one cell the paper reports, which is a calibration point, not a
  validation.
- **No access to the provider of successful calls**, so the extent of off-pin serving is unknown.
- **The schema attribution in §3.4 is observational.** Harnesses differ in many ways at once.
- **Data licence:** CC BY-NC 4.0. Only scripts and summary numbers are in this repository; the
  trajectories stay on Hugging Face.
