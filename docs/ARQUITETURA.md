# Laudo — Arquitetura

> Versão 0.1 · 26/10/2026 · Acompanha a [Especificação do MVP](./ESPECIFICACAO.md)

## 1. Visão geral

```
                ┌──────────────┐     ┌──────────────┐
  terminal ───▶ │  @laudo/cli  │     │ laudo-action │ ◀─── GitHub (pull_request)
                └──────┬───────┘     └──────┬───────┘
                       └────────┬───────────┘
                                ▼
                      ┌───────────────────┐
                      │    @laudo/core    │
                      │                   │
                      │ 1. Coleta         │  git diff, arquivos antes/depois, package.json
                      │ 2. Análise        │  analisadores em paralelo
                      │ 3. Veredito       │  regras → aprovado / revisar / bloqueado
                      │ 4. Relatório      │  terminal · markdown · json · sarif
                      └─────────┬─────────┘
                                │ usa (sempre por interface)
              ┌─────────────────┼──────────────────┐
              ▼                 ▼                  ▼
          Git (local)   Registro npm (HTTP)   Stryker (subprocesso)
```

O núcleo é uma **função pura no meio**: recebe um `ChangeSet` (o diff com o conteúdo antes e depois) e devolve um `Report`. Tudo o que toca o mundo externo (git, rede, processos) fica atrás de interfaces. Isso deixa os analisadores fáceis de testar com fixtures e impede que a rede afete o resultado sem aviso.

## 2. Estrutura do repositório

Monorepo com npm workspaces (o pnpm não está instalado na máquina; dá para trocar depois sem mudar o código):

```
laudo/
├─ packages/
│  ├─ core/                 # @laudo/core: pipeline, tipos, analisadores, renderizadores
│  │  └─ src/
│  │     ├─ collect/        # git.ts, changeset.ts, manifest.ts
│  │     ├─ analyzers/
│  │     │  ├─ test-integrity/   # parse.ts, rules/*.ts
│  │     │  ├─ deps/             # registry.ts, typosquat.ts, rules.ts
│  │     │  ├─ risk-map/         # zones.ts, trivial.ts
│  │     │  └─ mutation/         # ranges.ts, stryker.ts
│  │     ├─ verdict.ts
│  │     ├─ render/         # terminal.ts, markdown.ts, json.ts, sarif.ts
│  │     ├─ config.ts       # carrega e valida laudo.config.json (zod)
│  │     └─ index.ts        # runLaudo(options): Promise<Report>
│  ├─ cli/                  # @laudo/cli → binário `laudo` (check, init, explain)
│  └─ action/               # GitHub Action (bundle único em dist/)
├─ fixtures/                # corpo de PRs: _shared/ (base comum), <caso>/before|after/ e cases.json (veredito e regras esperadas)
├─ bench/                   # roda o Laudo em PRs reais e mede precisão e tempo
└─ docs/
```

## 3. Tecnologias

| Para quê | Escolha | Por quê |
|---|---|---|
| Linguagem | TypeScript, Node ≥ 20.19 | O público alvo é JS/TS; `npx` sem instalar nada |
| Build | `tsc -b` (project references); tsup entra na fatia 4 | `tsc` basta para a CLI; o bundle único só é preciso na Action |
| AST | `@babel/parser` (plugins `typescript`, `jsx`) | Lê TS, JSX e JS com tolerância a erro |
| Diff | `git` via `child_process` + parser próprio de `-U0` | Usa o git que já existe; sem dependência extra |
| Nomes parecidos | Distância de edição própria + `npm-high-impact` | Determinístico; a lista vem pronta e atualizada pelo autor |
| Versões | `semver` | O mesmo resolvedor que o npm usa |
| Mutação | Stryker JS (subprocesso) | Aceita intervalos de linha (`arquivo.ts:10-24`), modo incremental, Vitest/Jest/Mocha |
| Config | `zod` | Erros de config claros, com o caminho do campo |
| CLI | `commander` + `picocolors` | Leve |
| Action | `@actions/core`, `@actions/github` | Padrão do GitHub |
| Testes | Vitest + testes de fixture (snapshot do `Report`) | Cada regra nova vem com seu fixture |

Regra das duas semanas: só versões publicadas há pelo menos 14 dias, fixadas sem `^`. Na fatia 1 a instalação foi feita com `npm install --before=2026-10-12`, que aplica a regra também às dependências indiretas. Babel 7 e Commander 14 foram escolhidos em vez de Babel 8 e Commander 15 porque estes exigem Node 22.

## 4. Modelo de dados

```ts
type Level = 'pass' | 'review' | 'block';

interface ChangeSet {
  base: string;               // sha
  head: string;               // sha
  files: ChangedFile[];
  manifests: { before: PackageJson | null; after: PackageJson | null; path: string }[];
}

interface ChangedFile {
  path: string;
  oldPath?: string;           // renomeado
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  kind: 'test' | 'source' | 'config' | 'ci' | 'snapshot' | 'other';
  before: string | null;      // conteúdo completo
  after: string | null;
  hunks: Hunk[];              // linhas alteradas, com números antes/depois
}

interface Finding {
  id: string;                 // estável: hash(regra + arquivo + trecho) → mesmo achado entre pushes
  rule: string;               // ex.: 'tests/assertion-removed'
  level: Level;
  title: string;              // frase curta, em português
  file?: string;
  line?: number;
  evidence?: { before?: string; after?: string };
  hint?: string;              // como resolver
}

interface Analyzer {
  name: string;
  appliesTo(cs: ChangeSet): boolean;
  run(cs: ChangeSet, ctx: Context): Promise<Finding[]>;
}

interface Context {
  config: Config;
  registry: RegistryClient;   // interface → falso nos testes
  runner: ProcessRunner;      // interface → falso nos testes
  cache: Cache;
  signal: AbortSignal;        // limite de tempo
  log: Logger;
}

interface Report {
  verdict: Level;
  findings: Finding[];
  reviewPlan: { file: string; lines: number; reason: string }[];
  trivial: { file: string; lines: number; why: 'rename' | 'format' | 'imports' }[];
  mutation?: { killed: number; survived: number; timedOut: boolean };
  meta: { version: string; durationMs: number; analyzers: Record<string, 'ok' | 'skipped' | 'error'> };
}
```

## 5. Pipeline

### 5.1 Coleta (`collect/`)

1. `git merge-base <base> HEAD` → sha da base.
2. `git diff --find-renames -U0 <base>...HEAD` → hunks.
3. Para cada arquivo: `git show <sha>:<path>` antes e depois (com limite de tamanho; arquivos binários são pulados).
4. Classifica cada arquivo (`kind`) pelos padrões da config e por convenções (`*.test.*`, `__tests__/`, `.github/workflows/`, `__snapshots__/`).
5. Lê os `package.json` antes e depois (incluindo os de workspaces).

### 5.2 Análise

Os analisadores rodam em paralelo (`Promise.allSettled`). **Se um falha, o laudo continua**: ele é marcado como `error` no `meta`, e o veredito nunca fica pior por causa da falha. A mutação roda por último e só se `--mutate` estiver ligado.

#### `test-integrity`

- Faz o parse do antes e do depois de cada arquivo `kind: test`.
- Extrai uma **lista de testes**: caminho `describe > it`, modificadores (`skip`/`only`/`todo`), número de asserts (`expect(...)`, `assert.*`, `t.is`...) e as expressões de cada assert normalizadas.
- Pareia os testes por nome (e por similaridade de corpo quando o nome mudou).
- Cada regra é uma função pequena `(parAntes, parDepois) => Finding[]`, que fica em `rules/`.
- Arquivos `kind: ci` e `config` (vitest/jest config, `package.json` scripts) passam por regras próprias: limite de cobertura, `continue-on-error`, `|| true`, `--passWithNoTests`, job de teste removido.

#### `deps`

- Diferença entre `dependencies`, `devDependencies` e `optionalDependencies` antes e depois.
- Para cada pacote novo, em até 3 consultas:
  1. `GET registry.npmjs.org/<nome>` com `Accept: application/vnd.npm.install-v1+json` (metadados resumidos: versões, dist-tags e `hasInstallScript` de cada versão). Pacote popular conhecido para aqui.
  2. `GET api.npmjs.org/downloads/point/last-week/<nome>` (só no registro público).
  3. Só se tiver menos de 10 mil downloads por semana: o documento completo, para ler `time.created`. Os documentos completos de pacotes grandes têm vários MB, por isso essa etapa é evitada.
- Versão: `semver.maxSatisfying` sobre as versões publicadas; se o valor não for um range, ele é tratado como dist-tag (`next`, `beta`).
- Nome parecido: distância de edição com troca de vizinhas (Damerau/OSA) contra os 5 mil pacotes mais baixados do [npm-high-impact](https://github.com/wooorm/npm-high-impact). O limite é 1 para nomes de 5 a 8 letras e 2 a partir de 9; também conta igualdade ignorando `-`, `_` e `.`, e escopo trocado (`@bable/` → `@babel/`). Pacotes da lista completa (~17 mil) nunca são suspeitos.
- Cache em JSON (24 h; 1 h para pacote inexistente), gravado num temporário e renomeado. O local é `%LOCALAPPDATA%\laudo\cache` no Windows e `$XDG_CACHE_HOME/laudo` ou `~/.cache/laudo` nos outros sistemas, ou `LAUDO_CACHE_DIR`. Sem rede, o resultado vira **Revisar** (`deps/registry-unavailable`).
- Pacotes do próprio repositório (campo `name` de todo `package.json` rastreado pelo git) são pulados. Assim um monorepo não acusa os próprios pacotes como inexistentes.

#### `ci-integrity`

Pega o agente que deixa o CI verde mexendo no próprio CI. Lê arquivos `kind: ci` e `config`.

- **Falha ignorada** (`ci/failure-ignored`): conta, antes e depois, as linhas com `continue-on-error: true`, `|| true`, `|| exit 0`, `|| :`, `; exit 0`, `set +e` e `if: false`; o que entrou bloqueia. `--passWithNoTests` só pede revisão. Nos `package.json`, a mesma conta é feita nos valores de `scripts`. A comparação é por linha e não por YAML, porque esses truques sempre cabem numa linha e assim não é preciso parser.
- **Testes que deixam de rodar** (`ci/tests-not-run`): linhas com comando de teste (`npm test`, `npx vitest`, `jest`, `node --test`, `playwright test`…) que sumiram do workflow, ou o arquivo de CI apagado. Também o script `test` do `package.json` trocado por `echo`/`exit 0`/`true` ou apagado; o placeholder do `npm init` não conta.
- **Cobertura reduzida** (`ci/coverage-lowered`): os limites de `lines`, `branches`, `functions` e `statements` lidos do AST de `vitest.config.*`/`jest.config.*` (só sob uma chave com "threshold"), de `package.json` (`jest.coverageThreshold`, `nyc`, `c8`) e de `.nycrc`/`.c8rc` em JSON, mais `check-coverage`. Valor menor, chave removida ou `true → false` bloqueia.

#### `risk-map`

Os analisadores devolvem `{ findings, reviewPlan?, trivial? }`; só o `risk-map` preenche os dois últimos.

- **Zonas** (`zones.ts`): 6 zonas embutidas mais `risk.sensitive` da config. Cada zona tem uma regex de caminho, que casa com palavra inteira (`auth.ts` sim, `author.ts` não), e outra de conteúdo, aplicada só às linhas que o diff tirou ou colocou. Testes e snapshots não contam. Um achado `risk/sensitive-zone` (Revisar) por zona, listando os arquivos.
- **Trivial** (`trivial.ts`), do mais barato para o mais caro:
  1. Lockfile → `generated`; conteúdo idêntico e renomeado → `moved`.
  2. Fora de JS/TS: igual sem espaços → `format`.
  3. AST serializado sem posições, comentários, `extra` (forma original de literais, parênteses) → igual = `format`.
  4. O mesmo, trocando os nomes **locais** por `$1, $2…` na ordem em que aparecem → igual = `rename`. Ficam de fora os nomes exportados, as propriedades (`a.b`, `{ b: 1 }`), as chaves de desestruturação e os nomes importados/exportados, porque trocar qualquer um deles muda o comportamento.
  5. Mesmo código fora dos imports, e o mesmo conjunto de imports em outra ordem → `imports`.
  Na dúvida (erro de sintaxe, arquivo pulado), não é trivial.
- **Plano**: zonas sensíveis → tipo (código, CI, config, teste, outro, snapshot) → tamanho → nome.

#### `mutation`

Desligado por padrão (`mutation.enabled`, `--mutate`, entrada `mutate` da Action).

1. **Intervalos** (`ranges.ts`): só as linhas que o diff **colocou** em código-fonte JS/TS (sem testes nem `.d.ts`), juntando trechos a até 2 linhas de distância → `src/cart.ts:12-30`.
2. **Stryker do projeto** (`stryker.ts`): usa `node_modules/@stryker-mutator/core` do projeto analisado, e não um embutido no Laudo. Assim o runner (vitest, jest, mocha) e o executor de testes são os do projeto, nas versões dele. O runner é o pacote `@stryker-mutator/<x>-runner` instalado; sem nenhum, usa `npm test` (`command`, sem cobertura por teste). Sem Stryker, a mutação é pulada com uma nota que diz o que instalar.
3. **Disco = HEAD:** o Stryker muta os arquivos como estão no disco. Comparando com o HEAD, se algum arquivo a mutar tiver mudança não commitada, a mutação é pulada; com `--worktree`, o disco é o próprio alvo.
4. **Config de uma execução** (num diretório temporário): `mutate` = os intervalos, `coverageAnalysis: perTest`, `ignoreStatic`, relatório `json`, `incremental` com o arquivo em `.laudo/stryker-incremental.json` (vale pôr em cache no CI). O `.laudo/` nunca entra no laudo.
5. **Processo:** `node <bin do stryker> run <config>`, morto ao passar de `mutation.timeoutSeconds`. Tempo esgotado → nota, `mutation.timedOut: true` e nenhum achado: nunca bloqueia.
6. **Leitura** (`report.ts`, `mutation-testing-report-schema`): `Killed` e `Timeout` contam como pegos; `Survived` e `NoCoverage` como escapados; `CompileError`, `RuntimeError`, `Ignored` e `Pending` ficam fora da nota. Nota = pegos ÷ (pegos + escapados).
7. **Achados:** nenhum se a nota ≥ `minScore`, porque um ou outro sobrevivente é normal. Abaixo disso, um `mutation/survived` por arquivo (Revisar), com até 5 exemplos, primeiro um por linha. Com nota 0 num PR que também mexeu nos testes, o achado bloqueia.

Medido num projeto de exemplo (Vitest, 6 linhas novas, 16 mutantes): 8,4 s na primeira execução e 5,3 s na segunda, com o incremental.

### 5.3 Veredito (`verdict.ts`)

```
se algum achado é 'block'   → block
senão se algum é 'review'   → review
senão                       → pass
```

O `failOn` da config decide qual nível faz o código de saída falhar o CI. Supressões (`// laudo-ignore <regra>: <motivo>`) só valem com motivo escrito e aparecem listadas no relatório. Nada é escondido em silêncio.

### 5.4 Relatório (`render/`)

Cada renderizador é uma função pura `Report → string`. O markdown segue o modelo da Especificação (seção 7) e termina com um marcador invisível `<!-- laudo:report -->`, que a Action usa para achar e atualizar o próprio comentário.

Regras do markdown, porque tudo o que vem do diff é controlado por quem abriu o PR:
- Texto comum passa por `text()`: primeiro escapa o markdown (`` \ ` * _ [ ] | ~ # ``), depois o HTML (`& < >`) e o `@`, que vira `&#64;` para não mencionar pessoas nem times (`@org/time`). A ordem importa: escapar `#` depois criaria `&\#64;`.
- Nomes e trechos vão em código (`code()` e `fence()`), com mais crases que a maior sequência do conteúdo, para que ele não feche o bloco antes da hora.
- Limite padrão de 60 mil caracteres (o GitHub aceita 65.536): o resumo, as listas e o marcador entram sempre; as evidências entram até onde couber, e o resto é indicado.
- O JSON leva `schemaVersion: 1`, que muda quando o formato quebrar quem lê.

## 6. CLI

```
laudo check [--base <ref>] [--mutate] [--format terminal|markdown|json|sarif] [--fail-on block|review|never]
laudo init                   # cria laudo.config.json e .github/workflows/laudo.yml
laudo explain <regra>        # explica uma regra, com exemplo de antes e depois
```

## 7. GitHub Action

`action.yml` fica na raiz (`uses: EduardoxDev/Laudo@v0`) e roda em `node24`; o `node20` foi removido das Actions em 23/09/2026. O código está em `packages/action/` e vira um arquivo único com o esbuild (`dist/index.cjs`, sem minificar, versionado no git). O CI confere se o bundle está atualizado. A Action não usa `@actions/*`: lê as entradas de `INPUT_*`, grava em `GITHUB_OUTPUT` e `GITHUB_STEP_SUMMARY` e chama a API REST com `fetch`.

Três modos:

```
single   (pull_request)  analisa → grava laudo-report.json e laudo.sarif → resumo do job → comentário único → falha se bloqueado
analyze  (pull_request)  igual, sem comentário; o workflow sobe laudo-report.json como artefato
comment  (workflow_run)  baixa o artefato → valida → confere o PR na API → comentário único
```

- **Artefato** (`envelope.ts`): `{ artifactVersion: 1, pr: { number, headSha }, report }`. É validado com zod (`ReportSchema`), com tamanho máximo em todo texto e lista. O schema é conferido na compilação contra o tipo `Report`, para os dois nunca divergirem.
- **Por que conferir o PR:** no evento `pull_request`, o próprio workflow vem do PR, então um fork pode reescrever o artefato como quiser. O modo `comment` só comenta se (1) o `headSha` do artefato for o `workflow_run.head_sha` e (2) o PR indicado, lido na API, estiver nesse mesmo commit. Sem isso, um fork poderia publicar um laudo falso no PR de outra pessoa.
- **Comentário único** (`comment.ts`): procura um comentário com `<!-- laudo:report -->` **e** feito pelo `comment-author` (padrão `github-actions[bot]`); atualiza se achar, cria se não. Um humano que colar o marcador não tem o comentário editado.
- **Token só de leitura** (PR de fork no modo `single`): o 403 vira aviso, o laudo fica no resumo do job e o veredito continua valendo.
- O job que **executa o código do PR** nunca tem segredos nem token de escrita; o job que **escreve no PR** nunca faz checkout. Isso importa a partir da fatia 5, quando a mutação vai rodar os testes do PR.
- **SARIF** (`render/sarif.ts`): 2.1.0, com as regras do catálogo (`rules.ts`), `partialFingerprints` igual ao id do achado (o mesmo alerta entre pushes) e só achados com arquivo, porque o GitHub exige localização. O envio fica com `github/codeql-action/upload-sarif@v4` no workflow.

## 8. Segurança e privacidade

- Nenhum código é enviado para fora. As únicas chamadas de rede são ao registro do npm, e só com **nomes de pacote**.
- Os textos que vêm do PR (nomes de arquivo, trechos) são escapados no markdown para evitar injeção no comentário.
- O resumo com IA (versão futura) é opcional, usa a chave da própria pessoa e envia apenas o `Report`, não o código.
- A pipeline do próprio Laudo roda o Laudo nos seus PRs.

## 9. Desempenho

| Etapa | Meta (diff de ~500 linhas) |
|---|---|
| Coleta | < 1 s |
| test-integrity + risk-map | < 3 s (parse só dos arquivos alterados) |
| deps | < 2 s com cache; consultas em paralelo (máx. 8) |
| mutation | ≤ limite configurado (padrão 300 s), incremental |

## 10. Testes

- **Unitários** por regra: um par mínimo antes/depois → achados esperados.
- **Fixtures** (`fixtures/<caso>/`): cada caso é um mini-repositório git montado no teste (`antes/` → commit, `depois/` → commit). Roda o `runLaudo` e compara com `expected.json`.
- **Contrato** do registro: respostas gravadas do npm, para não depender da rede no CI.
- **Bench** (`bench/run.mjs`, `npm run bench`): clona (raso) os projetos de `bench/repos.json` e roda o Laudo em cada um dos últimos 10 commits da branch principal, cada um contra o anterior. Em projetos maduros, cada commit ali é um PR já revisado e mesclado, então um "bloqueado" é falso positivo até prova em contrário. O resultado vai para `bench/RESULTADOS.md`.
  - **Primeira rodada (27/10/2026, 50 PRs de ky, Hono, Fastify, Express e Zod):** 0 bloqueados e 15 revisar. Três eram ruído e foram corrigidos: documentação contando como zona sensível (`Migration-Guide-V5.md` virou "banco de dados") e `middleware` como zona de login (o `serve-static` do Hono).
  - **Segunda rodada:** 0 bloqueados, 38 aprovados e 12 revisar, todos justificáveis (workflows de release, `bearer-auth`, testes de fato removidos). Mediana de 0,7 s e p95 de 3,0 s por PR.
  - Ainda falta a outra metade: PRs reais feitos por agentes que enfraqueceram testes, para medir quanto o Laudo **pega**, e não só quanto ele **não incomoda**.

## 11. Ordem de construção

| Fatia | Entrega | Demo |
|---|---|---|
| 1 | Coleta + `test-integrity` (assert removido, skip/only, corpo vazio, tautologia) + saída no terminal | `npx laudo check` pega um assert apagado |
| 2 | `deps` com cache e nomes parecidos | Bloqueia `lodahs` |
| 3 | `risk-map` + renderizadores markdown e JSON | "Revise estas 46 linhas" |
| 4 | GitHub Action com comentário único e SARIF | PR de exemplo barrado em repositório público |
| 5 | `mutation` com Stryker | "Trocar `>` por `>=` não quebra nenhum teste" |
| 6 | Regras de CI/config + bench + README com GIF | Lançamento v0.1 |

Cada fatia termina com testes passando, fixture novo e o README atualizado.

## 12. Decisões em aberto

1. **Licença:** MIT (mais adoção) ou Apache-2.0 (proteção de patente). Sugestão: MIT.
2. **Nome no npm:** `laudo`, `laudo-cli` e `@laudo/cli` estavam livres em 26/10/2026. Vale registrar a organização `@laudo` logo.
3. **Idioma:** relatório em português e inglês desde a v0.1? Sugestão: inglês por padrão (alcance) e `--lang pt-BR`.
