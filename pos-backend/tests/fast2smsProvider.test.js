const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  sendOtp,
  Fast2SmsError,
  toIndianTenDigit,
} = require("../services/fast2smsProvider");

/**
 * Fast2SMS provider — unit tests.
 *
 * We stub globalThis.fetch so the tests never make a real network call. The
 * point is to prove the provider's control flow:
 *   - key/number validation
 *   - success parsing (return:true → { ok:true, requestId })
 *   - hard failure raises non-retryable Fast2SmsError
 *   - transient failure (5xx / abort) retries exactly once
 */

const stubFetch = (impl) => {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = original;
  };
};

test("toIndianTenDigit strips non-digits and takes trailing 10 chars", () => {
  assert.equal(toIndianTenDigit("+91 98765 43210"), "9876543210");
  assert.equal(toIndianTenDigit("91-98765-43210"), "9876543210");
  assert.equal(toIndianTenDigit("9876543210"), "9876543210");
  assert.equal(toIndianTenDigit("bad"), "");
});

test("rejects when no API key is configured", async () => {
  await assert.rejects(sendOtp({ phone: "9876543210", otp: "123456" }), (err) => {
    assert.ok(err instanceof Fast2SmsError);
    assert.match(err.message, /API key/i);
    return true;
  });
});

test("rejects when the phone number is not 10 digits", async () => {
  await assert.rejects(
    sendOtp({ phone: "12345", otp: "123456", apiKey: "test" }),
    (err) => err instanceof Fast2SmsError && /10-digit/.test(err.message)
  );
});

test("success: parses return:true + request_id", async () => {
  const restore = stubFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ return: true, request_id: "req-abc-123" }),
  }));
  try {
    const res = await sendOtp({
      phone: "+91 98765 43210",
      otp: "654321",
      apiKey: "test",
    });
    assert.equal(res.ok, true);
    assert.equal(res.requestId, "req-abc-123");
  } finally {
    restore();
  }
});

test("hard failure (401 invalid API key) throws non-retryable Fast2SmsError", async () => {
  let calls = 0;
  const restore = stubFetch(async () => {
    calls += 1;
    return {
      ok: false,
      status: 401,
      json: async () => ({ return: false, status_code: 412, message: "Invalid Authentication" }),
    };
  });
  try {
    await assert.rejects(
      sendOtp({ phone: "9876543210", otp: "111111", apiKey: "bad" }),
      (err) => {
        assert.ok(err instanceof Fast2SmsError);
        assert.equal(err.retryable, false);
        assert.equal(err.status, 401);
        return true;
      }
    );
    assert.equal(calls, 1, "must NOT retry on non-retryable errors");
  } finally {
    restore();
  }
});

test("transient failure (5xx) retries exactly once, then throws", async () => {
  let calls = 0;
  const restore = stubFetch(async () => {
    calls += 1;
    return {
      ok: false,
      status: 502,
      json: async () => ({ return: false, message: "Bad Gateway" }),
    };
  });
  try {
    await assert.rejects(
      sendOtp({ phone: "9876543210", otp: "111111", apiKey: "test" }),
      (err) => err instanceof Fast2SmsError && err.status === 502
    );
    assert.equal(calls, 2, "should retry exactly once on 5xx");
  } finally {
    restore();
  }
});

test("SECURITY: API key is never logged in the thrown error message", async () => {
  const restore = stubFetch(async () => ({
    ok: false,
    status: 401,
    json: async () => ({ return: false, message: "Invalid Authentication" }),
  }));
  try {
    let caught;
    try {
      await sendOtp({
        phone: "9876543210",
        otp: "222222",
        apiKey: "supersecret-should-never-appear",
      });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "expected sendOtp to throw");
    assert.ok(
      !String(caught.message).includes("supersecret"),
      "API key must not appear in the error message"
    );
    assert.ok(
      !JSON.stringify(caught.providerBody || {}).includes("supersecret"),
      "API key must not appear in providerBody"
    );
  } finally {
    restore();
  }
});
