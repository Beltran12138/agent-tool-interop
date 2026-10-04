# Slice 0.8 — the exact conversations do not reproduce it either

Run `2026-10-04T09-49-26-352Z` (smoke test: `2026-10-04T09-48-46-395Z`, 1 replay). Kimi K3,
Moonshot first-party, settings as in the Slice 0.5 amendment, OpenHands 1.44.1 tool schemas. 26
prefix replays, one completion each, 0 `ERROR`. The empty-reasoning fallback was never needed:
the API accepted replayed assistant turns without `reasoning_content`. Cost ¥10.65, smoke test
included.

Pre-registered at `cf457c7`. **Maintainer-approved data handling:** benchmark task content from
Right Fit's released trajectories (Terminal-Bench 4, TUA-Bench) was sent to Moonshot's API. Raw
requests and replies are in `runs-private/` (git-ignored, never committed). The public
`summary.json` holds task ids, classifications and token counts only. `replay08.js` regenerates
every request from the public dataset.

## What was replayed

For each sampled Right Fit Kimi K3 / OpenHands run: the conversation **up to, but not
including,** the assistant message holding its first `file_editor` `create`. That means the
run's own system prompt (with its September datetime), the benchmark task, and every exploration
turn and tool output that Kimi had seen, sent with OpenHands' five tool schemas. The pool after
the 120k-character cap held 64 omission prefixes and 15 non-omission prefixes, with 14 excluded
by size. The seed-fixed sample was 10 + 10 omission prefixes (TB4, TUA) and 3 + 3 controls.

## Result

| original first `create` | replays | reply: `create` with `file_text` | **reply: `create` without `file_text`** | reply: other tool (all `terminal`) |
|---|---|---|---|---|
| omitted | 20 | 13 | **0** | 7 |
| included (control) | 6 | 4 | 0 | 2 |

**Primary: 0/13. Decision rule: CONTENT DOES NOT REPRODUCE IT.** On the exact conversations where
September's Kimi omitted `file_text`, today's first-party K3 includes it every time it creates.
Seven replies chose to explore further instead. Non-determinism is visible directly: the smoke
test's single replay of `foodstuff-beta-activity` was a `create`, and the grid's replay of the same
prefix was a `terminal` call. Temperature cannot be set on K3.

## What this closes

Holding the model name, the tool schemas, the system prompt and **the entire conversation** fixed
leaves only what sits between the request and the weights:

| candidate | status after 0.5–0.8 |
|---|---|
| decomposition, injected fields, descriptions, system prompt, other tools | excluded (0.5, 0.6) |
| long brief / exploration situation | excluded (0.7) |
| **the benchmark content and conversation history** | **excluded (0.8)** |
| the serving path (OpenRouter `moonshotai/mxfp4`) | open |
| a model change between 2026-09-10/15 and 2026-10-04 | open |
| LiteLLM request shaping (message structure, `cache_control`, history format) | open |

The three that remain cannot be separated without an OpenRouter run, and even that would not
separate a model change from a serving difference. The checkpoint behind `kimi-k3` in September is
not available to request.

**Consequence for OPEN-CODING-02 §3.4.** The Kimi K3 omission is now best described as **a
behaviour observed through one serving path at one point in time, which does not reproduce on the
first-party API under the same prompts, tools and conversations.** It is no longer evidence about
harness design. A correction to that effect is prepended to OPEN-CODING-02 and appended to
RELATED-WORK §5.

## The pattern that keeps reversing (exploratory)

On the replayed `create` replies, K3 attached the injected `summary` 2 times in 13. Right Fit's
Kimi, on the same prefixes, attached `summary` and dropped `file_text`. Slice 0.7 showed the same
reversal in long synthetic contexts (`summary` on 1/187 `file_editor` calls). Whatever decides
which arguments survive in a long `file_editor` call, it resolved one way in September through
OpenRouter and the other way now, first-party. That is a description, not a mechanism.

## Limits

- One completion per prefix. 13 `create` replies is enough for the pre-registered rule: under a
  true rate of 50%, 0/13 has probability about 0.0001. A low single-digit rate is not excluded.
- Replayed assistant turns carry no `reasoning_content`, because Right Fit did not log it. If
  September's Kimi omitted *because of* its own reasoning trace, a replay without that trace
  cannot reproduce it. This is the one content-side gap left, and the dataset cannot close it.
- The tool descriptions say `/workspace` where Right Fit's named each run's directory, and the
  dataset's head/tail truncation of very long strings is inherited.

## Spend

Slices 0.5 (K3 arm) to 0.8: ¥48.81 in total. The balance is ¥26.19.
