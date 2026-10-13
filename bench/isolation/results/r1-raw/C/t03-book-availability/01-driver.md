Change the line that displays the book's availability to show "On loan" or "Available" based on the `available` field. Replace the line:

```tsx
<p>{String(item.available)}</p>
```

with:

```tsx
<p>{item.available ? 'Available' : 'On loan'}</p>
```