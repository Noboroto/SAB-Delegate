# pnpm + runtime (chuyển từ yarn, 2026-10-10)

- pnpm 12: cấu hình cho phép install script nằm ở `root/pnpm-workspace.yaml` → `allowBuilds: {pkg: true}`.
  `onlyBuiltDependencies` và field `"pnpm"` trong package.json bị pnpm 11+ BỎ QUA im lặng.
  Cần cho: `better-sqlite3` (native), `esbuild` (của tsx).
- Repo có node_modules cũ của yarn → `pnpm install --config.confirm-modules-purge=false` để khỏi hỏi tương tác.
- `better-sqlite3` 13 đòi Node ≥ 22; trên macOS Node 24 nó build từ source (node-gyp) — mất ~20s.
- TypeScript 7 (bản Go) chưa dùng được: `typescript-eslint` 8.x peer `typescript <6.1`. Ghim `~6.0`.
- TS 6 mặc định `strict: true`, `types: []`, bỏ `moduleResolution: node`/`baseUrl` → tsconfig đặt tường minh
  `strict: false`, `types: ["node"]`, `module/moduleResolution: nodenext`, `noEmit`.
- Runtime `tsx` thay `ts-node` (ts-node không theo kịp TS mới). Loader command dùng `require()` file `.ts` — tsx hỗ trợ.
- dotenv ≥17 in log mặc định → gọi `dotenv.config({ quiet: true })`.
- ESLint 10 chỉ nhận flat config (`root/eslint.config.mjs`); `.eslintrc.json` đã xoá.

## Bổ sung từ bài học các repo khác (11/10/2026)
- Monorepo: `pnpm add <pkg>` không ghim version; `@types/node` cùng major với runtime image; `@nestjs/platform-fastify` ghim cứng fastify (override); `pnpm.patchedDependencies` cho `@rc-component/util@1.13.0`; `pnpm deploy --prod --config.inject-workspace-packages=true` không `--legacy`; `.pnpmfile.cjs` cắt optional peer. Chi tiết: `mem:lessons/tooling/dependencies-and-syncthing`, `mem:lessons/deploy/docker-image-build`.
