import { REPORT_MARKER } from '@laudo/core';
import type { GitHubClient, IssueComment } from './github.js';

export const DEFAULT_COMMENT_AUTHOR = 'github-actions[bot]';

/**
 * Mantém um comentário só por PR: atualiza o do Laudo se existir, cria se não.
 * Só considera comentários do próprio autor da Action; um humano que colar o marcador não é editado.
 */
export async function upsertComment(
  gh: GitHubClient,
  pr: number,
  body: string,
  author = DEFAULT_COMMENT_AUTHOR,
): Promise<{ comment: IssueComment; action: 'created' | 'updated' }> {
  const comments = await gh.listComments(pr);
  const mine = comments.find((c) => c.user?.login === author && c.body?.includes(REPORT_MARKER));
  if (mine) return { comment: await gh.updateComment(mine.id, body), action: 'updated' };
  return { comment: await gh.createComment(pr, body), action: 'created' };
}
