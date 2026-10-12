import "@testing-library/jest-dom/vitest";

/**
 * jsdom does not implement matchMedia, and a component that asks the user's
 * colour-scheme preference would throw on mount. The stub answers "no
 * preference", which is the honest default for a test.
 */
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

/**
 * Network stubbing is installed per test by `stubApi` in the test helpers,
 * which swaps the axios transport. That boundary is the right one: the request
 * and response interceptors in `api/client.js` — where the CSRF header is
 * attached and where an error becomes an ApiError — still run, so the code under
 * test is the code that ships.
 *
 * Stubbing `fetch` instead would require reimplementing a Response for every
 * call, and stubbing axios itself would skip those interceptors entirely, which
 * is precisely the behaviour worth testing.
 */
