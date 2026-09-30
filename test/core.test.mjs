import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDataset, loadDataset, auditDataset, queryDataset, parseDecimal, addDecimal, decimalToString, parseSourceDate, normalizeFilter, SOURCE_CSV_SHA256 } from '../core.mjs';

const header = 'date,Usage_kWh,NSM,WeekStatus,Day_of_week,Load_Type';
const fixture = lines => Buffer.from(`\uFEFF${header}\r\n${lines.join('\r\n')}\r\n`);
const admit = bytes => parseDataset(bytes, { expectedSha256: createHash('sha256').update(bytes).digest('hex') });
const row = (usage, date = '01/01/2018 00:15', extras = '900,Weekday,Monday,Light_Load') => `${date},${usage},${extras}`;

test('decimal 0.1 + 0.2, scaled and very large values are exact', () => {
  assert.equal(decimalToString(addDecimal(parseDecimal('0.1'), parseDecimal('0.2'))), '0.3');
  assert.equal(decimalToString(addDecimal(parseDecimal('999999999999999999999999999.999'), parseDecimal('0.001'))), '1000000000000000000000000000');
  assert.equal(decimalToString(addDecimal(parseDecimal('-0.00001'), parseDecimal('1.000000'))), '0.99999');
  for (const value of ['', 'NaN', '1e3', ' 1', '1 ', '.', 'Infinity', '0x10']) assert.equal(parseDecimal(value), null);
  assert.equal(queryDataset(admit(fixture([row('0.1'), row('0.2', '01/01/2018 00:30', '1800,Weekday,Monday,Light_Load')]))).usage_kwh, '0.3');
});

test('strict source calendar: leap years, format and time bounds', () => {
  assert.equal(parseSourceDate('29/02/2020 23:59').status, 'valid');
  assert.equal(parseSourceDate('29/02/1900 00:00').status, 'invalid');
  assert.equal(parseSourceDate('29/02/2000 00:00').status, 'valid');
  assert.equal(parseSourceDate('02/03/2018 00:15').date_label, '2018-03-02');
  for (const value of ['29/02/2018 00:00', '31/04/2018 00:00', '00/01/2018 00:00', '01/13/2018 00:00', '01/01/0000 00:00', '01/01/2018 24:00', '01/01/2018 00:60', '01/01/2018 12:00Z', '1/1/2018 0:15', '2018-01-01 00:15', ' 01/01/2018 00:15']) assert.equal(parseSourceDate(value).status, 'invalid', value);
  assert.equal(parseSourceDate('').status, 'missing');
});

test('BOM, CSV quotes and byte spans retain authoritative source', () => {
  const bytes = fixture([row('"0.10"'), row('0.2', '01/01/2018 00:30', '1800,Weekday,Monday,"Light_Load"')]);
  const dataset = admit(bytes);
  assert.equal(dataset.source_bom, true);
  assert.equal(dataset.header.source_span.byte_start, 3);
  assert.equal(dataset.rows[0].row_id, 'csv-line-2');
  assert.equal(dataset.rows[0].source_fields.Usage_kWh, '0.10');
  assert.equal(dataset.rows[0].field_lexemes[1], '"0.10"');
  for (const record of [dataset.header, ...dataset.rows]) assert.equal(bytes.subarray(record.source_span.byte_start, record.source_span.byte_end).toString(), record.raw_csv);
  const multi = admit(fixture([row('0.1', '01/01/2018 00:15', '900,Weekday,Monday,"Light_\nLoad"'), row('0.2')]));
  assert.equal(multi.rows[0].source_fields.Load_Type, 'Light_\nLoad');
  assert.equal(multi.rows[1].row_id, 'csv-line-4');
  assert.equal(multi.rows[0].source_span.line_end, 3);
});

test('invalid CSV shape, quoting and UTF-8 are rejected', () => {
  for (const bytes of [Buffer.from(header + '\n1,2\n'), Buffer.from(header + '\n"broken'), Buffer.from(header + '\n"x"oops,1,2,3,4,5'), Buffer.from(header + '\rbroken'), Buffer.concat([Buffer.from(header + '\n'), Buffer.from([255])])]) assert.throws(() => admit(bytes), { code: 'INVALID_CSV' });
  assert.throws(() => admit(Buffer.from('date,date\n1,2\n')), { code: 'INVALID_SCHEMA' });
});

test('midnight stays last in source order and same source label', () => {
  const dataset = admit(fixture([row('1', '01/01/2018 23:45', '85500,Weekday,Monday,Light_Load'), row('2', '01/01/2018 00:00', '0,Weekday,Monday,Light_Load'), row('3', '02/01/2018 00:15', '900,Weekday,Tuesday,Light_Load')]));
  assert.deepEqual(dataset.rows.map(r => r.time_label), ['23:45', '00:00', '00:15']);
  const audit = auditDataset(dataset), query = queryDataset(dataset);
  assert.equal(audit.negative_order_jump_count, 1);
  assert.equal(audit.negative_order_jumps[0].jump_seconds, -85500);
  assert.equal(audit.nsm_conflict_count, 0);
  assert.deepEqual(query.daily.map(d => [d.date_label, d.usage_kwh]), [['2018-01-01', '3'], ['2018-01-02', '3']]);
  assert.deepEqual(query.contributing_row_ids, ['csv-line-2', 'csv-line-3', 'csv-line-4']);
});

test('missing, invalid, zero, unknown and conflicting source values remain distinct', () => {
  const dataset = admit(fixture([row('0'), row('', '01/01/2018 00:30', '1800,Unknown,Noday,Other'), row('bad', '', ',,,') , row('2', '31/02/2018 00:15'), row('1', '01/01/2018 00:45', '99,Weekend,Tuesday,Maximum_Load')]));
  const audit = auditDataset(dataset), query = queryDataset(dataset);
  assert.equal(audit.missing_counts.Usage_kWh, 1); assert.equal(audit.invalid_numeric_counts.Usage_kWh, 1);
  assert.equal(audit.missing_date_count, 1); assert.equal(audit.invalid_date_count, 1);
  assert.equal(audit.unknown_load_type_row_ids.length, 1); assert.equal(audit.unknown_week_status_row_ids.length, 1); assert.equal(audit.unknown_day_of_week_row_ids.length, 1);
  assert.equal(audit.week_status_conflict_count, 2); assert.equal(audit.day_of_week_conflict_count, 2); assert.equal(audit.nsm_conflict_count, 1);
  assert.equal(query.row_count, 3); assert.equal(query.excluded_invalid_date_count, 2); assert.equal(query.date_coverage_complete, false);
  assert.equal(query.usage_kwh, null); assert.equal(query.sumUsage, '1'); assert.equal(query.status, 'incomplete');
  assert.equal(query.daily[0].missing_usage_count, 1);
  const zero = queryDataset(admit(fixture([row('0')]))); assert.equal(zero.status, 'complete'); assert.equal(zero.usage_kwh, '0');
  const empty = queryDataset(dataset, { start_date: '2019-01-01' }); assert.equal(empty.status, 'empty'); assert.equal(empty.usage_kwh, '0'); assert.equal(empty.row_count, 0); assert.equal(empty.excluded_invalid_date_count, 2);
  const invalidUsage = queryDataset(admit(fixture([row('bad')]))); assert.equal(invalidUsage.invalid_usage_count, 1); assert.equal(invalidUsage.usage_kwh, null); assert.equal(invalidUsage.sumUsage, '0');
});

test('typed allowlist rejects unsupported or ambiguous query values', () => {
  for (const filter of [null, [], 'query', { sql: 'SELECT' }, { metric: 'carbon' }, { tariff: 1 }, { start_date: 20180101 }, { start_date: '2018-1-1' }, { start_date: '2018-02-29' }, { start_date: '2018-01-01T00:00:00Z' }, { start_date: '2018-02-02', end_date: '2018-02-01' }, { load_type: 'unknown' }, { week_status: 'weekday' }, { end_date: undefined }, { load_type: 1 }, { [Symbol('x')]: 1 }]) assert.throws(() => normalizeFilter(filter), { code: 'INVALID_FILTER' });
  assert.deepEqual(normalizeFilter({ end_date: '2020-02-29' }), { start_date: null, end_date: '2020-02-29', load_type: 'ALL', week_status: 'ALL' });
});

test('source hash and deep immutability protect source authority', async () => {
  const bytes = fixture([row('0.1')]), dataset = admit(bytes);
  assert.throws(() => parseDataset(bytes), { code: 'SOURCE_HASH_MISMATCH' });
  assert.throws(() => parseDataset(Buffer.concat([bytes, Buffer.from('x')]), { expectedSha256: dataset.source_csv_sha256 }), { code: 'SOURCE_HASH_MISMATCH' });
  bytes[0] = 0;
  assert.equal(dataset.rows[0].source_fields.Usage_kWh, '0.1');
  for (const mutate of [() => dataset.rows.push({}), () => dataset.rows[0].source_fields.Usage_kWh = '999', () => dataset.rows[0].raw_fields[1] = '999', () => dataset.rows[0].source_span.byte_start = 0, () => dataset.rows[0].numeric.Usage_kWh.value = '999']) assert.throws(mutate, TypeError);
  assert.throws(() => queryDataset(JSON.parse(JSON.stringify(dataset))), { code: 'INVALID_DATASET' });
  assert.equal(queryDataset(dataset).usage_kwh, '0.1');
  const temp = await mkdtemp(join(tmpdir(), 'p12-core-'));
  try {
    const original = fixture([row('0.1')]), path = join(temp, 'fixture.csv'); await writeFile(path, original);
    const loaded = await loadDataset({ path, expectedSha256: dataset.source_csv_sha256 });
    assert.deepEqual(await readFile(path), original); assert.equal(loaded.rows[0].row_id, 'csv-line-2');
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('receipt binds exact contributing row IDs, source, normalized filters and metric semantics', () => {
  const dataset = admit(fixture([row('0.1'), row('0.2', '02/01/2018 00:15', '900,Weekday,Tuesday,Maximum_Load')]));
  const a = queryDataset(dataset), b = queryDataset(dataset, { week_status: 'ALL', load_type: 'ALL', end_date: null, start_date: null });
  assert.equal(a.query_fingerprint, b.query_fingerprint); assert.equal(a.filter_hash, b.filter_hash);
  assert.deepEqual(a.receipt.contributing_row_ids, ['csv-line-2', 'csv-line-3']);
  const { filter_hash, query_fingerprint, ...payload } = a.receipt;
  assert.equal(query_fingerprint, createHash('sha256').update(JSON.stringify(payload)).digest('hex'));
  assert.equal(filter_hash, createHash('sha256').update(JSON.stringify(a.normalized_filter)).digest('hex'));
  assert.notEqual(queryDataset(dataset, { load_type: 'Maximum_Load' }).query_fingerprint, a.query_fingerprint);
  assert.notEqual(queryDataset(dataset, { start_date: '2018-01-01' }).query_fingerprint, a.query_fingerprint);
  assert.throws(() => a.receipt.contributing_row_ids.push('fake'), TypeError);
  assert.equal(a.carbon_status, 'unresolved_source_semantics'); assert.deepEqual(a.allowed_metrics, ['source_usage_kwh', 'source_row_count']);
});

test('official original source checks when admitted CSV is present', async t => {
  let dataset;
  try { dataset = await loadDataset(); } catch (error) { if (error.code === 'ENOENT') return t.skip('Official source not present in this checkout'); throw error; }
  const audit = auditDataset(dataset), query = queryDataset(dataset);
  assert.deepEqual(dataset.columns, ['date', 'Usage_kWh', 'Lagging_Current_Reactive.Power_kVarh', 'Leading_Current_Reactive_Power_kVarh', 'CO2(tCO2)', 'Lagging_Current_Power_Factor', 'Leading_Current_Power_Factor', 'NSM', 'WeekStatus', 'Day_of_week', 'Load_Type']);
  assert.equal(dataset.source_bom, true); assert.equal(dataset.columns[0], 'date');
  assert.equal(dataset.source_csv_sha256, SOURCE_CSV_SHA256); assert.equal(audit.row_count, 35040); assert.equal(audit.date_count, 365); assert.equal(audit.every_date_has_96_rows, true);
  assert.equal(audit.negative_order_jump_count, 365); assert.equal(audit.nsm_conflict_count, 0); assert.equal(audit.invalid_date_count, 0); assert.equal(audit.missing_date_count, 0);
  assert.ok(Object.values(audit.missing_counts).every(n => n === 0)); assert.ok(Object.values(audit.invalid_numeric_counts).every(n => n === 0));
  assert.equal(query.row_count, 35040); assert.equal(query.daily.length, 365); assert.equal(query.contributing_row_ids.length, 35040); assert.equal(query.usage_kwh, audit.totalUsage);
  assert.equal(dataset.rows[95].time_label, '00:00'); assert.equal(dataset.rows[95].date_label, '2018-01-01'); assert.equal(dataset.rows[94].time_label, '23:45');
  assert.doesNotThrow(() => JSON.stringify(audit)); assert.doesNotThrow(() => JSON.stringify(query));
  t.diagnostic(JSON.stringify({ source_csv_sha256: dataset.source_csv_sha256, row_count: audit.row_count, date_count: audit.date_count, negative_order_jump_count: audit.negative_order_jump_count, nsm_conflict_count: audit.nsm_conflict_count, week_status_conflict_count: audit.week_status_conflict_count, day_of_week_conflict_count: audit.day_of_week_conflict_count, load_type_counts: audit.load_type_counts, totalUsage: audit.totalUsage, query_fingerprint: query.query_fingerprint }));
});
