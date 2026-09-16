'use client';

import { useEffect, useState } from 'react';
import { useMachine } from '@xstate/react';
import { useRouter } from 'next/navigation';
import { SignupWorkflow } from '../workflows/Signup';
import { registerUser, logSignupAttempt } from '../services/Signup';

export function useSignup() {
  const router = useRouter();
  const [state, send] = useMachine(SignupWorkflow);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (state.matches('success')) {
      logSignupAttempt(email);
      registerUser(username, email, password).then(() => router.push('/'));
    }
  }, [state, username, email, password, router]);

  const submit = () => send({ type: 'SUBMIT', username, email, password });

  return { username, setUsername, email, setEmail, password, setPassword, submit, error: state.context.error };
}
