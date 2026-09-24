import "../styles/globals.css";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";

export default function App({ Component, pageProps }) {
  const { pathname } = useRouter();
  return (
    <>
      <Head>
        <title>Decision Studio</title>
        <meta name="description" content="A configurable loan decisioning engine: eligibility rules, pricing tiers, and partner routing, adjustable without a code change." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta property="og:title" content="Decision Studio: a live loan decisioning engine" />
        <meta property="og:description" content="Configurable eligibility rules, pricing tiers, partner routing, and a full audit trace. Decisions in milliseconds." />
        <meta property="og:image" content="https://decision-studio-one.vercel.app/thumb.png" />
        <meta property="og:url" content="https://decision-studio-one.vercel.app/" />
        <meta property="og:type" content="website" />
      </Head>
      <header className="nav">
        <div className="nav-inner">
          <span className="brand">Decision<span className="accent">Studio</span></span>
          <nav>
            <Link href="/" className={pathname === "/" ? "active" : ""}>Apply</Link>
            <Link href="/rules" className={pathname === "/rules" ? "active" : ""}>Rules Console</Link>
          </nav>
        </div>
      </header>
      <main className="container">
        <Component {...pageProps} />
      </main>
      <footer className="footer">
        Built by <a href="https://subhasishgoswami.com">Subhasish Goswami</a>. A demo of decisioning built on configurable
        primitives: eligibility rules, pricing tiers, and partner routing you can
        change without a code deploy.
      </footer>
    </>
  );
}
