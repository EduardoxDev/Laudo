import { matchesAny } from '../../collect/glob.js';
import type { ChangedFile } from '../../types.js';
import type { ChangedLines } from './lines.js';

export interface Zone {
  id: string;
  label: string;
  /** Casa com o caminho do arquivo. */
  path?: RegExp;
  /** Casa com alguma linha alterada (tirada ou colocada). */
  content?: RegExp;
}

/** Palavra inteira num caminho: `src/auth/x.ts` e `auth.ts` sim, `author.ts` não. */
const seg = (words: string) => new RegExp(`(^|[/._-])(${words})([/._-]|$)`, 'i');

export const ZONES: readonly Zone[] = [
  {
    id: 'auth',
    label: 'login e permissões',
    // Sem "middleware": em frameworks como Hono e Express quase todo middleware é outra coisa (estáticos, CORS, log).
    path: seg('auth|authn|authz|login|logout|signin|signup|session|sessions|oauth|sso|passport|jwt|permissions?|rbac|acl'),
    content: /\b(jwt\.(sign|verify)|bcrypt|argon2|passport\.\w+|getServerSession|httpOnly|sameSite|isAdmin|hasRole|hasPermission|authorize)\b/,
  },
  {
    id: 'crypto',
    label: 'criptografia',
    path: seg('crypto|cipher|encrypt|decrypt|hash|hashing|signature'),
    content: /\b(createHash|createHmac|createCipheriv|createDecipheriv|randomBytes|timingSafeEqual|crypto\.subtle)\b/,
  },
  {
    id: 'money',
    label: 'dinheiro e pagamentos',
    path: seg('payments?|billing|invoices?|checkout|refunds?|payouts?|wallets?|ledger|pix|stripe|charges?|subscriptions?|fees?'),
    content: /\b(stripe\.\w+|paymentIntents?|refund\(|payout\w*|ledger\w*)\b/i,
  },
  {
    id: 'database',
    label: 'banco de dados e migrações',
    path: seg('migrations?|migrate|seeds?|schema\\.prisma|schema\\.sql'),
    // `\b` não funciona antes de `$`, por isso o Prisma fica fora do grupo.
    content: /\b(ALTER\s+TABLE|DROP\s+(TABLE|COLUMN|INDEX|DATABASE)|TRUNCATE|DELETE\s+FROM)\b|\$(executeRaw|queryRaw)\w*/i,
  },
  {
    id: 'secrets',
    label: 'segredos e ambiente',
    path: /(^|\/)\.env(\.[\w-]+)?$|(^|[/._-])secrets?([/._-]|$)/i,
    content: /process\.env\.\w*(SECRET|TOKEN|KEY|PASSWORD|PASS|CREDENTIAL)\w*|\b(api[_-]?key|private[_-]?key|client[_-]?secret)\b/i,
  },
  {
    id: 'infra',
    label: 'CI e deploy',
    path: /^\.github\/|^\.gitlab-ci\.ya?ml$|^\.circleci\/|(^|\/)(Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|[^/]+\.tf|vercel\.json|netlify\.toml|fly\.toml)$|(^|\/)(deploy|k8s|helm|terraform)\//i,
  },
];

const CUSTOM_LABEL = 'zona marcada na config';

/** Documentação fala de migração, login e hash sem mexer em nada disso (medido no bench). */
const DOCS = /\.(md|mdx|markdown|txt|rst|adoc)$|(^|\/)docs?\//i;

/** Zonas sensíveis que a mudança neste arquivo toca. Testes, snapshots e documentação não contam. */
export function zonesFor(file: ChangedFile, lines: ChangedLines, customGlobs: readonly string[]): string[] {
  const paths = [file.path, ...(file.oldPath ? [file.oldPath] : [])];
  const custom = customGlobs.length > 0 && paths.some((p) => matchesAny(p, customGlobs));
  if (file.kind === 'test' || file.kind === 'snapshot' || (DOCS.test(file.path) && !custom)) return [];
  const changed = [...lines.added, ...lines.removed];
  const out: string[] = [];
  for (const zone of ZONES) {
    const byPath = zone.path && paths.some((p) => zone.path!.test(p));
    const byContent = zone.content && changed.some((l) => zone.content!.test(l));
    if (byPath || byContent) out.push(zone.label);
  }
  if (custom) out.push(CUSTOM_LABEL);
  return out;
}
