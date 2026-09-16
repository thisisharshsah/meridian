/**
 * What a business can charge in.
 *
 * Ordered rather than alphabetical: the first two are where this product is
 * actually sold, so they are the ones at the top of the list and the one a new
 * business starts with. Somebody setting up a shop in Kathmandu should not
 * scroll past four currencies they will never use to reach their own.
 *
 * A currency is set per business and each one keeps its own, so a list this
 * short is a starting point rather than a limit — the column takes any ISO
 * code, and adding one here is adding a line.
 */
export const CURRENCIES = [
  { code: "NPR", label: "Nepalese Rupee" },
  { code: "INR", label: "Indian Rupee" },
  { code: "USD", label: "US Dollar" },
  { code: "EUR", label: "Euro" },
  { code: "GBP", label: "British Pound" },
  { code: "AUD", label: "Australian Dollar" },
  { code: "CAD", label: "Canadian Dollar" },
  { code: "SGD", label: "Singapore Dollar" },
  { code: "AED", label: "UAE Dirham" },
  { code: "JPY", label: "Japanese Yen" },
];

/**
 * What a business charges in until it says otherwise, and what a screen falls
 * back to when a session has not arrived yet.
 *
 * It was `"USD"`, written into a dozen places by hand. The server has the same
 * default, and the two have to agree: a form that offers dollars while the
 * database records rupees is a wrong number on every invoice.
 */
export const DEFAULT_CURRENCY = "NPR";
