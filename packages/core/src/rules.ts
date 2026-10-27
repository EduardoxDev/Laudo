/** Catálogo de todas as regras: usado no SARIF e para explicar cada achado. */
export interface RuleInfo {
  /** Nível mais grave que a regra pode dar. */
  maxLevel: 'block' | 'review';
  summary: string;
}

export const RULES = {
  'tests/assertion-removed': { maxLevel: 'block', summary: 'Um assert foi apagado e nada entrou no lugar.' },
  'tests/tautology': { maxLevel: 'block', summary: 'Um assert novo sempre passa, porque compara um valor com ele mesmo ou com uma constante.' },
  'tests/only-added': { maxLevel: 'block', summary: 'Um .only novo faz o resto da suíte parar de rodar.' },
  'tests/body-emptied': { maxLevel: 'block', summary: 'O corpo de um teste foi esvaziado.' },
  'tests/test-skipped': { maxLevel: 'review', summary: 'Um teste ou bloco foi desativado (skip ou todo).' },
  'tests/expected-changed': { maxLevel: 'review', summary: 'O valor esperado de um assert mudou.' },
  'tests/assertion-weakened': { maxLevel: 'review', summary: 'Um assert passou a só conferir que existe um valor, sem conferir qual.' },
  'tests/assertions-reduced': { maxLevel: 'review', summary: 'Um teste ficou com menos verificações que antes.' },
  'tests/test-removed': { maxLevel: 'review', summary: 'Testes foram removidos do arquivo.' },
  'tests/file-deleted': { maxLevel: 'review', summary: 'Um arquivo de teste foi apagado.' },
  'tests/empty-test-added': { maxLevel: 'review', summary: 'Um teste novo não tem nada dentro.' },
  'deps/not-found': { maxLevel: 'block', summary: 'O pacote não existe no registro; a IA pode ter inventado o nome.' },
  'deps/version-not-found': { maxLevel: 'block', summary: 'Nenhuma versão publicada atende o que foi pedido.' },
  'deps/typosquat': { maxLevel: 'block', summary: 'O nome é quase igual ao de um pacote popular.' },
  'deps/install-script': { maxLevel: 'review', summary: 'O pacote roda um script durante a instalação.' },
  'deps/new-package': { maxLevel: 'review', summary: 'O pacote foi publicado há pouco tempo.' },
  'deps/low-downloads': { maxLevel: 'review', summary: 'O pacote tem poucos downloads por semana.' },
  'deps/registry-unavailable': { maxLevel: 'review', summary: 'Não deu para consultar o pacote no registro.' },
  'risk/sensitive-zone': { maxLevel: 'review', summary: 'A mudança toca uma zona sensível (login, dinheiro, banco, segredos, CI).' },
  'mutation/survived': {
    maxLevel: 'block',
    summary: 'Bugs inseridos de propósito nas linhas alteradas não fazem nenhum teste falhar: os testes não provam esta mudança.',
  },
} as const satisfies Record<string, RuleInfo>;

export type RuleId = keyof typeof RULES;

export const RULES_URL = 'https://github.com/EduardoxDev/Laudo#o-que-o-laudo-detecta';
