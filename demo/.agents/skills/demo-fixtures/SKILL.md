---
name: demo-fixtures
description: Prepare, inspect, and clean isolated SQLite fixture data for Prism Demo real-browser verification. Use when testing login, notes, forms, searches, or other flows that require known users or records before operating the visible web application.
---

# Demo fixtures

Use the `demo_fixtures` MCP tools to prepare prerequisites before browser actions.

1. Use the current verification ID for every fixture call.
2. Create a unique user with `fixtures_create_user`; use an explicit email only when it ends in `.test`.
3. Create required notes with `fixtures_create_note`. Only use a fixture user owned by the same verification.
4. Operate the application with `prism_browser` tools and verify observable UI/network evidence.
5. Use `fixtures_get_user` or `fixtures_get_note` only when a database assertion is required.
6. Always call `fixtures_cleanup_run` after evidence collection, including after a failed check.

Never execute arbitrary SQL, modify the built-in demo account, or use fixture tools outside development verification.
