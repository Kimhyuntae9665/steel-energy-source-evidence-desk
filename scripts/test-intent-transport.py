"""CPU-only fault injection. No requests, models, runtime probes or real locks."""
import http.client,importlib.util,io,json,unittest,urllib.error
from pathlib import Path
from unittest.mock import Mock,patch

if 'runner' not in globals():
    spec=importlib.util.spec_from_file_location('intent_runner',Path(__file__).with_name('run-intent-v1.py'))
    runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)

class Response:
    status=200;closed=False
    def __init__(self,body=b'',failure=None,exit_failure=None):self.body=body;self.failure=failure;self.exit_failure=exit_failure
    def __enter__(self):return self
    def __exit__(self,*args):
        if self.exit_failure:raise self.exit_failure
    def read(self,limit):
        if self.failure:raise self.failure
        return self.body[:limit]
    def close(self):pass

class TransportTests(unittest.TestCase):
    def setUp(self):
        self.record={};self.barrier=Mock();self.runtime={'timeout_seconds':60,'response_byte_limit':128}
        self.no_network=patch.object(runner.urllib.request,'urlopen',side_effect=AssertionError('Network forbidden in CPU tests'))
        self.no_network.start();self.addCleanup(self.no_network.stop)
    def call(self,response=None,error=None):
        self.opener=Mock(return_value=response,side_effect=error)
        return runner.bounded_request(object(),self.runtime,self.record,self.barrier,self.opener)
    def assert_blocked(self,kind):
        self.barrier.assert_called_once_with('post_dispatch_completion_unverified')
        self.assertTrue(self.record['http_request_attempted']);self.assertFalse(self.record['transport_terminal_established'])
        self.assertEqual(self.record['transport_error']['type'],kind)
        self.opener.assert_called_once()
    def test_complete_response(self):
        api={'done':True,'response':'{}'}
        self.assertEqual(self.call(Response(json.dumps(api).encode())),api)
        self.assertTrue(self.record['transport_terminal_established']);self.barrier.assert_not_called();self.opener.assert_called_once()
    def test_incomplete_read_preserves_partial_status_and_error(self):
        with self.assertRaises(http.client.IncompleteRead):self.call(Response(failure=http.client.IncompleteRead(b'partial',20)))
        self.assert_blocked('IncompleteRead');self.assertEqual(self.record['http_status'],200);self.assertEqual(self.record['partial_response_text'],'partial')
    def test_connection_reset_and_interrupt(self):
        for error in [ConnectionResetError('reset'),KeyboardInterrupt('interrupted')]:
            with self.subTest(type=type(error).__name__):
                self.record={};self.barrier.reset_mock()
                with self.assertRaises(type(error)):self.call(error=error)
                self.assert_blocked(type(error).__name__)
    def test_error_body_read_failure_preserves_http_status(self):
        for failure in [TimeoutError('body timed out'),http.client.IncompleteRead(b'error fragment',8)]:
            with self.subTest(type=type(failure).__name__):
                self.record={};self.barrier.reset_mock()
                error=urllib.error.HTTPError('http://invalid',400,'rejected',{},Response(failure=failure))
                with self.assertRaises(type(failure)):self.call(error=error)
                self.assert_blocked(type(failure).__name__);self.assertEqual(self.record['http_status'],400);self.assertTrue(self.record['http_rejection'])
    def test_complete_http_rejection(self):
        error=urllib.error.HTTPError('http://invalid',400,'rejected',{},io.BytesIO(b'schema rejected'))
        self.assertIsNone(self.call(error=error));self.assertEqual(self.record['status'],'http_rejected');self.assertEqual(self.record['raw_response_text'],'schema rejected')
        self.assertTrue(self.record['transport_terminal_established']);self.barrier.assert_not_called();self.opener.assert_called_once()
    def test_malformed_shape_missing_done_and_overflow(self):
        for body in [b'bad JSON',b'[]',b'{"done":false}',b'x'*129]:
            with self.subTest(body=body[:20]):
                self.record={};self.barrier.reset_mock()
                with self.assertRaises(Exception):self.call(Response(body))
                self.barrier.assert_called_once();self.assertFalse(self.record['transport_terminal_established']);self.opener.assert_called_once()
    def test_http_error_overflow_is_not_terminal(self):
        error=urllib.error.HTTPError('http://invalid',500,'error',{},io.BytesIO(b'x'*129))
        with self.assertRaises(RuntimeError):self.call(error=error)
        self.assert_blocked('RuntimeError');self.assertEqual(self.record['http_status'],500);self.assertEqual(len(self.record['raw_response_text']),128)
    def test_response_cleanup_failure_is_blocked(self):
        with self.assertRaises(OSError):self.call(Response(b'{"done":true}',exit_failure=OSError('close failed')))
        self.assert_blocked('OSError')

if __name__=='__main__':unittest.main()
