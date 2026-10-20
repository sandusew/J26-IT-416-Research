const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireOwnership } = require('../src/middleware/auth');

function run(role, studentId, target) {
  return new Promise((resolve) => {
    const req = { user: { role, studentId }, params: { studentId: target } };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ status: this.statusCode, body });
      },
    };
    requireOwnership('studentId')(req, res, () => resolve({ status: 200, body: null }));
  });
}

describe('learner record ownership', () => {
  it('lets a student read only their own id', async () => {
    const ok = await run('student', 'demo_s0001', 'demo_s0001');
    assert.equal(ok.status, 200);
    const denied = await run('student', 'demo_s0001', 'other');
    assert.equal(denied.status, 403);
  });

  it('rejects a teacher who guesses a student id', async () => {
    const denied = await run('teacher', undefined, 'demo_s0001');
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, 'forbidden_ownership');
  });

  it('allows admin', async () => {
    const ok = await run('admin', undefined, 'demo_s0001');
    assert.equal(ok.status, 200);
  });
});
