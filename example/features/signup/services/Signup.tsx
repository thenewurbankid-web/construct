export async function registerUser(username: string, email: string, password: string) {
  const response = await fetch('/api/signup', {
    method: 'POST',
    body: JSON.stringify({ username, email, password }),
  });
  if (!response.ok) throw new Error('Signup failed');
  return response.json();
}

export function logSignupAttempt(email: string): void {
  window.localStorage.setItem('lastSignupAttempt', email);
}
