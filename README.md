# Laudo

Verifica se dá para confiar nas mudanças feitas por agentes de IA. Ele não escreve código nem dá opinião: junta evidências e dá um veredito (✔ aprovado, ● revisar, ✖ bloqueado).

> Status: **fatia 4 de 6**. Já funcionam a integridade dos testes, a checagem de dependências novas, o mapa de risco e a GitHub Action, com comentário único no PR e SARIF. Veja a [especificação](docs/ESPECIFICACAO.md) e a [arquitetura](docs/ARQUITETURA.md).

```
✖ BLOQUEADO  3 problemas · 1 ponto para revisar

  ✖ Assert trocado por um que sempre passa em "soma preço vezes quantidade"
    test/cart.test.ts:7 · tests/tautology
    - expect(total([{ price: 10, qty: 2 }, { price: 11, qty: 2 }])).toBe(42)
    + expect(result).toBe(result)
```

## O que o Laudo detecta

### Testes enfraquecidos

| Regra | Nível |
|---|---|
| `tests/assertion-removed`: assert apagado sem substituto | Bloqueado |
| `tests/tautology`: assert que sempre passa (`expect(x).toBe(x)`, `assert(true)`) | Bloqueado |
| `tests/only-added`: `.only`, `fit`, `fdescribe` novos | Bloqueado |
| `tests/body-emptied`: corpo do teste esvaziado | Bloqueado |
| `tests/test-skipped`: `.skip`, `xit`, `todo`, `{ skip: true }` novos | Revisar |
| `tests/expected-changed`: valor esperado mudou (com ou sem mudança no código) | Revisar |
| `tests/assertion-weakened`: `toBe(42)` virou `toBeDefined()` | Revisar |
| `tests/assertions-reduced`: menos verificações que antes | Revisar |
| `tests/test-removed` e `tests/file-deleted`: testes ou arquivo apagados | Revisar |
| `tests/empty-test-added`: teste novo sem nada dentro | Revisar |

Entende Vitest, Jest, Mocha/Chai, Playwright e `node:test`. A comparação é feita pela estrutura do código (AST), então mudar a formatação, as aspas ou o nome de um teste não gera alarme.

### Dependências novas suspeitas

Para cada pacote **adicionado** a um `package.json`, o Laudo consulta o registro do npm e gera um achado só por pacote, com todos os sinais juntos:

| Regra | Nível |
|---|---|
| `deps/not-found`: o pacote não existe (a IA inventou o nome) | Bloqueado; com escopo (`@org/x`), Revisar, porque pode ser privado |
| `deps/version-not-found`: nenhuma versão publicada atende o que foi pedido | Bloqueado |
| `deps/typosquat`: nome quase igual ao de um pacote popular (`lodahs`, `axois`, `@bable/core`) | Bloqueado se também for novo, pouco baixado ou de versão inexistente; senão Revisar |
| `deps/install-script`: a versão instalada roda script na instalação | Revisar |
| `deps/new-package`: publicado há menos de 30 dias | Revisar |
| `deps/low-downloads`: menos de 100 downloads por semana | Revisar |
| `deps/registry-unavailable`: sem resposta do registro | Revisar (nunca bloqueia) |

Pacotes do próprio monorepo, `workspace:`, `file:` e dependências de git são pulados. Os nomes populares vêm do [npm-high-impact](https://github.com/wooorm/npm-high-impact) (~17 mil pacotes). As respostas do registro ficam em cache por 24 h; pacote inexistente, por 1 h. O cache fica em `%LOCALAPPDATA%\laudo\cache` no Windows e em `~/.cache/laudo` no Linux/macOS, ou onde `LAUDO_CACHE_DIR` mandar.

Configuração em `laudo.config.json`:

```json
{
  "deps": { "minAgeDays": 30, "minWeeklyDownloads": 100, "allow": ["@minha-org/*"], "registry": "https://registry.npmjs.org" }
}
```

### Mapa de risco: por onde revisar

```
Por onde revisar: 26 linhas em 5 arquivos · 10 linhas triviais escondidas (1 arquivo)
  1. src/payments/refund.ts  +12 −0  dinheiro e pagamentos
  2. .github/workflows/ci.yml  +7 −0  CI e deploy
  3. package.json  +1 −0  config
```

- **Zonas sensíveis** (`risk/sensitive-zone`, Revisar): login e permissões, criptografia, dinheiro e pagamentos, banco de dados e migrações, segredos e ambiente, CI e deploy. A zona é reconhecida pelo caminho (`src/payments/`, `.env`, `Dockerfile`) ou pelo conteúdo das linhas alteradas (`jwt.sign`, `process.env.*_SECRET`, `ALTER TABLE`, `$executeRaw`). Testes não contam. Dá para marcar zonas próprias em `risk.sensitive`.
- **Mudanças triviais**, escondidas do plano: só formatação ou comentários, só renomeação de variáveis locais, só a ordem dos imports, arquivo só movido, lockfile. A comparação é pelo AST. Renomear algo **exportado**, trocar o nome de uma propriedade ou adicionar um import **não** conta como trivial.
- **Ordem:** zonas sensíveis primeiro, depois código, CI, config, testes e o resto; dentro de cada grupo, o maior primeiro.

## GitHub Action

```yaml
# .github/workflows/laudo.yml
name: Laudo
on: pull_request
permissions:
  contents: read
  pull-requests: write # comentar no PR
  security-events: write # SARIF em "Code scanning"
jobs:
  laudo:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0 # o Laudo precisa do commit da base
      - uses: EduardoxDev/Laudo@v0
      - uses: github/codeql-action/upload-sarif@v4
        if: always() && hashFiles('laudo.sarif') != ''
        with:
          sarif_file: laudo.sarif
          category: laudo
```

A cada push no PR, o Laudo **atualiza o mesmo comentário** em vez de criar outro. O laudo também aparece no resumo do job, e os achados vão para a aba "Code scanning". O job falha quando o veredito é bloqueado (`fail-on` muda isso).

**PRs de fork:** neles o GitHub dá ao workflow um token só de leitura. O modo simples então mostra o laudo no resumo do job, mas não comenta. Para comentar também nesses PRs, use os dois workflows de [docs/exemplos/](docs/exemplos/):
- [`laudo-analise.yml`](docs/exemplos/laudo-analise.yml) roda no PR **sem** permissão de escrita e sem segredos, e guarda o relatório como artefato.
- [`laudo-comentario.yml`](docs/exemplos/laudo-comentario.yml) roda depois, com permissão de escrita, mas **nunca** baixa nem executa o código do PR. Ele valida o relatório e confere na API do GitHub que ele é mesmo do PR e do commit analisados. Só então comenta.

| Entrada | Padrão | O quê |
|---|---|---|
| `mode` | `single` | `single` (analisa e comenta), `analyze` (só analisa) ou `comment` (só comenta, em `workflow_run`) |
| `fail-on` | `failOn` da config (`block`) | `block`, `review` ou `never` |
| `base` | base do PR | ref ou sha da base, para rodar fora de PR |
| `comment` | `true` | no modo `single`, publica o comentário |
| `comment-author` | `github-actions[bot]` | só comentários desse autor são atualizados (troque se usar outro token) |
| `working-directory` | `.` | pasta do repositório |
| `report-path` / `sarif-path` | `laudo-report.json` / `laudo.sarif` | onde gravar os arquivos |

Saídas: `verdict` (`pass`, `review` ou `block`), `findings`, `report-path` e `sarif-path`.

## Como usar a CLI

```bash
npm install
npm run build
node packages/cli/dist/index.js check -C <pasta-do-repositorio>
```

Opções do `laudo check`:

- `--base <ref>`: ref da base. O padrão é `origin/main`, `origin/master`, `main` ou `master`.
- `--worktree`: inclui mudanças não commitadas.
- `--format markdown`: comentário pronto para PR. O que vem do diff é escapado, então não vira HTML, link nem menção a `@alguém`. O texto respeita o limite de tamanho do GitHub e termina com o marcador `<!-- laudo:report -->`.
- `--format json`: o relatório completo, com `schemaVersion: 1`.
- `--format sarif`: SARIF 2.1.0, para outras ferramentas de code scanning.
- `--fail-on block|review|never`: a partir de qual veredito o comando falha.

Códigos de saída: `0` aprovado · `1` revisar · `2` bloqueado · `3` erro do Laudo. Por padrão, só o bloqueado falha.

## Desenvolvimento

```bash
npm test            # unitários + corpo de PRs em fixtures/
npm run typecheck
```

Mudou algo que a Action usa? Rode `node packages/action/build.mjs` e commite `packages/action/dist/`. O CI confere se o bundle está atualizado.

Cada caso em `fixtures/` vira um repositório git temporário com dois commits. O resultado é comparado com `fixtures/cases.json`. Toda regra nova entra com o seu caso.
