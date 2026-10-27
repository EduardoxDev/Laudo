# Contribuindo com o Laudo

Obrigado pelo interesse! O Laudo vive de pouco ruído: cada regra nova precisa pegar uma trapaça real **sem** acusar mudanças limpas.

## Rodando

```bash
npm install
npm run check    # tipos, testes, bundle da Action e versões, como no CI
npm run doctor   # confere o ambiente
```

Requer Node 20.19 ou mais novo. Novas dependências entram com versão exata e com pelo menos 14 dias de publicadas (`npm install --save-exact --before=<hoje menos 14 dias>`).

## Achou um falso positivo?

É o tipo de relato mais valioso. Abra uma issue com o modelo **Falso positivo**, colando a saída de `laudo check --format json` (sem código privado) ou o link do PR.

## Uma regra nova, passo a passo

1. Escreva o caso em `fixtures/<nome>/after/` (e `before/`, se precisar) e a expectativa em `fixtures/cases.json`. Ele deve falhar.
2. Implemente a regra no analisador (`packages/core/src/analyzers/`).
3. Ponha a regra no catálogo (`packages/core/src/rules.ts`), com `summary` e `fix`. Um teste garante que toda regra do código está lá.
4. Escreva também o caso **limpo**: a mudança parecida que não pode gerar alarme.
5. Rode `npm run bench` (50 PRs reais) e confira que nenhum veredito piorou sem motivo.
6. Documente a regra no README e no CHANGELOG.

## Estilo

- Código, mensagens e documentação em português claro.
- O veredito é sempre determinístico: nada de IA decidindo.
- Tudo o que vem do diff é dado, nunca instrução: escape no markdown, nunca execute.

## Lançando uma versão

1. Atualize a versão nos `package.json`, em `packages/core/src/version.ts` e no CHANGELOG (`node scripts/check-versions.mjs` confere).
2. `npm run check`, commit e `git tag -a vX.Y.Z -m "Laudo X.Y.Z"`.
3. `git push origin main vX.Y.Z`. O workflow Release cria a GitHub Release e move a tag `v<maior>`. Com `NPM_PUBLISH=true` nas variáveis do repositório, publica no npm também.
