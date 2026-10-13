**FUNCTION:** `BookPage`

**SIGNATURE:** 
```tsx
export function BookPage({ params }: { params: { id: string } }): JSX.Element;
```

**IMPORTS:** 
```tsx
import { formatNumber } from 'number-format';
```

**CHANGE:**
- Replace the line `<p>{String(item.pages)}</p>` with:
  ```tsx
  <p>{formatNumber(item.pages)} pages</p>
  ```

**EXAMPLE:**
```tsx
<p>312 pages</p>
```