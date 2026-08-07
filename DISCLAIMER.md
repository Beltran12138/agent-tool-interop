# Disclaimer

## Purpose

This project is an **interoperability research and protocol-analysis initiative**. It studies how different AI coding-agent CLIs expose their tool-use interfaces to inference backends, and documents the resulting compatibility landscape.

It is **not** a tool for circumventing vendor authentication, billing, rate limits, or Terms of Service, and contains **no vendor-specific bypass patches or binaries**.

It does include one **vendor-neutral reference implementation** (`reference/path-rewrite-proxy/`) that demonstrates the specification's contract: a generic transport/protocol adapter (OpenAI path-prefix rewrite + Anthropic↔OpenAI Chat translation) configured entirely by placeholders and targeting no specific vendor. It ships no real endpoint, key, or internal address.

## Scope of artifacts

- Protocol analysis and documentation
- An open, vendor-neutral interface specification
- A compatibility matrix
- A community registry structure for interoperability reports
- A vendor-neutral reference implementation demonstrating the spec's contract (`reference/path-rewrite-proxy/`)

Vendors are referred to by **codenames** (Vendor A, Vendor B, …) rather than trademarks in the core documents.

## No legal advice

Statements about reverse-engineering or interoperability doctrines (e.g. references such as 17 U.S.C. §1201(f)) are **informational only**, have **not** been reviewed by counsel, and are **not legal advice**. Consult a qualified attorney in your jurisdiction before relying on any such doctrine.

## Intended use

Interoperability research and personal study. The maintainers do not encourage violations of any vendor's Terms of Service.
