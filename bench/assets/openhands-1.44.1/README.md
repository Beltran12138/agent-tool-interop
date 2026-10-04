# OpenHands 1.44.1, LLM-facing surface

This is what OpenHands 1.44.1 sends a model on every completion, rebuilt from the MIT-licensed
packages (`openhands-sdk==1.44.1`, `openhands-tools==1.44.1`; licence in `LICENSE-OpenHands`). It
is used by Slice 0.6 (`../../slice06.js`).

| file | what | how it was produced |
|---|---|---|
| `tools.json` | `terminal`, `file_editor`, `task_tracker`, `finish`, `think` as OpenAI function tools | `gen/dump_oh_tools.py` calls `ToolDefinition.to_openai_tool(add_security_risk_prediction=True)`, which is the call the agent makes (`openhands/sdk/agent/utils.py`). `gen/post_oh_tools.py` then sets the working directory in the descriptions to `/workspace`. `terminal` uses the Unix description, built directly, because `create()` picks the PowerShell variant on Windows. Vision is off, as configured for Kimi K3 in Right Fit. |
| `system_prompt.txt` | the static system prompt | `gen/render_sys.py` renders `Agent.static_system_message`. `gen/norm_sys.py` replaces the two platform words (Windows renders `powershell`, Linux `bash`). Verified **identical** to the system prompt logged in Right Fit's Kimi K3 / OpenHands trajectories once their trailing `<CURRENT_DATETIME>` block is removed. The runner appends that block with the run time. |

To regenerate (Python ≥ 3.12):

```
uv venv -p 3.13 .venv && uv pip install -p .venv openhands-sdk==1.44.1 openhands-tools==1.44.1
.venv/Scripts/python gen/dump_oh_tools.py <an existing dir> && python gen/post_oh_tools.py <same dir>
.venv/Scripts/python gen/render_sys.py && python gen/norm_sys.py oh_system_sdk.txt <logged prompt> system_prompt.txt
```

(`render_sys.py` diffs against a logged prompt file, which comes from the Right Fit dataset and is
not redistributed here. Delete those lines to render without it.)

Not reproduced here: request shaping by LiteLLM, and OpenRouter's serving path.
