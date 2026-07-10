# agent-tool-interop

**An interoperability research initiative for AI coding-agent tool-use interfaces.**

This project studies how different AI coding-agent CLIs expose their tool-use interfaces to inference backends, documents the resulting compatibility landscape, and proposes a vendor-neutral interface contract. It is **research and documentation**, not a tool.

## What this is

- A **protocol analysis** of how agent CLIs advertise tools to backends, and why some are drivable by third-party backends while others are not.
- An **interface specification** ([`SPEC.md`](SPEC.md), v0 draft) defining what it means for an agent CLI to be tool-use interoperable.
- A **compatibility matrix** documenting observed (agent, backend) behavior.
- A **registry** structure for community interoperability reports.

## What this is *not*

- **Not** a tool to connect a specific backend to a specific agent.
- **Not** a source of runnable patches, binaries, or bypass code.
- **Not** affiliated with or endorsed by any vendor.

See [`DISCLAIMER.md`](DISCLAIMER.md).

## At a glance

| Artifact | Status | File |
|---|---|---|
| Interface specification | v0 draft | [`SPEC.md`](SPEC.md) |
| Compatibility matrix | v0 (2 observed points) | [`matrix/compatibility.md`](matrix/compatibility.md) |
| Protocol analysis | #1: function tools vs RPC-wrapping | [`analysis/01-function-vs-rpc-wrapping.md`](analysis/01-function-vs-rpc-wrapping.md) |
| Community registry | placeholder | [`registry/`](registry/) |

## Key finding

Whether an inference backend can drive a coding agent's tools is determined primarily by **how the agent exposes its tools**, not by backend capability. Agents using a standard function-tool schema are drivable; agents wrapping tools in proprietary RPC/Protobuf protocols are not — the backend returns advisory text instead of performing actions. See [Analysis 01](analysis/01-function-vs-rpc-wrapping.md).

## Repo structure

```
agent-tool-interop/
├── README.md
├── LICENSE                 # MIT
├── DISCLAIMER.md
├── SPEC.md                 # v0 interface contract
├── matrix/
│   └── compatibility.md    # observed (agent, backend) data
├── analysis/
│   └── 01-function-vs-rpc-wrapping.md
└── registry/
    └── README.md           # community report structure (placeholder)
```

## Limitations

- v0 is a **category definition and criterion**, not a complete protocol or conformance test suite.
- The matrix has two observed data points; broader coverage depends on community reports.
- No runnable reference implementation yet (a future `β` track, gated on v0 traction).

## License

MIT — see [`LICENSE`](LICENSE).
