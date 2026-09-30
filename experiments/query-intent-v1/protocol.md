# P12 query intent v1 · pre-inference protocol

This is a bounded optional **stored/offline natural-language intent experiment**, not a live UI inference service. Model output is only the exact seven-field `P12-UCI851-QUERY-1` query. It never supplies an energy number, SQL, arithmetic, a conclusion or operational authority. Human semantic confirmation precedes deterministic execution. The manual builder remains usable without any model artifact.

## Frozen method and source boundary

`prompt.txt`, `schema.json`, `runtime.json`, both question files, disclosed `expected-queries.json`, payload construction, bounded runner, raw grader and structural/policy validator are hashed in `freeze.json` before the first call. CSV, dictionary and query-policy hashes bind every attempt and review. The existing CPU baseline is commit `703b7210469a34471452dea0b87a791deb0919c7`; original source, arithmetic implementation, operation policy and all original CPU evidence/media are protected unchanged by digest. UI repairs are separate engineering changes.

The schema requires all seven explicitly typed fields, rejects extras, and constrains operation/category/topic enums. Date strings retain syntax-only validation in the model schema: an explicit invalid Gregorian date or outside period must survive unchanged for authoritative backend rejection. No silent date correction, alias replacement, null filling, stripped code fences or fixed JSON is credited to the model. Exact source category strings are not interpreted as causes. Instructions embedded in a question cannot grant code execution or control authority.

The runner reads only the frozen question text to build requests. It does not parse expected queries or include dataset rows, aggregate answers, evaluator feedback or receipts in any request. Hashing a method/label file to verify the freeze does not supply its contents to the model. Raw API response and raw generated query remain distinct from CPU inspection, independent grading and later human review.

## Initial scope and progression gate

Initial batch: exactly the three declared development questions D1 sum/full source, D2 Load_Type counts/full source, D3 original raw order/full source, once each. Planned maximum3 generation requests, no retries, no demo calls. A transport/schema-level HTTP rejection or ambiguous completion stops later requests in that batch and preserves unattempted cases in the scheduled denominator.

Progression requires all3 calls complete, strict JSON/schema success, exact21/21 raw field matches, all3 query-policy guards allowed, and no extra answer/authority fields. Report the development result first. Nine separately frozen E1–E9 questions may run only after that gate and a separate explicit resource handover. They are **exposed conformance questions** derived from disclosed mappings, not an independently unseen evaluation or a broad generalization claim. Prompt/schema/runtime remain unchanged for those nine. If development fails, preserve v1 and report the failure; any repair needs a separately versioned method. Do not tune from the nine exposed outputs and present them as fresh held-out evidence.

## Runtime and token budget

Installed Ollama0.17.7; existing qwen3:4b Q4_K_M model digest `359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7`. No model download or framework installation. `/api/generate`, explicit Qwen raw role template with nonthinking suffix, `raw:true`, `think:false`, `stream:false`; schema also supplied as `format`. Context4096/output640, temperature0/seed42, timeout60seconds, one request at a time. Actual installed version and model digest are checked before requests.

The complete raw prompt contains the instruction, compact JSON schema and one question. For the pinned byte-level GPT2/Qwen2 BPE tokenizer, UTF-8 byte length plus one possible BOS token is a conservative input-token upper bound. Raw mode adds no hidden chat template. Reserve640 output tokens and128 additional safety tokens. `freeze.json` records exact byte counts, request digests and per-case minimum conservative headroom. This is not a measured token count; observed `prompt_eval_count` and `eval_count` remain in each actual response. Reject an over-budget request before inference; do not rely on context truncation.

The existing shared inference lock and persistent `.blocked` marker govern the entire batch. Timeout, ambiguous transport completion or response-size overflow writes a persistent barrier; no retries, marker removal or unsupported assumption that the request stopped. If barrier persistence fails, keep the lock held. Reconnection/disconnect does not establish completion. Release only after durable completed receipts or independently verified recovery.

API references: [Ollama generate/raw/think](https://docs.ollama.com/api/generate), [structured schema outputs](https://docs.ollama.com/capabilities/structured-outputs), [Qwen tokenizer configuration](https://huggingface.co/Qwen/Qwen3-4B/blob/main/tokenizer_config.json). These describe interfaces, not measured P12 performance.

## Metrics and failure denominators

Report each phase separately: scheduled cases (3 or9), attempted requests, completed requests, strict structural successes, raw seven-field exact matches (21 or63 leaves), strict full-query matches, guard-allowed/rejected counts and unexpected answer/authority fields. Missing/refused/malformed/truncated/timed-out/HTTP-rejected output stays in the full scheduled denominator; absent fields are wrong. A parsable structurally invalid object may have matching raw leaves, but receives no strict-query success or authority. No deterministic repair/enrichment is counted as model success. Backend arithmetic credit to the model is always0.

Semantic credit requires a dispatched, completed, provenance-valid attempt: exact question/case/phase, request bytes and budget, freeze, source/dictionary/policy, installed model/runtime identity, HTTP200, durable terminal completion and agreement between the full raw transport body, parsed API response and raw generated output. A forged or stale artifact with correct-looking leaves receives zero credited leaves; observed uncredited matches remain inspectable. The grader shares these provenance checks with the UI and writes each phase report once, refusing overwrite. Local hashes bind stored artifacts; they are not cryptographic attestation of a remote model service. Synthetic CPU transport fixtures are never published as model results.

Semantic grading compares the original parsed values independently to the disclosed query labels; the validator never uses a vocabulary switch or expected answer. Structural validity means only safe shape/source constraints, and UI proposals still require human semantic review. E4 may be a semantically correct intent with `invalid_calendar_date` guard rejection; E5 may correctly preserve outside coverage. Unknown-field reports may be valid intents whose confirmed deterministic result remains unresolved. None becomes an energy conclusion from the model.

## Review binding and rejection evidence

Store exact raw output and field-specific structural/policy errors. Proposal fingerprints bind the original question, raw attempt/output, exact parsed fields, protocol freeze and CSV/dictionary/policy identities. Confirmation binds the exact inspected proposal; a changed file, revision, question, query or model attempt rejects stale acceptance and requires inspection again. Filling the visible builder does not execute it. Editing populated fields switches to manual provenance and clears the model review binding. Receipt preparation checks the binding again, keeping model intent, human review and immutable CPU query receipt distinct.

Before a GPU grant: generation calls0, no development/evaluation result claims. CPU synthetic fixtures exercise review guards only and are explicitly labeled as such.
