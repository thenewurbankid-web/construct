import { Routes, Route } from 'react-router-dom';
import { WidgetController } from '../features/widget/controllers/WidgetController';

export function App() {
  return (
    <Routes>
      <Route path="/dashboard" element={<WidgetController />} />
    </Routes>
  );
}
