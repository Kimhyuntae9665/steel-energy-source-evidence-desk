"""Pure CPU protocol checks. No requests, tokenizer/model downloads or evaluator execution."""
import importlib.util,json,sys,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1];E=ROOT/'experiments/query-intent-v1'
def module(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
payload=module('payload','intent-payload.py');runner=module('runner','run-intent-v1.py')
class ProtocolChecks(unittest.TestCase):
    def test_exact_typed_schema_and_all_requests_fit_without_answers(self):
        schema=json.loads((E/'schema.json').read_text());runtime=json.loads((E/'runtime.json').read_text());freeze=json.loads((E/'freeze.json').read_text())
        self.assertEqual(len(schema['required']),7);self.assertEqual(set(schema['required']),set(schema['properties']));self.assertFalse(schema['additionalProperties'])
        for phase in ['development','exposed-conformance']:
            for q in json.loads((E/f'questions-{phase}.json').read_text())['questions']:
                request,budget=payload.payload_for(q)
                self.assertEqual(budget,next(x for x in freeze['predeclared_request_budgets']if x['case_id']==q['id']))
                self.assertGreaterEqual(budget['conservative_context_headroom'],1000)
                self.assertTrue(request['raw']);self.assertFalse(request['think']);self.assertFalse(request['stream'])
                self.assertEqual(request['options']['num_ctx'],4096);self.assertEqual(request['options']['num_predict'],640)
                for forbidden in ['959636.71','126238.29','3968.64','frozen-gold','expected-queries.json','csv-line-']:
                    self.assertNotIn(forbidden,request['prompt'])
        self.assertEqual(runtime['retry_calls'],0);self.assertEqual(runtime['demo_calls'],0)
    def test_payload_rejects_extra_oracle_and_oversize_input_without_correction(self):
        with self.assertRaises(ValueError):payload.payload_for({'id':'synthetic','question':'inert','expected':'not permitted'})
        with self.assertRaises(ValueError):payload.payload_for({'id':'synthetic','question':'x'*10000})
    def test_runner_refuses_without_resource_handover_before_runtime_or_transport(self):
        with patch.object(sys,'argv',['run-intent-v1.py','--phase','development']),patch.object(runner,'verify_identity',side_effect=AssertionError('runtime probe must not happen')):
            with self.assertRaisesRegex(RuntimeError,'explicit_gpu_handover_required'):runner.main()
    def test_freeze_and_original_cpu_evidence_bytes_match(self):
        freeze,digest=runner.verify_freeze();self.assertTrue(freeze['frozen_before_inference']);self.assertEqual(freeze['model_calls_at_freeze'],0);self.assertEqual(len(digest),64)
if __name__=='__main__':unittest.main()
