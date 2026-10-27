<p align="center"><img src="docs/lupa.svg" alt="Laudo: a Lupa, uma lupa em pixel art com olhos, examina o diff e dá o veredito: aprovado, revisar ou bloqueado" width="760"></p>

<p align="center">
<a href="https://github.com/EduardoxDev/Laudo/actions/workflows/ci.yml"><img src="https://github.com/EduardoxDev/Laudo/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
<a href="CHANGELOG.md"><img src="https://img.shields.io/badge/vers%C3%A3o-0.2.0-informational" alt="versão 0.2.0"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/licen%C3%A7a-MIT-blue.svg" alt="Licença: MIT"></a>
<img src="https://img.shields.io/badge/node-%E2%89%A520.19-339933" alt="Node 20.19 ou mais novo">
</p>

# Laudo

**Seu agente de IA deixou os testes verdes. O Laudo confere se ele não trapaceou para isso.**

O Laudo lê o diff de um PR e responde a uma pergunta só: *dá para confiar nesta mudança?* Ele não escreve código nem dá opinião sobre estilo. Ele junta evidências e dá um veredito: ✔ aprovado, ● revisar ou ✖ bloqueado.

Desde a v0.2 ele também lê **a sessão do agente** (Claude Code) e confere o que a IA *fez*, não só o que ela entregou. Ele vê se os testes rodaram depois da última mudança, se passaram e se o agente mexeu só no teste logo depois de ele falhar.

<p align="center"><img src="docs/demo.svg" alt="O Laudo bloqueando um PR: o agente trocou um assert por um que sempre passa, adicionou um pacote com nome parecido com lodash e, na sessão, mexeu só no teste depois de ele falhar" width="760"></p>

> **Novo na v0.2:** interface nova no terminal, leitura da sessão do agente (`--agent`), arquivos gerados fora do plano de revisão e os comandos `laudo init`, `laudo rules` e `laudo explain`. Veja o [CHANGELOG](CHANGELOG.md).

## Por que existe

Gerar código com agentes ficou barato. Confiar nele, não:

- **66%** dos devs dizem que o maior incômodo com IA é código "quase certo", e **46%** desconfiam da precisão dela (Stack Overflow Developer Survey 2025).
- Times com muita IA abrem **98% mais PRs**, e o tempo de revisão sobe **91%** (Faros/DORA). A revisão virou o gargalo.
- Agentes já foram pegos **apagando asserts, pulando testes e escrevendo testes que sempre passam** para deixar a suíte verde (benchmark EvilGenie, relatos com Codex, Claude Code e Gemini CLI).
- A IA **inventa nomes de pacote**, e atacantes registram esses nomes no npm com código malicioso (*slopsquatting*).

Revisores com IA respondem a isso com mais comentários, e com 15% a 22% de falsos positivos. O Laudo vai pelo outro lado: **regras determinísticas, pouco ruído, um comentário só**.

## Conheça a Lupa

A Lupa é a mascote do Laudo: uma lupa em pixel art de 20 × 16, com aro prateado em três tons, vidro azul em degradê com reflexo, olhos com brilho, bochechas rosadas e cabo de madeira com anel dourado. Ela aparece no cabeçalho de todo laudo, desenhada no próprio terminal com meio-blocos coloridos (`▀▄`, cada caractere mostra dois pixels). Muda de cara conforme o veredito e diz em uma frase o que achou.

| Cara | Quando |
|---|---|
| feliz, de olhos fechados e boca aberta | **aprovado**: nada suspeito |
| desconfiada, de pálpebras baixas | **revisar**: algo merece um olhar humano |
| brava, de sobrancelhas franzidas | **bloqueado**: trapaça nos testes, CI afrouxado, pacote suspeito |
| simpática | em `laudo --help`, `laudo init` e `laudo doctor` |

Enquanto analisa, ela olha de um lado para o outro no indicador de progresso. Num terminal sem cor ela vira uma lupa em texto, e `--no-mascot` a esconde. A frase é escolhida por regra, pelo veredito e pelo achado mais grave, como todo o resto do Laudo: nenhuma IA envolvida. O logo lá em cima sai dos mesmos pixels (`node scripts/lupa-svg.mjs`).

## A prova

- **[PR #1](https://github.com/EduardoxDev/Laudo/pull/1):** um "agente" enfraqueceu três testes do próprio Laudo. **O CI ficou verde** (os testes passam) e **o Laudo bloqueou**, apontando cada trapaça com arquivo, linha e o antes/depois.
- **[Bench em 50 PRs reais](bench/RESULTADOS.md)** de ky, Hono, Fastify, Express e Zod, todos já revisados e mesclados: **0 bloqueados**, 38 aprovados e 12 "revisar", todos justificáveis (mudanças em workflows de release, autenticação e testes realmente removidos). Tempo mediano de **0,4 s** por PR.
- **O Laudo revisou a própria v0.2**, lendo a sessão do Claude Code que a construiu (`laudo check --worktree --agent`). No meio do trabalho ele pegou três coisas reais: o agente mudou 12 arquivos sem rodar os testes, um arquivo novo chamado `session.ts` foi confundido com código de login (o arquivo virou `transcript.ts`) e o bundle da Action, grande demais para ler, ainda aparecia em 1º no plano de revisão (bug corrigido, com teste). Na rodada da Lupa e da infraestrutura, ele apontou que o agente mexeu só em testes logo depois de eles falharem. Era verdade, e os testes é que estavam errados, mas é exatamente o que um humano deve confirmar. Também apareceram dois ruídos do próprio Laudo, ambos corrigidos: uma suíte rodada por `npm run check` não era reconhecida (agora ele reconhece pela saída) e modelos de issue contavam como "CI e deploy".
- **Corpo de 26 PRs de exemplo** em [`fixtures/`](fixtures/cases.json), um para cada truque e para as mudanças limpas que **não** podem gerar alarme. Cada caso roda num repositório git de verdade, a cada `npm test`.

## O que ele verifica

| Analisador | Pega | Exemplo |
|---|---|---|
| **Testes** | assert apagado, tautologia, `.only`, `.skip`, teste esvaziado, valor esperado ajustado, assert enfraquecido | `toBe(42)` → `toBeDefined()` |
| **CI e config** | falha ignorada, passo de testes removido, script `test` esvaziado, cobertura reduzida | `npm test \|\| true` |
| **Dependências** | pacote inexistente, versão inexistente, nome parecido com pacote popular, pacote recém-criado, script de instalação | `lodahs`, `axois` |
| **Mapa de risco** | ordena a revisão (pagamentos, login e CI primeiro) e esconde o que é só formatação ou renomeação | "revise estas 46 linhas, pule estas 300" |
| **Mutação** (opcional) | insere bugs de propósito **só nas linhas alteradas** e vê se algum teste percebe | "trocar `>` por `>=` não quebra nenhum teste" |
| **Sessão do agente** (opcional, novo) | lê o que o Claude Code fez: testes que não rodaram depois da última mudança, última execução falhando, teste mexido logo depois de falhar | "`npm test` falhou → o agente editou só o teste → passou" |

A comparação de código é feita pela estrutura (AST), não pelo texto. Reformatar, trocar aspas ou renomear uma variável local não gera alarme.

## Começar

### GitHub Action

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

<details><summary>Entradas e saídas da Action</summary>

| Entrada | Padrão | O quê |
|---|---|---|
| `mode` | `single` | `single` (analisa e comenta), `analyze` (só analisa) ou `comment` (só comenta, em `workflow_run`) |
| `fail-on` | `failOn` da config (`block`) | `block`, `review` ou `never` |
| `base` | base do PR | ref ou sha da base, para rodar fora de PR |
| `comment` | `true` | no modo `single`, publica o comentário |
| `mutate` | `false` | roda os testes de mutação (precisa de `npm ci` antes) |
| `comment-author` | `github-actions[bot]` | só comentários desse autor são atualizados (troque se usar outro token) |
| `working-directory` | `.` | pasta do repositório |
| `report-path` / `sarif-path` | `laudo-report.json` / `laudo.sarif` | onde gravar os arquivos |

Saídas: `verdict` (`pass`, `review` ou `block`), `findings`, `report-path` e `sarif-path`.

</details>

### CLI

O Laudo ainda não está publicado no npm. Por enquanto, rode a partir do código:

```bash
git clone https://github.com/EduardoxDev/Laudo.git && cd Laudo
npm install && npm run build
node packages/cli/dist/index.js check -C <pasta-do-seu-repositório>
```

O uso mais comum é logo depois de o agente terminar, ainda sem commit:

```bash
laudo check --worktree --agent
```

| Comando | O quê |
|---|---|
| `laudo check` (padrão) | analisa o diff e dá o veredito |
| `laudo init` | cria o `laudo.config.json`, o workflow do GitHub e põe `.laudo/` no `.gitignore` (nunca sobrescreve) |
| `laudo rules` | lista todas as regras, por área |
| `laudo explain <regra>` | explica uma regra e o que fazer (`laudo explain tautology`) |
| `laudo doctor` | confere o ambiente: Node, git, base, config, registro do npm, Stryker e sessão do agente |

| Opção do `check` | O quê |
|---|---|
| `--base <ref>` | base da comparação (padrão: `origin/main`, `origin/master`, `main` ou `master`) |
| `--worktree` | inclui mudanças não commitadas, útil logo depois de o agente terminar |
| `--agent [sessão]` | lê a sessão do Claude Code que fez a mudança: a mais recente desta pasta, ou o `.jsonl` indicado |
| `--mutate` | roda os testes de mutação nas linhas alteradas |
| `--verbose` | mostra o plano de revisão inteiro e as mudanças triviais |
| `--no-mascot` | esconde a Lupa do cabeçalho (ela também some sozinha em terminal estreito) |
| `--format terminal\|markdown\|json\|sarif` | `markdown` é o comentário de PR; `json` tem `schemaVersion: 1`; `sarif` é o SARIF 2.1.0 |
| `--fail-on block\|review\|never` | a partir de qual veredito o comando falha |

Códigos de saída: `0` aprovado · `1` revisar · `2` bloqueado · `3` erro do Laudo. Por padrão, só o bloqueado falha.

## As regras

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

Entende Vitest, Jest, Mocha/Chai, Playwright e `node:test`.

### CI e config

| Regra | Nível |
|---|---|
| `ci/failure-ignored`: `continue-on-error: true`, `\|\| true`, `\|\| exit 0`, `set +e` e `if: false` novos no CI ou num script | Bloqueado (`--passWithNoTests`: Revisar) |
| `ci/tests-not-run`: o passo que rodava os testes saiu do CI, ou o script `test` virou `echo` | Bloqueado |
| `ci/coverage-lowered`: limite de cobertura reduzido, removido ou desligado (Vitest, Jest, nyc, c8) | Bloqueado |

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

### Mapa de risco

- **Zonas sensíveis** (`risk/sensitive-zone`, Revisar): login e permissões, criptografia, dinheiro e pagamentos, banco de dados e migrações, segredos e ambiente, CI e deploy. A zona é reconhecida pelo caminho (`src/payments/`, `.env`, `Dockerfile`) ou pelo conteúdo das linhas alteradas (`jwt.sign`, `process.env.*_SECRET`, `ALTER TABLE`, `$executeRaw`). Testes e documentação não contam. Dá para marcar zonas próprias em `risk.sensitive`.
- **Mudanças triviais**, escondidas do plano: só formatação ou comentários, só renomeação de variáveis locais, só a ordem dos imports, arquivo só movido, lockfile e **arquivo gerado** (marcado `linguist-generated` no `.gitattributes`, com cabeçalho `@generated`/`DO NOT EDIT`, `.min.js` ou `.map`). Renomear algo **exportado**, trocar o nome de uma propriedade ou adicionar um import **não** conta como trivial.

### Testes de mutação nas linhas alteradas (`--mutate`)

Um teste que passa não prova nada se ele também passaria com o código errado. Com `--mutate`, o Laudo usa o [Stryker](https://stryker-mutator.io) para inserir bugs de propósito **só nas linhas que o diff alterou**, como trocar `>=` por `>`, `&&` por `||` ou uma condição por `true`. Depois roda os testes.

```
Mutação: 1 de 16 mutantes pegos nas linhas alteradas (6%)

  ● Os testes não pegam bugs nas linhas alteradas de src/cart.js (15 mutantes escaparam)
    · linha 6: trocar `code === 'METADE' && value >= 100` por `true` não quebra nenhum teste
    · linha 7: nenhum teste passa por aqui
```

- Abaixo de `mutation.minScore` (50%), o Laudo pede revisão. Com 0% num PR que também mexeu nos testes, ele bloqueia (`mutation/survived`).
- Usa o **Stryker do próprio projeto**, para que o executor de testes seja o mesmo. Instale `@stryker-mutator/core` e o runner do seu executor (`@stryker-mutator/vitest-runner`, `jest-runner` ou `mocha-runner`); sem runner, o Laudo usa `npm test`. O Stryker 10 pede Node 22; o 9 roda no Node 20.
- Roda em modo incremental, com o cache em `.laudo/` (coloque no `.gitignore`). Se passar de `mutation.timeoutSeconds` (300 s), a mutação é interrompida e não conta no veredito.
- Desligada por padrão: a mutação roda os testes do PR. Na Action, ligue-a só onde o código do PR pode rodar.

### Sessão do agente (`--agent`)

O diff mostra o que o agente entregou. A sessão mostra **como** ele chegou lá. Com `--agent`, o Laudo procura em `~/.claude/projects/` a transcrição mais recente do Claude Code que mexeu neste repositório, inclusive aberta numa pasta acima, e fica só com o que aconteceu depois do commit da base. Ele usa só dois tipos de evento: arquivos editados e execuções dos testes, que passaram ou falharam.

| Regra | Nível |
|---|---|
| `agent/test-edited-after-failure`: o teste falhou, o agente mexeu **só** no teste (nenhum código) e rodou de novo | Revisar |
| `agent/tests-not-run`: código ou teste mudou depois da última execução da suíte, ou ela nunca rodou | Revisar |
| `agent/last-test-failed`: a última execução dos testes falhou e o agente parou ali | Revisar |

O laudo também resume a sessão: o pedido, quantas edições, quantas vezes os testes rodaram e quantos arquivos do diff mudaram sem edição direta do agente. A transcrição é lida na sua máquina e nada sai dela. Mudanças feitas por comandos de terminal (`sed`, um build) não aparecem como edição. Por enquanto, só o Claude Code; Codex e outros agentes estão nos próximos passos.

### Configuração (`laudo.config.json`, opcional)

```json
{
  "failOn": "block",
  "tests": { "patterns": ["e2e/**"] },
  "deps": { "minAgeDays": 30, "minWeeklyDownloads": 100, "allow": ["@minha-org/*"] },
  "risk": { "sensitive": ["src/pricing/**"] },
  "mutation": { "enabled": false, "timeoutSeconds": 300, "minScore": 50 },
  "ignore": ["**/*.generated.ts"]
}
```

## Como funciona

O núcleo é uma função pura no meio: recebe o diff (com o conteúdo antes e depois de cada arquivo) e devolve um relatório. Git, registro do npm, Stryker e GitHub ficam atrás de interfaces, por isso tudo é testável sem rede. Os detalhes estão na [arquitetura](docs/ARQUITETURA.md); o escopo e as decisões, na [especificação](docs/ESPECIFICACAO.md).

- **Determinístico:** nenhuma IA decide o veredito.
- **Privado:** nenhum código sai da máquina; o registro do npm só recebe nomes de pacote.
- **Seguro como comentário de PR:** tudo o que vem do diff é escapado. Nomes de arquivo, teste e pacote não viram HTML, link nem menção a `@alguém`.

## Desenvolvimento

```bash
npm install
npm test             # unitários + corpo de PRs em fixtures/
npm run typecheck
npm run bench        # Laudo em 50 PRs reais (clona os projetos; precisa de rede)
npm run demo         # gera docs/demo.svg a partir da saída real
npm run bundle       # gera o arquivo da Action (packages/action/dist/), que vai no git
```

Cada caso em `fixtures/` vira um repositório git temporário com dois commits, e o resultado é comparado com `fixtures/cases.json`. Toda regra nova entra com o seu caso, e um teste garante que toda regra do código está no [catálogo](packages/core/src/rules.ts).

## Próximos passos

- Ler também as sessões do Codex e do Gemini CLI, e comparar **o que foi pedido** com o que mudou (arquivos fora do escopo).
- Perguntas de entendimento ao autor antes do merge, contra a "dívida de compreensão".
- Python (pytest e PyPI) e publicação no npm.

## Licença

[MIT](LICENSE) © Eduardo Maciel Wanka
