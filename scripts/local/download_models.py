"""Public pinned model downloads only. Does not load .env or use Hugging Face tokens."""
import argparse
import hashlib
import json
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
MODELS = json.loads((ROOT / 'scripts/local/models.json').read_text())


def digest(path):
    with path.open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


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
        for file, limit in [('config.json', 4096), ('README.md', 65536), ('weights.npz', model['bytes'])]:
            path = dest / file
            if path.exists() and (file != 'weights.npz' or digest(path) == model['sha256']):
                continue
            total = 0
            temporary = path.with_suffix(path.suffix + '.part')
            try:
                with urllib.request.urlopen(base + '/' + file, timeout=90) as response, temporary.open('wb') as output:
                    while chunk := response.read(1024 * 1024):
                        total += len(chunk)
                        if total > limit:
                            raise ValueError('Download exceeds manifest size')
                        output.write(chunk)
                        if total % (32 * 1024 * 1024) == 0:
                            print(f'{name}: {total // (1024 * 1024)} MiB downloaded', flush=True)
                if file == 'weights.npz' and (total != model['bytes'] or digest(temporary) != model['sha256']):
                    raise ValueError('Model checksum mismatch')
                temporary.replace(path)
            finally:
                temporary.unlink(missing_ok=True)
        print(f'{name}: pinned weights verified', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Model download failed. Check internet/storage; no credentials are needed. Details suppressed.')
        raise SystemExit(1)
