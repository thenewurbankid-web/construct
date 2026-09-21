"""Speak captions in the voice of a sample its speaker supplied (Chatterbox, MIT code and weights, CPU).

  ~/.cache/construct-media/venv/bin/python tools/media/clone_voice.py SAMPLE.wav CAPTIONS.json OUT_DIR [--seed N]

Writes OUT_DIR/<file>.wav per caption ("file" in the entry, else c<i>) and prints one JSON line per clip. Called by voiceover.mjs --voice-sample.
The sample is read from where it is; nothing derived from it is written anywhere (the model keeps its voice
conditioning in memory only). Every clip carries Chatterbox's inaudible Perth watermark marking it as synthetic.
"""
import json, os, sys, time, zlib
os.environ.setdefault("TQDM_DISABLE", "1")
import torch, torchaudio

sample, caps_file, out_dir = sys.argv[1:4]
seed = int(sys.argv[sys.argv.index("--seed") + 1]) if "--seed" in sys.argv else 1
torch.set_num_threads(max(1, (os.cpu_count() or 4) - 2))
from chatterbox.tts import ChatterboxTTS

model = ChatterboxTTS.from_pretrained(device="cpu")
model.prepare_conditionals(sample, exaggeration=0.5)  # in memory only
os.makedirs(out_dir, exist_ok=True)
for i, c in enumerate(json.load(open(caps_file))):
    t = time.time()
    torch.manual_seed(seed + zlib.crc32(c["text"].encode()) % 100000)  # same text, same take
    wav = model.generate(c["text"])
    path = os.path.join(out_dir, f"{c.get('file', f'c{i}')}.wav")
    torchaudio.save(path, wav, model.sr)
    print(json.dumps({"i": i, "path": path, "seconds": wav.shape[-1] / model.sr, "compute": round(time.time() - t, 1)}), flush=True)
