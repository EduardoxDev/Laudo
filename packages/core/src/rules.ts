/** Catálogo de todas as regras: usado no SARIF, em `laudo rules` e para explicar cada achado. */
export interface RuleInfo {
  /** Nível mais grave que a regra pode dar. */
  maxLevel: 'block' | 'review';
  summary: string;
  /** O que fazer quando a regra aparece. */
  fix: string;
}

export const RULES = {
  'tests/assertion-removed': {
    maxLevel: 'block',
    summary: 'Um assert foi apagado e nada entrou no lugar.',
    fix: 'Se o comportamento mudou, ajuste o valor esperado em vez de apagar a verificação.',
  },
  'tests/tautology': {
    maxLevel: 'block',
    summary: 'Um assert novo sempre passa, porque compara um valor com ele mesmo ou com uma constante.',
    fix: 'Compare o resultado do código com o valor que ele deveria dar, escrito à mão.',
  },
  'tests/only-added': {
    maxLevel: 'block',
    summary: 'Um .only novo faz o resto da suíte parar de rodar.',
    fix: 'Tire o .only (ou fit/fdescribe) antes do merge.',
  },
  'tests/body-emptied': {
    maxLevel: 'block',
    summary: 'O corpo de um teste foi esvaziado.',
    fix: 'Restaure as verificações, ou apague o teste de forma explícita e diga por quê.',
  },
  'tests/test-skipped': {
    maxLevel: 'review',
    summary: 'Um teste ou bloco foi desativado (skip ou todo).',
    fix: 'Confirme se foi de propósito e deixe o motivo escrito no código, com um link para a tarefa que o reativa.',
  },
  'tests/expected-changed': {
    maxLevel: 'review',
    summary: 'O valor esperado de um assert mudou.',
    fix: 'Confira se o novo valor está certo pela regra do negócio, e não só copiado da saída para o teste passar.',
  },
  'tests/assertion-weakened': {
    maxLevel: 'review',
    summary: 'Um assert passou a só conferir que existe um valor, sem conferir qual.',
    fix: 'Volte a conferir o valor exato (toBe, toEqual) em vez de só toBeDefined ou toBeTruthy.',
  },
  'tests/assertions-reduced': {
    maxLevel: 'review',
    summary: 'Um teste ficou com menos verificações que antes.',
    fix: 'Confira se o teste ainda verifica tudo o que verificava antes.',
  },
  'tests/test-removed': {
    maxLevel: 'review',
    summary: 'Testes foram removidos do arquivo.',
    fix: 'Confira se o que esses testes cobriam continua testado em outro lugar.',
  },
  'tests/file-deleted': {
    maxLevel: 'review',
    summary: 'Um arquivo de teste foi apagado.',
    fix: 'Confira se o que esses testes cobriam continua testado em outro lugar.',
  },
  'tests/empty-test-added': {
    maxLevel: 'review',
    summary: 'Um teste novo não tem nada dentro.',
    fix: 'Escreva as verificações ou marque o teste como todo.',
  },
  'deps/not-found': {
    maxLevel: 'block',
    summary: 'O pacote não existe no registro; a IA pode ter inventado o nome.',
    fix: 'Procure o nome certo do pacote no npm. Nunca publique nem instale um nome inventado: alguém pode registrá-lo com código malicioso.',
  },
  'deps/version-not-found': {
    maxLevel: 'block',
    summary: 'Nenhuma versão publicada atende o que foi pedido.',
    fix: 'Use uma versão que exista (`npm view <pacote> versions`).',
  },
  'deps/typosquat': {
    maxLevel: 'block',
    summary: 'O nome é quase igual ao de um pacote popular.',
    fix: 'Confira letra por letra. Se era o pacote popular, troque o nome; se não era, confirme quem publica o pacote.',
  },
  'deps/install-script': {
    maxLevel: 'review',
    summary: 'O pacote roda um script durante a instalação.',
    fix: 'Leia o script (preinstall, install, postinstall) antes de instalar. Na dúvida, use `npm install --ignore-scripts`.',
  },
  'deps/new-package': {
    maxLevel: 'review',
    summary: 'O pacote foi publicado há pouco tempo.',
    fix: 'Confirme quem publica e se há alternativa mais estabelecida. Pacotes novos são o alvo preferido de ataques.',
  },
  'deps/low-downloads': {
    maxLevel: 'review',
    summary: 'O pacote tem poucos downloads por semana.',
    fix: 'Confirme que é mesmo o pacote que você quer, e não um nome parecido.',
  },
  'deps/registry-unavailable': {
    maxLevel: 'review',
    summary: 'Não deu para consultar o pacote no registro.',
    fix: 'Rode o Laudo de novo com rede. Se o pacote é privado, ponha o escopo em `deps.allow`.',
  },
  'risk/sensitive-zone': {
    maxLevel: 'review',
    summary: 'A mudança toca uma zona sensível (login, dinheiro, banco, segredos, CI).',
    fix: 'Revise estes arquivos com calma, de preferência com quem conhece a área.',
  },
  'ci/failure-ignored': {
    maxLevel: 'block',
    summary: 'O CI ou um script passou a ignorar falhas (|| true, continue-on-error, if: false).',
    fix: 'Deixe a falha aparecer e conserte a causa. Se um passo pode falhar de propósito, escreva o motivo no workflow.',
  },
  'ci/tests-not-run': {
    maxLevel: 'block',
    summary: 'Um passo ou script que rodava os testes foi removido ou esvaziado.',
    fix: 'Devolva o passo de testes ao CI (ou o comando ao script `test`).',
  },
  'ci/coverage-lowered': {
    maxLevel: 'block',
    summary: 'Um limite de cobertura de testes foi reduzido, removido ou desligado.',
    fix: 'Escreva os testes que faltam em vez de baixar o limite.',
  },
  'mutation/survived': {
    maxLevel: 'block',
    summary: 'Bugs inseridos de propósito nas linhas alteradas não fazem nenhum teste falhar: os testes não provam esta mudança.',
    fix: 'Escreva testes que falhem quando a lógica dessas linhas muda (o laudo lista cada mutante que escapou).',
  },
  'agent/test-edited-after-failure': {
    maxLevel: 'review',
    summary: 'Depois de um teste falhar, o agente mudou só o teste (nenhum código) até ele passar.',
    fix: 'Confira se o teste estava errado de verdade. Se não estava, o código é que precisa mudar.',
  },
  'agent/tests-not-run': {
    maxLevel: 'review',
    summary: 'O agente mudou código ou testes depois da última vez que rodou a suíte (ou nunca rodou).',
    fix: 'Rode os testes antes do merge: o agente não viu o resultado dessas mudanças.',
  },
  'agent/last-test-failed': {
    maxLevel: 'review',
    summary: 'A última execução dos testes na sessão do agente falhou.',
    fix: 'Rode os testes de novo. Se ainda falham, o trabalho foi entregue quebrado.',
  },
} as const satisfies Record<string, RuleInfo>;

export type RuleId = keyof typeof RULES;

/** Áreas das regras, na ordem em que o laudo mostra. */
export const CATEGORIES = {
  tests: 'Testes',
  ci: 'CI e config',
  deps: 'Dependências',
  mutation: 'Mutação',
  agent: 'Sessão do agente',
  risk: 'Risco',
} as const;

export type Category = keyof typeof CATEGORIES;

export function categoryOf(rule: string): Category {
  const prefix = rule.split('/')[0] as Category;
  return prefix in CATEGORIES ? prefix : 'risk';
}

export const RULES_URL = 'https://github.com/EduardoxDev/Laudo#as-regras';
