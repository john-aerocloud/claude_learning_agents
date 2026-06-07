import { handleDisconnect } from '../../lambda/ws/disconnect-handler';
import type { LocalGameStore } from './adapters/local-store';
import type { LocalRelay } from './adapters/local-relay';
import type { LocalConnectionStore } from './adapters/local-connection-store';

/**
 * handleLocalDisconnect — the local stand-up's $disconnect orchestration (UC1-S6,
 * principles/02). It delegates to the SAME cloud handler (handleDisconnect) over
 * the local adapters, so the survivor-notify flow stands up locally behind the
 * identical ports + the identical pure decideDisconnect domain (§41 local/cloud
 * parity). The local adapters reproduce the abandon-CAS BRANCH (a JS map cannot
 * reproduce real DDB conditional atomicity — that platform guarantee is the
 * ABANDON_CONDITION_EXPRESSION pin + UC4 prod, not this stand-up).
 */
export interface LocalDisconnectDeps {
  connections: LocalConnectionStore;
  store: LocalGameStore;
  relay: LocalRelay;
}

export async function handleLocalDisconnect(
  connectionId: string,
  deps: LocalDisconnectDeps,
): Promise<void> {
  await handleDisconnect(connectionId, {
    connections: deps.connections,
    store: deps.store,
    relay: deps.relay,
    buildSha: 'local',
    log: () => {
      /* local stand-up: structured logs are a cloud concern (the S4 pin is prod) */
    },
  });
}
