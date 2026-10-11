import { Route, Routes } from 'react-router-dom';
import AlertsPage from '@/alerts/pages/AlertsPage';
import { AlertDetailPage } from './alerts/pages/AlertDetailPage';

export function App() {
  return (
    <Routes>
      <Route path="/alerts" element={<AlertsPage />} />
      <Route path="/alerts/:id" element={<AlertDetailPage />} />
    </Routes>
  );
}
