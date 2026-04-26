/**
 * Find Publix stores near a US zip code and print their store IDs (the value
 * to set as PUBLIX_STORE_ID for the Publix scraper).
 *
 *   npm run find-publix-store -- 23060
 */
const zip = process.argv[2];
if (!zip || !/^\d{5}$/.test(zip)) {
  console.error("Usage: npm run find-publix-store -- <5-digit zip>");
  process.exit(1);
}

const url =
  `https://services.publix.com/storelocator/api/v1/stores/?types=R` +
  `&count=30&isWebsite=true&zip=${encodeURIComponent(zip)}`;

interface LocatorStore {
  storeNumber: string;
  name: string;
  address: { streetAddress: string; city: string; state: string; zip: string };
}

const res = await fetch(url, {
  headers: {
    Accept: "application/json",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  },
});
if (!res.ok) {
  console.error(`Publix locator returned ${res.status} ${res.statusText}`);
  process.exit(2);
}
const data = (await res.json()) as { stores?: LocatorStore[] };
const stores = data.stores ?? [];

if (stores.length === 0) {
  console.log(`No Publix stores found near ${zip}.`);
  process.exit(0);
}

console.log(`Found ${stores.length} Publix store(s) near ${zip}:\n`);
for (const s of stores) {
  const a = s.address;
  console.log(
    `  ${s.storeNumber}  ${s.name.padEnd(42)}  ${a.streetAddress}, ${a.city}, ${a.state} ${a.zip}`,
  );
}
console.log(
  `\nPick your store and set PUBLIX_STORE_ID=<storeNumber> in the server's environment.`,
);
