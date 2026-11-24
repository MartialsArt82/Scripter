"""Run multilingual Whisper inference locally and return a JSON transcript."""
import json
import sys
from pathlib import Path
from faster_whisper import WhisperModel

source, language, cache = sys.argv[1:4]
hints = Path(sys.argv[4]).read_text(encoding="utf-8") if len(sys.argv) > 4 else None
model = WhisperModel(cache, device="cpu", compute_type="int8", local_files_only=True)
segments, info = model.transcribe(source, language=None if language == "auto" else language, vad_filter=True, hotwords=hints or None)
output = []
for segment in segments:
    output.append({"start": segment.start, "end": segment.end, "text": segment.text.strip()})
print(json.dumps({"language": info.language, "segments": output}, ensure_ascii=True))
