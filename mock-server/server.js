const express = require('express');

const app = express();
app.use(express.json());

// In-memory store, keyed by deviceId+localId (NOT localId alone).
// This is the fix for Scenario A: local IDs are only unique per-device,
// so two devices both producing "School_1" must not collide.
const records = new Map();

function keyFor(deviceId, localId) {
  return `${deviceId}::${localId}`;
}

app.post('/sync-survey', (req, res) => {
  const { deviceId, localId, submissionId, surveyId, answers } = req.body || {};

  const missing = ['deviceId', 'localId', 'submissionId', 'surveyId', 'answers'].filter(
    (field) => req.body?.[field] === undefined
  );
  if (missing.length > 0) {
    return res.status(400).json({ error: 'missing_fields', fields: missing });
  }

  const key = keyFor(deviceId, localId);
  const existing = records.get(key);

  if (existing) {
    if (existing.submissionId === submissionId) {
      // Same device retried the same submission (e.g. timeout then retry).
      // Idempotent no-op: do NOT create a duplicate, do NOT overwrite.
      return res.status(200).json({
        status: 'duplicate_ignored',
        serverId: existing.serverId,
      });
    }
    // Same device, same local record, but a new submissionId: this is a
    // legitimate re-save of the same survey (edited before sync), so we
    // update in place rather than creating a second record.
    existing.submissionId = submissionId;
    existing.answers = answers;
    existing.updatedAt = new Date().toISOString();
    return res.status(200).json({ status: 'updated', serverId: existing.serverId });
  }

  const serverId = `srv_${records.size + 1}_${Math.random().toString(36).slice(2, 8)}`;
  records.set(key, {
    serverId,
    deviceId,
    localId,
    submissionId,
    surveyId,
    answers,
    createdAt: new Date().toISOString(),
  });

  return res.status(201).json({ status: 'created', serverId });
});

// Test/debug helpers — not part of the real API surface, just so the
// automated tests can assert on server-side state without a real DB.
app.get('/sync-survey/:deviceId/:localId', (req, res) => {
  const record = records.get(keyFor(req.params.deviceId, req.params.localId));
  if (!record) return res.status(404).json({ error: 'not_found' });
  res.json(record);
});

app.get('/_debug/records', (_req, res) => {
  res.json(Array.from(records.values()));
});

app.post('/_debug/reset', (_req, res) => {
  records.clear();
  res.status(204).end();
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`mock sync-survey server listening on :${PORT}`);
});
