import os, difflib, sys
os.environ["OPENHANDS_SUPPRESS_BANNER"] = "1"
from openhands.sdk import Agent, LLM
from openhands.sdk.tool import Tool
a = Agent(llm=LLM(model="openrouter/moonshotai/kimi-k3", api_key="x", usage_id="x"),
          tools=[Tool(name="terminal"), Tool(name="file_editor"), Tool(name="task_tracker")])
s = a.static_system_message
ref = open("oh_system_tb4.txt", encoding="utf-8").read()
print(len(s), len(ref))
d = [l for l in difflib.unified_diff(s.splitlines(), ref.splitlines(), lineterm="", n=0)]
print("\n".join(d[:40]))
open("oh_system_sdk.txt", "w", encoding="utf-8").write(s)
