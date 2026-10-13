Change the back link text to "Back to the catalogue" and the unknown-book message to "We could not find that book". Update the `back` variable and the `DetailPage` call in the `BookPage` component.

```tsx
const back = <Link href="/">Back to the catalogue</Link>;
if (!item) {
  return <DetailPage title="We could not find that book" back={back} />;
}
```