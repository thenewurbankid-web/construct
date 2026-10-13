# Smith OSS coverage on the hardened Smith

Rerun of bench/smith-oss on the same repos and commits. Smith: atomic-codemod cbc2567, smith f70eecf; TS/TSX fed directly. Gaps: "(...)", "does not translate cleanly" and a bare "?". `full` = 0.5 rule with every gap kind counted; `clean` = no gap at all. Pinned (885b32e, only "(...)" counted): 57.5% overall, 75.4% logic-only.

| repo | commit | functions | TS source found |
| --- | --- | --- | --- |
| taxonomy | `298a8857c712` | 220 | 220 |
| commerce | `3761e52e60df` | 105 | 105 |
| query | `0fbbc6213641` | 214 | 214 |

## All functions

| repo | bar | hook | component | util | store | server | all | pinned all |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| taxonomy | full | 100% (4/4) | 100% (175/175) | 100% (24/24) | 100% (1/1) | 100% (16/16) | **100% (220/220)** | 40.5% (89/220) |
| taxonomy | clean | 100% (4/4) | 100% (175/175) | 100% (24/24) | 100% (1/1) | 100% (16/16) | **100% (220/220)** |  |
| commerce | full | 100% (1/1) | 100% (54/54) | 100% (11/11) | 100% (7/7) | 100% (32/32) | **100% (105/105)** | 65.7% (69/105) |
| commerce | clean | 100% (1/1) | 100% (54/54) | 100% (11/11) | 100% (7/7) | 100% (32/32) | **100% (105/105)** |  |
| query | full | 100% (15/15) | 100% (112/112) | 100% (83/83) | - | 100% (4/4) | **100% (214/214)** | 71% (152/214) |
| query | clean | 100% (15/15) | 100% (112/112) | 100% (83/83) | - | 100% (4/4) | **100% (214/214)** |  |
| overall | full | 100% (20/20) | 100% (341/341) | 100% (118/118) | 100% (8/8) | 100% (52/52) | **100% (539/539)** | 57.5% (310/539) |
| overall | clean | 100% (20/20) | 100% (341/341) | 100% (118/118) | 100% (8/8) | 100% (52/52) | **100% (539/539)** |  |

## Logic only (templates excluded)

| repo | bar | hook | component | util | store | server | all | pinned all |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| taxonomy | full | 100% (4/4) | 100% (32/32) | 100% (24/24) | - | 100% (16/16) | **100% (76/76)** | 76.3% (58/76) |
| taxonomy | clean | 100% (4/4) | 100% (32/32) | 100% (24/24) | - | 100% (16/16) | **100% (76/76)** |  |
| commerce | full | 100% (1/1) | 100% (30/30) | 100% (11/11) | 100% (6/6) | 100% (32/32) | **100% (80/80)** | 75% (60/80) |
| commerce | clean | 100% (1/1) | 100% (30/30) | 100% (11/11) | 100% (6/6) | 100% (32/32) | **100% (80/80)** |  |
| query | full | 100% (15/15) | 100% (83/83) | 100% (83/83) | - | 100% (4/4) | **100% (185/185)** | 75.1% (139/185) |
| query | clean | 100% (15/15) | 100% (83/83) | 100% (83/83) | - | 100% (4/4) | **100% (185/185)** |  |
| overall | full | 100% (20/20) | 100% (145/145) | 100% (118/118) | 100% (6/6) | 100% (52/52) | **100% (341/341)** | 75.4% (257/341) |
| overall | clean | 100% (20/20) | 100% (145/145) | 100% (118/118) | 100% (6/6) | 100% (52/52) | **100% (341/341)** |  |

## Pairs

| repo | full | distinct code | clean distinct |
| --- | --- | --- | --- |
| taxonomy | 220 | 220 | 220 |
| commerce | 105 | 105 | 105 |
| query | 214 | 190 | 190 |
| overall | 539 | 515 | 515 |

Gap occurrences: 0 "(...)", 0 "does not translate cleanly", 0 "?". to-english `unhandled`: none.

