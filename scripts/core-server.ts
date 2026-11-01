import { main } from "../apps/core/src/http/main";

main().catch(error => { console.error("[core-http] startup failed", error); process.exitCode = 1; });
