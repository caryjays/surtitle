"""Language profiles shared with the service; see profiles/languages.json."""
import json
from pathlib import Path

PROFILES = json.loads((Path(__file__).resolve().parents[2] / 'profiles/languages.json').read_text(encoding='utf-8'))
