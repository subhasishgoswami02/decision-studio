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
        // The site picks its theme from localStorage (dark unless "light").
        await context.addInitScript((t) => {
          try {
            window.localStorage.setItem("ds-theme", t);
          } catch (e) {}
        }, scheme);
        const page = await context.newPage();
        const ctx = { width, scheme };
        // Console errors (hydration mismatches, CSP blocks, crashes) fail the run.
        // Vercel's preview-only feedback script is blocked by our CSP by design.
        const consoleError = (text) => {
          if (/vercel\.live/.test(text)) return;
          errors.push({ ...ctx, message: `console: ${text.split("\n")[0].slice(0, 200)}` });
        };
        page.on("console", (m) => m.type() === "error" && consoleError(m.text()));
        page.on("pageerror", (e) => consoleError(e.message));
        try {
          for (const path of PAGES) {
            await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
            await scan(page, { ...ctx, page: path, state: "initial" });
          }

          await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
          const confirmed = () =>
            page.waitForFunction(
              () => /Confirmed by the decision API/.test(document.querySelector(".result .timing")?.textContent || ""),
              null,
              { timeout: 10000 }
            );
          for (const name of PRESETS) {
            const button = page.getByRole("button", { name: new RegExp(`^${escapeRe(name)}`) });
            await button.click();
            await page.waitForFunction(
              (label) => {
                const b = [...document.querySelectorAll("button[aria-pressed='true']")];
                return b.some((el) => el.textContent.trim().startsWith(label)) && document.querySelector(".badge");
              },
              name,
              { timeout: 10000 }
            );
            await page.locator(".badge").first().waitFor({ state: "visible" });
            await page.waitForTimeout(700); // let the API check start and settle
            await confirmed();
            await scan(page, { ...ctx, page: "/", state: `preset: ${name}` });
          }

          // Move the loan slider by keyboard: the decision updates and deltas appear.
          await page.getByRole("button", { name: /^Borderline/ }).click();
          await page.locator("#loanAmount-range").focus();
          for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowLeft");
          await page.waitForTimeout(700);
          await confirmed();
          await scan(page, { ...ctx, page: "/", state: "slider moved" });

          // Open a pipeline step: the trace opens with that step highlighted.
          await page.locator(".pipe-btn").nth(1).click();
          await page.locator(".trace li.is-focus").first().waitFor({ state: "visible" });
          await scan(page, { ...ctx, page: "/", state: "trace step opened" });

          // Clear the loan amount: a field error and the stale-result note appear.
          await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
          await page.fill("#loanAmount", "");
          await page.locator("#loanAmount-error").waitFor({ state: "visible" });
          await page.locator(".stale-note").waitFor({ state: "visible" });
          await scan(page, { ...ctx, page: "/", state: "field error" });
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
