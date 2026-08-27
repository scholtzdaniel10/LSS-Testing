# @lss/schemas — contracts C1–C7

JSON Schemas (draft 2020-12) for the frozen contracts defined in the vault note
`Projects/Maintenance System/00 Architecture & Contracts.md` (v1). Both apps
validate against these files — never against a local copy.

| File | Contract |
|---|---|
| `target-environment.schema.json` | C1 — the company program's own running instance (test target) |
| `health-snapshot.schema.json` | C2 — per-program health rollup for the dashboard |
| `dependency-edge.schema.json` | C3 — dependency graph edges |
| `usage-report.schema.json` | C4 — import uses/needs report |
| `diagnostic-error.schema.json` | C5 — normalised analyser findings |
| `test.schema.json` | C6 — browser tests & steps |

C7 (API conventions: envelope, pagination, rate limits) is behavioural, not a
payload shape — it is enforced by `apps/api` middleware and contract tests.

**Changing a schema requires a decision-log row in the vault Roadmap and a
version bump in note 00.** PLT-9 wires these files into both apps: the API
validates C1–C6 through `App\Support\Contracts\ContractSchema` (same directory
this package lives in); the web app imports the JSON files and validates with
Ajv. Never duplicate a schema inside either app.
