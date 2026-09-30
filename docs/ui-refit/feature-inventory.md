# UI v2 feature inventory

Recorded before presentation edits against commit `29ccb12c1a205512f4dd468c7aed9714e5150cda`. This refit adds presentation files and a static-route wrapper; original source, server, app and experiment bytes remain unchanged.

| Existing capability | UI v2 surface | Boundary retained |
|---|---|---|
| Original ZIP/CSV admission, hash checks, missing/invalid/order audit | Left source panel | Immutable source; 365 raw label reversals; no timezone conversion |
| Exact seven-field manual query and six operations | Right query/result panel | Strict dates/enums; both bounds or neither; explicit source interpretation |
| Exact decimal result, native daily chart | Right result panel | Approximate chart only; CPU arithmetic only; raw label tooltips |
| Original row ledger, date choice, 96-row pages, lexemes/byte spans | Left source panel | Original row order; ledger page differs from complete receipt |
| Exact receipt preparation and local query history | Right result panel | Separate acknowledgment; no target import, billing or equipment authority |
| Stored actual D1–D3/E1–E9 question/proposal inspection | Full-width optional review | Raw output and seven fields visible; fingerprints retained |
| Human semantic review, followed by separate source confirmation | Optional review then right builder | Structure does not establish correct meaning; no automatic execution |
| Invalid/outside/partial/empty/unknown states | Exact result JSON and metrics | Preselection Not evaluated; covered empty 0; unresolved carbon/absent topics |
| Stale/delayed responses, source/dictionary/policy read failure | Historical status and disabled controls | Cached evidence retained; authority cannot be restored by late responses |
| Keyboard focus and 390px chart/ledger scrolling | Native controls and focus outline | No page overflow; readable evidence; unchanged focus logic |

The current local command is `node ui-v2/server.mjs` (loopback port 5162). `npm start` continues to serve the original historical presentation. There are no new packages, downloads, inference calls, security changes, or changes to the frozen method/results.
