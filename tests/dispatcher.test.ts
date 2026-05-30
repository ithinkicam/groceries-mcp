import { expect, test } from "vitest";
import { listStores } from "../src/dispatcher.js";

test("listStores returns the deal stores exposed by the server", () => {
  expect(listStores()).toEqual(["publix", "aldi", "lidl"]);
});
