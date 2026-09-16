import { WidgetPage } from '../pages/WidgetPage';

// Registered directly as this route's element by react-router in
// src/App.tsx (<Route path="/dashboard" element={<WidgetController />} />)
// -- no per-route page.tsx wrapper file like the Next.js target uses.
export function WidgetController() {
  return <WidgetPage />;
}
