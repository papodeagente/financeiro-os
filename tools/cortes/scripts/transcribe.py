import sys, json
from faster_whisper import WhisperModel
m = WhisperModel(sys.argv[3], device="cpu", compute_type="int8", cpu_threads=4)
import wave, numpy as np
wf=wave.open(sys.argv[1]); a=np.frombuffer(wf.readframes(wf.getnframes()),dtype=np.int16).astype(np.float32)/32768
segs, info = m.transcribe(a, language="pt", word_timestamps=True, vad_filter=True)
out=[]
with open(sys.argv[2]+".txt","w") as f:
  for s in segs:
    d={"start":s.start,"end":s.end,"text":s.text,"words":[[w.start,w.end,w.word] for w in s.words]}
    out.append(d); f.write(f"[{s.start:7.1f}-{s.end:7.1f}] {s.text}\n"); f.flush()
json.dump(out,open(sys.argv[2]+".json","w"),ensure_ascii=False)
