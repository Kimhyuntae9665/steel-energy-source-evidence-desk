import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { queryDataset, selectDatasetRows, parseDecimal } from './core.mjs';

const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const policyBytes = readFileSync(new URL('./query-policy.json', import.meta.url));
export const QUERY_POLICY = freeze(JSON.parse(policyBytes));
export const QUERY_POLICY_SHA256 = hash(policyBytes);
export const SCHEMA_VERSION = QUERY_POLICY.schema_version;
const FIELDS = QUERY_POLICY.required_fields;
const nullAnswer = () => ({ count: null, value: null, row_count: null, day_count: null, usage_kwh_exact: null });
function strictCalendar(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return null;
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > days[month - 1]) return null;
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(0, 0, 0, 0);
  return date;
}
function previousLabel(value) {
  const date = strictCalendar(value); date.setUTCDate(date.getUTCDate() - 1);
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
export function exactTwoDecimal(value) {
  const decimal = parseDecimal(value);
  if (!decimal) return null;
  let coefficient = decimal.coefficient;
  if (decimal.scale > 2) { const divisor = 10n ** BigInt(decimal.scale - 2); if (coefficient % divisor !== 0n) return null; coefficient /= divisor; }
  else coefficient *= 10n ** BigInt(2 - decimal.scale);
  const negative = coefficient < 0n, digits = (negative ? -coefficient : coefficient).toString().padStart(3, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

export function validateQuery(query) {
  if (!query || typeof query !== 'object' || Array.isArray(query) || Object.getPrototypeOf(query) !== Object.prototype || Reflect.ownKeys(query).length !== FIELDS.length || Reflect.ownKeys(query).some(key => typeof key !== 'string' || !FIELDS.includes(key)) || FIELDS.some(key => !Object.hasOwn(query, key))) return freeze({ valid: false, status: 'invalid_query', reason: 'invalid_shape', canonical_query: null });
  const canonical_query = Object.fromEntries(FIELDS.map(key => [key, query[key]]));
  const badEnum = query.schema_version !== SCHEMA_VERSION || !QUERY_POLICY.operations.includes(query.operation) || !(query.source_weekstatus === null || QUERY_POLICY.source_weekstatus.includes(query.source_weekstatus)) || !(query.source_load_type === null || QUERY_POLICY.source_load_type.includes(query.source_load_type)) || !(query.unavailable_topic === null || QUERY_POLICY.unavailable_topics.includes(query.unavailable_topic));
  if (badEnum) return freeze({ valid: false, status: 'invalid_query', reason: 'invalid_enum', canonical_query });
  const from = query.source_labeled_date_from, to = query.source_labeled_date_to_exclusive;
  if (from !== null && !strictCalendar(from) || to !== null && !strictCalendar(to)) return freeze({ valid: false, status: 'invalid_calendar_date', reason: 'invalid_calendar_date', canonical_query });
  if ((from === null) !== (to === null) || from !== null && from >= to) return freeze({ valid: false, status: 'invalid_date_range', reason: 'invalid_date_range', canonical_query });
  const scope = { from: from ?? QUERY_POLICY.coverage.from, to_exclusive: to ?? QUERY_POLICY.coverage.to_exclusive };
  if (scope.to_exclusive <= QUERY_POLICY.coverage.from || scope.from >= QUERY_POLICY.coverage.to_exclusive) return freeze({ valid: false, status: 'period_not_in_historical_source', reason: 'period_not_in_historical_source', canonical_query, requested_scope: scope });
  if (scope.from < QUERY_POLICY.coverage.from || scope.to_exclusive > QUERY_POLICY.coverage.to_exclusive) return freeze({ valid: false, status: 'scope_not_fully_covered', reason: 'scope_not_fully_covered', canonical_query, requested_scope: scope });
  return freeze({ valid: true, canonical_query, requested_scope: scope });
}

const UNAVAILABLE = {
  period_coverage: { state: 'period_present_in_historical_source', description: 'Requested source-labeled dates are within the admitted historical 2018 coverage. This reports period coverage only.' },
  co2_mass: { state: 'unit_and_derivation_unresolved', description: 'Publisher carbon field name/unit inconsistency is unresolved; no carbon mass is computed.' },
  energy_per_tonne: { state: 'production_quantity_absent', description: 'Production tonnes are absent; energy per tonne cannot be computed.' },
  electricity_cost: { state: 'tariff_and_billing_rules_absent', description: 'Tariff and bill fields are absent; electricity cost cannot be computed.' },
  equipment_fault_cause: { state: 'equipment_and_fault_cause_labels_absent', description: 'Equipment fault evidence is absent; fault causes cannot be inferred.' },
  source_timezone: { state: 'source_timezone_unresolved', description: 'Source labels have no established timezone.' },
  physical_interval_boundary: { state: 'physical_interval_semantics_unresolved', description: 'Source row order places 00:00 after 23:45 within each labeled date; physical interval boundaries are not established.' }
};
export function executeQuery(dataset, query, options = {}) {
  const dictionary_sha256 = options.dictionary_sha256 ?? hash(readFileSync(new URL('./data/source-dictionary.json', import.meta.url)));
  if (typeof dictionary_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(dictionary_sha256)) { const error = new Error('dictionary_sha256 must be an admitted SHA256 digest'); error.code = 'INVALID_DICTIONARY_DIGEST'; throw error; }
  const validated = validateQuery(query);
  const baseReceipt = { receipt_version: 'P12-UCI851-RECEIPT-1', source_csv_sha256: dataset.source_csv_sha256, source_dictionary_sha256: dictionary_sha256, query_policy_sha256: QUERY_POLICY_SHA256, canonical_query: validated.canonical_query, requested_scope: validated.requested_scope ?? null, source_label_basis: 'Original source DD/MM/YYYY calendar labels; no timezone or physical interval boundary interpretation.', source_order_policy: QUERY_POLICY.source_time_policy };
  const finish = ({ status, reason = null, answer = nullAnswer(), selected_row_ids = null, contributing_row_ids = null, daily = [], receiptExtras = {} }) => {
    const receipt = { ...baseReceipt, status, reason, answer, selected_row_ids, selected_row_count: selected_row_ids === null ? null : selected_row_ids.length, contributing_row_ids, contributing_row_count: contributing_row_ids === null ? null : contributing_row_ids.length, exact_usage_kwh: answer.usage_kwh_exact, daily_series_role: 'contextual_source_usage_for_energy_operations_only', unresolved_states: ['ok', 'period_present_in_historical_source'].includes(status) ? [] : [reason ?? status], ...receiptExtras };
    const query_fingerprint = hash(JSON.stringify(receipt));
    return freeze({ canonical_query: validated.canonical_query, status, reason, answer, receipt: { ...receipt, query_fingerprint }, query_fingerprint, selected_row_ids, contributing_row_ids, daily, daily_series_role: 'contextual_source_usage_for_energy_operations_only' });
  };
  if (!validated.valid) return finish({ status: validated.status, reason: validated.reason });
  const q = validated.canonical_query;
  const filter = { start_date: validated.requested_scope.from, end_date: previousLabel(validated.requested_scope.to_exclusive), week_status: q.source_weekstatus ?? 'ALL', load_type: q.source_load_type ?? 'ALL' };
  const selection = selectDatasetRows(dataset, filter);
  const selected_row_ids = selection.selected_row_ids, selectedRows = selection.rows;
  const selectedDayCount = new Set(selectedRows.map(row => row.date_label)).size;
  const energyRequested = ['sum_source_usage_kwh', 'compare_source_weekstatus_sums'].includes(q.operation) && q.unavailable_topic === null;
  const energySelection = energyRequested && selected_row_ids.length > 0 ? queryDataset(dataset, filter) : null;
  const daily = energySelection === null ? [] : energySelection.daily.map(day => ({ date_label: day.date_label, row_count: day.row_count, usage_kwh: day.usage_kwh === null ? null : exactTwoDecimal(day.usage_kwh), usage_kwh_exact: day.usage_kwh === null ? null : exactTwoDecimal(day.usage_kwh), status: day.status, missing_usage_count: day.missing_usage_count, invalid_usage_count: day.invalid_usage_count, series_role: 'contextual_source_usage' }));
  const receiptExtras = { excluded_invalid_date_rows: selection.invalid_date_rows, date_coverage_complete: selection.date_coverage_complete, contextual_source_usage_kwh: energySelection === null || energySelection.usage_kwh === null ? null : exactTwoDecimal(energySelection.usage_kwh), selected_source_day_count: selectedDayCount, energy_aggregation_performed: energySelection !== null };
  const finishSelected = fields => finish({ selected_row_ids, daily, receiptExtras, ...fields });
  if (selected_row_ids.length === 0) {
    const categories = q.operation === 'count_by_source_load_type' ? QUERY_POLICY.source_load_type : q.operation === 'compare_source_weekstatus_sums' ? QUERY_POLICY.source_weekstatus : null;
    const groups = categories === null ? {} : { groups: categories.map(category => ({ category, count: 0, row_count: 0, day_count: 0, usage_kwh_exact: null, sum: null, state: 'empty_group', contributing_row_ids: [] })) };
    return finishSelected({ status: 'empty_selection', answer: { count: 0, value: null, row_count: 0, day_count: 0, usage_kwh_exact: null, ...groups }, contributing_row_ids: [] });
  }
  if (q.operation === 'describe_source_time_order' && [q.source_labeled_date_from, q.source_labeled_date_to_exclusive, q.source_weekstatus, q.source_load_type].some(value => value !== null)) return finishSelected({ status: 'invalid_query', reason: 'describe_requires_full_original_scope', contributing_row_ids: null });
  if (q.operation === 'report_missing_or_unresolved_field' ? q.unavailable_topic === null : q.unavailable_topic !== null) return finishSelected({ status: 'invalid_query', reason: 'invalid_operation_topic', contributing_row_ids: null });
  if (q.operation === 'report_missing_or_unresolved_field') {
    const unavailable = { ...UNAVAILABLE[q.unavailable_topic], state: QUERY_POLICY.topic_states[q.unavailable_topic] };
    return finishSelected({ status: unavailable.state, reason: unavailable.state, answer: { ...nullAnswer(), topic: q.unavailable_topic, description: unavailable.description }, contributing_row_ids: [] });
  }
  const measuredUsage = energySelection === null || energySelection.usage_kwh === null ? null : exactTwoDecimal(energySelection.usage_kwh);
  const common = { count: selected_row_ids.length, row_count: selected_row_ids.length, day_count: selectedDayCount, value: null, usage_kwh_exact: null };
  const energyResult = { ...common, value: measuredUsage, usage_kwh_exact: measuredUsage };
  if (q.operation === 'count_source_rows') return finishSelected({ status: 'ok', answer: { ...common, value: selected_row_ids.length }, contributing_row_ids: selected_row_ids });
  const group = (field, category) => {
    const groupRows = selectedRows.filter(row => row.source_fields[field] === category), ids = groupRows.map(row => row.row_id);
    const result = !energyRequested || groupRows.length === 0 ? null : queryDataset(dataset, { start_date: validated.requested_scope.from, end_date: previousLabel(validated.requested_scope.to_exclusive), week_status: field === 'WeekStatus' ? category : q.source_weekstatus ?? 'ALL', load_type: field === 'Load_Type' ? category : q.source_load_type ?? 'ALL' });
    const sum = result === null || result.usage_kwh === null ? null : exactTwoDecimal(result.usage_kwh);
    return { category, count: groupRows.length, row_count: groupRows.length, day_count: new Set(groupRows.map(row => row.date_label)).size, usage_kwh_exact: sum, sum: sum, state: groupRows.length === 0 ? 'empty_group' : energyRequested && sum === null ? 'incomplete_usage' : 'ok', contributing_row_ids: energyRequested && sum === null ? [] : ids };
  };
  if (q.operation === 'count_by_source_load_type') return finishSelected({ status: 'ok', answer: { ...common, groups: QUERY_POLICY.source_load_type.map(category => group('Load_Type', category)) }, contributing_row_ids: selected_row_ids });
  if (q.operation === 'describe_source_time_order') {
    let previous = null; const jumps = [];
    for (const row of dataset.rows) {
      if (row.date.status !== 'valid') { previous = null; continue; }
      const ordinal = row.date.calendar_day_number * 86400 + row.date.seconds_of_day;
      if (previous && ordinal < previous.ordinal) jumps.push({ previous_row_id: previous.row.row_id, row_id: row.row_id, previous_source_date: previous.row.source_fields.date, source_date: row.source_fields.date, jump_seconds: ordinal - previous.ordinal });
      previous = { row, ordinal };
    }
    return finishSelected({ status: 'ok', answer: { ...common, negative_order_jump_count: jumps.length, negative_order_jumps: jumps, source_examples: jumps.slice(0, 3), description: QUERY_POLICY.source_time_policy }, contributing_row_ids: selected_row_ids });
  }
  if (measuredUsage === null) return finishSelected({ status: 'incomplete_usage', reason: energySelection.usage_kwh === null ? 'missing_or_invalid_source_usage' : 'source_usage_not_exact_two_decimal', answer: { ...nullAnswer(), ...(q.operation === 'compare_source_weekstatus_sums' ? { groups: QUERY_POLICY.source_weekstatus.map(category => group('WeekStatus', category)) } : {}) }, contributing_row_ids: [] });
  if (q.operation === 'sum_source_usage_kwh') return finishSelected({ status: 'ok', answer: energyResult, contributing_row_ids: selected_row_ids });
  if (q.operation === 'compare_source_weekstatus_sums') return finishSelected({ status: 'ok', answer: { ...energyResult, groups: QUERY_POLICY.source_weekstatus.map(category => group('WeekStatus', category)) }, contributing_row_ids: selected_row_ids });
  throw new Error('Unreachable operation');
}
