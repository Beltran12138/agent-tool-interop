# Slice 0.6 — the OpenHands surface does not reproduce the omission

Run `2026-10-04T08-06-21-880Z`. Kimi K3, Moonshot first-party (`api.moonshot.cn`), settings as in
the Slice 0.5 amendment. Stage 1 only: `OH` (OpenHands 1.44.1 system prompt + five tool
schemas, rebuilt exactly from the MIT packages, see `assets/openhands-1.44.1/`) against `BASE`
(Slice 0.5's `MUX`). 5 create-first tasks × 6 repetitions × 2 arms = 60 cells, 0 `ERROR`.
Offline assertions: `test-slice06.js` (16). Cost ¥6.13 by account balance.

Pre-registered in [`../docs/BENCH-DESIGN.md`](../docs/BENCH-DESIGN.md) at commit `e357b3c`, before
any harness code for this slice.

## Result

| arm | first `create` omits `file_text` | all `create` omissions | `file_editor` calls carrying `summary` / `security_risk` | outcomes |
|---|---|---|---|---|
| `OH` | **0/30** | 0/30 | 47/53 / 26/53 | 30 OK |
| `BASE` | 0/30 | 0/30 | 0/44 / 0/44 | 30 OK |

Every task, every repetition: 0. Right Fit's Kimi K3 under OpenHands: **155/184 (84%)**.

**Decision rule: NOT REPRODUCED** (`OH` ≤ 10%). Stage 2 does not run. The exact OpenHands
prompt-and-tool surface is **not sufficient** to make K3 omit on the first-party serving path.

The surface did change behaviour, so the arm was not inert. Under `OH` the model used the
injected meta-fields (`summary` on 89% of `file_editor` calls), called `terminal` 42 times and
`finish` 19 times, and took 4 turns at the median against 2. It read the OpenHands surface and
acted on it. It just did not omit.

## What is now excluded, and what is left

Excluded for K3 on this serving path, each by a controlled arm:

| candidate (from `FINDINGS-SLICE0.5.md`) | how |
|---|---|
| multiplexed tool with conditional requirements | Slice 0.5, K3 arm (0/24) |
| nullable argument types | not present: `file_text` serializes as a plain `string` |
| injected `security_risk` / `summary` fields placed first | present in `OH`, used by the model, 0/30 |
| the 2,100-character `file_editor` description | present in `OH`, 0/30 |
| the OpenHands system prompt and the other four tools | present in `OH`, 0/30 |

My own prediction (that `A-meta` would drop the most) assumed the surface reproduced. It never
got to be tested.

Left, in order of how cheaply each can be tested:

1. **Conversation content.** Right Fit's first `create` came after a long benchmark task and,
   usually, some exploration turns. 181 of 184 first `create` calls came after more than
   20k characters of conversation, system prompt included. Here the system prompt alone is about
   15k and the task is one sentence.
2. **The serving path.** Right Fit reached K3 through OpenRouter's `moonshotai/mxfp4` endpoint.
   The quantization behind the first-party API is unstated. OPEN-CODING-02 §3.3 also found the
   OpenRouter pin failing for some Kimi requests.
3. **A model change** between Right Fit's runs (2026-09-10 to 09-15) and today. It cannot be
   tested without the old checkpoint, and it is not separable from (2) without an OpenRouter run.
4. **Request shaping by LiteLLM** (message structure, `cache_control`, tool-call history format).

## The test that separates 1 from 2

**Prefix replay:** send first-party K3 the exact Right Fit conversation up to each original first
`create`, and record whether the next call omits `file_text`.

- If it reproduces (high omission on first-party), the cause is in **the content**, and (2)/(3)
  are cleared.
- If it does not, the content is cleared, and the serving path or model version is left.

It costs about ¥10. It also needs a decision this project cannot make alone. It sends benchmark
task content (TUA-Bench, ALE-CLI, Terminal-Bench 4, which carry a do-not-train canary) to a
commercial API, and the dataset asks that it not be exposed to agents under evaluation. K3 is not
being evaluated on those benchmarks here. Whether that meets the spirit of the dataset terms is the
maintainer's call. That is why it was excluded from the pre-registration.

The alternative that avoids the question is synthetic long tasks: realistic multi-step briefs
written for this bench, run first-party. It is weaker. It can confirm (1) only if it happens to
capture the relevant property of the content, and a null result would leave both (1) and (2)
standing.
