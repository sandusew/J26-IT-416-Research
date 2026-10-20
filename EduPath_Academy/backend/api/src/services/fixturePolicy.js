/**
 * Server-side fixture isolation.
 * Client flags (allowTestFixtures / includeFixtures) never enable fixtures alone.
 */
const config = require('../config');

function fixturesAllowedByServer() {
  if (config.nodeEnv === 'production') return false;
  return config.allowTestFixtures === true;
}

/**
 * Resolve whether fixture catalogue items may be used for this request.
 * @param {boolean|string|undefined} clientFlag - body/query hint (ignored unless server allows)
 * @returns {{ allowed: boolean, reason: string|null, serverEnabled: boolean, clientRequested: boolean }}
 */
function resolveFixtureAccess(clientFlag) {
  const clientRequested =
    clientFlag === true || clientFlag === 'true' || clientFlag === '1' || clientFlag === 1;
  const serverEnabled = fixturesAllowedByServer();
  if (clientRequested && !serverEnabled) {
    return {
      allowed: false,
      reason:
        config.nodeEnv === 'production'
          ? 'fixtures_forbidden_in_production'
          : 'fixtures_require_server_ARTS_AI_ALLOW_TEST_FIXTURES',
      serverEnabled,
      clientRequested,
    };
  }
  if (!serverEnabled) {
    return {
      allowed: false,
      reason: null,
      serverEnabled,
      clientRequested: false,
    };
  }
  // Server allows fixtures only when client also opts in (isolated test/demo context)
  if (!clientRequested) {
    return {
      allowed: false,
      reason: null,
      serverEnabled,
      clientRequested: false,
    };
  }
  return { allowed: true, reason: null, serverEnabled, clientRequested: true };
}

/** Mongo filter clause: exclude fixtures unless access.allowed */
function applyFixtureFilter(filter, access) {
  const out = { ...filter };
  if (!access.allowed) {
    out.isTestFixture = { $ne: true };
  }
  return out;
}

module.exports = {
  fixturesAllowedByServer,
  resolveFixtureAccess,
  applyFixtureFilter,
};
