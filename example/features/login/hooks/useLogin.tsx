'use client';

// Hooks own React/application logic when React context is genuinely needed
// (routing, state) — this is the only place navigation and the machine meet.
import { useEffect, useState } from 'react';
import { useMachine } from '@xstate/react';
import { useRouter } from 'next/navigation';
import { LoginWorkflow } from '../workflows/Login';
import { startSession } from '../services/Login';

export function useLogin() {
  const router = useRouter();
  const [state, send] = useMachine(LoginWorkflow);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (state.matches('success')) {
      startSession(username);
      router.push('/');
    }
  }, [state, username, router]);

  const submit = () => send({ type: 'SUBMIT', username, password });

  return { username, setUsername, password, setPassword, submit, error: state.context.error };
}
