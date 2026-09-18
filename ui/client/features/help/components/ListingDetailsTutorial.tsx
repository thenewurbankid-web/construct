// Static content — no props, no data dependency. Follows GettingStarted.tsx's
// pattern: one small function per step, all screenshots served from
// ui/client/public/tutorials/listing-details/ (real local assets, never
// hotlinked). Condensed from #135-137's full write-ups for in-product
// reading, presented as a spectrum from fully automatic to AI-assisted.
function ScaffoldFeatureAndSlice() {
  return (
    <>
      <p>
        Scaffolding a &quot;Products&quot; feature — a listing page, a details page, and their
        supporting hook/component/controller/domain layers — needs no <code>--llm</code> flag at
        all. Same files, every time, on any machine, zero model calls.
      </p>
      <figure className="tutorial-figure">
        <img
          className="tutorial-screenshot"
          src="/tutorials/listing-details/listing-details-1-ui-create-feature.png"
          alt="Dashboard Create form after scaffolding the products feature"
          loading="lazy"
        />
        <figcaption>Dashboard Create form: the products feature scaffolded, 0 LLM calls.</figcaption>
      </figure>
      <p>Then scaffold each vertical slice (listing, details) across the layers you want:</p>
      <figure className="tutorial-figure">
        <img
          className="tutorial-screenshot"
          src="/tutorials/listing-details/listing-details-2-ui-create-listing-slice.png"
          alt="Dashboard Create form after scaffolding the ProductsListing vertical slice"
          loading="lazy"
        />
        <figcaption>Dashboard Create form: the ProductsListing vertical slice scaffolded.</figcaption>
      </figure>
    </>
  );
}

function BrowseGeneratedPages() {
  return (
    <>
      <p>The generated pages are immediately browsable — the UI and the CLI read the exact same project on disk:</p>
      <figure className="tutorial-figure">
        <img
          className="tutorial-screenshot"
          src="/tutorials/listing-details/listing-details-3-ui-browse-pages.png"
          alt="Pages Editor browsing the generated ProductsListingPage"
          loading="lazy"
        />
        <figcaption>Pages Editor: browsing the deterministically-generated pages.</figcaption>
      </figure>
      <p className="hint">
        Equivalent CLI commands: <code>construct create feature products</code>, then{' '}
        <code>
          construct create layer ProductsListing --feature products --layers
          domain,service,hook,component,page,controller
        </code>
        . Generated files are intentionally minimal stubs at this point.
      </p>
    </>
  );
}

function DeterministicScaffoldStep() {
  return (
    <>
      <h3>1. Fully automatic: scaffold the feature deterministically</h3>
      <ScaffoldFeatureAndSlice />
      <BrowseGeneratedPages />
    </>
  );
}

function LlmAssistedStep() {
  return (
    <>
      <h3>2. AI-assisted: have Claude write the real page logic</h3>
      <p>
        Add <code>--llm claude</code> to a create command and, instead of leaving a new file as a
        blank stub, Construct sends that one file&apos;s constraints (its layer, its feature, its
        name) to Claude and writes back a real implementation — one model call per file, never one
        call for the whole batch. A real run produced a working products listing: search box,
        sort dropdown, loading/error/empty states, a product grid, and pagination — all typed
        against an interface the model inferred itself. Both pages passed{' '}
        <code>construct validate</code> cleanly.
      </p>
      <p className="hint">
        This path is CLI-only today — the Dashboard&apos;s Create form has no LLM field at all,
        unlike Import&apos;s LLM checkbox on the same screen:
      </p>
      <figure className="tutorial-figure">
        <img
          className="tutorial-screenshot"
          src="/tutorials/listing-details/listing-details-4-ui-no-llm-field-on-create.png"
          alt="Dashboard Create form with no LLM field, next to Import's LLM checkbox"
          loading="lazy"
        />
        <figcaption>Dashboard: Create has no LLM option (top-left) vs. Import&apos;s LLM checkbox (bottom-right).</figcaption>
      </figure>
      <p className="hint">
        Equivalent CLI command:{' '}
        <code>construct create page ProductsListingPage --feature products --llm claude</code>.
        Review AI-written output before trusting it, same as any generated code.
      </p>
    </>
  );
}

function OpenApiServiceStep() {
  return (
    <>
      <h3>3. Zero-LLM, from a spec: generate the data layer</h3>
      <p>
        The other end of the spectrum from step 2 — instead of asking a model to write logic,
        hand Construct a real OpenAPI spec and it generates the data-fetching service (RTK Query
        endpoints, typed request/response shapes) directly from it. Zero LLM calls, and fully
        repeatable: the same spec always produces the same file, unlike a model that can answer
        differently each run.
      </p>
      <p>
        This path is CLI-only — the Dashboard&apos;s Create form has no field for a spec path yet.
        What you <em>can</em> see in the UI is the real, CLI-generated result, browsed read-only
        through the Research form:
      </p>
      <figure className="tutorial-figure">
        <img
          className="tutorial-screenshot"
          src="/tutorials/listing-details/listing-details-5-ui-research-openapi-service.png"
          alt="Dashboard Research form listing the CLI-generated productsApi.ts among the feature's files"
          loading="lazy"
        />
        <figcaption>Dashboard Research form: the spec-generated service file, visible read-only.</figcaption>
      </figure>
      <p className="hint">
        Equivalent CLI command:{' '}
        <code>
          construct create service products --feature products --openapi
          fixtures/openapi-products/products.yaml
        </code>
        .
      </p>
    </>
  );
}

export function ListingDetailsTutorial() {
  return (
    <div>
      <p>
        The Products listing/details example, walked through end to end as a spectrum — from
        fully automatic deterministic scaffolding, to AI-assisted implementation, to a zero-LLM
        data layer generated straight from a spec.
      </p>
      <DeterministicScaffoldStep />
      <LlmAssistedStep />
      <OpenApiServiceStep />
    </div>
  );
}
