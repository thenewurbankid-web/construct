'use client';

import { SignupPage } from '../pages/SignupPage';
import { useSignup } from '../hooks/useSignup';

export function SignupController() {
  const { username, setUsername, email, setEmail, password, setPassword, submit, error } = useSignup();
  return (
    <SignupPage
      username={username}
      setUsername={setUsername}
      email={email}
      setEmail={setEmail}
      password={password}
      setPassword={setPassword}
      onSubmit={submit}
      error={error}
    />
  );
}
