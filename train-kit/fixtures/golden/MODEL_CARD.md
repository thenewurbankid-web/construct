# Model card: features-lr 1-55d26b82

A structured-feature classifier for Construct's decision seam: a multinomial logistic regression per closed question ("route"), over
features of the question as it was offered (option ids that were enabled, the quoted word and its ending, the words of the question).
It suggests one option or abstains; it never executes anything.

- **Trained on:** dataset `55d26b82295fb64512b37b217a2d0f620e48e2e2f025a0067c20b2e315cb5bd6` (96 train / 11 validation / 13 test records), the TRAIN split only.
- **Base model:** none. Trained from scratch by train-kit/train_features.py (pure Python, seed 1, 60 epochs); no pretrained weights, no third-party data.
- **Licence note:** the weights are derived only from the decision traces of the project that exported the dataset, plus this kit (MIT, Construct). They carry no third-party model or dataset licence; who may use them is decided by whoever owns those traces.
- **Routes learned:** 2 (requirement.card.noun, requirement.placement.shape).
- **Routes skipped for too little data:** 0.

## Limits

- It knows only the questions (route = wording with quoted words blanked plus the option ids) it saw at least 5 times; on any other question it abstains.
- Small data: read eval-report.json before trusting it. `construct model import` replays held-out records against the rules baseline and stays disabled until you enable it.
- Features are bag-of-words and word endings; it does not understand meaning and will not generalise to unseen wording beyond that.
- Not evaluated for fairness or safety beyond the agreement numbers in eval-report.json.
