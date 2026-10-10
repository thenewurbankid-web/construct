import fs from 'node:fs';

fs.writeFileSync('/dev/null', 'tests may write scratch files');
