import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadDataset, parseDataset } from '../core.mjs';
import { executeQuery, validateQuery, exactTwoDecimal, QUERY_POLICY, QUERY_POLICY_SHA256 } from '../policy.mjs';

const dictionary_sha256 = 'a'.repeat(64);
const run = (dataset, query) => executeQuery(dataset, query, { dictionary_sha256 });
const q = (operation = 'sum_source_usage_kwh', overrides = {}) => ({ schema_version: 'P12-UCI851-QUERY-1', operation, source_labeled_date_from: null, source_labeled_date_to_exclusive: null, source_weekstatus: null, source_load_type: null, unavailable_topic: null, ...overrides });
const fixture = lines => {
  const bytes = Buffer.from('\uFEFFdate,Usage_kWh,NSM,WeekStatus,Day_of_week,Load_Type\r\n' + lines.join('\r\n') + '\r\n');
  return parseDataset(bytes, { expectedSha256: createHash('sha256').update(bytes).digest('hex') });
};
const sample = fixture(['01/01/2018 00:15,0.1,900,Weekday,Monday,Light_Load', '01/01/2018 23:45,0.2,85500,Weekday,Monday,Maximum_Load', '01/01/2018 00:00,0,0,Weekday,Monday,Light_Load', '06/01/2018 00:15,1,900,Weekend,Saturday,Medium_Load']);

test('normative policy checksum, canonical exact seven keys and immutable policy', () => {
  assert.equal(QUERY_POLICY_SHA256, createHash('sha256').update(readFileSync(new URL('../query-policy.json', import.meta.url))).digest('hex'));
  const reversed = Object.fromEntries(Object.entries(q()).reverse());
  assert.deepEqual(Object.keys(run(sample, reversed).canonical_query), QUERY_POLICY.required_fields);
  assert.throws(() => QUERY_POLICY.operations.push('rank'), TypeError);
  assert.throws(() => run(sample, q()).canonical_query.operation = 'rank', TypeError);
});

test('exact keys, schema and enums reject aliases, extras, ranking and wrong types', () => {
  const missing = q(); delete missing.unavailable_topic;
  for (const query of [missing, { ...q(), start_date: null }, { ...q(), metric: 'energy' }, q('rank_loads'), q('sum_source_usage_kwh', { schema_version: 1 }), q('sum_source_usage_kwh', { source_weekstatus: 'weekday' }), q('sum_source_usage_kwh', { source_weekstatus: 'ALL' }), q('sum_source_usage_kwh', { source_load_type: 'Light' }), q('sum_source_usage_kwh', { source_load_type: 1 }), q('report_missing_or_unresolved_field', { unavailable_topic: 'carbon' }), [], null]) {
    const result = run(sample, query);
    assert.equal(result.status, 'invalid_query'); assert.equal(result.answer.count, null); assert.equal(result.answer.value, null); assert.equal(result.receipt.selected_row_count, null); assert.equal(result.receipt.contributing_row_count, null);
  }
});

test('strict Gregorian paired calendar dates and range precedence', () => {
  for (const overrides of [{ source_labeled_date_from: '2018-02-29', source_labeled_date_to_exclusive: '2018-03-01' }, { source_labeled_date_from: '2018-04-31', source_labeled_date_to_exclusive: '2018-05-01' }, { source_labeled_date_from: '2018-1-01', source_labeled_date_to_exclusive: '2018-02-01' }, { source_labeled_date_from: 20180101, source_labeled_date_to_exclusive: '2018-02-01' }, { source_labeled_date_from: '0000-01-01', source_labeled_date_to_exclusive: '2018-01-02' }, { source_labeled_date_from: '2018-02-29', source_labeled_date_to_exclusive: null }, { source_labeled_date_from: null, source_labeled_date_to_exclusive: 'bad' }]) {
    const result = run(sample, q('sum_source_usage_kwh', overrides)); assert.equal(result.status, 'invalid_calendar_date'); assert.equal(result.reason, 'invalid_calendar_date'); assert.equal(result.receipt.selected_row_count, null);
  }
  for (const [start, end] of [['2018-01-02', '2018-01-02'], ['2018-01-03', '2018-01-02'], ['2018-01-01', null], [null, '2018-02-01']]) {
    const result = run(sample, q('sum_source_usage_kwh', { source_labeled_date_from: start, source_labeled_date_to_exclusive: end })); assert.equal(result.status, 'invalid_date_range'); assert.equal(result.reason, 'invalid_date_range'); assert.equal(result.receipt.selected_row_count, null);
  }
  const e4 = run(sample, q('sum_source_usage_kwh', { source_labeled_date_from: '2018-02-29', source_labeled_date_to_exclusive: '2018-03-01' })); assert.equal(e4.status, 'invalid_calendar_date'); assert.equal(e4.answer.value, null);
  assert.equal(validateQuery(q('sum_source_usage_kwh', { source_labeled_date_from: '2020-02-29', source_labeled_date_to_exclusive: '2020-03-01' })).status, 'period_not_in_historical_source');
});

test('fully outside, partial coverage and covered empty remain distinct', () => {
  for (const [start, end] of [['2019-01-01', '2019-01-02'], ['2017-12-01', '2018-01-01']]) {
    const result = run(sample, q('sum_source_usage_kwh', { source_labeled_date_from: start, source_labeled_date_to_exclusive: end }));
    assert.equal(result.status, 'period_not_in_historical_source'); assert.equal(result.answer.value, null); assert.equal(result.receipt.selected_row_count, null);
  }
  for (const [start, end] of [['2017-12-31', '2018-01-02'], ['2018-12-31', '2019-01-02']]) assert.equal(run(sample, q('sum_source_usage_kwh', { source_labeled_date_from: start, source_labeled_date_to_exclusive: end })).status, 'scope_not_fully_covered');
  const empty = run(sample, q('sum_source_usage_kwh', { source_labeled_date_from: '2018-02-01', source_labeled_date_to_exclusive: '2018-02-02' }));
  assert.equal(empty.status, 'empty_selection'); assert.equal(empty.answer.row_count, 0); assert.equal(empty.answer.value, null); assert.equal(empty.answer.usage_kwh_exact, null); assert.equal(empty.receipt.selected_row_count, 0);
  assert.equal(empty.receipt.contextual_source_usage_kwh, null); assert.equal(empty.receipt.energy_aggregation_performed, false);
});

test('exclusive source date bounds and category filters combine with AND', () => {
  const result = run(sample, q('sum_source_usage_kwh', { source_labeled_date_from: '2018-01-01', source_labeled_date_to_exclusive: '2018-01-02', source_weekstatus: 'Weekday', source_load_type: 'Light_Load' }));
  assert.equal(result.answer.value, '0.10'); assert.equal(result.answer.row_count, 2); assert.equal(result.answer.day_count, 1); assert.deepEqual(result.selected_row_ids, ['csv-line-2', 'csv-line-4']);
  assert.equal(run(sample, q('count_source_rows', { source_weekstatus: 'Weekend', source_load_type: 'Light_Load' })).status, 'empty_selection');
});

test('all declared load and week groups retain filtered empty groups', () => {
  const loads = run(sample, q('count_by_source_load_type', { source_load_type: 'Light_Load' }));
  assert.equal(loads.answer.groups.length, 3); assert.deepEqual(loads.answer.groups.map(group => group.count), [2, 0, 0]);
  assert.equal(loads.answer.groups[1].state, 'empty_group'); assert.equal(loads.answer.groups[1].sum, null);
  const weeks = run(sample, q('compare_source_weekstatus_sums', { source_weekstatus: 'Weekday' }));
  assert.equal(weeks.answer.groups.length, 2); assert.deepEqual(weeks.answer.groups.map(group => group.sum), ['0.30', null]); assert.equal(weeks.answer.groups[1].count, 0); assert.equal(weeks.answer.groups[1].state, 'empty_group');
});

test('entirely empty AND selections retain every declared group with null sums', () => {
  for (const [operation, categories] of [['count_by_source_load_type', QUERY_POLICY.source_load_type], ['compare_source_weekstatus_sums', QUERY_POLICY.source_weekstatus]]) {
    const result = run(sample, q(operation, { source_weekstatus: 'Weekend', source_load_type: 'Light_Load' }));
    assert.equal(result.status, 'empty_selection'); assert.equal(result.answer.row_count, 0); assert.equal(result.answer.usage_kwh_exact, null); assert.equal(result.answer.value, null);
    assert.deepEqual(result.answer.groups.map(group => group.category), categories);
    for (const group of result.answer.groups) { assert.equal(group.state, 'empty_group'); assert.equal(group.row_count, 0); assert.equal(group.day_count, 0); assert.equal(group.sum, null); assert.equal(group.usage_kwh_exact, null); assert.deepEqual(group.contributing_row_ids, []); }
    assert.equal(result.receipt.selected_row_count, 0); assert.equal(result.receipt.contributing_row_count, 0); assert.equal(result.receipt.exact_usage_kwh, null);
  }
});

test('incomplete week comparison retains incomplete and measured groups without an aggregate', () => {
  const dataset = fixture(['01/01/2018 00:15,,900,Weekday,Monday,Light_Load', '06/01/2018 00:15,0,900,Weekend,Saturday,Light_Load']);
  const result = run(dataset, q('compare_source_weekstatus_sums'));
  assert.equal(result.status, 'incomplete_usage'); assert.equal(result.answer.count, null); assert.equal(result.answer.value, null); assert.equal(result.answer.usage_kwh_exact, null);
  assert.deepEqual(result.answer.groups.map(group => group.category), ['Weekday', 'Weekend']);
  assert.deepEqual(result.answer.groups.map(group => [group.row_count, group.state, group.sum]), [[1, 'incomplete_usage', null], [1, 'ok', '0.00']]);
  assert.deepEqual(result.answer.groups[0].contributing_row_ids, []); assert.deepEqual(result.answer.groups[1].contributing_row_ids, ['csv-line-3']);
  assert.equal(result.receipt.selected_row_count, 2); assert.equal(result.receipt.contributing_row_count, 0); assert.equal(result.receipt.exact_usage_kwh, null);
});

test('BOM measured zero, missing, invalid and excess precision never fabricate totals', () => {
  const zero = fixture(['01/01/2018 00:00,0,0,Weekday,Monday,Light_Load']);
  const measured = run(zero, q()); assert.equal(measured.status, 'ok'); assert.equal(measured.answer.value, '0.00'); assert.equal(measured.answer.row_count, 1);
  for (const value of ['', 'bad', '\uFEFF0', '0.001']) {
    const result = run(fixture([`01/01/2018 00:00,${value},0,Weekday,Monday,Light_Load`]), q());
    assert.equal(result.status, 'incomplete_usage'); assert.equal(result.answer.value, null); assert.equal(result.answer.count, null); assert.equal(result.receipt.selected_row_count, 1); assert.equal(result.receipt.contributing_row_count, 0);
  }
  assert.equal(exactTwoDecimal('999999999999999999999999999.1'), '999999999999999999999999999.10'); assert.equal(exactTwoDecimal('0.1000'), '0.10'); assert.equal(exactTwoDecimal('0.001'), null);
});

test('operation constraints preserve validation precedence and original order', () => {
  const order = run(sample, q('describe_source_time_order'));
  assert.equal(order.status, 'ok'); assert.equal(order.answer.negative_order_jump_count, 1); assert.equal(order.answer.source_examples[0].row_id, 'csv-line-4');
  for (const query of [q('describe_source_time_order', { source_load_type: 'Light_Load' }), q('sum_source_usage_kwh', { unavailable_topic: 'electricity_cost' }), q('report_missing_or_unresolved_field')]) { const result = run(sample, query); assert.equal(result.status, 'invalid_query'); assert.equal(result.answer.count, null); assert.equal(result.answer.value, null); }
  assert.equal(run(sample, q('describe_source_time_order', { source_labeled_date_from: '2019-01-01', source_labeled_date_to_exclusive: '2019-01-02' })).status, 'period_not_in_historical_source');
  for (const operation of ['count_source_rows', 'count_by_source_load_type', 'describe_source_time_order']) {
    const result = run(sample, q(operation)); assert.deepEqual(result.daily, []); assert.equal(result.receipt.contextual_source_usage_kwh, null); assert.equal(result.receipt.energy_aggregation_performed, false);
  }
});

test('unavailable topic answers keep scope evidence separate from contributors and chart', () => {
  const states = { period_coverage: 'period_present_in_historical_source', co2_mass: 'unit_and_derivation_unresolved', energy_per_tonne: 'production_quantity_absent', electricity_cost: 'tariff_and_billing_rules_absent', equipment_fault_cause: 'equipment_and_fault_cause_labels_absent', source_timezone: 'source_timezone_unresolved', physical_interval_boundary: 'physical_interval_semantics_unresolved' };
  for (const [topic, state] of Object.entries(states)) {
    const result = run(sample, q('report_missing_or_unresolved_field', { source_load_type: 'Light_Load', unavailable_topic: topic }));
    assert.equal(result.status, state); assert.equal(result.answer.count, null); assert.equal(result.answer.value, null); assert.equal(result.answer.usage_kwh_exact, null); assert.equal(result.receipt.selected_row_count, 2); assert.equal(result.receipt.contributing_row_count, 0); assert.deepEqual(result.contributing_row_ids, []); assert.deepEqual(result.daily, []); assert.equal(result.receipt.contextual_source_usage_kwh, null); assert.equal(result.receipt.energy_aggregation_performed, false);
  }
});

test('receipt fingerprint binds complete receipt and all three digests', () => {
  const result = run(sample, q()); const { query_fingerprint, ...receipt } = result.receipt;
  assert.equal(query_fingerprint, createHash('sha256').update(JSON.stringify(receipt)).digest('hex'));
  assert.equal(receipt.source_dictionary_sha256, dictionary_sha256); assert.equal(receipt.query_policy_sha256, QUERY_POLICY_SHA256); assert.equal(receipt.source_csv_sha256, sample.source_csv_sha256);
  assert.notEqual(run(sample, q('count_source_rows')).query_fingerprint, result.query_fingerprint);
  assert.notEqual(executeQuery(sample, q(), { dictionary_sha256: 'b'.repeat(64) }).query_fingerprint, result.query_fingerprint);
  assert.throws(() => result.receipt.selected_row_ids.push('fake'), TypeError); assert.doesNotThrow(() => JSON.stringify(result));
});

test('12 declared actual-source conformance cases, not an unseen benchmark', async t => {
  let dataset; try { dataset = await loadDataset(); } catch (error) { if (error.code === 'ENOENT') return t.skip('Original admitted source absent locally'); throw error; }
  const cases = [
    ['all', q(), '959636.71', 35040, 365],
    ['January', q('sum_source_usage_kwh', { source_labeled_date_from: '2018-01-01', source_labeled_date_to_exclusive: '2018-02-01' }), '126238.29', 2976, 31],
    ['Jan15', q('sum_source_usage_kwh', { source_labeled_date_from: '2018-01-15', source_labeled_date_to_exclusive: '2018-01-16' }), '3968.64', 96, 1],
    ['Jan1', q('sum_source_usage_kwh', { source_labeled_date_from: '2018-01-01', source_labeled_date_to_exclusive: '2018-01-02' }), '351.86', 96, 1],
    ['Weekday', q('sum_source_usage_kwh', { source_weekstatus: 'Weekday' }), '842501.16', 25056, 261],
    ['Weekend', q('sum_source_usage_kwh', { source_weekstatus: 'Weekend' }), '117135.55', 9984, 104]
  ];
  for (const [name, query, value, rows, days] of cases) { const result = run(dataset, query); assert.equal(result.status, 'ok', name); assert.equal(result.answer.value, value, name); assert.equal(result.answer.row_count, rows, name); assert.equal(result.answer.day_count, days, name); }
  const loads = run(dataset, q('count_by_source_load_type')); assert.deepEqual(loads.answer.groups.map(group => group.count), [18072, 9696, 7272]);
  const weeks = run(dataset, q('compare_source_weekstatus_sums')); assert.deepEqual(weeks.answer.groups.map(group => group.sum), ['842501.16', '117135.55']);
  const counts = run(dataset, q('count_source_rows')); assert.equal(counts.answer.value, 35040);
  const order = run(dataset, q('describe_source_time_order')); assert.equal(order.answer.negative_order_jump_count, 365);
  const unknown = run(dataset, q('report_missing_or_unresolved_field', { unavailable_topic: 'co2_mass' })); assert.equal(unknown.status, 'unit_and_derivation_unresolved'); assert.equal(unknown.answer.value, null);
  const period = run(dataset, q('report_missing_or_unresolved_field', { unavailable_topic: 'period_coverage' })); assert.equal(period.status, 'period_present_in_historical_source'); assert.equal(period.answer.value, null);
  const zero = dataset.rows.find(row => row.row_id === 'csv-line-29857'); assert.equal(zero.source_fields.date, '07/11/2018 00:00'); assert.equal(zero.usage_kwh, '0'); assert.equal(zero.usage_status, 'valid');
  assert.ok(run(dataset, q('sum_source_usage_kwh', { source_labeled_date_from: '2018-11-07', source_labeled_date_to_exclusive: '2018-11-08' })).contributing_row_ids.includes('csv-line-29857'));
  t.diagnostic(JSON.stringify({ declared_actual_cases: 12, csv_sha256: dataset.source_csv_sha256, query_policy_sha256: QUERY_POLICY_SHA256, all_exact_kwh: cases[0][2], zero_row_id: zero.row_id, exposed_conformance_only: true }));
});
