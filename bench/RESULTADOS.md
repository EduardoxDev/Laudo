# Bench do Laudo

Rodado em 2026-10-27 com o Laudo 0.1.0, sem mutação. Cada linha é um commit da branch principal (um PR já revisado e mesclado), comparado com o commit anterior.

**50 PRs · 38 aprovados · 12 revisar · 0 bloqueados · 0 erros** · tempo mediano 0.8 s, p95 3.1 s

## Por projeto

| Projeto | PRs | Aprovado | Revisar | Bloqueado |
|---|---|---|---|---|
| [sindresorhus/ky](https://github.com/sindresorhus/ky) | 10 | 6 | 4 | 0 |
| [honojs/hono](https://github.com/honojs/hono) | 10 | 9 | 1 | 0 |
| [fastify/fastify](https://github.com/fastify/fastify) | 10 | 10 | 0 | 0 |
| [expressjs/express](https://github.com/expressjs/express) | 10 | 8 | 2 | 0 |
| [colinhacks/zod](https://github.com/colinhacks/zod) | 10 | 5 | 5 | 0 |

## Regras que dispararam

| Regra | Vezes |
|---|---|
| `tests/test-removed` | 13 |
| `risk/sensitive-zone` | 7 |

## Todos os commits

| Veredito | Commit | Assunto | Achados |
|---|---|---|---|
| ✅ | [sindresorhus/ky 3541888](https://github.com/sindresorhus/ky/commit/3541888878c4d303a8bc2ad61815f4e048f55a5d) | 2.2.0 |  |
| ✅ | [sindresorhus/ky 242c327](https://github.com/sindresorhus/ky/commit/242c32728a4be7eacfa08bca1ae0b209444f83d1) | Let a `beforeRetry` hook change per-attempt options |  |
| ✅ | [sindresorhus/ky d9ddb03](https://github.com/sindresorhus/ky/commit/d9ddb03b444cbb6c10601003ede9269f3885a665) | Fix CI |  |
| 🟡 | [sindresorhus/ky d93adf8](https://github.com/sindresorhus/ky/commit/d93adf85d1a992eb3b0390200c7d19e37d16b890) | Run the browser tests and static checks once in CI | `risk/sensitive-zone` |
| ✅ | [sindresorhus/ky a5ed57b](https://github.com/sindresorhus/ky/commit/a5ed57b1898d5eba75f1b0ffc8752518a75e0f07) | Refactor |  |
| 🟡 | [sindresorhus/ky 7f0137d](https://github.com/sindresorhus/ky/commit/7f0137dc42bbebc8652649a8139065c0dd4dff0b) | Report the sent request for a hook's response, and finish the cross-re | `tests/test-removed` |
| 🟡 | [sindresorhus/ky 13c8da5](https://github.com/sindresorhus/ky/commit/13c8da559c940c4abd9c741a56ea4603c25a0383) | Stop surfacing progress callback errors | `tests/test-removed`, `tests/test-removed`, `tests/test-removed`, `tests/test-removed`, `tests/test-removed` |
| ✅ | [sindresorhus/ky 55599c8](https://github.com/sindresorhus/ky/commit/55599c89809c83bdae7f56b56ac8e2a5bd57b8d3) | Run `beforeError` for a `beforeRetry` abort and share the body-wrappin |  |
| 🟡 | [sindresorhus/ky 3ded2aa](https://github.com/sindresorhus/ky/commit/3ded2aad45a1ef06eef5a91e3d853dd056376bf6) | Tweaks | `tests/test-removed`, `tests/test-removed`, `tests/test-removed`, `tests/test-removed`, `tests/test-removed` |
| ✅ | [sindresorhus/ky 692c435](https://github.com/sindresorhus/ky/commit/692c43575422c7251baea01ef4179100e0215e1b) | Restore the retry-only marker condition and cover the remaining cases |  |
| ✅ | [honojs/hono bac5c4a](https://github.com/honojs/hono/commit/bac5c4a8bcd76b165428ce757e1185753c7935bd) | 4.13.14 |  |
| ✅ | [honojs/hono eb78eca](https://github.com/honojs/hono/commit/eb78ecaabe26baa8addc053cf8a94b5b7603c001) | fix(utils/url): preserve encoded duplicate query order (#5495) |  |
| 🟡 | [honojs/hono 06a45bc](https://github.com/honojs/hono/commit/06a45bc3a639c1f9eea28e16370bc03447f0d7cb) | feat(bearer-auth): allow MessageFunction to return a Response (#5269) | `risk/sensitive-zone` |
| ✅ | [honojs/hono 5ca49b0](https://github.com/honojs/hono/commit/5ca49b0720755c585c9a9835f0a479ceea36fb52) | fix(css): Fix multiline CSS handling in style replacement (#5405) |  |
| ✅ | [honojs/hono e9c0107](https://github.com/honojs/hono/commit/e9c01079a932ffdfa269c0011075ac43fd8a1035) | fix(hono-base): disallow `getPath` when `strict` is `false` (#5563) |  |
| ✅ | [honojs/hono 08807ce](https://github.com/honojs/hono/commit/08807ce12aa3aa27c8c5adf63e677bbab6bceda9) | fix(trie-router): keep first value for duplicate path params (#5422) ( |  |
| ✅ | [honojs/hono e77c7c8](https://github.com/honojs/hono/commit/e77c7c8eb9fea50a496ba10010063998b55d7a6b) | fix(helper/route): match regex params in basePath() the same way as th |  |
| ✅ | [honojs/hono d54720d](https://github.com/honojs/hono/commit/d54720da80134a180f5fe2dd98a7676cfc8f08b4) | fix(serve-static): respect q-values in Accept-Encoding for precompress |  |
| ✅ | [honojs/hono ae401f0](https://github.com/honojs/hono/commit/ae401f080004872678100e890fd3398d3df09e67) | fix(css): keep the descendant combinator before a pseudo-class when mi |  |
| ✅ | [honojs/hono 2013fed](https://github.com/honojs/hono/commit/2013fed5b21719bb1e6f44ce7f49757660946856) | fix(css): keep "//" inside an unquoted url() when minifying (#5450) |  |
| ✅ | [fastify/fastify 5df959f](https://github.com/fastify/fastify/commit/5df959f3af698823dd582f1c3661f3e80df0b5da) | docs: fix syntax errors in code examples (#7159) |  |
| ✅ | [fastify/fastify d40c30d](https://github.com/fastify/fastify/commit/d40c30d2a68051a35c2ded4d4b2db114784e2d6c) | docs: clarify that maxParamLength does not prevent ReDoS (#7140) |  |
| ✅ | [fastify/fastify 2a64ae1](https://github.com/fastify/fastify/commit/2a64ae1627d78fe1f22fb021a7e5763581384473) | fix(decorators): evaluate instance getters once in getDecorator (#7124 |  |
| ✅ | [fastify/fastify 05869c5](https://github.com/fastify/fastify/commit/05869c5cca5964776fdb61230ac60c5fa297f593) | perf(request): hoist port regex to module level (#7110) |  |
| ✅ | [fastify/fastify a122571](https://github.com/fastify/fastify/commit/a122571bde10126da9cfa02591eecf2d1c8e0a52) | docs(request): reorganize Request reference by properties and methods  |  |
| ✅ | [fastify/fastify 1a012d3](https://github.com/fastify/fastify/commit/1a012d3b22692a616d1e91a41a2f9127e9dba494) | docs(reply): reorganize Reply reference by properties and methods (#71 |  |
| ✅ | [fastify/fastify 78d68b2](https://github.com/fastify/fastify/commit/78d68b2225baa3b7e05ebb5522239f40a4bcf6e8) | test: do not assert a HEAD response body through inject() (#7148) |  |
| ✅ | [fastify/fastify 5c1f393](https://github.com/fastify/fastify/commit/5c1f3935e43b35679c71ea7a65275a348d1efbd1) | fix(types): add logSerializers to RouteShorthandOptions |  |
| ✅ | [fastify/fastify ce41dc0](https://github.com/fastify/fastify/commit/ce41dc0fbb4ed75e9a42f3972ac896333f6a7396) | fix(types): allow socket path strings in addresses (#6842) |  |
| ✅ | [fastify/fastify 5d4c233](https://github.com/fastify/fastify/commit/5d4c23352d90c2474bfaf1a0d530c86b699cb795) | feat(hooks): support disposables in onClose hook (#7121) |  |
| 🟡 | [expressjs/express 1c6f1b0](https://github.com/expressjs/express/commit/1c6f1b0fe4000977b9a7b4f34097e4d527dd9824) | test: expand coverage for request, response and view behavior (#7112) | `tests/test-removed` |
| ✅ | [expressjs/express 0dee2c5](https://github.com/expressjs/express/commit/0dee2c52c7c873498f8ed7d8ee4ddd0a04d3ada8) | docs: correct crossed names in the emeritus triagers list (#7529) |  |
| ✅ | [expressjs/express a419aa7](https://github.com/expressjs/express/commit/a419aa7350389a275ab45fde2e849ed1f02449ef) | Revert "build(deps-dev): bump supertest from 6.3.0 to 7.3.0 (#7494)" ( |  |
| ✅ | [expressjs/express 6d2df03](https://github.com/expressjs/express/commit/6d2df035a95f3d1002be3e29997b7a4bfe976b5f) | build(deps-dev): bump supertest from 6.3.0 to 7.3.0 (#7494) |  |
| ✅ | [expressjs/express cf6722b](https://github.com/expressjs/express/commit/cf6722bf89a86905281d9160b6482e08166b5ef0) | 5.3.0 (#7468) |  |
| ✅ | [expressjs/express 8c2fcfc](https://github.com/expressjs/express/commit/8c2fcfcb7d37c9c2e89363b7b86a092768c3a8a3) | docs: fix typos and a stale API reference in lib comments (#7512) |  |
| ✅ | [expressjs/express 9efc29e](https://github.com/expressjs/express/commit/9efc29e280018dafc1f0617f3a3d28f4e463b7be) | docs: fix pass-through typos (#7509) |  |
| 🟡 | [expressjs/express 2717ae3](https://github.com/expressjs/express/commit/2717ae3cbf2bdc3f946d22ea6a4e0b5bd438b87b) | build(deps): bump the github-actions group with 3 updates (#7499) | `risk/sensitive-zone` |
| ✅ | [expressjs/express de77771](https://github.com/expressjs/express/commit/de777714df3fb1e81ac2d95f509c421478ab1e56) | build(deps-dev): bump hbs from 4.3.0 to 4.3.1 (#7500) |  |
| ✅ | [expressjs/express 9169cbe](https://github.com/expressjs/express/commit/9169cbe1127ed1f9bc4f80a70b82c412467dd156) | docs: add missing apostrophe in example (#7483) |  |
| 🟡 | [colinhacks/zod afdac65](https://github.com/colinhacks/zod/commit/afdac65e0f80c0ccf9e8909da97c411567908b57) | release: the approval summary tells the maintainer to run stager, not  | `risk/sensitive-zone` |
| 🟡 | [colinhacks/zod a66e698](https://github.com/colinhacks/zod/commit/a66e69814daa34e098e290fe0899451197515fc5) | release: tag before installing dependencies, and delete the key after  | `risk/sensitive-zone` |
| 🟡 | [colinhacks/zod f1ffdf5](https://github.com/colinhacks/zod/commit/f1ffdf555730f9b618c17a666962be8b81f7fb3c) | release: only the approved release job can create a tag, and the dispa | `risk/sensitive-zone` |
| ✅ | [colinhacks/zod 680d19f](https://github.com/colinhacks/zod/commit/680d19f7d1e042e55934209caeb79bc843b94f44) | fix(v4): report a union option that only checks rejected (#6662) |  |
| 🟡 | [colinhacks/zod 40a5dba](https://github.com/colinhacks/zod/commit/40a5dba080b065cc430e5b0e64a8058d68c1660d) | fix(locales): add Sizable.map to es, fr, he, hr and lt, and check Siza | `tests/test-removed` |
| ✅ | [colinhacks/zod 311cd74](https://github.com/colinhacks/zod/commit/311cd74b2765ff7c7b58add60e37c5a0ea7a1972) | fix(v4): run a record's key schema on an own __proto__ key (#6660) |  |
| ✅ | [colinhacks/zod b500a2e](https://github.com/colinhacks/zod/commit/b500a2ee95134f81d74da7911d7378dd2853d042) | 4.6.7 |  |
| 🟡 | [colinhacks/zod 9c21983](https://github.com/colinhacks/zod/commit/9c219833c3a3764fa1f1ea9c5ecec8254a63c0b1) | ci: stage at verbose so a failed OIDC token exchange says why | `risk/sensitive-zone` |
| ✅ | [colinhacks/zod 529f78d](https://github.com/colinhacks/zod/commit/529f78dd9431b07f49647fee3aa0819b3f8b66b7) | 4.6.6 |  |
| ✅ | [colinhacks/zod a0ebf97](https://github.com/colinhacks/zod/commit/a0ebf970f2d752e5f58527cd2942ff48be4f46bd) | fix(v4): check array, set and map size bounds before parsing elements  |  |
