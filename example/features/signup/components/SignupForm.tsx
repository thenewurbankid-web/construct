'use client';

type SignupFormProps = {
  username: string;
  setUsername: (value: string) => void;
  email: string;
  setEmail: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  onSubmit: () => void;
  error: string | null;
};

export function SignupForm({ username, setUsername, email, setEmail, password, setPassword, onSubmit, error }: SignupFormProps) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <label>
        Username
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
      </label>
      <label>
        Email
        <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit">Sign up</button>
    </form>
  );
}
