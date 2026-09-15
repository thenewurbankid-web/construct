import type { ReactNode } from 'react';
import { Login } from '../components/Login';

// Props to JSX only — no business logic, workflow, service, fetch, or domain
// imports (PAGE-002/003/004/005).
type LoginPageProps = {
  username: string;
  setUsername: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  onSubmit: () => void;
  error: string | null;
};

export function LoginPage(props: LoginPageProps): ReactNode {
  return (
    <main>
      <h1>Sign in</h1>
      <p>Demo credentials: admin / password123</p>
      <Login {...props} />
    </main>
  );
}
