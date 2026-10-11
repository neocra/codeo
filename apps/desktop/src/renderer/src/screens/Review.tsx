import { Banner, DiffView, PageHeader, Placeholder } from '@codeo/ui-desktop';
import { useT } from '../lib/i18n';

/** Phase 5 screen. The diff component is real; the data source (worktree diffs, PRs) is not wired yet. */
export function ReviewScreen() {
  const t = useT();
  return (
    <>
      <PageHeader title={t('review.title')} subtitle={t('review.subtitle')} />
      <div style={{ marginBottom: 24 }}>
        <Banner tone="info">
          {t('review.placeholder')} <Placeholder>{t('placeholder.phase', { n: 5 })}</Placeholder>
        </Banner>
      </div>
      <DiffView
        file="exemple — SaveSyncService.cs"
        lines={[
          { type: 'ctx', old: 10, new: 10, text: 'public async Task<SyncResult> SyncAsync(SaveData localData)' },
          { type: 'ctx', old: 11, new: 11, text: '{' },
          { type: 'del', old: 12, text: '    var remoteData = await _cloudProvider.GetLatestAsync(localData.Id);' },
          { type: 'add', new: 12, text: '    var remoteData = await _cloudProvider.GetLatestAsync(localData.Id, ct);' },
          { type: 'add', new: 13, text: '    // Gestion des conflits' },
          { type: 'add', new: 14, text: '    if (remoteData != null && !remoteData.IsDeleted)' },
          { type: 'ctx', old: 13, new: 15, text: '        return await _conflictResolver.ResolveAsync(localData, remoteData);' },
        ]}
      />
    </>
  );
}
