// Static per-kind templates for briefBuilder (#941, arm H). Each kind says what the change usually looks like
// and gives one worked example on a different domain (a shop), so the brief shows the pattern without the answer.
// `needs`: state -> 'use client' + useState import; fixture -> the books fixture import and its element type.

export const templates = {
  format: {
    needs: [],
    change: [
      'Show every value exactly in the words the SPEC quotes: put the fixed words around the value in JSX.',
      'Turn a boolean into the SPEC\'s two words with a ternary; never print true/false.',
      'Use the SPEC\'s exact text for headings, links and "not found" messages (the title prop of the page component is the main heading).',
      'Keep everything else in the function as it is.',
    ],
    example: `export function ProductPage({ params }: { params: { id: string } }) {
  const item = (products as Product[]).find((p) => p.id === params.id);
  const back = <Link href="/">Back to the shop</Link>;
  if (!item) return <DetailPage title="We could not find that product" back={back} />;
  return (
    <DetailPage title={item.name} back={back}>
      <p>made by {item.maker}</p>
      <p>{item.weight} grams</p>
      <p>{item.inStock ? 'In stock' : 'Sold out'}</p>
    </DetailPage>
  );
}`,
  },
  button: {
    needs: ['state'],
    change: [
      'Call useState for the status message at the very top of the function, before any early return.',
      'Render the button only when the item may be used; otherwise show the SPEC\'s words instead.',
      'In onClick, call the store function with the item id, then set the status text the SPEC quotes.',
      'Show the status in a <p role="status"> when it is set. Pass the button and status as the page\'s aside.',
    ],
    example: `export function ProductPage({ params }: { params: { id: string } }) {
  const [status, setStatus] = useState('');
  const item = (products as Product[]).find((p) => p.id === params.id);
  if (!item) return <DetailPage title="Not found" />;
  const aside = item.inStock ? (
    <>
      <Button label="Add to cart" onClick={() => { addToCart(item.id); setStatus('Added to your cart'); }} />
      {status ? <p role="status">{status}</p> : null}
    </>
  ) : <p>Sold out</p>;
  return <DetailPage title={item.name} aside={aside}><p>{item.maker}</p></DetailPage>;
}`,
  },
  store: {
    needs: [],
    change: [
      'Keep the data in localStorage under the key the task names, as a JSON array of strings.',
      'Read with JSON.parse and fall back to [] when the key is missing; write with JSON.stringify.',
      'Write only this one function, reading localStorage itself.',
    ],
    example: `export function addToCart(id: string): void {
  const raw = localStorage.getItem('cart');
  const cart: string[] = raw ? (JSON.parse(raw) as string[]) : [];
  if (!cart.includes(id)) localStorage.setItem('cart', JSON.stringify([...cart, id]));
}`,
  },
  list: {
    needs: ['state', 'fixture'],
    change: [
      'Read the store into state at the top: const [ids, setIds] = useState<string[]>(() => listX()).',
      'Look each id up in the fixture and drop ids that are not found.',
      'Give the page component the SPEC\'s heading as title and the SPEC\'s empty text as its empty prop; pass children only when there are items.',
      'Each item shows its fields; a remove button\'s label is the SPEC\'s words plus the title. After removing, set state from the store again.',
    ],
    example: `export function CartPage() {
  const [ids, setIds] = useState<string[]>(() => listCart());
  const items = ids.map((id) => (products as Product[]).find((p) => p.id === id)).filter((p): p is Product => Boolean(p));
  return (
    <ListPage title="My cart" empty={<p>Your cart is empty</p>}>
      {items.length > 0 && items.map((item) => (
        <article key={item.id}>
          <h2>{item.name}</h2>
          <p>{item.maker}</p>
          <Button label={\`Remove \${item.name}\`} onClick={() => { removeFromCart(item.id); setIds(listCart()); }} />
        </article>
      ))}
    </ListPage>
  );
}`,
  },
  paging: {
    needs: ['state'],
    change: [
      'Define the page size as a constant inside the function, and the current page with useState(1).',
      'Slice the items for the current page; compute the page count with Math.ceil.',
      'Under the list show the SPEC\'s page line and the two buttons with the SPEC\'s labels, each disabled at its end.',
      'Wrap the page component and the controls in a fragment <>...</>.',
    ],
    example: `export function ShopPage() {
  const PAGE_SIZE = 4;
  const [page, setPage] = useState(1);
  const items = products as Product[];
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const shown = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return (
    <>
      <ListPage title="Shop">{shown.map((item) => <article key={item.id}>{item.name}</article>)}</ListPage>
      <p>Screen {page} of {pageCount}</p>
      <Button label="Back" disabled={page === 1} onClick={() => setPage(page - 1)} />
      <Button label="More" disabled={page === pageCount} onClick={() => setPage(page + 1)} />
    </>
  );
}`,
  },
  sort: {
    needs: [],
    change: [
      'Sort a copy of the items, never the fixture itself: [...items].sort(...).',
      'Compare text with localeCompare (A-Z) and numbers by subtraction.',
      'Render the sorted copy where the list was rendered.',
    ],
    example: `export function ShopPage() {
  const items = [...(products as Product[])].sort((a, b) => a.name.localeCompare(b.name));
  return <ListPage title="Shop">{items.map((item) => <article key={item.id}>{item.name}</article>)}</ListPage>;
}`,
  },
  filter: {
    needs: ['state'],
    change: [
      'Hold the chosen value with useState; the "all" option has its own value.',
      'Use a native <label htmlFor> and <select id> with the SPEC\'s label and options, passed as the page component\'s toolbar.',
      'Filter the items by the chosen value before rendering; the "all" value keeps every item.',
    ],
    example: `export function ShopPage() {
  const [maker, setMaker] = useState('all');
  const items = (products as Product[]).filter((p) => maker === 'all' || p.maker === maker);
  const toolbar = (
    <>
      <label htmlFor="maker">Maker</label>
      <select id="maker" value={maker} onChange={(e) => setMaker(e.target.value)}>
        <option value="all">All makers</option>
        <option value="Acme">Acme</option>
      </select>
    </>
  );
  return <ListPage title="Shop" toolbar={toolbar}>{items.map((item) => <article key={item.id}>{item.name}</article>)}</ListPage>;
}`,
  },
};
