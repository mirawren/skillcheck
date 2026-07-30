---
name: migration-runner
description: Writes and dry-runs database migrations against the seeded fixture database, including the paired rollback. Use when the user asks to add a column, change a schema, backfill a table, or check that a migration can be reverted.
---

# Migration runner

Write the forward migration, write its rollback, then dry-run both against the
fixture database before proposing the change.
