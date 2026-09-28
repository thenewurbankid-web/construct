// The three real Portfolio Health pages, pulled from Subframe (project Project Max V2, canvas "Portfolio Health").
// Pick one with the hash: #redesigned, #figma-1, #figma-2 (default: redesigned).
import { useEffect, useState, type ReactElement } from "react";
import RedesignedPortfolioHealth from "./pages/RedesignedPortfolioHealth";
import PortfolioHealthFigmaRebuild from "./pages/PortfolioHealthFigmaRebuild";
import PortfolioHealthFigmaRebuild2 from "./pages/PortfolioHealthFigmaRebuild2";

const PAGES: Record<string, { label: string; Page: () => ReactElement }> = {
  redesigned: { label: "Redesigned portfolio health", Page: RedesignedPortfolioHealth },
  "figma-1": { label: "Figma rebuild", Page: PortfolioHealthFigmaRebuild },
  "figma-2": { label: "Figma rebuild 2", Page: PortfolioHealthFigmaRebuild2 },
};

export default function App() {
  const read = () => (window.location.hash.replace("#", "") in PAGES ? window.location.hash.replace("#", "") : "redesigned");
  const [key, setKey] = useState(read);
  useEffect(() => {
    const on = () => setKey(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const { Page } = PAGES[key];
  return (
    <>
      <nav style={{ position: "fixed", right: 12, bottom: 12, zIndex: 9999, display: "flex", gap: 6, padding: 6, background: "#fff", border: "1px solid #ddd", borderRadius: 10, font: "12px sans-serif" }}>
        {Object.entries(PAGES).map(([k, v]) => (
          <a key={k} href={`#${k}`} style={{ padding: "4px 8px", borderRadius: 6, textDecoration: "none", color: k === key ? "#fff" : "#333", background: k === key ? "#2563eb" : "transparent" }}>
            {v.label}
          </a>
        ))}
      </nav>
      <Page />
    </>
  );
}
