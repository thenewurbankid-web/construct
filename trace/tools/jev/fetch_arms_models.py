#!/usr/bin/env python3
"""Fetch the NLI arm's model (MIT, 25 MB) into models/xtremedistil-zeroshot (gitignored). Idempotent."""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = "MoritzLaurer/xtremedistil-l6-h256-zeroshot-v1.1-all-33"
FILES = ["config.json", "model.safetensors", "special_tokens_map.json", "tokenizer.json", "tokenizer_config.json", "vocab.txt", "README.md"]

if __name__ == "__main__":
    from huggingface_hub import snapshot_download

    print(snapshot_download(REPO, local_dir=os.path.join(HERE, "models", "xtremedistil-zeroshot"), allow_patterns=FILES))
