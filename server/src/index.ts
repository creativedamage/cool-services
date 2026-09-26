/** Development entry (`npm run dev`): API on :4000, the Next dev server proxies /api to it. */
import { config } from "./config.js";
import { startServer } from "./app.js";

void startServer({ port: config.port });
