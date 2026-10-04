import json, os, sys
os.environ["OPENHANDS_SUPPRESS_BANNER"] = "1"
from types import SimpleNamespace as NS
WD = sys.argv[1] if len(sys.argv) > 1 else "/workspace"
conv = NS(workspace=NS(working_dir=WD), agent=NS(llm=NS(vision_is_active=lambda: False)),
          persistence_dir=None, env_observation_persistence_dir=None, id="x")
out = []
from openhands.tools.file_editor.definition import FileEditorTool
from openhands.tools.terminal.definition import TerminalTool
from openhands.tools.task_tracker.definition import TaskTrackerTool
from openhands.sdk.tool.builtins import FinishTool, ThinkTool
class _NoExec:
    def __call__(self, *a, **k): raise RuntimeError("schema dump only")
for cls in (TerminalTool, FileEditorTool, TaskTrackerTool):
    try:
        if cls is TerminalTool:
            from openhands.tools.terminal import definition as TD
            from openhands.sdk.tool import ToolAnnotations
            tools = [TD.TerminalTool(action_type=TD.TerminalAction, observation_type=TD.TerminalObservation,
                     description=TD.UNIX_TOOL_DESCRIPTION, annotations=ToolAnnotations(title="terminal",
                     readOnlyHint=False, destructiveHint=True, idempotentHint=False, openWorldHint=True))]
        else:
            tools = cls.create(conv)
    except Exception as e:
        print("create failed", cls.__name__, repr(e)[:300], file=sys.stderr); continue
    for t in tools: out.append(t.to_openai_tool(add_security_risk_prediction=True))
for cls in (FinishTool, ThinkTool):
    try:
        tools = cls.create(conv) if hasattr(cls, "create") else [cls]
        for t in tools: out.append(t.to_openai_tool(add_security_risk_prediction=True))
    except Exception as e:
        print("builtin failed", cls, repr(e)[:300], file=sys.stderr)
json.dump(out, open("oh_tools.json", "w"), indent=1, default=str)
print([o["function"]["name"] for o in out])
