export * from "./src/index.js";
export { main as default } from "./src/index.js";

import { main } from "./src/index.js";

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
