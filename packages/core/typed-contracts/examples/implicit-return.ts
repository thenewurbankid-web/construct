// #501 step 1's "every path must return a real value -- no implicit
// undefined" requirement, as a real `tsc` error. Excluded from this
// directory's own tsconfig.json (it must NOT compile); compiled on its own
// by test/typed-contracts-tsc.test.mjs.
import * as React from 'react';
import { defineComponent } from '../index.ts';

interface Props { show: boolean }

const Bad = defineComponent<Props>('Bad', (props) => {
  if (props.show) {
    return React.createElement('div', null, 'shown');
  }
  // No return here: an implicit `undefined` on the `!show` path, which
  // Template<Props> = (props) => JSX.Element does not allow.
});
void Bad;
