"""Run multilingual Whisper inference locally and return a JSON transcript."""
import json
import sys
from faster_whisper import WhisperModel

source, language, cache = sys.argv[1:]
model = WhisperModel(cache, device="cpu", compute_type="int8", local_files_only=True)
segments, info = model.transcribe(source, language=None if language == "auto" else language, vad_filter=True)
output = []
for segment in segments:
    output.append({"start": segment.start, "end": segment.end, "text": segment.text.strip()})
print(json.dumps({"language": info.language, "segments": output}, ensure_ascii=True))
