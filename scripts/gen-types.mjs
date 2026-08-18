import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const spec = execSync("cd apps/api && uv run python scripts/dump_openapi.py").toString();
writeFileSync("/tmp/openapi.json", spec);
mkdirSync("packages/api-types", { recursive: true });
execSync("pnpm exec openapi-typescript /tmp/openapi.json -o packages/api-types/index.ts");
console.log("generated packages/api-types/index.ts");
