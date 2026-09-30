import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspectIntent, parseStrictJSON } from '../intent-validation.mjs';

const query = overrides => ({ schema_version: 'P12-UCI851-QUERY-1', operation: 'sum_source_usage_kwh', source_labeled_date_from: null, source_labeled_date_to_exclusive: null, source_weekstatus: null, source_load_type: null, unavailable_topic: null, ...overrides });
const inspect = overrides => inspectIntent(JSON.stringify(query(overrides)));

test('raw whitespace and exact query values remain preserved; semantic review is always required', () => {
  const raw = ` \n\t${JSON.stringify(query())}\r\n`;
  const result = inspectIntent(raw);
  assert.equal(result.raw_output, raw); assert.deepEqual(result.parsed_query, query()); assert.equal(result.structural_state, 'valid'); assert.equal(result.policy_state, 'valid'); assert.equal(result.execution_allowed, true); assert.equal(result.semantic_state, 'requires_human_review'); assert.deepEqual(result.errors, []);
  assert.throws(() => result.parsed_query.operation = 'rank', TypeError);
});

test('strict JSON rejects fences, prose, trailing material, comments and trailing commas without repair', () => {
  for (const raw of [`\`\`\`json\n${JSON.stringify(query())}\n\`\`\``, `Here is JSON: ${JSON.stringify(query())}`, `${JSON.stringify(query())} trailing`, `${JSON.stringify(query())}\n{}`, '{"x":1,}', '{/*comment*/"x":1}', '{"x":01}', '\uFEFF' + JSON.stringify(query()), '{"x":"bad\\q"}']) {
    const result = inspectIntent(raw); assert.equal(result.raw_output, raw); assert.equal(result.structural_state, 'invalid'); assert.equal(result.policy_state, 'not_evaluated'); assert.equal(result.execution_allowed, false); assert.equal(result.parsed_query, null); assert.equal(result.errors[0].layer, 'structure');
  }
});

test('duplicate decoded keys reject exact and escaped names at every object depth', () => {
  for (const raw of ['{"operation":"count_source_rows","operation":"sum_source_usage_kwh"}', '{"operation":"count_source_rows","\\u006fperation":"sum_source_usage_kwh"}', '{"extra":{"key":1,"key":2}}', '{"extra":[{"a":1,"\\u0061":2}]}']) {
    assert.throws(() => parseStrictJSON(raw), { code: 'duplicate_key' });
    const result = inspectIntent(raw); assert.equal(result.structural_state, 'invalid'); assert.equal(result.errors[0].code, 'duplicate_key'); assert.equal(result.execution_allowed, false);
  }
});

test('JSON parser accepts legal escapes and bounds bytes and nesting', () => {
  assert.deepEqual(parseStrictJSON('{"text":"brace } \\" quote","array":[true,false,null,-1.2e3]}'), { text: 'brace } " quote', array: [true, false, null, -1200] });
  assert.throws(() => parseStrictJSON(' '.repeat(65537)), { code: 'response_byte_limit_exceeded' });
  assert.throws(() => parseStrictJSON('['.repeat(34) + '0' + ']'.repeat(34)), { code: 'json_depth_limit_exceeded' });
  assert.equal(inspectIntent(1).errors[0].code, 'raw_output_must_be_string');
});

test('exact required keys, typed dates, extra numeric or SQL fields and literal enums are structural errors', () => {
  const missing = query(); delete missing.source_load_type;
  for (const proposal of [missing, { ...query(), energy_kwh: '100' }, { ...query(), sql: 'SELECT *' }, { ...query(), start_date: null }, query({ source_weekstatus: 'weekday' }), query({ source_load_type: 'Light' }), query({ operation: 'rank_loads' }), query({ source_labeled_date_from: 20180101 }), query({ source_labeled_date_to_exclusive: '2018-1-02' }), query({ schema_version: 1 })]) {
    const result = inspectIntent(JSON.stringify(proposal)); assert.equal(result.structural_state, 'invalid'); assert.equal(result.policy_state, 'not_evaluated'); assert.equal(result.execution_allowed, false); assert.ok(result.errors.every(failure => failure.layer === 'structure')); assert.ok(result.errors.every(failure => failure.field));
  }
  for (const raw of ['[]', 'null', 'true', '1', '"query"']) assert.equal(inspectIntent(raw).errors[0].code, 'expected_object');
});

test('invalid Gregorian date remains structurally valid and exactly retained with calendar policy error', () => {
  const result = inspect({ source_labeled_date_from: '2018-02-29', source_labeled_date_to_exclusive: '2018-03-01' });
  assert.equal(result.structural_state, 'valid'); assert.equal(result.policy_state, 'invalid_calendar_date'); assert.equal(result.parsed_query.source_labeled_date_from, '2018-02-29'); assert.equal(result.execution_allowed, false); assert.equal(result.errors[0].field, 'source_labeled_date_from'); assert.equal(result.errors[0].layer, 'policy');
  assert.equal(inspect({ source_labeled_date_from: '2018-02-29' }).policy_state, 'invalid_calendar_date');
});

test('unpaired, reversed, outside and partial scopes produce policy errors without repair', () => {
  for (const [overrides, state] of [[{ source_labeled_date_from: '2018-01-01' }, 'invalid_date_range'], [{ source_labeled_date_from: '2018-01-02', source_labeled_date_to_exclusive: '2018-01-02' }, 'invalid_date_range'], [{ source_labeled_date_from: '2019-01-01', source_labeled_date_to_exclusive: '2019-02-01' }, 'period_not_in_historical_source'], [{ source_labeled_date_from: '2017-12-31', source_labeled_date_to_exclusive: '2018-01-02' }, 'scope_not_fully_covered']]) {
    const result = inspect(overrides); assert.equal(result.structural_state, 'valid'); assert.equal(result.policy_state, state); assert.equal(result.execution_allowed, false); assert.deepEqual(result.parsed_query, query(overrides)); assert.ok(result.errors.every(failure => failure.layer === 'policy'));
  }
});

test('operation-topic and original-order scope constraints reject proposals without source execution', () => {
  for (const [overrides, field, code] of [[{ unavailable_topic: 'electricity_cost' }, 'unavailable_topic', 'invalid_operation_topic'], [{ operation: 'report_missing_or_unresolved_field' }, 'unavailable_topic', 'invalid_operation_topic'], [{ operation: 'describe_source_time_order', source_weekstatus: 'Weekday' }, 'source_weekstatus', 'describe_requires_full_original_scope'], [{ operation: 'describe_source_time_order', source_labeled_date_from: '2018-01-01', source_labeled_date_to_exclusive: '2019-01-01' }, 'source_labeled_date_from', 'describe_requires_full_original_scope']]) {
    const result = inspect(overrides); assert.equal(result.structural_state, 'valid'); assert.equal(result.policy_state, 'invalid_query'); assert.equal(result.execution_allowed, false); assert.ok(result.errors.some(failure => failure.field === field && failure.code === code));
  }
  assert.equal(inspect({ operation: 'describe_source_time_order' }).execution_allowed, true);
});

test('unavailable reports are proposals only; inspector has no question/oracle or numeric execution path', () => {
  const result = inspect({ operation: 'report_missing_or_unresolved_field', unavailable_topic: 'co2_mass', source_load_type: 'Light_Load' });
  assert.equal(result.structural_state, 'valid'); assert.equal(result.policy_state, 'valid'); assert.equal(result.execution_allowed, true); assert.equal(result.semantic_state, 'requires_human_review'); assert.equal(result.parsed_query.unavailable_topic, 'co2_mass');
  for (const key of ['answer', 'value', 'count', 'receipt', 'daily', 'question', 'semantic_correct']) assert.equal(Object.hasOwn(result, key), false);
  const implementation = readFileSync(new URL('../intent-validation.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(implementation, /\b(?:executeQuery|queryDataset|loadDataset|auditDataset|eval)\s*\(/);
  assert.doesNotMatch(implementation, /questions-(?:development|exposed-conformance)|evaluator|expected_query/);
});
