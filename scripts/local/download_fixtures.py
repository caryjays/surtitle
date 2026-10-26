"""Download a bounded prefix of pinned CC-BY-4.0 FLEURS archives, not entire datasets."""
import hashlib
import io
import json
from pathlib import Path
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
LIMIT = 8 * 1024 * 1024


def main():
    fixtures = json.loads((ROOT / 'benchmarks/fleurs.json').read_text())
    dest = ROOT / '.local/fixtures'
    dest.mkdir(parents=True, exist_ok=True)
    for url in sorted({f['archive'] for f in fixtures}):
        group = [f for f in fixtures if f['archive'] == url]
        pending = {f['member']: f for f in group if not (dest / (f['id'] + '.wav')).exists()
                   or hashlib.sha256((dest / (f['id'] + '.wav')).read_bytes()).hexdigest() != f['sha256']}
        if not pending:
            continue
        if not url.startswith('https://huggingface.co/datasets/google/fleurs/resolve/70bb2e84b976b7e960aa89f1c648e09c59f894dd/'):
            raise ValueError('Unexpected fixture source')
        request = urllib.request.Request(url, headers={'Range': f'bytes=0-{LIMIT - 1}'})
        with urllib.request.urlopen(request, timeout=90) as response:
            if response.status != 206:
                raise ValueError('Source does not support bounded downloads')
            prefix = response.read(LIMIT + 1)
            if len(prefix) > LIMIT:
                raise ValueError('Download limit exceeded')
        # Never extract archive paths. Only write allowlisted IDs after checksum verification.
        expanded = 0
        with tarfile.open(fileobj=io.BytesIO(prefix), mode='r|gz') as tar:
            for member in tar:
                expanded += member.size
                if expanded > 64 * 1024 * 1024:
                    raise ValueError('Archive expansion limit')
                fixture = pending.get(member.name)
                if not fixture:
                    continue
                if not member.isfile() or member.size > 2 * 1024 * 1024:
                    raise ValueError('Unexpected archive member')
                audio = tar.extractfile(member).read()
                if hashlib.sha256(audio).hexdigest() != fixture['sha256']:
                    raise ValueError('Fixture checksum mismatch')
                (dest / (fixture['id'] + '.wav')).write_bytes(audio)
                del pending[member.name]
                if not pending:
                    break
        if pending:
            raise ValueError('Selected clips absent from bounded archive prefix')
    print(f"Verified {len(fixtures)} public FLEURS clips ({sum(f['seconds'] for f in fixtures):.2f}s); cache only, no API calls.")


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Fixture setup failed. Check network/storage or manifest checksums. Details suppressed.')
        raise SystemExit(1)
