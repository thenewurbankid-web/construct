// #503 -- EXPR-006's "must satisfy the shared Template<Props> type" as a real `tsc` error, the
// same TS7030 proof implicit-return.ts already gives for defineComponent. Excluded from this
// directory's own tsconfig.json (it must NOT compile); compiled on its own by
// test/typed-contracts-tsc.test.mjs, which asserts on the actual `tsc` diagnostic produced.
import * as React from 'react';
import { defineExpression } from '../index.ts';

interface Props { show: boolean }

const Bad = defineExpression<Props>('Bad', (props) => {
  if (props.show) {
    return React.createElement(React.Fragment, null, props.children);
  }
  // No return here: an implicit `undefined` on the `!show` path, which the Template<Props &
  // {children?: ReactNode}> shape ExpressionUnit<Props> is built from does not allow.
});
void Bad;
