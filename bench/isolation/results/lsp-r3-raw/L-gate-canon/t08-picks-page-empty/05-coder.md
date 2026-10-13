```tsx
export function PicksPage() {
  const [ids, setIds] = useState<string[]>(() => listPicks());

  return (
    <ListPage title="My picks">
      {ids.length === 0 && <p>You have not picked any books yet</p>}
      {ids.length > 0 && (
        <ul>
          {ids.map((id) => (
            <li key={id}>
              <h2>{id}</h2>
              {/* Add other item fields here */}
              <Button label={`Remove ${id}`} onClick={() => removePick(id)} />
            </li>
          ))}
        </ul>
      )}
    </ListPage>
  );
}
```