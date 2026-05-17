/**
 * Find Kroger-family stores near a US zip code and print their location IDs
 * (the value to set as KROGER_LOCATION_ID for the Kroger scraper).
 *
 * Requires KROGER_CLIENT_ID and KROGER_CLIENT_SECRET in the environment.
 *
 *   npm run find-kroger-store -- 90210
 */
const zip = process.argv[2];
if (!zip || !/^\d{5}$/.test(zip)) {
  console.error("Usage: npm run find-kroger-store -- <5-digit zip>");
  process.exit(1);
}

const clientId = process.env["KROGER_CLIENT_ID"];
const clientSecret = process.env["KROGER_CLIENT_SECRET"];
if (!clientId || !clientSecret) {
  console.error(
    "Set KROGER_CLIENT_ID and KROGER_CLIENT_SECRET in the environment.\n" +
      "Register at https://developer.kroger.com to get API credentials.",
  );
  process.exit(1);
}

const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
const tokenRes = await fetch("https://api.kroger.com/v1/connect/oauth2/token", {
  method: "POST",
  headers: {
    Authorization: `Basic ${credentials}`,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: "grant_type=client_credentials&scope=product.compact",
});
if (!tokenRes.ok) {
  console.error(`Token request failed: ${tokenRes.status} ${tokenRes.statusText}`);
  process.exit(2);
}
const { access_token } = (await tokenRes.json()) as { access_token: string };

const url = new URL("https://api.kroger.com/v1/locations");
url.searchParams.set("filter.zipCode.near", zip);
url.searchParams.set("filter.radiusInMiles", "15");
url.searchParams.set("filter.limit.stores", "10");

const locRes = await fetch(url.toString(), {
  headers: {
    Authorization: `Bearer ${access_token}`,
    Accept: "application/json",
  },
});
if (!locRes.ok) {
  console.error(`Locations request failed: ${locRes.status} ${locRes.statusText}`);
  process.exit(2);
}

interface LocationAddress {
  addressLine1?: string;
  city?: string;
  state?: string;
  zipCode?: string;
}
interface KrogerLocation {
  locationId: string;
  name: string;
  chain: string;
  address?: LocationAddress;
}
const data = (await locRes.json()) as { data?: KrogerLocation[] };
const stores = data.data ?? [];

if (stores.length === 0) {
  console.log(`No Kroger-family stores found within 15 miles of ${zip}.`);
  process.exit(0);
}

console.log(`Found ${stores.length} Kroger-family store(s) near ${zip}:\n`);
for (const s of stores) {
  const a = s.address;
  const addr = a
    ? `${a.addressLine1 ?? ""}, ${a.city ?? ""}, ${a.state ?? ""} ${a.zipCode ?? ""}`
    : "(no address)";
  console.log(`  ${s.locationId}  ${s.chain.padEnd(14)}  ${s.name.padEnd(36)}  ${addr}`);
}
console.log(
  `\nPick your store and set KROGER_LOCATION_ID=<locationId> in the server's environment.`,
);
