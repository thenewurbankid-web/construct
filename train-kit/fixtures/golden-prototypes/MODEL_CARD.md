# Model card: layer-proto 1-55d26b82

A local nearest-prototype classifier for Construct's decision seam. For each closed question ("route") it holds example words per
option (prototypes). A new word is embedded (`embed.v1`: signed hashing of its character n-grams, no dictionary, no model download)
and compared with them by cosine similarity; it suggests the option of the closest example or abstains. It never executes anything.

- **Trained on:** dataset `55d26b82295fb64512b37b217a2d0f620e48e2e2f025a0067c20b2e315cb5bd6` (96 train / 11 validation / 13 test records), the TRAIN split only.
- **Prototypes:** 96 words over 2 routes (requirement.card.noun, requirement.placement.shape), at most 30 per option.
- **Base model:** none. No pretrained weights and no embedding table: the embedding is a fixed function (`embed.v1`, MIT, Construct).
- **Licence note:** the prototypes come only from the decision traces of the project that exported the dataset. They carry no third-party model or dataset licence; who may use them is decided by whoever owns those traces.
- **Routes skipped for too little data:** 0.

## Limits

- It knows only the questions it saw at least 5 times (or that the seed names); on any other question, or one that quotes no word, it abstains.
- Character n-grams capture shared stems and endings ("invoices", "invoice"), not meaning: an unrelated synonym is not close. A neural embedding (a static table, bge-small, MiniLM) would, and belongs in a later `embedder.version` that must beat this one on replay.
- Read eval-report.json before trusting it. `construct model import` replays held-out records against the rules baseline and stays disabled until you enable it.
