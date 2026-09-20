import { Routes, Route } from 'react-router-dom';
import { OrdersController } from '../features/orders/controllers/OrdersController';
import { BillingController } from '../features/billing/controllers/BillingController';

// /billing and /billing/history both render the billing controller (two routes, one feature);
// /checkout renders orders and billing side by side (one route, two features). The import order
// above (orders before billing) is the order the flow view lists that fan-out in.
export function App() {
  return (
    <Routes>
      <Route path="/billing" element={<BillingController />} />
      <Route path="/billing/history" element={<BillingController />} />
      <Route path="/checkout" element={<><OrdersController /><BillingController /></>} />
    </Routes>
  );
}
