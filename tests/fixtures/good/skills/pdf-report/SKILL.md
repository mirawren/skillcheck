---
name: pdf-report
description: Generate polished PDF reports from markdown or data files. Use when the user asks to create a PDF report, export analysis results as a PDF, or convert a markdown document into a printable report.
license: MIT
---

# PDF Report Generation

Use when the user wants a finished PDF artifact rather than raw markdown.

## Workflow

1. Collect the source content (markdown, CSV, or JSON).
2. Build an HTML intermediate with the house template.
3. Render to PDF and confirm the page count.

Keep body text under 11pt and tables under 8 columns.
