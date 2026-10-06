import url from "node:url";

const file = (name: string) => url.fileURLToPath(new URL(name, import.meta.url));

export const fakeGhPath = file("./fake-gh.js");
export const fakePiPath = file("./fake-pi.js");
export const browserLocatorsPath = file("./browser-locators.ts");
