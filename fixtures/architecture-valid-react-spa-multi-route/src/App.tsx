import { Routes, Route } from 'react-router-dom';
import { DashboardController } from '../features/dashboard/controllers/DashboardController';
import { SettingsController } from '../features/settings/controllers/SettingsController';
import { UserController } from '../features/user/controllers/UserController';

// Three routes across three distinct features -- unlike the single-route
// architecture-valid-react-spa fixture, this exercises resolveRoute picking
// the right entry out of more than one, plus a react-router dynamic-segment
// path (":id"). resolveReactSpaRoute matches a URL against this table by
// exact string equality (route-resolver.mjs has no live path-param
// substitution yet), so "/users/:id" is resolved as that literal declared
// path, not a live-substituted URL like "/users/42".
export function App() {
  return (
    <Routes>
      <Route path="/dashboard" element={<DashboardController />} />
      <Route path="/settings" element={<SettingsController />} />
      <Route path="/users/:id" element={<UserController />} />
    </Routes>
  );
}
