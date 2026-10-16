import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { RepositoryInspection } from '@codeo/contracts';
import type { ExecutionMode } from '@codeo/domain';
import { Button, Card, Choice, Dialog, EmptyState, Field, Icon, Input, PageHeader, RepoChip, StatusPill } from '@codeo/ui-desktop';
import { ExecutionModeSelect } from '../components/ExecutionModeSelect';
import { codeo, invoke, describeError } from '../lib/api';
import { useT } from '../lib/i18n';
import { keys, useWorkspaces } from '../lib/queries';
import { useUi } from '../lib/store';

function CreateWorkspaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const setWorkspace = useUi((s) => s.setWorkspace);
  const [name, setName] = useState('');
  const [type, setType] = useState<'multi-repo' | 'monorepo'>('multi-repo');
  const [repos, setRepos] = useState<RepositoryInspection[]>([]);
  const [defaultExecutionMode, setDefaultExecutionMode] = useState<ExecutionMode>('auto');
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    const dir = await codeo.pickDirectory({ title: t('action.chooseFolder') });
    if (!dir) return;
    const info = await invoke('repositories.inspect', { path: dir });
    if (!info.isGitRepository) {
      setError(t('workspaces.notGit'));
      return;
    }
    setError(null);
    setRepos((r) => (r.some((x) => x.root === info.root) ? r : [...r, info]));
    if (!name) setName(info.name);
  };
  const create = useMutation({
    mutationFn: () => invoke('workspaces.create', { name, type, repositoryPaths: repos.map((r) => r.root!), defaultExecutionMode }),
    onSuccess: (ws) => {
      void qc.invalidateQueries({ queryKey: keys.workspaces });
      setWorkspace(ws.id);
      void codeo.setPreference('workspaceId', ws.id);
      setRepos([]);
      setName('');
      setDefaultExecutionMode('auto');
      onClose();
    },
    onError: (e) => setError(describeError(e, t)),
  });
  const valid = name.trim().length > 0 && repos.length > 0 && (type === 'multi-repo' || repos.length === 1);
  return (
    <Dialog open={open} onClose={onClose} title={t('workspaces.create')} closeLabel={t('action.close')}>
      <form
        className="cd-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) create.mutate();
        }}
      >
        <Field label={t('workspaces.name')} htmlFor="ws-name">
          <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        </Field>
        <Field label={t('workspaces.type')}>
          <div className="cd-row-gap">
            <Choice checked={type === 'multi-repo'} onChange={() => setType('multi-repo')} label={t('workspaces.type.multiRepo')} name="ws-type" />
            <Choice checked={type === 'monorepo'} onChange={() => setType('monorepo')} label={t('workspaces.type.monorepo')} name="ws-type" />
          </div>
        </Field>
        <Field label={t('workspaces.defaultExecutionMode')} htmlFor="ws-execution-mode" hint={`${t(`executionMode.${defaultExecutionMode}.desc`)} ${t('workspaces.defaultExecutionMode.hint')}`}>
          <ExecutionModeSelect id="ws-execution-mode" value={defaultExecutionMode} onChange={setDefaultExecutionMode} />
        </Field>
        <Field label={t('workspaces.repositories')} hint={t('workspaces.repositories.hint')} error={error}>
          <div className="cd-stack cd-stack--sm">
            {repos.map((r) => (
              <div key={r.root} className="cd-row-gap" style={{ justifyContent: 'space-between' }}>
                <span className="cd-row-gap">
                  <RepoChip name={r.name} />
                  <span className="cd-key">{r.defaultBranch ?? '—'}</span>
                  <span className="cd-body-sm cd-faint">{r.root}</span>
                </span>
                <Button variant="ghost" size="sm" onClick={() => setRepos((x) => x.filter((y) => y.root !== r.root))}>
                  {t('action.remove')}
                </Button>
              </div>
            ))}
            <div>
              <Button variant="secondary" icon="folder" onClick={() => void pick()} disabled={type === 'monorepo' && repos.length === 1}>
                {t('action.chooseFolder')}
              </Button>
            </div>
          </div>
        </Field>
        <div className="cd-form__actions">
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" variant="primary" icon="check" disabled={!valid} loading={create.isPending}>
            {t('action.create')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function WorkspacesScreen() {
  const t = useT();
  const qc = useQueryClient();
  const workspaces = useWorkspaces();
  const { workspaceId, setWorkspace } = useUi();
  const [creating, setCreating] = useState(false);
  const addRepo = useMutation({
    mutationFn: async (workspaceId: string) => {
      const dir = await codeo.pickDirectory({ title: t('action.chooseFolder') });
      if (!dir) return null;
      return invoke('workspaces.addRepository', { workspaceId, path: dir });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.workspaces }),
  });
  const updateWorkspace = useMutation({
    mutationFn: (p: { workspaceId: string; defaultExecutionMode: ExecutionMode }) => invoke('workspaces.update', p),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.workspaces }),
  });
  const removeRepo = useMutation({
    mutationFn: (p: { workspaceId: string; repositoryId: string }) => invoke('workspaces.removeRepository', p),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.workspaces }),
  });
  return (
    <>
      <PageHeader
        title={t('workspaces.title')}
        subtitle={t('workspaces.subtitle')}
        actions={
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            {t('workspaces.create')}
          </Button>
        }
      />
      {workspaces.data?.length ? (
        <div className="cd-grid cd-grid--2">
          {workspaces.data.map((ws) => (
            <Card key={ws.id} title={ws.name} icon="layers" live={ws.id === workspaceId} action={ws.id !== workspaceId ? { label: t('workspaces.active'), onClick: () => setWorkspace(ws.id) } : undefined}>
              <div className="cd-row-gap" style={{ marginBottom: 12 }}>
                <StatusPill tone={ws.id === workspaceId ? 'live' : 'idle'}>{ws.id === workspaceId ? t('workspaces.active') : t(ws.type === 'monorepo' ? 'workspaces.type.monorepo' : 'workspaces.type.multiRepo')}</StatusPill>
                <span className="cd-body-sm cd-muted">{t(ws.type === 'monorepo' ? 'workspaces.type.monorepo' : 'workspaces.type.multiRepo')}</span>
              </div>
              <div className="cd-stack cd-stack--sm">
                <Field label={t('workspaces.defaultExecutionMode')} htmlFor={`ws-mode-${ws.id}`} hint={t('workspaces.defaultExecutionMode.hint')}>
                  <ExecutionModeSelect id={`ws-mode-${ws.id}`} value={ws.defaultExecutionMode} disabled={updateWorkspace.isPending} onChange={(m) => updateWorkspace.mutate({ workspaceId: ws.id, defaultExecutionMode: m })} />
                </Field>
                {ws.repositories.map((r) => (
                  <div key={r.id} className="cd-row-gap" style={{ justifyContent: 'space-between' }}>
                    <span className="cd-row-gap">
                      <RepoChip name={r.name} />
                      <span className="cd-key">
                        <Icon name="branch" size={12} /> {r.defaultBranch}
                      </span>
                      <span className="cd-body-sm cd-faint">{r.path}</span>
                    </span>
                    {ws.type === 'multi-repo' && ws.repositories.length > 1 ? (
                      <Button variant="ghost" size="sm" onClick={() => removeRepo.mutate({ workspaceId: ws.id, repositoryId: r.id })}>
                        {t('action.remove')}
                      </Button>
                    ) : null}
                  </div>
                ))}
                {ws.type === 'multi-repo' ? (
                  <div>
                    <Button variant="secondary" size="sm" icon="plus" loading={addRepo.isPending} onClick={() => addRepo.mutate(ws.id)}>
                      {t('action.addRepository')}
                    </Button>
                  </div>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon="layers"
          title={t('workspaces.empty')}
          action={
            <Button variant="secondary" icon="plus" onClick={() => setCreating(true)}>
              {t('workspaces.create')}
            </Button>
          }
        />
      )}
      <CreateWorkspaceDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
