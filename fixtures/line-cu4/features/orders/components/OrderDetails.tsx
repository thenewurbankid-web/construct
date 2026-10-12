// @line-base components/Disclosure
import type { ComponentProps } from 'react';
import { Disclosure } from '../../../library/components/Disclosure';

export function OrderDetails(props: ComponentProps<typeof Disclosure> & object) {
  return <Disclosure {...props} />;
}
