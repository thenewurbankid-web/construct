// A stand-in for a design-tool (e.g. Subframe) export: a self-contained,
// stateful React component with inline placeholder handlers -- exactly the
// shape `construct create page --from <this file>` (Ticket 7.2) ingests and
// turns into a pristine, presentation-only Construct page.
import { useState } from 'react';
import { Card } from '../components/Card';

export function CheckoutExport() {
  const [quantity, setQuantity] = useState(1);

  function handleIncrement() {
    setQuantity(quantity + 1);
  }

  return (
    <Card>
      <form onSubmit={() => {}}>
        <input value={quantity} onChange={() => {}} />
        <button type="button" onClick={handleIncrement}>Add</button>
      </form>
    </Card>
  );
}
