import { readFileSync } from 'node:fs';
import { validateQuery, QUERY_POLICY } from './policy.mjs';

const schema = JSON.parse(readFileSync(new URL('./experiments/query-intent-v1/schema.json', import.meta.url)));
const runtime = JSON.parse(readFileSync(new URL('./experiments/query-intent-v1/runtime.json', import.meta.url)));
const BYTE_LIMIT = runtime.response_byte_limit;
const error = (field, layer, code, message) => ({ field, layer, code, message });
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };

// This recognizes JSON before JSON.parse, so duplicate decoded object keys cannot
// be silently overwritten. It never repairs, extracts, evaluates or executes text.
export function parseStrictJSON(raw_output) {
  const fail = (code, message, field = '$') => { const failure = new SyntaxError(message); failure.code = code; failure.field = field; throw failure; };
  if (typeof raw_output !== 'string') fail('raw_output_must_be_string', 'Raw output must be a string.');
  if (Buffer.byteLength(raw_output, 'utf8') > BYTE_LIMIT) fail('response_byte_limit_exceeded', `Raw output exceeds the declared ${BYTE_LIMIT}-byte bound.`);
  let cursor = 0;
  const whitespace = () => { while (/[\x20\t\r\n]/.test(raw_output[cursor] ?? '') && cursor < raw_output.length) cursor++; };
  const string = () => {
    const start = cursor;
    if (raw_output[cursor++] !== '"') fail('invalid_json', 'Expected a JSON string.');
    let closed = false;
    while (cursor < raw_output.length) {
      const char = raw_output[cursor++];
      if (char === '"') { closed = true; break; }
      if (char === '\\') { if (cursor >= raw_output.length) break; cursor++; }
    }
    if (!closed) fail('invalid_json', 'Unclosed JSON string.');
    try { return JSON.parse(raw_output.slice(start, cursor)); } catch { fail('invalid_json', 'Invalid JSON string or escape.'); }
  };
  const value = (depth, path) => {
    if (depth > 32) fail('json_depth_limit_exceeded', 'JSON nesting exceeds the bounded validation depth.', path);
    whitespace();
    const char = raw_output[cursor];
    if (char === '{') {
      cursor++; whitespace(); const keys = new Set();
      if (raw_output[cursor] === '}') { cursor++; return; }
      while (true) {
        whitespace(); const key = string(), field = path === '$' ? key : `${path}.${key}`;
        if (keys.has(key)) fail('duplicate_key', `Duplicate JSON key ${JSON.stringify(key)} is forbidden.`, field);
        keys.add(key); whitespace(); if (raw_output[cursor++] !== ':') fail('invalid_json', 'Expected a colon after an object key.', field);
        value(depth + 1, field); whitespace();
        if (raw_output[cursor] === '}') { cursor++; return; }
        if (raw_output[cursor++] !== ',') fail('invalid_json', 'Expected an object comma or closing brace.', path);
      }
    }
    if (char === '[') {
      cursor++; whitespace(); if (raw_output[cursor] === ']') { cursor++; return; }
      let index = 0;
      while (true) { value(depth + 1, `${path}[${index++}]`); whitespace(); if (raw_output[cursor] === ']') { cursor++; return; } if (raw_output[cursor++] !== ',') fail('invalid_json', 'Expected an array comma or closing bracket.', path); }
    }
    if (char === '"') { string(); return; }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(raw_output.slice(cursor));
    if (!token) fail('invalid_json', 'Expected a JSON value.', path);
    cursor += token[0].length;
  };
  value(0, '$'); whitespace();
  if (cursor !== raw_output.length) fail('invalid_json', 'Content outside the single JSON value is forbidden.');
  try { return JSON.parse(raw_output); } catch { fail('invalid_json', 'Output is not strict JSON.'); }
}

export function inspectIntent(raw_output) {
  let parsed_query = null; const errors = [];
  const finish = (structural_state, policy_state, execution_allowed) => freeze({ raw_output, parsed_query, structural_state, policy_state, errors, semantic_state: 'requires_human_review', execution_allowed });
  try { parsed_query = parseStrictJSON(raw_output); }
  catch (failure) { errors.push(error(failure.field ?? '$', 'structure', failure.code ?? 'invalid_json', failure.message)); return finish('invalid', 'not_evaluated', false); }
  if (!parsed_query || typeof parsed_query !== 'object' || Array.isArray(parsed_query)) {
    errors.push(error('$', 'structure', 'expected_object', 'Proposal must be exactly one JSON object.')); return finish('invalid', 'not_evaluated', false);
  }
  for (const key of schema.required) if (!Object.hasOwn(parsed_query, key)) errors.push(error(key, 'structure', 'missing_required_field', 'All seven fields are required; unused fields must be null.'));
  for (const key of Object.keys(parsed_query)) if (!Object.hasOwn(schema.properties, key)) errors.push(error(key, 'structure', 'additional_field', 'Extra fields and aliases are forbidden.'));
  for (const [field, rule] of Object.entries(schema.properties)) {
    if (!Object.hasOwn(parsed_query, field)) continue;
    const fieldValue = parsed_query[field];
    if (Object.hasOwn(rule, 'const') && fieldValue !== rule.const) errors.push(error(field, 'structure', 'invalid_const', `Expected ${JSON.stringify(rule.const)}.`));
    if (rule.enum && !rule.enum.some(allowed => allowed === fieldValue)) errors.push(error(field, 'structure', 'invalid_enum', 'Value must match a declared schema enum exactly, including case.'));
    if (rule.type) {
      const types = Array.isArray(rule.type) ? rule.type : [rule.type];
      const actualType = fieldValue === null ? 'null' : Array.isArray(fieldValue) ? 'array' : typeof fieldValue;
      if (!types.includes(actualType)) errors.push(error(field, 'structure', 'invalid_type', `Expected ${types.join(' or ')}.`));
      else if (typeof fieldValue === 'string' && rule.pattern && !new RegExp(rule.pattern).test(fieldValue)) errors.push(error(field, 'structure', 'invalid_date_shape', 'Date syntax must be exactly YYYY-MM-DD; calendar meaning is checked separately.'));
    }
  }
  if (errors.length) return finish('invalid', 'not_evaluated', false);
  const policy = validateQuery(parsed_query);
  if (!policy.valid) {
    const from = parsed_query.source_labeled_date_from, to = parsed_query.source_labeled_date_to_exclusive;
    if (policy.status === 'invalid_calendar_date') {
      for (const field of ['source_labeled_date_from', 'source_labeled_date_to_exclusive']) {
        const bound = parsed_query[field];
        if (bound !== null && validateQuery({ ...parsed_query, source_labeled_date_from: bound, source_labeled_date_to_exclusive: bound }).status === 'invalid_calendar_date') errors.push(error(field, 'policy', 'invalid_calendar_date', 'Source date label is not a valid Gregorian calendar date; the proposed label is preserved.'));
      }
    } else if (policy.status === 'invalid_date_range') {
      const field = from === null ? 'source_labeled_date_from' : to === null ? 'source_labeled_date_to_exclusive' : 'source_labeled_date_to_exclusive';
      errors.push(error(field, 'policy', 'invalid_date_range', from === null || to === null ? 'Both date bounds must be supplied together or both null.' : 'Exclusive end must be later than start.'));
    } else if (['period_not_in_historical_source', 'scope_not_fully_covered'].includes(policy.status)) {
      for (const field of ['source_labeled_date_from', 'source_labeled_date_to_exclusive']) errors.push(error(field, 'policy', policy.status, `Requested scope must be fully covered by [${QUERY_POLICY.coverage.from},${QUERY_POLICY.coverage.to_exclusive}); no date label is repaired.`));
    } else errors.push(error('$', 'policy', policy.reason ?? policy.status, 'Proposal fails the existing deterministic query policy.'));
    return finish('valid', policy.status, false);
  }
  if (parsed_query.operation === 'describe_source_time_order') {
    for (const field of ['source_labeled_date_from', 'source_labeled_date_to_exclusive', 'source_weekstatus', 'source_load_type']) if (parsed_query[field] !== null) errors.push(error(field, 'policy', 'describe_requires_full_original_scope', 'Original time-order description requires null date and category filters for the complete source order.'));
  }
  const report = parsed_query.operation === 'report_missing_or_unresolved_field';
  if (report ? parsed_query.unavailable_topic === null : parsed_query.unavailable_topic !== null) errors.push(error('unavailable_topic', 'policy', 'invalid_operation_topic', report ? 'An unavailable-field report requires a declared topic.' : 'This operation requires unavailable_topic to be null.'));
  if (errors.length) return finish('valid', 'invalid_query', false);
  return finish('valid', 'valid', true);
}
