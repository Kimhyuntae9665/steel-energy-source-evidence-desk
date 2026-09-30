import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const SOURCE_CSV_SHA256 = '9b1cee6f9cb9cd9df2b95814ca90a9a2ff15b7f5f1fba0fae3c643e82072eacc';
export const LOAD_TYPES = Object.freeze(['Light_Load', 'Medium_Load', 'Maximum_Load']);
const REQUIRED = ['date', 'Usage_kWh', 'NSM', 'WeekStatus', 'Day_of_week', 'Load_Type'];
const TEXT_FIELDS = new Set(['date', 'WeekStatus', 'Day_of_week', 'Load_Type']);
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const authority = new WeakSet();
const hash = value => createHash('sha256').update(value).digest('hex');
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };

// Arithmetic never passes a measurement through Number, parseFloat, or binary floats.
export function parseDecimal(value) {
  if (typeof value !== 'string' || !/^[+-]?\d+(?:\.\d+)?$/.test(value)) return null;
  const negative = value[0] === '-';
  const unsigned = value.replace(/^[+-]/, '');
  const [whole, fraction = ''] = unsigned.split('.');
  return freeze({ coefficient: BigInt(whole + fraction) * (negative ? -1n : 1n), scale: fraction.length });
}
export function addDecimal(a, b) {
  const scale = Math.max(a.scale, b.scale);
  return freeze({ coefficient: a.coefficient * 10n ** BigInt(scale - a.scale) + b.coefficient * 10n ** BigInt(scale - b.scale), scale });
}
export function decimalToString(decimal) {
  const negative = decimal.coefficient < 0n;
  let digits = (negative ? -decimal.coefficient : decimal.coefficient).toString().padStart(decimal.scale + 1, '0');
  if (decimal.scale) digits = `${digits.slice(0, -decimal.scale)}.${digits.slice(-decimal.scale)}`.replace(/0+$/, '').replace(/\.$/, '');
  return `${negative ? '-' : ''}${digits}`;
}
const numeric = value => value === '' ? { status: 'missing', value: null } : parseDecimal(value) ? { status: 'valid', value: decimalToString(parseDecimal(value)) } : { status: 'invalid', value: null };
function calendar(year, month, day) {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return null;
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > days[month - 1]) return null;
  // UTC is used only to determine a calendar weekday; source timestamps have no timezone.
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(0, 0, 0, 0);
  return { date_label: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, weekday: WEEKDAYS[date.getUTCDay()], calendar_day_number: Math.floor(date.getTime() / 86400000) };
}
export function parseSourceDate(value) {
  if (value === '') return freeze({ status: 'missing', reason: 'missing_date', date_label: null });
  const match = typeof value === 'string' && /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(value);
  if (!match) return freeze({ status: 'invalid', reason: 'expected_DD/MM/YYYY_HH:mm', date_label: null });
  const [, dd, mm, yyyy, hh, min] = match;
  const day = calendar(Number(yyyy), Number(mm), Number(dd));
  if (!day) return freeze({ status: 'invalid', reason: 'invalid_calendar_date', date_label: null });
  if (Number(hh) > 23 || Number(min) > 59) return freeze({ status: 'invalid', reason: 'invalid_time', date_label: null });
  return freeze({ status: 'valid', ...day, time_label: `${hh}:${min}`, seconds_of_day: Number(hh) * 3600 + Number(min) * 60 });
}

// Byte-oriented RFC4180 parser retains CSV lexemes, decoded values and exact source offsets.
function parseCSV(bytes) {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  try { decoder.decode(bytes); } catch { fail('INVALID_CSV', 'Source is not valid UTF-8'); }
  const records = []; let i = bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191 ? 3 : 0;
  let line = 1;
  while (i < bytes.length) {
    const start = i, lineStart = line, fields = [], lexemes = [], spans = [];
    while (true) {
      const fieldStart = i; let value;
      if (bytes[i] === 34) {
        i++; const parts = []; let partStart = i, closed = false;
        while (i < bytes.length) {
          if (bytes[i] === 34) {
            parts.push(bytes.subarray(partStart, i));
            if (bytes[i + 1] === 34) { parts.push(Buffer.from('"')); i += 2; partStart = i; continue; }
            i++; closed = true; break;
          }
          if (bytes[i] === 10) line++;
          i++;
        }
        if (!closed) fail('INVALID_CSV', `Unclosed quoted field at line ${lineStart}`);
        value = decoder.decode(Buffer.concat(parts));
        if (i < bytes.length && ![44, 10, 13].includes(bytes[i])) fail('INVALID_CSV', `Characters after closing quote at line ${lineStart}`);
      } else {
        while (i < bytes.length && ![44, 10, 13].includes(bytes[i])) { if (bytes[i] === 34) fail('INVALID_CSV', `Quote inside unquoted field at line ${lineStart}`); i++; }
        value = decoder.decode(bytes.subarray(fieldStart, i));
      }
      fields.push(value); lexemes.push(decoder.decode(bytes.subarray(fieldStart, i))); spans.push({ byte_start: fieldStart, byte_end: i });
      if (bytes[i] === 44) { i++; continue; }
      const end = i, lineEnd = line;
      if (bytes[i] === 13) { if (bytes[i + 1] !== 10) fail('INVALID_CSV', `Bare carriage return at line ${line}`); i += 2; line++; }
      else if (bytes[i] === 10) { i++; line++; }
      records.push({ fields, lexemes, spans, raw_csv: decoder.decode(bytes.subarray(start, end)), source_span: { byte_start: start, byte_end: end, byte_end_with_newline: i, line_start: lineStart, line_end: lineEnd } });
      if (records.length > 100001) fail('SOURCE_BOUND_EXCEEDED', 'Source exceeds 100000 data rows');
      break;
    }
  }
  return records;
}

export function parseDataset(input, { expectedSha256 = SOURCE_CSV_SHA256 } = {}) {
  const bytes = Buffer.from(input);
  if (bytes.length > 8000000) fail('SOURCE_BOUND_EXCEEDED', 'Source exceeds 8 MB');
  const digest = hash(bytes);
  if (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha256) || digest !== expectedSha256) fail('SOURCE_HASH_MISMATCH', 'CSV byte hash does not match admitted source');
  const records = parseCSV(bytes), header = records.shift();
  if (!header || new Set(header.fields).size !== header.fields.length || REQUIRED.some(name => !header.fields.includes(name))) fail('INVALID_SCHEMA', 'Source requires unique expected column names');
  const columns = header.fields;
  const rows = records.map(record => {
    if (record.fields.length !== columns.length) fail('INVALID_CSV', `Column count differs at line ${record.source_span.line_start}`);
    const source_fields = Object.fromEntries(columns.map((name, index) => [name, record.fields[index]]));
    const date = parseSourceDate(source_fields.date), numbers = Object.fromEntries(columns.filter(name => !TEXT_FIELDS.has(name)).map(name => [name, numeric(source_fields[name])]));
    return { row_id: `csv-line-${record.source_span.line_start}`, source_fields, raw_fields: record.fields, field_lexemes: record.lexemes, field_spans: record.spans, raw_csv: record.raw_csv, source_span: record.source_span, date, date_label: date.date_label, time_label: date.time_label ?? null, usage_kwh: numbers.Usage_kWh.value, usage_status: numbers.Usage_kWh.status, numeric: numbers, load_type: source_fields.Load_Type, week_status: source_fields.WeekStatus };
  });
  const dataset = freeze({ source_csv_sha256: digest, source_bytes: bytes.length, source_bom: bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191, columns, header: { raw_csv: header.raw_csv, source_span: header.source_span }, rows });
  authority.add(dataset); return dataset;
}
export async function loadDataset(options = {}) {
  if (typeof options === 'string') options = { path: options };
  const path = options.path ?? fileURLToPath(new URL('./data/Steel_industry_data.csv', import.meta.url));
  const handle = await open(path, 'r');
  // Admission bounds apply to the read itself, even if a file grows while being read.
  const bytes = Buffer.alloc(8000001); let length = 0;
  try {
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, null);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
  } finally { await handle.close(); }
  if (length > 8000000) fail('SOURCE_BOUND_EXCEEDED', 'Source exceeds 8 MB');
  return parseDataset(bytes.subarray(0, length), { expectedSha256: options.expectedSha256 ?? SOURCE_CSV_SHA256 });
}
function assertDataset(dataset) { if (!authority.has(dataset)) fail('INVALID_DATASET', 'Use an immutable dataset returned by loadDataset or parseDataset'); }
function totals(rows) {
  let sum = parseDecimal('0'), missing = 0, invalid = 0, valid = 0;
  for (const row of rows) { if (row.usage_status === 'valid') { sum = addDecimal(sum, parseDecimal(row.usage_kwh)); valid++; } else if (row.usage_status === 'missing') missing++; else invalid++; }
  const subtotal = decimalToString(sum), complete = missing === 0 && invalid === 0;
  return { usage_kwh: complete ? subtotal : null, usage_kwh_exact: complete ? subtotal : null, sumUsage: subtotal, exact_usage_subtotal_kwh: subtotal, total_usage_kwh: complete ? subtotal : null, usage_total_complete: complete, valid_usage_count: valid, missing_usage_count: missing, invalid_usage_count: invalid, status: rows.length === 0 ? 'empty' : complete ? 'complete' : 'incomplete' };
}
export function auditDataset(dataset) {
  assertDataset(dataset);
  const missing_counts = Object.fromEntries(dataset.columns.map(name => [name, 0]));
  const invalid_numeric_counts = Object.fromEntries(dataset.columns.filter(name => !TEXT_FIELDS.has(name)).map(name => [name, 0]));
  const dateCounts = {}, loadCounts = {}, weekCounts = {}, weekdayCounts = {};
  const invalid_date_row_ids = [], missing_date_row_ids = [], negative_order_jumps = [], nsm_conflicts = [], week_status_conflicts = [], day_of_week_conflicts = [], unknown_load_type_row_ids = [], unknown_week_status_row_ids = [], unknown_day_of_week_row_ids = [];
  let previous = null;
  for (const row of dataset.rows) {
    for (const name of dataset.columns) if (row.source_fields[name] === '') missing_counts[name]++;
    for (const [name, value] of Object.entries(row.numeric)) if (value.status === 'invalid') invalid_numeric_counts[name]++;
    loadCounts[row.load_type] = (loadCounts[row.load_type] ?? 0) + 1;
    weekCounts[row.week_status] = (weekCounts[row.week_status] ?? 0) + 1;
    weekdayCounts[row.source_fields.Day_of_week] = (weekdayCounts[row.source_fields.Day_of_week] ?? 0) + 1;
    if (row.load_type !== '' && !LOAD_TYPES.includes(row.load_type)) unknown_load_type_row_ids.push(row.row_id);
    if (row.week_status !== '' && !['Weekday', 'Weekend'].includes(row.week_status)) unknown_week_status_row_ids.push(row.row_id);
    if (row.source_fields.Day_of_week !== '' && !WEEKDAYS.includes(row.source_fields.Day_of_week)) unknown_day_of_week_row_ids.push(row.row_id);
    if (row.date.status !== 'valid') { (row.date.status === 'missing' ? missing_date_row_ids : invalid_date_row_ids).push(row.row_id); previous = null; continue; }
    dateCounts[row.date_label] = (dateCounts[row.date_label] ?? 0) + 1;
    const ordinal = row.date.calendar_day_number * 86400 + row.date.seconds_of_day;
    if (previous && ordinal < previous.ordinal) negative_order_jumps.push({ previous_row_id: previous.row.row_id, row_id: row.row_id, previous_source_date: previous.row.source_fields.date, source_date: row.source_fields.date, jump_seconds: ordinal - previous.ordinal });
    previous = { row, ordinal };
    if (row.numeric.NSM.status === 'valid' && row.numeric.NSM.value !== String(row.date.seconds_of_day)) nsm_conflicts.push({ row_id: row.row_id, source_nsm: row.source_fields.NSM, expected_seconds_of_day: row.date.seconds_of_day });
    const expectedWeek = ['Saturday', 'Sunday'].includes(row.date.weekday) ? 'Weekend' : 'Weekday';
    if (row.week_status !== expectedWeek) week_status_conflicts.push({ row_id: row.row_id, source_week_status: row.week_status, expected_calendar_week_status: expectedWeek });
    if (row.source_fields.Day_of_week !== row.date.weekday) day_of_week_conflicts.push({ row_id: row.row_id, source_day_of_week: row.source_fields.Day_of_week, expected_calendar_day_of_week: row.date.weekday });
  }
  const daily = Object.entries(dateCounts).sort(([a], [b]) => a.localeCompare(b)).map(([date_label, row_count]) => ({ date_label, row_count }));
  return freeze({ source_csv_sha256: dataset.source_csv_sha256, source_bytes: dataset.source_bytes, row_count: dataset.rows.length, date_count: daily.length, label_date_count: daily.length, daily, rows_per_day: dateCounts, every_date_has_96_rows: daily.length > 0 && daily.every(day => day.row_count === 96), missing_counts, missing_by_column: missing_counts, invalid_numeric_counts, invalid_date_row_ids, missing_date_row_ids, invalid_date_count: invalid_date_row_ids.length, missing_date_count: missing_date_row_ids.length, load_type_counts: loadCounts, week_status_counts: weekCounts, day_of_week_counts: weekdayCounts, unknown_load_type_row_ids, unknown_week_status_row_ids, unknown_day_of_week_row_ids, negative_order_jumps, negative_order_jump_count: negative_order_jumps.length, nsm_conflicts, nsm_conflict_count: nsm_conflicts.length, week_status_conflicts, week_status_conflict_count: week_status_conflicts.length, week_status_comparison: { basis: 'source_calendar_date_weekday', conflict_count: week_status_conflicts.length, conflicts: week_status_conflicts, unknown_count: unknown_week_status_row_ids.length, missing_count: missing_counts.WeekStatus }, day_of_week_conflicts, day_of_week_conflict_count: day_of_week_conflicts.length, sourceDay_of_week: { counts: weekdayCounts, conflict_count: day_of_week_conflicts.length, conflicts: day_of_week_conflicts, unknown_count: unknown_day_of_week_row_ids.length, missing_count: missing_counts.Day_of_week }, ...totals(dataset.rows), totalUsage: totals(dataset.rows).total_usage_kwh, temporal_semantics: 'Source DD/MM/YYYY calendar labels and source row order. No timezone or physical-date repair. 00:00 stays in its original source position.', carbon_status: 'unresolved_source_semantics', allowed_metrics: ['source_usage_kwh', 'source_row_count'] });
}
export function normalizeFilter(filter = {}) {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter) || Object.getPrototypeOf(filter) !== Object.prototype) fail('INVALID_FILTER', 'Filter must be a plain object');
  const keys = ['start_date', 'end_date', 'load_type', 'week_status'];
  if (Reflect.ownKeys(filter).some(key => typeof key !== 'string' || !keys.includes(key))) fail('INVALID_FILTER', 'Unsupported filter field');
  const out = { start_date: null, end_date: null, load_type: 'ALL', week_status: 'ALL', ...filter };
  for (const key of ['start_date', 'end_date']) {
    if (out[key] === null) continue;
    if (typeof out[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(out[key])) fail('INVALID_FILTER', `${key} must be an ISO calendar label or null`);
    const [year, month, day] = out[key].split('-').map(Number);
    if (!calendar(year, month, day)) fail('INVALID_FILTER', `${key} is an invalid calendar date`);
  }
  if (out.start_date && out.end_date && out.start_date > out.end_date) fail('INVALID_FILTER', 'start_date exceeds end_date');
  if (typeof out.load_type !== 'string' || !['ALL', ...LOAD_TYPES].includes(out.load_type)) fail('INVALID_FILTER', 'Unsupported load_type');
  if (typeof out.week_status !== 'string' || !['ALL', 'Weekday', 'Weekend'].includes(out.week_status)) fail('INVALID_FILTER', 'Unsupported week_status');
  return freeze(out);
}
export function selectDatasetRows(dataset, filter = {}) {
  assertDataset(dataset); const normalized_filter = normalizeFilter(filter), rows = [], invalid_date_rows = [];
  for (const row of dataset.rows) {
    if (row.date.status !== 'valid') { invalid_date_rows.push({ row_id: row.row_id, source_date: row.source_fields.date, date_status: row.date.status, reason: row.date.reason }); continue; }
    if (normalized_filter.start_date && row.date_label < normalized_filter.start_date || normalized_filter.end_date && row.date_label > normalized_filter.end_date || normalized_filter.load_type !== 'ALL' && row.load_type !== normalized_filter.load_type || normalized_filter.week_status !== 'ALL' && row.week_status !== normalized_filter.week_status) continue;
    rows.push(row);
  }
  return freeze({ normalized_filter, rows, selected_row_ids: rows.map(row => row.row_id), invalid_date_rows, date_coverage_complete: invalid_date_rows.length === 0 });
}
export function queryDataset(dataset, filter = {}) {
  assertDataset(dataset); const normalized_filter = normalizeFilter(filter), rows = [], invalid_date_rows = [], dates = new Map();
  for (const row of dataset.rows) {
    // Invalid source dates cannot be assigned to any calendar range; always expose them separately.
    if (row.date.status !== 'valid') { invalid_date_rows.push({ row_id: row.row_id, source_date: row.source_fields.date, date_status: row.date.status, reason: row.date.reason }); continue; }
    if (normalized_filter.start_date && row.date_label < normalized_filter.start_date || normalized_filter.end_date && row.date_label > normalized_filter.end_date || normalized_filter.load_type !== 'ALL' && row.load_type !== normalized_filter.load_type || normalized_filter.week_status !== 'ALL' && row.week_status !== normalized_filter.week_status) continue;
    rows.push(row); if (!dates.has(row.date_label)) dates.set(row.date_label, []); dates.get(row.date_label).push(row);
  }
  const contributing_row_ids = rows.map(row => row.row_id), filter_hash = hash(JSON.stringify(normalized_filter));
  const receiptPayload = { receipt_version: 'p12-source-query-v1', source_csv_sha256: dataset.source_csv_sha256, normalized_filter, contributing_row_ids, excluded_invalid_date_row_ids: invalid_date_rows.map(row => row.row_id), metrics: ['source_usage_kwh', 'source_row_count'], grouping: 'source_calendar_label', arithmetic: 'decimal_bigint', timestamp_policy: 'preserve_source_label_and_row_order' };
  const query_fingerprint = hash(JSON.stringify(receiptPayload));
  const receipt = { ...receiptPayload, filter_hash, query_fingerprint };
  return freeze({ normalized_filter, filter: normalized_filter, filter_hash, query_fingerprint, source_csv_sha256: dataset.source_csv_sha256, row_count: rows.length, contributing_row_ids, daily: [...dates.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date_label, group]) => ({ date_label, row_count: group.length, ...totals(group) })), ...totals(rows), invalid_date_rows, excluded_invalid_date_count: invalid_date_rows.length, date_coverage_complete: invalid_date_rows.length === 0, receipt, carbon_status: 'unresolved_source_semantics', allowed_metrics: ['source_usage_kwh', 'source_row_count'] });
}
