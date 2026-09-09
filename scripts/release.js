// Provider-neutral release protocol. No provider, credentials or default target.
const { acquire } = require('./operation-lock');
const required = ['verifyArtifact', 'maintenance', 'stop', 'backup', 'migrate',
  'activate', 'start', 'ready', 'record', 'assertSchema', 'restore'];
async function release(adapter, request) {
  for (const name of required) if (typeof adapter[name] !== 'function') throw new Error('RELEASE: incomplete adapter');
  if (!request || !['deploy', 'rollback'].includes(request.mode)) throw new Error('RELEASE: invalid mode');
  if (!/^[a-f0-9]{64}$/.test(request.digest || '')) throw new Error('RELEASE: trusted digest required');
  // Adapter verifies trusted digest, version, platform and provenance before any mutation.
  await adapter.verifyArtifact(request);
  const unlock = acquire(request.databasePath, '.release-lock');
  try {
    await adapter.maintenance(true);
    await adapter.stop(); // Must prove all app/job writers stopped; disable supervisor restart.
    const receipt = await adapter.backup(); // Always, even when schema has no pending changes.
    if (!receipt || receipt.ok !== true || !receipt.database || !receipt.files || !receipt.verified) {
      throw new Error('RELEASE: verified database AND runtime file backup required');
    }
    await adapter.record({ phase: 'backed-up', digest: request.digest, receipt });
    if (request.mode === 'deploy') await adapter.migrate(request);
    else if (request.restore === true) {
      if (request.dataLossApproved !== true || !request.recoveryRef) throw new Error('RELEASE: recovery approval required');
      // Restore DB into NEW path and files into NEW directories; never overwrite live state.
      await adapter.restore(request);
    }
    // Exact ledger/checksum validation using TARGET release, including after restore.
    await adapter.assertSchema(request);
    await adapter.activate(request); // Atomic code pointer; shared runtime directories preserved.
    await adapter.start();
    if (await adapter.ready() !== true) throw new Error('RELEASE: readiness failed');
    await adapter.record({ phase: 'ready', digest: request.digest });
    await adapter.maintenance(false);
  } catch {
    // Never expose provider exceptions, commands, environment, response bodies or secrets.
    try { await adapter.maintenance(true); await adapter.stop(); } catch { /* operator must confirm isolation */ }
    throw new Error('RELEASE: stopped in maintenance; inspect private state and use runbook');
  } finally { unlock(); }
}
module.exports = { release };
