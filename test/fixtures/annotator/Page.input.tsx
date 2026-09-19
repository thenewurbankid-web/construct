export default function Page({ items }: { items: string[] }) {
  return (
    <main className="page">
      <h1>Title</h1>
      <Card title="x">
        <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>
      </Card>
      <><span data-cx-src="keep:1:1">hi</span></>
      <input type="text" />
    </main>
  );
}
