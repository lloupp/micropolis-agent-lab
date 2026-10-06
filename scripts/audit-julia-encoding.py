"""Preflight the pinned native tokenizer's lossless contract, without inference."""
import importlib.util
import json
import sys
from pathlib import Path
from transformers import AutoTokenizer
from julia.data import sequence

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('sidecar', ROOT / 'scripts/julia-sidecar.py')
sidecar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sidecar)
encoding = sys.argv[1] if len(sys.argv) > 1 else 'semantics-v3'
tokenizer = AutoTokenizer.from_pretrained(ROOT / 'artifacts/Julia-1/tokenizer', local_files_only=True)
requests = [json.loads(line) for line in (ROOT / 'docs/evidence/spatial-v1/requests.jsonl').read_text().splitlines()]
audit = []
for request in requests:
    payload = {'snapshot': request['snapshot'], 'availableActions': request['candidates'],
               'memory': {'recentSuggestions': ['build:res:119:99'] * 10}}
    state, criteria = sidecar.prepare_request(payload, encoding)
    row = {'state': state, 'question': sidecar.QUESTION, 'options': list(criteria.values()), 'type': 'choice'}
    try:
        encoded = sequence(tokenizer, row, sidecar.MODEL['maxLength'], sidecar.MODEL['headLength'], strict=True)
        audit.append({'decision': request['decision'], 'tokens': len(encoded['ids']),
                      'maxOptionTokens': max(encoded['option_tokens']), 'error': None})
    except ValueError as error:
        audit.append({'decision': request['decision'], 'error': str(error)})
report = {'encoding': encoding, 'inference': False, 'states': len(audit),
          'failures': sum(item['error'] is not None for item in audit), 'audit': audit}
path = ROOT / 'artifacts' / f'{encoding}-encoding-audit.json'
path.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({key: value for key, value in report.items() if key != 'audit'}))
if report['failures'] or report['states'] != 100:
    sys.exit(1)
