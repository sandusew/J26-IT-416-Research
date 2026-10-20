/**
 * Safe Mongo diagnostics — never print passwords or full URIs with secrets.
 */

function redactMongoUri(uri) {
  const s = String(uri || '');
  if (!s) return null;
  return s.replace(/:\/\/([^:/?#]+):([^@]+)@/, '://$1:***@');
}

function mongoIdentity(uri) {
  const s = String(uri || '');
  const out = {
    configured: !!s,
    scheme: null,
    isAtlas: false,
    database: null,
    hostHint: null,
    redactedUri: redactMongoUri(s),
  };
  if (!s) return out;
  out.isAtlas = s.startsWith('mongodb+srv://');
  out.scheme = out.isAtlas ? 'mongodb+srv' : s.startsWith('mongodb://') ? 'mongodb' : 'unknown';
  try {
    // Hide credentials for URL parsing
    const parseable = s.replace(/:\/\/([^:/?#]+):([^@]+)@/, '://$1@');
    const u = new URL(parseable);
    out.hostHint = u.hostname || null;
    const db = (u.pathname || '').replace(/^\//, '').split('/')[0];
    out.database = db || null;
  } catch {
    const m = s.match(/mongodb(?:\+srv)?:\/\/(?:[^@]+@)?([^/?]+)\/?([^?]*)/);
    if (m) {
      out.hostHint = m[1];
      out.database = (m[2] || '').split('/')[0] || null;
    }
  }
  return out;
}

module.exports = { redactMongoUri, mongoIdentity };
