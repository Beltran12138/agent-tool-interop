# Adapter Registry

This directory is a **placeholder** for a community-contributed registry of interoperability reports for specific agent CLIs.

## What belongs here

Community reports documenting, for a given agent CLI (referred to by codename):

- How it exposes its tool-use interface (protocol family)
- Whether a third-party inference backend can emit `tool_call`s the CLI accepts and executes
- Evidence of observed behavior (**not** bypass code)

## What does NOT belong here

- Runnable patches or patched binaries
- Authentication bypass or credential-extraction code
- Anything that would itself violate a vendor's Terms of Service

The main repository does **not** host runnable adapters. Any adapter a contributor writes lives in their own separate repository; this registry only links reports.

## Report template

A canonical report template will be provided in a future `v0.1` release. Until then, contributions are tracked via issues.
