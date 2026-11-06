"""Public pinned translation model downloads only. Does not load .env or use Hugging Face tokens."""
import argparse
import hashlib
import http.client
import json
import pathlib
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
MODELS = json.loads((ROOT / 'scripts/local/translators.json').read_text())


def verified(path, spec):
    if path.stat().st_size != spec['bytes']:
        return False
    # Large files are pinned by their LFS SHA-256, small ones by their Git blob SHA-1.
    digest = hashlib.sha256() if 'sha256' in spec else hashlib.sha1(f"blob {spec['bytes']}\0".encode())
    with path.open('rb') as file:
        while chunk := file.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest() == spec.get('sha256', spec.get('gitSha1'))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', choices=[*MODELS, 'all'], default='all')
    args = parser.parse_args()
    for name, model in MODELS.items():
        if args.model not in ('all', name):
            continue
        dest = ROOT / '.local/models' / name
        dest.mkdir(parents=True, exist_ok=True)
        base = f"https://huggingface.co/{model['repo']}/resolve/{model['revision']}"
        for file, spec in model['files'].items():
            path = dest / file
            if path.exists() and verified(path, spec):
                continue
            # A 3 GB file over a slow link: keep the partial file and resume it with a range request.
            temporary = path.with_suffix(path.suffix + '.part')
            for attempt in range(8):
                total = temporary.stat().st_size if temporary.exists() else 0
                if total > spec['bytes']:
                    temporary.unlink()
                    total = 0
                try:
                    if total < spec['bytes']:
                        request = urllib.request.Request(base + '/' + file, headers={'Range': f'bytes={total}-'} if total else {})
                        with urllib.request.urlopen(request, timeout=90) as response:
                            if total and response.status != 206:
                                total = 0
                            with temporary.open('ab' if total else 'wb') as output:
                                while chunk := response.read(1024 * 1024):
                                    total += len(chunk)
                                    if total > spec['bytes']:
                                        raise ValueError('Download exceeds manifest size')
                                    output.write(chunk)
                                    if total % (256 * 1024 * 1024) == 0:
                                        print(f'{name}: {total // (1024 * 1024)} MiB of {file}', flush=True)
                    break
                except (OSError, http.client.HTTPException):
                    if attempt == 7:
                        raise
                    print(f'{name}: connection lost; resuming {file}', flush=True)
                    time.sleep(2 * (attempt + 1))
            if not verified(temporary, spec):
                temporary.unlink(missing_ok=True)
                raise ValueError('Model checksum mismatch')
            temporary.replace(path)
        print(f'{name}: pinned files verified', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Translation model download failed. Check internet/storage; no credentials are needed. Details suppressed.')
        raise SystemExit(1)
