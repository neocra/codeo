import { useState } from 'react';
import { AgentCard, Button, Card, EmptyState, Icon, Overline, PageHeader, ProgressBar, RepoChip, StatusPill } from '@codeo/ui-desktop';
import { ApprovalItem } from '../components/ApprovalItem';
import { providerName, sessionTone, taskTone } from '../components/status';
import { CreateTaskDialog } from '../components/CreateTaskDialog';
import { formatRelative, useT } from '../lib/i18n';
import { useHome } from '../lib/queries';
import { useUi } from '../lib/store';

export function HomeScreen() {
  const t = useT();
  const { workspaceId, userName, navigate, openSession } = useUi();
  const home = useHome(workspaceId);
  const [creating, setCreating] = useState(false);
  const data = home.data;
  const ws = data?.workspace ?? null;
  const heroTask = data?.activeTasks.find((x) => x.status === 'running' || x.status === 'waiting_approval') ?? data?.activeTasks[0] ?? null;
  const heroSessions = (data?.recentSessions ?? []).filter((s) => (heroTask ? s.taskId === heroTask.id : false));
  const heroSession = heroSessions[0] ?? data?.activeSessions[0] ?? null;
  const repoNames = (ids: string[]) => (ws?.repositories ?? []).filter((r) => ids.includes(r.id)).map((r) => r.name);

  return (
    <>
      <PageHeader
        title={t('home.greeting', { name: userName || '' })}
        question={t('home.question')}
        subtitle={ws ? t('home.subtitle', { workspace: ws.name }) : t('home.subtitle.noWorkspace')}
        actions={
          <Button variant="primary" icon="plus" onClick={() => (ws ? setCreating(true) : navigate('workspaces'))}>
            {ws ? t('action.createTask') : t('workspaces.create')}
          </Button>
        }
      />

      {heroTask || heroSession ? (
        <Card hero live={heroSession?.status === 'running'} style={{ marginBottom: 24 }}>
          <div className="cd-hero">
            <div>
              <Overline>
                <Icon name="users" size={14} />
                {t('home.activity')}
              </Overline>
              <div style={{ display: 'flex', gap: 16, marginTop: 16 }}>
                <span className="cd-hero__icon">
                  <Icon name="ticket" size={22} />
                </span>
                <div style={{ minWidth: 0 }}>
                  {heroTask?.ticketKey ? <div className="cd-key">{heroTask.ticketKey}</div> : null}
                  <h2 className="cd-title" style={{ marginTop: 2 }}>
                    {heroTask?.title ?? heroSession?.title}
                  </h2>
                </div>
              </div>
              <div className="cd-hero__meta">
                {heroTask ? (
                  <StatusPill key={heroTask.status} tone={taskTone(heroTask.status).tone}>
                    {t(taskTone(heroTask.status).key)}
                  </StatusPill>
                ) : heroSession ? (
                  <StatusPill key={heroSession.status} tone={sessionTone(heroSession.status).tone}>
                    {t(sessionTone(heroSession.status).key)}
                  </StatusPill>
                ) : null}
                <span className="cd-vdivider" style={{ height: 16 }} />
                <span className="cd-body-sm cd-muted">{t('home.startedAgo', { ago: formatRelative(t, heroTask?.startedAt ?? heroSession?.createdAt ?? new Date().toISOString()) })}</span>
                {heroTask ? <ProgressBar value={heroTask.progress} running={heroTask.status === 'running'} /> : null}
              </div>
              {heroTask?.objective ? <p className="cd-hero__desc">{heroTask.objective}</p> : null}
              <div className="cd-body-sm cd-muted" style={{ marginBottom: 8 }}>
                {t('home.repositories')}
              </div>
              <div className="cd-row-gap">
                {repoNames(heroTask?.repositoryIds ?? (heroSession?.repositoryId ? [heroSession.repositoryId] : [])).map((n, i) => (
                  <RepoChip key={n} name={n} index={i} />
                ))}
              </div>
            </div>
            <span className="cd-vdivider" />
            <div className="cd-hero__side">
              <div className="cd-body-sm" style={{ fontWeight: 600 }}>
                {t('home.agents')}
              </div>
              {(heroSessions.length ? heroSessions : heroSession ? [heroSession] : []).map((s) => (
                <AgentCard
                  key={s.id}
                  name={providerName[s.provider]}
                  role={t(`role.${s.role}`)}
                  status={s.status === 'running' ? 'active' : s.status === 'waiting_approval' || s.status === 'idle' ? 'waiting' : s.status === 'failed' ? 'error' : s.status === 'completed' ? 'done' : 'idle'}
                  statusLabel={t(sessionTone(s.status).key)}
                  onClick={() => openSession(s.id)}
                />
              ))}
              {heroSession ? (
                <Button variant="primary" icon="play" onClick={() => openSession(heroSession.id)}>
                  {heroSession.status === 'running' ? t('home.openSession') : t('home.resumeSession')}
                </Button>
              ) : null}
              <div className="cd-hero__buttons">
                <Button variant="secondary" icon="external" onClick={() => navigate('tasks')}>
                  {t('home.viewTask')}
                </Button>
                <Button variant="secondary" icon="review" onClick={() => navigate('review')}>
                  {t('nav.review')}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <div style={{ marginBottom: 24 }}>
          <EmptyState
            title={t('home.empty.title')}
            body={t('home.empty.body')}
            action={
              <Button variant="secondary" icon="plus" onClick={() => (ws ? setCreating(true) : navigate('workspaces'))}>
                {ws ? t('action.createTask') : t('workspaces.create')}
              </Button>
            }
          />
        </div>
      )}

      <div className="cd-grid cd-grid--3">
        <Card title={t('home.activeAgents')} icon="users" action={{ label: t('home.seeAll'), onClick: () => navigate('sessions') }}>
          <div className="cd-stack cd-stack--sm">
            {(data?.activeSessions ?? []).length ? (
              data!.activeSessions.map((s) => (
                <AgentCard key={s.id} name={providerName[s.provider]} role={t(`role.${s.role}`)} status={s.status === 'running' ? 'active' : 'waiting'} statusLabel={t(sessionTone(s.status).key)} onClick={() => openSession(s.id)} />
              ))
            ) : (
              <div className="cd-body-sm cd-muted">{t('home.noActivity')}</div>
            )}
          </div>
        </Card>
        <Card title={t('home.pendingApprovals')} icon="shield" count={data?.pendingApprovals.length} action={{ label: t('home.seeAll'), onClick: () => navigate('tasks') }}>
          <div className="cd-stack">
            {(data?.pendingApprovals ?? []).length ? data!.pendingApprovals.slice(0, 2).map((a) => <ApprovalItem key={a.id} approval={a} />) : <div className="cd-body-sm cd-muted">{t('approvals.empty')}</div>}
          </div>
        </Card>
        <Card title={t('home.recentFailures')} icon="alert" action={{ label: t('home.seeAll'), onClick: () => navigate('sessions') }}>
          <div className="cd-stack cd-stack--sm">
            {(data?.recentFailures ?? []).length ? (
              data!.recentFailures.map((s) => (
                <AgentCard key={s.id} name={providerName[s.provider]} role={s.error ?? s.title} status="error" statusLabel={t('status.failed')} onClick={() => openSession(s.id)} />
              ))
            ) : (
              <div className="cd-body-sm cd-muted">—</div>
            )}
          </div>
        </Card>
      </div>

      <Card title={t('home.recentSessions')} icon="session" style={{ marginTop: 24 }} action={{ label: t('home.seeAll'), onClick: () => navigate('sessions') }}>
        {(data?.recentSessions ?? []).length ? (
          <div className="cd-list">
            {data!.recentSessions.map((s) => {
              const st = sessionTone(s.status);
              return (
                <div key={s.id} className="cd-list-row" role="button" tabIndex={0} onClick={() => openSession(s.id)} onKeyDown={(e) => e.key === 'Enter' && openSession(s.id)}>
                  <span className="cd-key">{providerName[s.provider]}</span>
                  <span className="cd-list-row__title">{s.title}</span>
                  <span className="cd-list-row__time">{formatRelative(t, s.lastActivityAt)}</span>
                  <StatusPill key={s.status} tone={st.tone}>
                    {t(st.key)}
                  </StatusPill>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="cd-body-sm cd-muted">{t('sessions.empty')}</div>
        )}
      </Card>
      <CreateTaskDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
