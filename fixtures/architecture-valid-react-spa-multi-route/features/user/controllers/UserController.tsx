import { UserPage } from '../pages/UserPage';

// Registered directly as this route's element by react-router in
// src/App.tsx (<Route path="/users/:id" element={<UserController />} />)
// -- a dynamic-segment route, still no per-route page.tsx wrapper file like
// the Next.js target uses.
export function UserController() {
  return <UserPage />;
}
