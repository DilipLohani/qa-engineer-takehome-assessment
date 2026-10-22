import { test, expect, APIRequestContext } from '@playwright/test';

const BASE_URL = 'http://localhost:4000';

async function reset(request: APIRequestContext) {
  await request.post(`${BASE_URL}/_debug/reset`);
}

function surveyPayload(overrides: Record<string, unknown> = {}) {
  return {
    deviceId: 'device_ankit',
    localId: 'School_1',
    submissionId: 'sub_001',
    surveyId: 'student_daily_habits',
    answers: { q_1: 'Govt Primary School' },
    ...overrides,
  };
}

test.describe('POST /sync-survey — duplicate local ID handling', () => {
  // These tests share one mock-server process and mutate its in-memory
  // store, so they must not interleave with each other.
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ request }) => {
    await reset(request);
  });

  test('two different devices registering the same local ID both succeed as distinct records', async ({
    request,
  }) => {
    // Ankit's phone and Pooja's phone each independently generated "School_1".
    const ankit = await request.post(`${BASE_URL}/sync-survey`, {
      data: surveyPayload({ deviceId: 'device_ankit', submissionId: 'sub_ankit_1' }),
    });
    expect(ankit.status()).toBe(201);
    const ankitBody = await ankit.json();
    expect(ankitBody.status).toBe('created');

    const pooja = await request.post(`${BASE_URL}/sync-survey`, {
      data: surveyPayload({ deviceId: 'device_pooja', submissionId: 'sub_pooja_1' }),
    });
    expect(pooja.status()).toBe(201);
    const poojaBody = await pooja.json();
    expect(poojaBody.status).toBe('created');

    // Critically: neither overwrote the other, and they got different server IDs.
    expect(poojaBody.serverId).not.toBe(ankitBody.serverId);

    const all = await (await request.get(`${BASE_URL}/_debug/records`)).json();
    expect(all).toHaveLength(2);
  });

  test('the same device retrying the same submission does not create a duplicate (idempotency)', async ({
    request,
  }) => {
    // Simulates a sync that succeeded server-side but the client never saw the
    // ack (connection dropped) and retries with the same submissionId.
    const first = await request.post(`${BASE_URL}/sync-survey`, { data: surveyPayload() });
    expect(first.status()).toBe(201);
    const firstBody = await first.json();

    const retry = await request.post(`${BASE_URL}/sync-survey`, { data: surveyPayload() });
    expect(retry.status()).toBe(200);
    const retryBody = await retry.json();
    expect(retryBody.status).toBe('duplicate_ignored');
    expect(retryBody.serverId).toBe(firstBody.serverId);

    const all = await (await request.get(`${BASE_URL}/_debug/records`)).json();
    expect(all).toHaveLength(1);
  });

  test('the same device re-saving the same local record with a new submissionId updates in place', async ({
    request,
  }) => {
    await request.post(`${BASE_URL}/sync-survey`, { data: surveyPayload() });

    const edited = await request.post(`${BASE_URL}/sync-survey`, {
      data: surveyPayload({ submissionId: 'sub_002', answers: { q_1: 'Govt Primary School (corrected)' } }),
    });
    expect(edited.status()).toBe(200);
    expect((await edited.json()).status).toBe('updated');

    const all = await (await request.get(`${BASE_URL}/_debug/records`)).json();
    expect(all).toHaveLength(1);
    expect(all[0].answers.q_1).toBe('Govt Primary School (corrected)');
  });

  test('concurrent syncs from many devices with colliding local IDs all land safely', async ({
    request,
  }) => {
    // Approximates the "50,000 users sync at once" scenario at small scale:
    // many devices, all using the same locally-generated localId, firing
    // concurrently. None should be lost or overwritten.
    const deviceCount = 25;
    const requests = Array.from({ length: deviceCount }, (_, i) =>
      request.post(`${BASE_URL}/sync-survey`, {
        data: surveyPayload({ deviceId: `device_${i}`, submissionId: `sub_${i}` }),
      })
    );

    const responses = await Promise.all(requests);
    for (const response of responses) {
      expect(response.status()).toBe(201);
    }

    const all = await (await request.get(`${BASE_URL}/_debug/records`)).json();
    expect(all).toHaveLength(deviceCount);
    expect(new Set(all.map((r: { serverId: string }) => r.serverId)).size).toBe(deviceCount);
  });

  test('rejects a payload missing required fields instead of silently accepting it', async ({
    request,
  }) => {
    const response = await request.post(`${BASE_URL}/sync-survey`, {
      data: { deviceId: 'device_ankit', localId: 'School_1' }, // missing submissionId/surveyId/answers
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('missing_fields');
    expect(body.fields).toEqual(expect.arrayContaining(['submissionId', 'surveyId', 'answers']));
  });
});
