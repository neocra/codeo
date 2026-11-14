import type { FileDiff, WorktreeDiff } from '@codeo/contracts';

/**
 * Scripted changes of the demo worktrees, served by `worktrees.diff` in demo mode instead of git: the demo
 * repositories are not checkouts, so nothing is read from disk. Written as compact unified hunks.
 */

interface HunkSpec {
  /** First line of the hunk in the old and in the new file. */
  at: [number, number];
  /** Text after the `@@ … @@` range (the enclosing symbol, as git prints it). */
  context?: string;
  /** `+added`, `-deleted`, ` context`. */
  lines: string[];
}

function fileDiff(path: string, status: FileDiff['status'], hunks: HunkSpec[]): FileDiff {
  let additions = 0;
  let deletions = 0;
  const built = hunks.map(({ at: [oldStart, newStart], context, lines }) => {
    let o = oldStart;
    let n = newStart;
    const out = lines.map((raw) => {
      const mark = raw[0];
      const text = raw.slice(1);
      if (mark === '+') {
        additions++;
        return { type: 'add' as const, old: null, new: n++, text };
      }
      if (mark === '-') {
        deletions++;
        return { type: 'del' as const, old: o++, new: null, text };
      }
      if (mark !== ' ') throw new Error(`demo diff line without a +, - or space marker: ${raw}`);
      return { type: 'ctx' as const, old: o++, new: n++, text };
    });
    const oldCount = o - oldStart;
    const newCount = n - newStart;
    const range = (start: number, count: number) => (count === 0 ? `${start - 1},0` : `${start},${count}`);
    return { header: `@@ -${range(oldStart, oldCount)} +${range(newStart, newCount)} @@${context ? ` ${context}` : ''}`, lines: out };
  });
  return { path, oldPath: null, status, binary: false, additions, deletions, hunks: built, truncated: false };
}

function worktreeDiff(
  w: { id: string; branch: string; baseBranch: string },
  shape: { mergeBase: string; head: string; commits: number; uncommitted: boolean },
  files: FileDiff[],
): WorktreeDiff {
  return {
    worktreeId: w.id,
    branch: w.branch,
    baseBranch: w.baseBranch,
    ...shape,
    files,
    additions: files.reduce((s, f) => s + f.additions, 0),
    deletions: files.reduce((s, f) => s + f.deletions, 0),
    truncated: false,
  };
}

export const DEMO_WORKTREE_IDS = {
  ely142: 'wt_demo_ely142',
  ely136: 'wt_demo_ely136',
  cc88: 'wt_demo_cc88',
  cc91: 'wt_demo_cc91',
} as const;

/** ELY-142 · inventory stacking — the agent's work, not committed yet. */
const ely142 = (w: { id: string; branch: string; baseBranch: string }) =>
  worktreeDiff(w, { mergeBase: '4f1c2a9e7b30d58c61a2f4e09b7d3c5a8e6f1b20', head: '4f1c2a9e7b30d58c61a2f4e09b7d3c5a8e6f1b20', commits: 0, uncommitted: true }, [
    fileDiff('Assets/Scripts/Inventory/InventoryGrid.cs', 'modified', [
      {
        at: [41, 41],
        context: 'public sealed class InventoryGrid',
        lines: [
          '     public bool TryAdd(ItemStack incoming)',
          '     {',
          '-        var slot = FirstEmptySlot();',
          '-        if (slot < 0) return false;',
          '-        _slots[slot] = incoming;',
          '-        return true;',
          '+        /* Fill the stacks of the same item first, then the empty slots. */',
          '+        for (var i = 0; i < _slots.Length && incoming.Count > 0; i++)',
          '+        {',
          '+            if (_slots[i].Item != incoming.Item) continue;',
          '+            var room = incoming.Item.MaxStack - _slots[i].Count;',
          '+            var moved = Math.Min(room, incoming.Count);',
          '+            _slots[i] = _slots[i].WithCount(_slots[i].Count + moved);',
          '+            incoming = incoming.WithCount(incoming.Count - moved);',
          '+        }',
          '+        while (incoming.Count > 0)',
          '+        {',
          '+            var slot = FirstEmptySlot();',
          '+            if (slot < 0) return false;',
          '+            var placed = Math.Min(incoming.Item.MaxStack, incoming.Count);',
          '+            _slots[slot] = incoming.WithCount(placed);',
          '+            incoming = incoming.WithCount(incoming.Count - placed);',
          '+        }',
          '+        Changed?.Invoke();',
          '+        return true;',
          '     }',
        ],
      },
      {
        at: [58, 73],
        context: 'public sealed class InventoryGrid',
        lines: [
          '     public ItemStack TakeAt(int slot) => _slots[slot];',
          '+',
          '+    /** Shift+click: half of the stack goes to the first empty slot. */',
          '+    public bool Split(int slot)',
          '+    {',
          '+        var stack = _slots[slot];',
          '+        var target = FirstEmptySlot();',
          '+        if (stack.Count < 2 || target < 0) return false;',
          '+        var half = stack.Count / 2;',
          '+        _slots[slot] = stack.WithCount(stack.Count - half);',
          '+        _slots[target] = stack.WithCount(half);',
          '+        Changed?.Invoke();',
          '+        return true;',
          '+    }',
          ' }',
        ],
      },
    ]),
    fileDiff('Assets/Scripts/Items/ItemDefinition.cs', 'modified', [
      {
        at: [9, 9],
        context: 'public class ItemDefinition : ScriptableObject',
        lines: [
          '     public string DisplayName;',
          '     public Sprite Icon;',
          '+    [Min(1)] public int MaxStack = 99;',
          '     public ItemCategory Category;',
        ],
      },
    ]),
    fileDiff('Assets/Tests/EditMode/InventoryStackingTests.cs', 'added', [
      {
        at: [1, 1],
        lines: [
          '+using NUnit.Framework;',
          '+',
          '+public class InventoryStackingTests',
          '+{',
          '+    [Test]',
          '+    public void Potions_merge_into_the_existing_stack()',
          '+    {',
          '+        var grid = new InventoryGrid(4);',
          '+        grid.TryAdd(Items.Potion(60));',
          '+        grid.TryAdd(Items.Potion(30));',
          '+        Assert.AreEqual(90, grid.TakeAt(0).Count);',
          '+    }',
          '+',
          '+    [Test]',
          '+    public void Overflow_starts_a_new_stack()',
          '+    {',
          '+        var grid = new InventoryGrid(4);',
          '+        grid.TryAdd(Items.Potion(150));',
          '+        Assert.AreEqual(99, grid.TakeAt(0).Count);',
          '+        Assert.AreEqual(51, grid.TakeAt(1).Count);',
          '+    }',
          '+}',
        ],
      },
    ]),
  ]);

/** ELY-136 · cloud saves — committed, pull request open. */
const ely136 = (w: { id: string; branch: string; baseBranch: string }) =>
  worktreeDiff(w, { mergeBase: '9a03be1c4d7f2e58b6c0a1d3f5e7092b4c6d8e1f', head: 'c2d4e6f8091a3b5c7d9e0f1a2b3c4d5e6f708192', commits: 2, uncommitted: false }, [
    fileDiff('Assets/Scripts/Save/CloudSaveService.cs', 'added', [
      {
        at: [1, 1],
        lines: [
          '+using System.Threading.Tasks;',
          '+',
          '+/** Uploads the local save after each checkpoint; the newest copy wins on load. */',
          '+public sealed class CloudSaveService',
          '+{',
          '+    private readonly ISaveBackend _backend;',
          '+    private readonly LocalSaveStore _local;',
          '+',
          '+    public CloudSaveService(ISaveBackend backend, LocalSaveStore local)',
          '+    {',
          '+        _backend = backend;',
          '+        _local = local;',
          '+    }',
          '+',
          '+    public async Task SyncAsync()',
          '+    {',
          '+        var local = _local.Read();',
          '+        var remote = await _backend.FetchAsync(local.PlayerId);',
          '+        if (remote is null || local.SavedAt > remote.SavedAt) await _backend.UploadAsync(local);',
          '+        else _local.Write(remote);',
          '+    }',
          '+}',
        ],
      },
    ]),
    fileDiff('Assets/Scripts/Save/SaveManager.cs', 'modified', [
      {
        at: [27, 27],
        context: 'public void OnCheckpointReached(Checkpoint checkpoint)',
        lines: [
          '     {',
          '         _local.Write(Snapshot(checkpoint));',
          '+        _ = _cloud.SyncAsync();',
          '     }',
        ],
      },
    ]),
  ]);

/** CC-88 · CSV export — committed, pull request approved. */
const cc88 = (w: { id: string; branch: string; baseBranch: string }) =>
  worktreeDiff(w, { mergeBase: '1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e', head: 'e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b', commits: 1, uncommitted: false }, [
    fileDiff('apps/api/src/routes/invoices.ts', 'modified', [
      {
        at: [12, 12],
        context: "export const invoices = new Hono<Env>()",
        lines: [
          "   .get('/', listInvoices)",
          "+  .get('/export.csv', zValidator('query', periodSchema), async (c) => {",
          "+    const { from, to } = c.req.valid('query');",
          "+    c.header('Content-Type', 'text/csv; charset=utf-8');",
          '+    c.header(\'Content-Disposition\', `attachment; filename="factures-${from}-${to}.csv"`);',
          '+    return stream(c, async (out) => {',
          "+      await out.write('numero;client;date;montant_ht;tva;statut\\n');",
          '+      for await (const inv of invoicesBetween(c.var.db, c.var.account, from, to)) await out.write(toCsvRow(inv));',
          '+    });',
          '+  })',
          "   .get('/:id', getInvoice);",
        ],
      },
    ]),
    fileDiff('apps/web/src/pages/Invoices.tsx', 'modified', [
      {
        at: [34, 34],
        context: 'export function InvoicesPage()',
        lines: [
          '       <PageHeader title="Factures">',
          '+        <Button variant="secondary" icon="download" href={exportUrl(period)}>',
          '+          Exporter',
          '+        </Button>',
          '         <PeriodPicker value={period} onChange={setPeriod} />',
          '       </PageHeader>',
        ],
      },
    ]),
  ]);

/** CC-91 · API rate limiting — committed, awaiting review. */
const cc91 = (w: { id: string; branch: string; baseBranch: string }) =>
  worktreeDiff(w, { mergeBase: '7c6b5a4938271605f4e3d2c1b0a99887766554433', head: '0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8091', commits: 1, uncommitted: false }, [
    fileDiff('apps/api/src/middleware/rate-limit.ts', 'added', [
      {
        at: [1, 1],
        lines: [
          "+import type { MiddlewareHandler } from 'hono';",
          '+',
          '+const LIMIT = 100;',
          '+const WINDOW_MS = 60_000;',
          '+',
          '+/** Sliding window per API key; RateLimit-* headers as in draft-ietf-httpapi-ratelimit-headers. */',
          '+export function rateLimit(now = () => Date.now()): MiddlewareHandler {',
          '+  const hits = new Map<string, number[]>();',
          '+  return async (c, next) => {',
          "+    const key = c.req.header('Authorization') ?? c.req.header('X-Forwarded-For') ?? 'anonymous';",
          '+    const t = now();',
          '+    const recent = (hits.get(key) ?? []).filter((at) => t - at < WINDOW_MS);',
          '+    const remaining = Math.max(0, LIMIT - recent.length - 1);',
          "+    c.header('RateLimit-Limit', String(LIMIT));",
          "+    c.header('RateLimit-Remaining', String(remaining));",
          '+    if (recent.length >= LIMIT) {',
          "+      c.header('Retry-After', String(Math.ceil((WINDOW_MS - (t - recent[0]!)) / 1000)));",
          "+      return c.json({ error: 'rate_limited' }, 429);",
          '+    }',
          '+    hits.set(key, [...recent, t]);',
          '+    await next();',
          '+  };',
          '+}',
        ],
      },
    ]),
    fileDiff('apps/api/src/app.ts', 'modified', [
      {
        at: [18, 18],
        context: 'export function createApp(deps: AppDeps)',
        lines: [
          "   app.use('*', requestId());",
          "+  app.use('/v1/*', rateLimit());",
          "   app.route('/v1/invoices', invoices);",
        ],
      },
    ]),
    fileDiff('apps/api/test/rate-limit.test.ts', 'added', [
      {
        at: [1, 1],
        lines: [
          "+import { describe, expect, it } from 'vitest';",
          "+import { testApp } from './helpers';",
          '+',
          "+describe('rate limit', () => {",
          "+  it('answers 429 after 100 requests in a minute', async () => {",
          "+    const app = testApp({ apiKey: 'key_test' });",
          "+    for (let i = 0; i < 100; i++) expect((await app.get('/v1/invoices')).status).toBe(200);",
          "+    const blocked = await app.get('/v1/invoices');",
          '+    expect(blocked.status).toBe(429);',
          "+    expect(blocked.headers.get('RateLimit-Remaining')).toBe('0');",
          '+  });',
          '+});',
        ],
      },
    ]),
  ]);

const BUILDERS: Record<string, (w: { id: string; branch: string; baseBranch: string }) => WorktreeDiff> = {
  [DEMO_WORKTREE_IDS.ely142]: ely142,
  [DEMO_WORKTREE_IDS.ely136]: ely136,
  [DEMO_WORKTREE_IDS.cc88]: cc88,
  [DEMO_WORKTREE_IDS.cc91]: cc91,
};

/** The scripted changes of a demo worktree, or null when the worktree has none (a lane of a task created in demo mode). */
export function demoWorktreeDiff(w: { id: string; branch: string; baseBranch: string }): WorktreeDiff | null {
  return BUILDERS[w.id]?.(w) ?? null;
}
