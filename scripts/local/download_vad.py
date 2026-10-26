"""Explicit public pinned Silero VAD download. No .env, tokens or runtime fetches."""
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[2]


def main():
    spec = json.loads((ROOT / 'scripts/local/vad-model.json').read_text())
    target = ROOT / '.local/models/silero-vad/model.jit'
    if target.is_file() and target.stat().st_size == spec['bytes']:
        with target.open('rb') as file:
            if hashlib.file_digest(file, 'sha256').hexdigest() == spec['sha256']:
                print('Local speech detector: pinned model verified.')
                return
    url = f"https://raw.githubusercontent.com/{spec['repo']}/{spec['revision']}/{spec['file']}"
    with urllib.request.urlopen(url, timeout=60) as response:
        data = response.read(spec['bytes'] + 1)
    if len(data) != spec['bytes'] or hashlib.sha256(data).hexdigest() != spec['sha256']:
        raise ValueError('Public model checksum mismatch')
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.part')
    try:
        temporary.write_bytes(data)
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    print('Local speech detector: pinned model downloaded and verified.')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Speech detector setup failed. Check network/storage; no credential needed. Details suppressed.')
        raise SystemExit(1)
