# Slice 0.7 — Right Fit's situation, reproduced; the omission, not

Run `2026-10-04T09-10-10-983Z`. Kimi K3, Moonshot first-party, settings as in the Slice 0.5
amendment. OpenHands 1.44.1 surface (`OH`), four long-brief tasks written for this bench
(`X1`–`X4`, synthetic and deterministic, no benchmark content), 4 repetitions,
`--max-turns=20`, concurrency 4. 16 cells: 14 scored, 2 `ERROR`. Cost about ¥26.

Pre-registered at `8d4f230`, with two amendments, both before the run below: `e830121` (the
task-size specification, restated before any cell) and `8d8a0c3` (budget staging, written
**after 3 cells had been seen, all non-omitting**, which that amendment discloses). The stopped
run `2026-10-04T08-52-59-998Z` (2 cells) is aborted and excluded.

## Result

| | value |
|---|---|
| first `create` omits `file_text` | **0/14** |
| all `create` omissions | 0/14 |
| cells that reached the target situation (≥ 8,858 characters before the first `create`) | **14/14** |
| characters of conversation before the first `create` | median 17,214, min 16,677 (Right Fit: median 21,149, p10 8,858) |
| turn of the first `create` | median 7 (Right Fit: median 9 assistant turns) |
| outcomes | 14 OK |

**Decision rule: NOT REPRODUCED.** `OH` ≤ 10%, and the target situation was reached in every
scored cell, so this is an informative null and not a failure to get there. The design's purpose
was to put K3 where Right Fit's Kimi was when it omitted: a long brief, several files read, about
20k characters and 7–9 turns in. It got there, and K3 wrote `file_text` every time.

`BASE` was not run. Under the budget amendment it is needed only if `OH` reproduces.

### The two `ERROR` cells

Both are `X3` (the config-migration script), repetitions 1 and 2. Each ended in a request that
reached the 300 s timeout at the turn where the model was about to write. No `create` had been
issued in either. Rule 8 applies: they are not evidence in either direction. `X3` repetitions 3
and 4 completed, both without omission. The timeout is a harness constant, and on long-reasoning
turns it is binding. That is recorded as a limit, not adjusted after the fact.

## What is now excluded, and what is left

Across Slices 0.5–0.7, on the first-party API, holding K3 fixed:

| candidate | status |
|---|---|
| multiplexed tool with conditional requirements | excluded (0.5: 0/24) |
| nullable argument types | not present in OpenHands' schema |
| injected `security_risk` / `summary`, listed first | excluded (0.6: 0/30, fields in use) |
| OpenHands' tool description, system prompt and other tools | excluded (0.6: 0/30) |
| **long brief, multi-file exploration, ~17–21k characters before the first `create`** | **excluded (0.7: 0/14, situation reached in 14/14)** |
| the specific content of the benchmark tasks | open. Testable only by prefix replay, which needs the maintainer's decision |
| the serving path (OpenRouter `moonshotai/mxfp4`) | open. Needs an OpenRouter credential |
| a model change since 2026-09-10/15 | open. Not separable from the serving path without an OpenRouter run |
| LiteLLM request shaping | open |

With the approximations in this project, **nothing reproduces the Right Fit omission on
first-party K3 today.** The remaining candidates are almost all **outside the model–surface
interaction** this project measures. They sit in the serving and transport layer, or in the
model's version. That changes how OPEN-CODING-02 §3.4 should be read. "A harness interaction with
an unidentified component" now covers the possibility that the interaction is not with the
harness at all, but with how the requests reached the model in September. That restatement is not
made here, because nothing tested it directly. It is the hypothesis the next test, if any, should
target.

## Exploratory, not pre-registered: in long contexts, the optional field goes

| | `file_editor` calls with `summary` | `terminal` calls with `summary` |
|---|---|---|
| Slice 0.6 (short tasks) | 47/53 | 42/42 |
| Slice 0.7 (long briefs) | **1/187** | 103/103 |

In long contexts, K3 stops attaching the injected optional `summary` to `file_editor` calls, but
not to `terminal` calls. So it does shed arguments from `file_editor` once the conversation is
long. It sheds the **optional** one, and keeps the required `file_text`. Right Fit's Kimi under
OpenHands did the reverse: it attached `summary` and dropped `file_text`. One possibility, stated
as a hypothesis only: whatever made September's Kimi drop `file_text` affected which arguments
survive in a long `file_editor` call, and today's first-party K3 resolves the same pressure the
other way. Nothing here tests that.

## Limits

- **Simulated terminal.** 42 of 103 `terminal` calls hit "not available in this sandbox" (`find`,
  `cut`, pipes). The model then used `file_editor view`. Right Fit's terminal was real. The
  conversation reached the target size anyway, but its texture differs.
- **The timeout** removed 2 of 4 `X3` cells (see above).
- **n = 14** in one arm, and all cells are one model and one serving path. Under a true rate of
  50%, 0/14 has probability below 0.0001. A true rate of a few percent is not excluded.

## Spend, and where this leaves the line of work

Slices 0.5 (K3 arm) to 0.7 cost ¥38.16 in total. The balance is ¥36.84, close to the ¥30 halt.
The tests that remain need either an OpenRouter credential (serving path) or the maintainer's
decision on prefix replay (content). Both are listed in `FINDINGS-SLICE0.6.md`.
