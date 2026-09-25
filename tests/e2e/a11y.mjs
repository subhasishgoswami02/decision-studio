// Accessibility and layout check against a running server.
//   BASE_URL=http://localhost:3000 node tests/e2e/a11y.mjs
// Runs axe (WCAG 2.0/2.1 A and AA, WCAG 2.2 AA) on every page at four widths in
// light and dark mode, plus each preset decision and the form error state on
// the home page, and fails on any horizontal overflow.
import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const WIDTHS = [320, 390, 768, 1366];
const SCHEMES = ["light", "dark"];
const PAGES = ["/", "/rules", "/evals"];
const PRESETS = ["Strong applicant", "Thin credit file", "Borderline", "Low score", "Ineligible"];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const violations = [];
const overflows = [];
const errors = [];
let scans = 0;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function scan(page, where) {
  scans++;
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  for (const v of result.violations) {
    for (const node of v.nodes) {
      violations.push({ ...where, rule: v.id, impact: v.impact, target: node.target.join(" "), help: v.help });
    }
  }
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  if (scrollWidth > innerWidth + 1) overflows.push({ ...where, scrollWidth, innerWidth });
}

async function run() {
  const browser = await chromium.launch();
  let contextIndex = 0;
  try {
    for (const width of WIDTHS) {
      for (const scheme of SCHEMES) {
        contextIndex++;
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          colorScheme: scheme,
          reducedMotion: "reduce",
          // The API allows 60 requests a minute per client address. Give each
          // context its own key so a full run is not throttled by itself or by
          // anything else sharing the server.
          extraHTTPHeaders: { "x-forwarded-for": `10.99.${contextIndex}.1` },
        });
        const page = await context.newPage();
        const ctx = { width, scheme };
        try {
          for (const path of PAGES) {
            await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
            await scan(page, { ...ctx, page: path, state: "initial" });
          }

          await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
          for (const name of PRESETS) {
            const button = page.getByRole("button", { name: new RegExp(`^${escapeRe(name)}`) });
            const response = page.waitForResponse((r) => r.url().endsWith("/api/decide"));
            await button.click();
            const res = await response;
            if (!res.ok()) throw new Error(`preset "${name}": /api/decide returned ${res.status()}`);
            await page.waitForFunction(
              (label) => {
                const b = [...document.querySelectorAll("button[aria-pressed='true']")];
                return b.some((el) => el.textContent.startsWith(label)) && document.querySelector(".badge");
              },
              name,
              { timeout: 10000 }
            );
            await page.locator(".badge").first().waitFor({ state: "visible" });
            await scan(page, { ...ctx, page: "/", state: `preset: ${name}` });
          }

          await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
          await page.fill("#loanAmount", "");
          await page.getByRole("button", { name: /^Get decision/ }).click();
          await page.locator(".error-summary").waitFor({ state: "visible" });
          await scan(page, { ...ctx, page: "/", state: "form error" });
        } catch (e) {
          errors.push({ ...ctx, message: e.message.split("\n")[0] });
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
}

function report() {
  console.log(`a11y: ${BASE_URL}, ${scans} axe scans across widths ${WIDTHS.join("/")} in ${SCHEMES.join("/")} mode`);
  if (violations.length) {
    const byRule = {};
    for (const v of violations) (byRule[v.rule] ||= []).push(v);
    console.log(`\nViolations: ${violations.length} node(s) in ${Object.keys(byRule).length} rule(s)`);
    for (const [rule, list] of Object.entries(byRule)) {
      console.log(`\n  ${rule} (${list[0].impact}): ${list[0].help}`);
      const seen = new Set();
      for (const v of list) {
        const line = `    ${v.page} [${v.state}] ${v.width}px ${v.scheme}: ${v.target}`;
        if (!seen.has(line)) {
          seen.add(line);
          console.log(line);
        }
      }
    }
  } else {
    console.log("Violations: none");
  }
  if (overflows.length) {
    console.log(`\nHorizontal overflow: ${overflows.length}`);
    for (const o of overflows) {
      console.log(`    ${o.page} [${o.state}] ${o.width}px ${o.scheme}: scrollWidth ${o.scrollWidth} > ${o.innerWidth}`);
    }
  } else {
    console.log("Horizontal overflow: none");
  }
  if (errors.length) {
    console.log(`\nScript errors: ${errors.length}`);
    for (const e of errors) console.log(`    ${e.width}px ${e.scheme}: ${e.message}`);
  }
  const failed = violations.length + overflows.length + errors.length > 0;
  console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS");
  return failed ? 1 : 0;
}

run()
  .then(() => process.exit(report()))
  .catch((e) => {
    console.error(e);
    report();
    process.exit(1);
  });
