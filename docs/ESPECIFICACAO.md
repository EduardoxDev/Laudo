# Laudo — Especificação do MVP

> Versão 0.1 · 26/10/2026 · Status: rascunho para começar a construir

## 1. Problema

Gerar código com agentes de IA ficou barato. Confiar nele, não.

- 66% dos devs dizem que o maior incômodo é código de IA "quase certo"; 46% desconfiam da precisão da IA (Stack Overflow 2025).
- Times com muita IA abrem 98% mais PRs, e o tempo de revisão sobe 91% (Faros/DORA).
- Agentes já foram pegos apagando asserts, pulando testes e escrevendo testes que sempre passam (EvilGenie, relatos de Codex, Claude Code e Gemini CLI).
- A IA inventa nomes de pacotes em 5% a 20% das amostras, e atacantes registram esses nomes no npm e no PyPI (slopsquatting).

Revisores com IA (CodeRabbit, Greptile) **acrescentam comentários**, com 15% a 22% de falsos positivos. Os detectores que existem (tamperguard, tampercheck) cobrem uma parte só e estão no começo.

## 2. Proposta

O **Laudo** responde a uma pergunta só: **"posso dar merge no que o agente fez?"**

Ele não escreve código nem opina sobre estilo. Ele **junta evidências** e entrega um veredito com motivo:

- ✅ **Aprovado**: nada suspeito.
- 🟡 **Revisar**: há pontos que pedem olho humano, e o laudo diz onde.
- 🔴 **Bloqueado**: há evidência forte de problema (teste esvaziado, pacote inexistente).

### Princípios

1. **Determinístico primeiro.** Toda conclusão vem de uma regra que pode ser reproduzida. A IA, se ligada, só escreve o resumo; ela nunca decide o veredito.
2. **Pouco ruído.** É melhor deixar passar um caso duvidoso do que bloquear à toa. A meta de precisão no nível "Bloqueado" é de 95% ou mais.
3. **Um comentário só.** No PR, o Laudo mantém um único comentário e o atualiza a cada push.
4. **Sempre com evidência.** Cada achado mostra o arquivo, a linha, o antes e o depois.
5. **Local e privado.** Funciona offline (exceto a consulta ao registro de pacotes). Nenhum código sai da máquina sem que a pessoa ative isso.

## 3. Público

- **Principal:** dev ou time pequeno que usa Claude Code, Codex, Cursor ou Copilot Agent e revisa PRs gerados por eles.
- **Secundário:** quem mantém projeto open source e recebe PRs feitos por IA.

## 4. Escopo do MVP (v0.1)

**Linguagem alvo:** projetos JavaScript/TypeScript com npm/pnpm/yarn e testes em Vitest, Jest ou Mocha.

### 4.1 Integridade dos testes — `test-integrity`

Compara os arquivos de teste antes e depois do diff, olhando a estrutura do código (AST), e não o texto.

| Regra | Exemplo | Nível |
|---|---|---|
| Assert removido sem substituto | `expect(total).toBe(42)` sumiu | Bloqueado |
| Teste pulado ou focado | `.skip`, `xit`, `.only`, `test.todo` novo | Bloqueado (`.only`) / Revisar |
| Corpo do teste esvaziado | `it('calcula', () => {})` | Bloqueado |
| Assert tautológico | `expect(x).toBe(x)`, `expect(true).toBe(true)` | Bloqueado |
| Valor esperado trocado no mesmo PR que mudou a lógica | `toBe(42)` virou `toBe(41)` | Revisar |
| Arquivo de teste apagado | `soma.test.ts` removido | Revisar |
| Snapshot reescrito em massa | mais de N snapshots mudaram | Revisar |
| Limite de cobertura reduzido | `thresholds.lines: 80 → 60` | Bloqueado |
| CI amolecido | `continue-on-error: true`, `\|\| true`, job de teste removido | Bloqueado |

### 4.2 Dependências novas — `deps`

Para cada pacote **adicionado** ao `package.json` (ou que apareceu no lockfile como dependência direta):

| Checagem | Nível |
|---|---|
| Pacote não existe no registro | Bloqueado (com escopo: Revisar, pode ser privado) |
| Nome parecido com um pacote popular (distância pequena, ex.: `lodahs`) | Bloqueado se também for novo, pouco baixado ou de versão inexistente; senão Revisar |
| Publicado há menos de 30 dias | Revisar |
| Menos de 100 downloads por semana | Revisar |
| Tem script `postinstall`/`preinstall` | Revisar |
| Versão fixada que não existe | Bloqueado |

### 4.3 Mapa de risco — `risk-map`

Organiza o diff para a revisão humana:

- **Zonas sensíveis**, por caminho e conteúdo: login/autenticação, criptografia, dinheiro, migrações de banco, variáveis de ambiente/segredos, CI, permissões. Elas sobem para o topo.
- **Mudanças triviais**, escondidas por padrão: só renomeação, só formatação, só imports (detectadas comparando o AST normalizado).
- Saída: "Revise primeiro estas **N linhas** em **K arquivos**; **M linhas** são triviais."

### 4.4 Testes de mutação nas linhas alteradas — `mutation` (opcional, `--mutate`)

O que mais diferencia o Laudo.

1. Pega as linhas de código-fonte (não de teste) que o diff alterou.
2. Roda o Stryker **só nesses intervalos** (`arquivo.ts:10-24`).
3. Cada mutante que sobrevive (o código foi estragado de propósito e os testes continuaram passando) vira um achado: _"Se a linha 18 trocar `>` por `>=`, nenhum teste falha."_
4. Pontuação: % de mutantes mortos nas linhas alteradas.
   - Abaixo de 50%: **Revisar** ("os testes não provam esta mudança").
   - 0% com testes alterados no mesmo PR: **Bloqueado**.

Limite de tempo configurável (padrão: 5 minutos). Se estourar, o Laudo informa e não bloqueia.

### 4.5 Saídas

- **Terminal**: resumo colorido e veredito.
- **Markdown**: o comentário do PR (template na seção 7).
- **JSON**: para integrar com outras ferramentas.
- **SARIF 2.1.0**: aparece na aba "Code scanning" do GitHub.
- **Código de saída**: `0` aprovado · `1` revisar · `2` bloqueado (o que falha o CI é configurável).

### 4.6 Formas de uso

```bash
npx laudo check                      # diff contra origin/main
npx laudo check --base main --mutate
npx laudo check --format sarif > laudo.sarif
npx laudo init                       # cria laudo.config.json e o workflow do GitHub
```

GitHub Action: `uses: <org>/laudo-action@v0` → roda no `pull_request` e publica o comentário único.

## 5. Fora do MVP (próximas versões)

| Versão | Recurso |
|---|---|
| v0.2 ✔ | **Sessão do agente** (entregue): lê a transcrição do Claude Code e confere se os testes rodaram depois da última mudança, se passaram e se o agente mexeu só no teste depois de ele falhar |
| v0.3 | **Pedido × diff:** leitura das sessões do Codex; compara o que foi pedido com os arquivos tocados e aponta mudanças fora do escopo |
| v0.3 | Rastro de origem: trailer `Laudo-Session:` no commit, ligando ao resumo da sessão |
| v0.3 | **Checagem de entendimento:** 2 ou 3 perguntas ao autor antes do merge (com IA, opcional) |
| v0.3 | Python (pytest, PyPI) |
| v0.4 | Painel web com histórico por repositório: PRs barrados, tempo de revisão, agentes mais "trapaceiros" |
| — | Resumo em linguagem natural com IA (opcional, chave da própria pessoa) |

## 6. Configuração — `laudo.config.json`

```json
{
  "base": "origin/main",
  "failOn": "block",
  "tests": { "patterns": ["**/*.test.ts", "**/*.spec.ts", "test/**"] },
  "deps": { "minAgeDays": 30, "minWeeklyDownloads": 100, "allow": ["@minha-org/*"] },
  "risk": { "sensitive": ["src/auth/**", "src/payments/**", "migrations/**"] },
  "mutation": { "enabled": false, "timeoutSeconds": 300, "minScore": 50 },
  "ignore": ["dist/**", "**/*.generated.ts"]
}
```

## 7. Modelo do comentário no PR

```markdown
## 🔴 Laudo: bloqueado (2 problemas, 3 pontos para revisar)

**Por onde revisar:** 46 linhas em 3 arquivos · 312 linhas triviais escondidas

### 🔴 Bloqueado
- **Assert removido** em `src/cart.test.ts:31`: `expect(total).toBe(42)` saiu e nada entrou no lugar.
- **Pacote inexistente**: `react-form-validatorz` não existe no npm (parecido com `react-form-validator`).

### 🟡 Revisar
- **Mutação:** 3 de 8 mutantes sobreviveram em `src/cart.ts:12-30`. Ex.: trocar `>` por `>=` na linha 18 não quebra nenhum teste.
- **Zona sensível:** `src/payments/refund.ts` (+22 −4).
- **Pacote novo** `tiny-date-x`: publicado há 6 dias, 41 downloads/semana.

<details><summary>Detalhes e evidências</summary> … </details>

<sub>Laudo v0.1 · 4,2 s · regras determinísticas · <a>como funciona</a></sub>
```

## 8. Critérios de aceite do MVP

1. `npx laudo check` roda num repositório TS sem configuração nenhuma e termina em menos de **15 s** sem mutação (repositório com ~50k linhas, diff de ~500 linhas).
2. Detecta todos os casos do **corpo de PRs trapaceiros** (seção 9) no nível certo.
3. Em 50 PRs reais e limpos de projetos open source, **zero** bloqueios indevidos.
4. A Action publica e **atualiza** um único comentário (não cria um novo a cada push).
5. Funciona em PRs vindos de forks sem expor segredos (ver Arquitetura, seção 8).
6. O modo `--mutate` respeita o limite de tempo e nunca bloqueia quando estoura.
7. README com GIF de demonstração e um PR de exemplo barrado num repositório público.

## 9. Corpo de testes ("PRs trapaceiros")

Uma pasta `fixtures/` com mini-repositórios, cada um com o par `antes/` e `depois/` e o laudo esperado (`expected.json`):

- assert removido · assert tautológico · `.skip` · `.only` · corpo esvaziado
- valor esperado alterado · snapshot reescrito · limite de cobertura reduzido
- `continue-on-error` no CI · `|| true` no script de teste
- pacote inexistente · pacote com nome parecido · pacote novo com `postinstall`
- PR limpo de refatoração (deve **passar**) · PR só de formatação (deve **passar**)

Esse corpo vira também o **benchmark público** do projeto.

## 10. Métricas de sucesso (portfólio e uso)

- Precisão no nível "Bloqueado" ≥ 95% no benchmark.
- Tempo mediano ≤ 10 s sem mutação.
- Post técnico: _"Rodei o Laudo em N PRs públicos feitos por agentes: X% tinham testes enfraquecidos"_. Isso transforma o projeto em pesquisa citável.
- Meta de 3 meses: 3 repositórios externos usando a Action.

## 11. Riscos

| Risco | Mitigação |
|---|---|
| Falsos positivos queimam a confiança | Níveis conservadores; benchmark com PRs limpos; `// laudo-ignore` com motivo obrigatório |
| Mutação lenta | Só nas linhas alteradas, modo incremental do Stryker e limite de tempo |
| Registro do npm fora do ar ou com limite | Cache local de 24 h; se falhar, vira "Revisar", nunca "Bloqueado" |
| Executar código de PR de fork | A Action separa o job que analisa (sem segredos) do job que comenta |
| Concorrentes copiam | O diferencial é o conjunto mais o benchmark aberto; publicar cedo |
