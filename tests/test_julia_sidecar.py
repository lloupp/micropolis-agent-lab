import importlib.util
import json
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
    def test_spatial_features_are_bounded_and_candidate_aligned(self):
        p = payload()
        p['snapshot']['candidateFeatures'] = [{'actionId': c['id'], 'legal': True, 'roadDistance': 1, 'powerDistance': None, 'zoneDistance': 2, 'roadCount': 1, 'plantCount': 0} for c in p['availableActions']]
        state, choices = sidecar.prepare_request(p)
        self.assertIn('Road distance 1', choices['build:res:10:10'])
        self.assertNotIn('candidateFeatures', json.loads(state)['snapshot'])
        p['snapshot']['candidateFeatures'][0]['powerDistance'] = -1
        with self.assertRaises(sidecar.InvalidRequest): sidecar.prepare_request(p)
        p['snapshot']['candidateFeatures'][0]['powerDistance'] = None
        p['snapshot']['candidateFeatures'][0]['actionId'] = 'unknown'
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
