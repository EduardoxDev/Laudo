# @laudo/cli

**Seu agente de IA deixou os testes verdes. O Laudo confere se ele não trapaceou para isso.**

<p align="center"><img src="https://raw.githubusercontent.com/EduardoxDev/Laudo/main/docs/lupa.svg" alt="A Lupa, mascote do Laudo, em pixel art" width="560"></p>

O Laudo lê o diff e dá um veredito (aprovado, revisar ou bloqueado), com regras determinísticas. Ele pega teste enfraquecido, CI afrouxado e pacote inventado ou com nome parecido com um popular. Também ordena a revisão por risco e, com `--agent`, lê a sessão do Claude Code para conferir o que a IA fez.

```bash
laudo check --worktree --agent   # logo depois de o agente terminar
laudo doctor                     # confere o ambiente
laudo init                       # config + workflow do GitHub
laudo rules                      # todas as regras
laudo explain tautology          # o que uma regra pega e o que fazer
```

Códigos de saída: `0` aprovado · `1` revisar · `2` bloqueado · `3` erro do Laudo (por padrão, só o bloqueado falha).

Documentação completa, GitHub Action e as regras: <https://github.com/EduardoxDev/Laudo#readme>

MIT © Eduardo Maciel Wanka
