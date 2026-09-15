'use client';

// Composes the hook (application behavior) with the page (presentation).
import { LoginPage } from '../pages/LoginPage';
import { useLogin } from '../hooks/useLogin';

export function LoginController() {
  const { username, setUsername, password, setPassword, submit, error } = useLogin();
  return (
    <LoginPage
      username={username}
      setUsername={setUsername}
      password={password}
      setPassword={setPassword}
      onSubmit={submit}
      error={error}
    />
  );
}
