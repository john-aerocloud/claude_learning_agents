import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { OxoGameStack } from '../lib/game-stack';

/**
 * §30 composed WebSocket contract test (delta §30; T7) — gates Phase E deploy.
 *
 * s004's §30 boundary was CloudFront /api/* <-> HTTP route key. s005's boundary
 * is the wss-URL handoff: OxoGameProd PRODUCES the WS endpoint; the deploy /
 * config-injection step CONSUMES it; the SPA CONNECTS with it. This test pins
 * all three so a rename on either side fails at synth/CI, not in prod (the
 * s004 prod-404 defect class):
 *
 *   1. The WS API synthesises EXACTLY the four route keys, no $default.
 *   2. The client `action` values the SPA sends (register, join) each equal a
 *      synthesised RouteKey (the $request.body.action selector match — the WS
 *      analogue of s004's path<->route-key check).
 *   3. OxoGameProd synthesises a CfnOutput exportName OxoGameProd-WsApiEndpoint
 *      resolving to id + /prod (not a placeholder).
 *   4. The deploy config-injection source the SPA reads for wsUrl references
 *      that exact export/output name.
 */

// The client `action` values the SPA sends over the socket. These MUST match
// synthesised WS route keys (the $request.body.action selector). Encoded here
// as the contract boundary the SPA and the API share.
const CLIENT_ACTION_VALUES = ['register', 'join', 'move'] as const;

const WS_ENDPOINT_OUTPUT_NAME = 'OxoGameProd-WsApiEndpoint';

// The pipeline file that performs the wsUrl config injection (the consumer side
// of the handoff). Read as a string so a rename of the output it references
// fails this test at CI.
const DEPLOY_WORKFLOW = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '.github',
  'workflows',
  'deploy-oxo-online.yml',
);

function synth(): Template {
  const app = new cdk.App();
  return Template.fromStack(
    new OxoGameStack(app, 'OxoGameProd', {
      env: { account: '123456789012', region: 'eu-west-2' },
    }),
  );
}

function wsRouteKeys(template: Template): string[] {
  const apis = template.findResources('AWS::ApiGatewayV2::Api', {
    Properties: { ProtocolType: 'WEBSOCKET' },
  });
  const wsApiLogicalId = Object.keys(apis)[0];
  const routes = template.findResources('AWS::ApiGatewayV2::Route');
  return Object.values(routes)
    .filter(
      (r) =>
        ((r.Properties as Record<string, unknown>).ApiId as { Ref?: string })
          ?.Ref === wsApiLogicalId,
    )
    .map((r) => (r.Properties as Record<string, unknown>).RouteKey as string);
}

describe('§30 composed WS contract (T7) — route keys, action match, endpoint export, wsUrl source', () => {
  it('1. synthesises exactly the five route keys (s006 move added) and no $default', () => {
    const keys = wsRouteKeys(synth()).sort();
    expect(keys).toEqual(['$connect', '$disconnect', 'join', 'move', 'register']);
    expect(keys).not.toContain('$default');
  });

  it('2. every client action value equals a synthesised WS route key', () => {
    const keys = new Set(wsRouteKeys(synth()));
    for (const action of CLIENT_ACTION_VALUES) {
      expect(keys.has(action)).toBe(true);
    }
  });

  it('3. exports OxoGameProd-WsApiEndpoint resolving to id + /prod (not a placeholder)', () => {
    const template = synth();
    template.hasOutput('WsApiEndpoint', {
      Export: { Name: WS_ENDPOINT_OUTPUT_NAME },
    });
    const outputs = template.findOutputs('WsApiEndpoint');
    const value = JSON.stringify(Object.values(outputs)[0].Value);
    expect(value).toContain('wss://');
    expect(value).toContain('/prod');
    // Must reference the real WS API id (Fn::Join over a Ref), not a literal
    // placeholder string.
    expect(value).toContain('Ref');
  });

  it('4. the deploy config-injection step sources wsUrl from the WsApiEndpoint output', () => {
    const workflow = readFileSync(DEPLOY_WORKFLOW, 'utf8');
    // The config injection must read the WsApiEndpoint CloudFormation output...
    expect(workflow).toContain('WsApiEndpoint');
    // ...and write it into the SPA runtime config key the SPA reads.
    expect(workflow).toContain('wsUrl');
    // A rename of the output name on the producer side (game-stack) without
    // updating this consumer fails test #3 or this assertion at CI.
  });

  // s006 R4.7 factor-out (§40): the UC4 flag was removed from code AND config at
  // slice delivery once UC3 deployed and the walking-skeleton proved the path.
  // This asserts the negative — the orphan flag MUST NOT linger in the pipeline
  // (an orphan flag at retro is a §40 principle failure).
  it('5. the config-injection step carries NO uc4Enabled flag (factored out, §40)', () => {
    const workflow = readFileSync(DEPLOY_WORKFLOW, 'utf8');
    expect(workflow).not.toContain('uc4Enabled');
  });
});
