/** O mínimo da API do GitHub que a Action usa, via `fetch`, sem dependências. */

export interface PullRequest {
  number: number;
  state: string;
  head: { sha: string };
}

export interface IssueComment {
  id: number;
  body?: string | null;
  html_url?: string;
  user?: { login?: string } | null;
}

export interface GitHubClient {
  getPull(number: number): Promise<PullRequest>;
  listComments(issue: number): Promise<IssueComment[]>;
  createComment(issue: number, body: string): Promise<IssueComment>;
  updateComment(id: number, body: string): Promise<IssueComment>;
}

export class GitHubError extends Error {
  override name = 'GitHubError';
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface RestOptions {
  token: string;
  /** `dono/repositório` */
  repo: string;
  apiUrl?: string;
  fetch?: typeof fetch;
}

const MAX_PAGES = 30;

export class RestGitHub implements GitHubClient {
  private readonly base: string;
  private readonly fetch: typeof fetch;

  constructor(private readonly opts: RestOptions) {
    this.base = `${(opts.apiUrl ?? 'https://api.github.com').replace(/\/+$/, '')}/repos/${opts.repo}`;
    this.fetch = opts.fetch ?? globalThis.fetch;
  }

  getPull(number: number): Promise<PullRequest> {
    return this.call(`/pulls/${number}`);
  }

  async listComments(issue: number): Promise<IssueComment[]> {
    const all: IssueComment[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const batch = await this.call<IssueComment[]>(`/issues/${issue}/comments?per_page=100&page=${page}`);
      all.push(...batch);
      if (batch.length < 100) break;
    }
    return all;
  }

  createComment(issue: number, body: string): Promise<IssueComment> {
    return this.call(`/issues/${issue}/comments`, 'POST', { body });
  }

  updateComment(id: number, body: string): Promise<IssueComment> {
    return this.call(`/issues/comments/${id}`, 'PATCH', { body });
  }

  private async call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const init: RequestInit = {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.opts.token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'laudo-action',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    };
    if (body) init.body = JSON.stringify(body);
    const res = await this.fetch(`${this.base}${path}`, init);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new GitHubError(`GitHub respondeu ${res.status} em ${method} ${path}: ${text.slice(0, 300)}`, res.status);
    }
    return (await res.json()) as T;
  }
}
