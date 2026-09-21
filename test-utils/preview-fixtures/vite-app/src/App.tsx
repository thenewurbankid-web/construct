import { useState } from 'react';
import { Card } from './components/Card';

export function App() {
  const [count, setCount] = useState(0);
  return (
    <main>
      <h1>Preview fixture</h1>
      <Card title="Sign in">
        <button data-testid="cta" onClick={() => setCount(count + 1)}>
          Clicked {count} times
        </button>
      </Card>
    </main>
  );
}
