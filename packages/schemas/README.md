# @lss/schemas — contracts C1–C7

JSON Schemas (draft 2020-12) for the frozen contracts defined in the vault note
`Projects/Webapp Builder/00 Architecture & Contracts.md`. Both apps validate
against these files — never against a local copy.

| File | Contract |
|---|---|
| `node.schema.json`, `scene.schema.json` | C1 — node tree & scene |
| `node-type.schema.json` | C2 — palette node-type definitions |
| `dependency-edge.schema.json` | C3 — dependency graph edges |
| `usage-report.schema.json` | C4 — import uses/needs report |
| `diagnostic-error.schema.json` | C5 — normalised analyser findings |
| `test.schema.json` | C6 — browser tests & steps |

C7 (API conventions: envelope, pagination, rate limits) is behavioural, not a
payload shape — it is enforced by `apps/api` middleware and contract tests.

**Changing a schema requires a decision-log row in the vault Roadmap and a
version bump in note 00.** Wiring these into both apps' builds is task PLT-9.
