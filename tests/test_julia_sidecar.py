import importlib.util
import json
import socket
import threading
import unittest
import urllib.request
import urllib.error
from pathlib import Path
from http.server import ThreadingHTTPServer
spec = importlib.util.spec_from_file_location('sidecar', Path(__file__).resolve().parents[1] / 'scripts/julia-sidecar.py')
sidecar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sidecar)

def payload():
    return {'snapshot': {'totalFunds': 20000}, 'memory': {}, 'availableActions': [
        {'id': 'build:res:10:10', 'action': {'kind': 'build', 'tool': 'res', 'x': 10, 'y': 10}},
        {'id': 'wait', 'action': {'kind': 'wait'}}]}

class RequestTests(unittest.TestCase):
    def test_malformed_context_rejected_before_inference(self):
        for field, value in [('totalFunds', True), ('totalFunds', '20000'),
                             ('totalFunds', float('nan')), ('totalFunds', float('inf')),
                             ('lastActions', None), ('lastActions', {}),
                             ('recentFailures', 'failure')]:
            p = payload(); p['snapshot'][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(sidecar.InvalidRequest):
                sidecar.prepare_request(p)
        p = payload(); p['memory']['recentSuggestions'] = None
        with self.assertRaises(sidecar.InvalidRequest): sidecar.prepare_request(p)
        p = payload(); p['snapshot']['cityPop'] = float('nan')
        with self.assertRaises(sidecar.InvalidRequest): sidecar.prepare_request(p)

    def test_incomplete_http_body_times_out_without_inference(self):
        class Runtime:
            identity = {}
            calls = 0
            def decide(self, _):
                self.calls += 1
                return {}
        server = ThreadingHTTPServer(('127.0.0.1', 0), sidecar.Handler)
        server.request_timeout = 0.1
        server.runtime = Runtime()
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            with socket.create_connection(server.server_address, timeout=2) as connection:
                connection.sendall(b'POST /decide HTTP/1.1\r\nHost: localhost\r\nContent-Length: 20\r\n\r\n{')
                self.assertIn(b'408', connection.recv(4096).split(b'\r\n')[0])
            self.assertEqual(server.runtime.calls, 0)
            self.assertEqual(urllib.request.urlopen(f'http://127.0.0.1:{server.server_port}/health', timeout=2).status, 200)
        finally:
            server.shutdown(); server.server_close(); thread.join()

    def test_nonstandard_json_never_reaches_runtime(self):
        class Runtime:
            identity = {}
            calls = 0
            def decide(self, _):
                self.calls += 1
                return {}
        server = ThreadingHTTPServer(('127.0.0.1', 0), sidecar.Handler)
        server.runtime = Runtime()
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            for constant in ['NaN', 'Infinity', '-Infinity']:
                body = ('{"snapshot":{"totalFunds":'+constant+'}}').encode()
                request = urllib.request.Request(f'http://127.0.0.1:{server.server_port}/decide', data=body)
                with self.assertRaises(urllib.error.HTTPError) as caught: urllib.request.urlopen(request, timeout=2)
                self.assertEqual(caught.exception.code, 422)
            self.assertEqual(server.runtime.calls, 0)
        finally:
            server.shutdown(); server.server_close(); thread.join()

    def test_http_framing_and_context_errors_are_recoverable(self):
        class Runtime:
            identity = {}
            calls = 0
            def decide(self, request):
                sidecar.prepare_request(request)
                self.calls += 1
                return {'ok': True}
        server = ThreadingHTTPServer(('127.0.0.1', 0), sidecar.Handler)
        server.runtime = Runtime()
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            for headers, body in [(b'Content-Length: 2\r\nContent-Length: 2', b'{}'),
                                  (b'Content-Length: 2\r\nTransfer-Encoding: chunked', b'{}'),
                                  (b'Content-Length: -1', b''),
                                  (b'Content-Length: 20', b'{')]:
                with socket.create_connection(server.server_address, timeout=2) as connection:
                    connection.sendall(b'POST /decide HTTP/1.1\r\nHost: localhost\r\n'+headers+b'\r\n\r\n'+body)
                    connection.shutdown(socket.SHUT_WR)
                    self.assertIn(b'422', connection.recv(4096).split(b'\r\n')[0])
            p = payload(); p['snapshot']['lastActions'] = None
            request = urllib.request.Request(f'http://127.0.0.1:{server.server_port}/decide', data=json.dumps(p).encode())
            with self.assertRaises(urllib.error.HTTPError) as caught: urllib.request.urlopen(request, timeout=2)
            self.assertEqual(caught.exception.code, 422)
            self.assertEqual(server.runtime.calls, 0)
            request.data = json.dumps(payload()).encode()
            self.assertEqual(urllib.request.urlopen(request, timeout=2).status, 200)
            self.assertEqual(server.runtime.calls, 1)
        finally:
            server.shutdown(); server.server_close(); thread.join()

    def test_known_candidates(self):
        state, choices = sidecar.prepare_request(payload())
        self.assertEqual(set(choices), {'wait', 'build:res:10:10'})
        self.assertIn('snapshot', json.loads(state))
    def test_coordinate_identity_budget_and_context(self):
        for mutate in [lambda p: p['availableActions'][0]['action'].update(x=120),
                       lambda p: p['availableActions'][0].update(id='build:res:1:1'),
                       lambda p: p['snapshot'].update(totalFunds=0),
                       lambda p: p['snapshot'].update(lastActions=[{}]*9),
                       lambda p: p['memory'].update(recentSuggestions=['wait']*11),
                       lambda p: p['snapshot'].update(text='x'*16001),
                       lambda p: p.update(command='execute')]:
            p = payload(); mutate(p)
            with self.assertRaises(sidecar.InvalidRequest): sidecar.prepare_request(p)
    def test_http_failure_does_not_crash_service(self):
        class FailingRuntime:
            identity = {}
            def decide(self, _): raise RuntimeError('service_busy')
        server = ThreadingHTTPServer(('127.0.0.1', 0), sidecar.Handler)
        server.runtime = FailingRuntime()
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        url = f'http://127.0.0.1:{server.server_port}'
        try:
            for body, code in [(b'{', 422), (b'{}', 503), (b'x'*24577, 422)]:
                request = urllib.request.Request(url+'/decide', data=body, headers={'Content-Type':'application/json'})
                with self.assertRaises(urllib.error.HTTPError) as caught: urllib.request.urlopen(request, timeout=2)
                self.assertEqual(caught.exception.code, code)
            self.assertEqual(urllib.request.urlopen(url+'/health', timeout=2).status, 200)
        finally:
            server.shutdown(); server.server_close(); thread.join()
