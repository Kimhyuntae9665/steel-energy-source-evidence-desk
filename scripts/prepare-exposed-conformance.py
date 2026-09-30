"""Write-once CPU readiness for the nine unchanged exposed cases; no transport/runtime probe."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXP = ROOT / 'experiments/query-intent-v1'
TARGET = EXP / 'exposed-conformance-readiness.json'
FREEZE_SHA256 = '2b971409cf0867b5f00d08654cd296e2c64919e3e7e0d3517a61402dc57a40dc'
BASE_COMMIT = 'f56bd04b38574a7f45e11d00c728634165eab6ad'
RESULT_SHA256 = {
    'model-runs/query-intent-v1/development/D1.json': 'b1b6facf902656d2e2cffa47717163463ef2acbb49b890fe12f4425bf4f9112f',
    'model-runs/query-intent-v1/development/D2.json': '4b545c32fefc43b475e2cd3b3b30c0345382efa9d136abefa8428b7b22f0d82c',
    'model-runs/query-intent-v1/development/D3.json': '9bff77684dcb979193aba09a4553fc8bfe2ffd2d1e5f1d601aa5cb33af9eecf2',
    'model-runs/query-intent-v1/development-report.json': '1eee10a50b30671f505c906237573357e2e9e37d95c8794d155a054816717b68'
}
def sha(value):
    return hashlib.sha256(value).hexdigest()
def checked_bytes(path, expected):
    value = (ROOT / path).read_bytes()
    if sha(value) != expected:
        raise ValueError('Protected identity differs: ' + path)
    return value
def build_manifest():
    freeze_bytes = checked_bytes('experiments/query-intent-v1/freeze.json', FREEZE_SHA256)
    freeze = json.loads(freeze_bytes)
    assert len(freeze['method_file_sha256']) == 19
    assert len(freeze['protected_cpu_baseline_files']) == 24
    for path, digest in freeze['method_file_sha256'].items():
        checked_bytes(path, digest)
    for item in freeze['protected_cpu_baseline_files']:
        checked_bytes(item['path'], item['sha256'])
    for path, digest in RESULT_SHA256.items():
        checked_bytes(path, digest)
    report = json.loads((ROOT / 'model-runs/query-intent-v1/development-report.json').read_bytes())
    assert report['freeze_sha256'] == FREEZE_SHA256 and report['development_gate_passed'] is True
    assert report['scheduled_case_count'] == report['attempted_calls'] == report['completed_calls'] == 3
    assert report['strict_intent_matches'] == 3 and report['raw_field_matches'] == report['raw_field_denominator'] == 21
    runtime = json.loads((EXP / 'runtime.json').read_bytes())
    schema = json.loads((EXP / 'schema.json').read_bytes())
    questions = json.loads((EXP / 'questions-exposed-conformance.json').read_bytes())['questions']
    labels = json.loads((EXP / 'expected-queries.json').read_bytes())['cases']
    case_ids = [f'E{index}' for index in range(1, 10)]
    assert [question['id'] for question in questions] == runtime['exposed_conformance_case_ids'] == case_ids
    assert runtime['options']['num_ctx'] == 4096 and runtime['options']['num_predict'] == 640
    assert runtime['timeout_seconds'] == 60 and runtime['concurrency'] == 1
    assert runtime['retry_calls'] == runtime['demo_calls'] == 0
    assert runtime['conditional_later_batch_calls'] == 9 and runtime['extra_safety_tokens'] == 128
    assert runtime['no_evaluator_in_request'] and runtime['no_dataset_rows_or_numeric_answers_in_request'] and runtime['no_generated_execution']
    spec = importlib.util.spec_from_file_location('frozen_intent_payload', ROOT / 'scripts/intent-payload.py')
    payload = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(payload)
    cases = []
    for question in questions:
        request, budget = payload.payload_for(question)
        assert budget == next(item for item in freeze['predeclared_request_budgets'] if item['case_id'] == question['id'])
        assert sha(json.dumps(request, separators=(',', ':'), ensure_ascii=False).encode()) == budget['request_sha256']
        assert budget['conservative_context_headroom'] >= 1007
        assert list(request) == ['model', 'prompt', 'format', 'raw', 'stream', 'think', 'keep_alive', 'options']
        assert request['raw'] is True and request['stream'] is False and request['think'] is False
        for forbidden in ['959636.71', '126238.29', '3968.64', 'expected-queries.json', 'csv-line-']:
            assert forbidden not in request['prompt']
        label_index = next(index for index, label in enumerate(labels) if label['id'] == question['id'])
        label = labels[label_index]
        assert list(label['query']) == schema['required'] and len(label['query']) == 7
        cases.append({
            'case_id': question['id'], 'question': question['question'], **budget,
            'expected_query': label['query'], 'expected_policy_state': label['policy_state'],
            'expected_query_pointer': f'experiments/query-intent-v1/expected-queries.json#/cases/{label_index}/query',
            'expected_policy_state_pointer': f'experiments/query-intent-v1/expected-queries.json#/cases/{label_index}/policy_state'
        })
    assert all(case['expected_query']['source_weekstatus'] is None for case in cases)
    assert all(case['expected_query']['operation'] != 'count_source_rows' for case in cases)
    development = [label for label in labels if label['id'] in ['D1', 'D2', 'D3']]
    assert len(development) == 3
    assert sum(value is None for label in development for value in label['query'].values()) == 15
    assert all(label['query']['schema_version'] == 'P12-UCI851-QUERY-1' for label in development)
    return {
        'readiness_version': 'P12-EXPOSED-CONFORMANCE-READINESS-1',
        'protocol_version': freeze['protocol_version'], 'phase': 'exposed-conformance',
        'state': 'prepared_not_run', 'preparation': 'CPU-only identity and budget verification; no generation, runtime/GPU probe, or model download',
        'preparation_base_commit': BASE_COMMIT, 'write_once': True, 'prepared_before_later_resource_handover': True,
        'resource_handover_required': True, 'development_gate_is_resource_authorization': False,
        'scope': 'Nine already-exposed declared mappings, not an independently unseen benchmark or broad natural-language accuracy test',
        'method_freeze_sha256': FREEZE_SHA256, 'method_file_count': 19,
        'method_file_sha256': freeze['method_file_sha256'],
        'protected_cpu_baseline_file_count': 24, 'protected_cpu_baseline_files': freeze['protected_cpu_baseline_files'],
        'unchanged_existing_result_sha256': RESULT_SHA256,
        'source_csv_sha256': freeze['source_csv_sha256'], 'source_dictionary_sha256': freeze['source_dictionary_sha256'],
        'query_policy_sha256': freeze['query_policy_sha256'],
        'questions_path': 'experiments/query-intent-v1/questions-exposed-conformance.json',
        'questions_sha256': freeze['method_file_sha256']['experiments/query-intent-v1/questions-exposed-conformance.json'],
        'expected_labels_path': 'experiments/query-intent-v1/expected-queries.json',
        'expected_labels_sha256': freeze['method_file_sha256']['experiments/query-intent-v1/expected-queries.json'],
        'canonical_request_digest_basis': 'UTF-8 compact JSON in the insertion order returned by unchanged frozen payload_for; expected labels never enter requests',
        'runtime_identity_basis': 'Unchanged pinned runtime declaration; no live runtime/GPU identity probe in this preparation',
        'runtime': {
            'model': runtime['model'], 'model_digest': runtime['model_digest'], 'ollama_version': runtime['ollama_version'],
            'context_tokens': 4096, 'output_reserved_tokens': 640, 'extra_safety_tokens': 128,
            'timeout_seconds': 60, 'concurrency': 1, 'retry_calls': 0, 'demo_calls': 0,
            'temperature': runtime['options']['temperature'], 'seed': runtime['options']['seed'],
            'raw': True, 'stream': False, 'think': False, 'response_byte_limit': runtime['response_byte_limit']
        },
        'scheduled_case_ids': case_ids, 'scheduled_case_count': 9, 'generation_calls_in_preparation': 0,
        'exposed_conformance_calls_recorded_at_preparation': 0,
        'minimum_conservative_context_headroom': min(case['conservative_context_headroom'] for case in cases),
        'tokenization': 'Conservative UTF-8-byte upper bound, not measured tokenization',
        'grading': {
            'unchanged_grader_path': 'scripts/grade-intent-v1.mjs',
            'unchanged_grader_sha256': freeze['method_file_sha256']['scripts/grade-intent-v1.mjs'],
            'unchanged_grading_module_sha256': freeze['method_file_sha256']['intent-grading.mjs'],
            'scheduled_failure_denominator': 9, 'raw_field_denominator': 63, 'strict_full_query_denominator': 9,
            'structural_denominator': 9, 'policy_denominator': 9,
            'report_separately': ['scheduled', 'attempted', 'completed_provenance_valid', 'raw_field_matches', 'strict_full_query_matches', 'structural_validity', 'policy_allowed_or_rejected', 'unexpected_fields'],
            'failure_rule': 'Every scheduled missing, refused, malformed, truncated, timed-out or HTTP-rejected output remains in the denominator; absent fields are wrong',
            'policy_rejection_is_semantic_failure': False, 'deterministic_repair_credit': 0, 'backend_arithmetic_credit_to_model': 0,
            'method_tuning_or_question_changes_for_this_batch': False
        },
        'development_literal_match_scope': {
            'raw_field_matches': 21, 'raw_field_denominator': 21, 'operation_choices': 3, 'schema_version_values': 3, 'null_filter_or_topic_values': 15,
            'date_extraction_evidence': False, 'category_filter_selection_evidence': False, 'unknown_topic_routing_evidence': False
        },
        'planned_coverage_limits': {
            'source_weekstatus_values': [None], 'source_weekstatus_filter_selection_tested': False,
            'count_source_rows_in_development_or_prepared_cases': False,
            'nine_case_results_available': False, 'general_natural_language_accuracy_claim': False
        },
        'cases': cases
    }
def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument('--check', action='store_true', help='Verify the existing write-once manifest; never write it.')
    options = args.parse_args()
    content = (json.dumps(build_manifest(), indent=2, ensure_ascii=False) + '\n').encode()
    if options.check:
        assert TARGET.read_bytes() == content, 'Readiness manifest differs from unchanged frozen inputs.'
        state = 'verified_existing_write_once_manifest'
    else:
        with TARGET.open('xb') as output:
            output.write(content)
        state = 'created_write_once_manifest'
    print(json.dumps({'state': state, 'readiness_sha256': sha(content), 'prepared_cases': 9, 'raw_field_denominator': 63, 'strict_query_denominator': 9, 'method_files_verified': 19, 'protected_baseline_files_verified': 24, 'existing_result_files_verified': 4, 'generation_calls': 0}))
if __name__ == '__main__':
    main()
