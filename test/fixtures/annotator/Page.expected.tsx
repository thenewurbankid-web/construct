export default function Page({ items }: { items: string[] }) {
  return (
    <main data-cx-src="features/x/pages/Page.tsx:3:5" className="page">
      <h1 data-cx-src="features/x/pages/Page.tsx:4:7">Title</h1>
      <Card title="x">
        <ul data-cx-src="features/x/pages/Page.tsx:6:9">{items.map((i) => <li data-cx-src="features/x/pages/Page.tsx:6:31" key={i}>{i}</li>)}</ul>
      </Card>
      <><span data-cx-src="keep:1:1">hi</span></>
      <input data-cx-src="features/x/pages/Page.tsx:9:7" type="text" />
    </main>
  );
}
