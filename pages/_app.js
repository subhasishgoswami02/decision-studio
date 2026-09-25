import "@fontsource-variable/manrope";
import "@fontsource-variable/sora";
import "../styles/globals.css";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import ThemeToggle from "../components/ThemeToggle";

const SITE = "https://decision-studio-one.vercel.app";
const PORTFOLIO = "https://subhasishgoswami.com";
const REPO = "https://github.com/subhasishgoswami02/decision-studio";

const NAV = [
  { href: "/", label: "Apply" },
  { href: "/rules", label: "Rules console" },
  { href: "/evals", label: "Policy tests" },
];

const TITLES = {
  "/": "Decision Studio: rules-based student-loan decisioning",
  "/rules": "Rules console | Decision Studio",
  "/evals": "Policy tests | Decision Studio",
};

export default function App({ Component, pageProps }) {
  const { pathname } = useRouter();
  const title = TITLES[pathname] || "Decision Studio";
  const description =
    "A live, rules-based student-loan decisioning engine: knockout rules, a weighted scorecard, risk-based pricing and partner routing you can edit without a deploy, with a full decision trace and a policy test suite.";

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content={description} />
        <link rel="canonical" href={`${SITE}${pathname === "/" ? "/" : pathname}`} />
        <meta property="og:site_name" content="Decision Studio" />
        <meta property="og:title" content="Decision Studio: a live loan decisioning engine" />
        <meta
          property="og:description"
          content="Move the inputs and watch a credit decision change live, with every rule, score and step shown. Built by Subhasish Goswami."
        />
        <meta property="og:image" content={`${SITE}/thumb.png`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:url" content={`${SITE}/`} />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="author" content="Subhasish Goswami" />
      </Head>

      <a className="skip-link" href="#main">Skip to content</a>

      <header className="site-nav">
        <div className="nav-inner">
          <Link href="/" className="wordmark" aria-label="Decision Studio, home">
            <span aria-hidden="true" className="wordmark-mark" />
            <span>
              Decision <b>Studio</b>
            </span>
          </Link>
          <div className="nav-right">
          <nav aria-label="Main">
            <ul className="nav-links">
              {NAV.map((n) => (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    className={pathname === n.href ? "active" : undefined}
                    aria-current={pathname === n.href ? "page" : undefined}
                  >
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <ThemeToggle />
          </div>
        </div>
      </header>

      <main id="main" className="container" tabIndex={-1}>
        <Component {...pageProps} />
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          <p>
            Built by <a href={PORTFOLIO}>Subhasish Goswami</a>, product leader for lending, fintech and applied AI.
          </p>
          <p className="footer-meta">
            A personal prototype. Every rule, score and rate here is illustrative, not any lender&apos;s credit
            policy. <a href={REPO}>Source on GitHub</a>
          </p>
        </div>
      </footer>
    </>
  );
}
