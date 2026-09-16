import type { ReactNode } from 'react';
import { SignupForm } from '../components/SignupForm';

type SignupPageProps = {
  username: string;
  setUsername: (value: string) => void;
  email: string;
  setEmail: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  onSubmit: () => void;
  error: string | null;
};

export function SignupPage(props: SignupPageProps): ReactNode {
  return (
    <main>
      <h1>Create an account</h1>
      <SignupForm {...props} />
    </main>
  );
}
