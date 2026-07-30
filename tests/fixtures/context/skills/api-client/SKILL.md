---
name: api-client
description: Regenerates the typed HTTP client from the OpenAPI schema and reconciles the diff with hand-written wrappers. Use when the user asks to update the generated client, add an endpoint, or investigate a mismatch between the schema and the code.
---

# API client

Regenerate from the schema, then read the diff — a removed field is a breaking
change even when the compiler stays quiet about it.
