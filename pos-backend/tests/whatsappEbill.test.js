const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

/**
 * The e-bill path: a signed public bill link, and the WhatsApp template that
 * carries it.
 *
 * Two failure modes drive these tests, and neither one raises an error at
 * runtime:
 *
 *   1. The link. It used to be `${FRONTEND_URL}/receipt/${orderNumber}` --
 *      a route that did not exist, behind an API that required a staff
 *      login, keyed by a SEQUENTIAL number. Had it ever resolved, subtracting
 *      one would have shown the previous customer's bill.
 *
 *   2. The variable order. WhatsApp and DLT both fill numbered placeholders,
 *      and both answer 200 when the values are in the wrong holes. The
 *      customer just reads their order number where the total should be.
 */

const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

/**
 * Source guards should read the CODE, not the prose around it. The comment
 * explaining why the old broken URL was replaced quotes that URL, and a naive
 * scan matched its own documentation.
 */
const CODE = (rel) =>
  SRC(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

const withEnv = async (vars, fn) => {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

const ID_A = "65f1a2b3c4d5e6f708192a3b";
const ID_B = "65f1a2b3c4d5e6f708192a3c"; // the very next id

// ---------------------------------------------------------------------------
// Signed receipt links
// ---------------------------------------------------------------------------

test("a receipt token round-trips", async () => {
  await withEnv({ RECEIPT_LINK_SECRET: "s3cr3t" }, () => {
    const link = require("../services/receiptLink");
    const parsed = link.readToken(link.tokenForOrder(ID_A));
    assert.equal(parsed.id, ID_A);
    assert.equal(parsed.isOrder, true);
    assert.equal(parsed.isSession, false);
  });
});

test("REGRESSION: an adjacent order id does not yield a usable link", async () => {
  await withEnv({ RECEIPT_LINK_SECRET: "s3cr3t" }, () => {
    const link = require("../services/receiptLink");
    const mine = link.tokenForOrder(ID_A);

    // What the old scheme let you do: edit the identifier in the URL.
    const guessed = mine.replace(ID_A, ID_B);
    assert.notEqual(guessed, mine);
    assert.equal(link.readToken(guessed), null, "a swapped id must not verify");

    // And the real neighbouring link is signed differently.
    assert.notEqual(link.tokenForOrder(ID_B), guessed);
  });
});

test("tampered signatures, wrong kinds and junk are all refused", async () => {
  await withEnv({ RECEIPT_LINK_SECRET: "s3cr3t" }, () => {
    const link = require("../services/receiptLink");
    const t = link.tokenForOrder(ID_A);

    assert.equal(link.readToken(t.slice(0, -1) + "Z"), null, "bad signature");
    assert.equal(link.readToken(t.replace(/^o_/, "s_")), null, "order token reused as session");
    assert.equal(link.readToken(""), null);
    assert.equal(link.readToken("../../etc/passwd"), null);
    assert.equal(link.readToken(`o_${ID_A}`), null, "signature omitted entirely");
  });
});

test("an order token and a session token for the same id differ", async () => {
  await withEnv({ RECEIPT_LINK_SECRET: "s3cr3t" }, () => {
    const link = require("../services/receiptLink");
    assert.notEqual(link.tokenForOrder(ID_A), link.tokenForSession(ID_A));
    assert.equal(link.readToken(link.tokenForSession(ID_A)).isSession, true);
  });
});

test("REGRESSION: a signature containing an underscore still verifies", async () => {
  // base64url's alphabet includes "_", so about half of all keys produce
  // signatures with one in them. Parsing the token with split("_") gave four
  // parts instead of three and rejected the link -- and which keys were
  // affected depended entirely on the signing secret, so it would have looked
  // like "receipts work in staging but not in production".
  await withEnv({ RECEIPT_LINK_SECRET: "seed-0" }, () => {
    const link = require("../services/receiptLink");
    const token = link.tokenForOrder(ID_A);
    assert.ok(token.split("_").length > 3, "this key really does produce the awkward case");
    assert.equal(link.readToken(token)?.id, ID_A);
  });
});

test("with no signing key configured, nothing verifies and nothing is minted", async () => {
  await withEnv(
    { RECEIPT_LINK_SECRET: undefined, CREDENTIALS_SECRET: undefined, JWT_SECRET: undefined },
    () => {
      const link = require("../services/receiptLink");
      // A default key would be a PUBLIC key: every receipt ever issued would
      // be enumerable by anyone who read the source.
      assert.throws(() => link.tokenForOrder(ID_A), /signing key/i);
      assert.equal(link.readToken(`o_${ID_A}_aaaaaaaaaaaaaaaaaaaaaa`), null);
    },
  );
});

test("the public URL is absolute and points at the API host", async () => {
  await withEnv(
    { RECEIPT_LINK_SECRET: "s3cr3t", PUBLIC_API_URL: "https://api.knotkitchen.online/" },
    () => {
      const link = require("../services/receiptLink");
      const url = link.urlForOrder(ID_A);
      assert.match(url, /^https:\/\/api\.knotkitchen\.online\/r\/o_/);
      assert.ok(!url.includes("//r/"), "trailing slash on the base must not double up");
    },
  );
});

// ---------------------------------------------------------------------------
// The WhatsApp transport
// ---------------------------------------------------------------------------

const captureFetch = () => {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: true, message: "Message sent successfully", request_id: "req_1" }),
    };
  };
  return { calls, restore: () => { global.fetch = original; } };
};

test("a WhatsApp template send carries template, number and variables", async () => {
  const { calls, restore } = captureFetch();
  try {
    const { sendWhatsAppTemplate } = require("../services/fast2smsProvider");
    const res = await sendWhatsAppTemplate({
      phone: "+91 94776 23682",
      messageId: "31172",
      phoneNumberId: "PNID99",
      apiKey: "KEY",
      variables: ["Spice Garden", "A-1042", "525.00", "https://api.knotkitchen.online/r/o_x_y"],
    });

    assert.equal(res.ok, true);
    assert.equal(res.requestId, "req_1");

    const url = new URL(calls[0].url);
    assert.equal(url.origin + url.pathname, "https://www.fast2sms.com/dev/whatsapp");
    assert.equal(url.searchParams.get("message_id"), "31172");
    assert.equal(url.searchParams.get("phone_number_id"), "PNID99");
    assert.equal(url.searchParams.get("numbers"), "9477623682", "+91 and spaces stripped");
    assert.equal(
      url.searchParams.get("variables_values"),
      "Spice Garden|A-1042|525.00|https://api.knotkitchen.online/r/o_x_y",
    );
    assert.equal(calls[0].opts.headers.authorization, "KEY");
  } finally {
    restore();
  }
});

test("a pipe inside a value cannot shift every later variable", async () => {
  const { calls, restore } = captureFetch();
  try {
    const { sendWhatsAppTemplate } = require("../services/fast2smsProvider");
    await sendWhatsAppTemplate({
      phone: "9477623682",
      messageId: "1",
      phoneNumberId: "p",
      apiKey: "k",
      // A restaurant is free to name itself this.
      variables: ["Bar | Grill", "A-1", "10.00", "https://x/y"],
    });
    const values = new URL(calls[0].url).searchParams.get("variables_values").split("|");
    assert.equal(values.length, 4, "one pipe per variable, no more");
    assert.equal(values[0], "Bar Grill");
    assert.equal(values[2], "10.00", "the total is still the third value");
  } finally {
    restore();
  }
});

test("a blank variable is refused rather than sent", async () => {
  const { calls, restore } = captureFetch();
  try {
    const { sendWhatsAppTemplate } = require("../services/fast2smsProvider");
    await assert.rejects(
      () =>
        sendWhatsAppTemplate({
          phone: "9477623682",
          messageId: "1",
          phoneNumberId: "p",
          apiKey: "k",
          variables: ["Spice Garden", "", "10.00", "https://x/y"],
        }),
      /variable 2 is empty/,
    );
    assert.equal(calls.length, 0, "nothing should have been sent");
  } finally {
    restore();
  }
});

test("a WhatsApp rejection is surfaced, not swallowed", async () => {
  const original = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    // The WhatsApp API says `status: false`, where the SMS API says `return: false`.
    json: async () => ({ status: false, message: "Invalid Message ID" }),
  });
  try {
    const { sendWhatsAppTemplate } = require("../services/fast2smsProvider");
    await assert.rejects(
      () =>
        sendWhatsAppTemplate({
          phone: "9477623682",
          messageId: "nope",
          phoneNumberId: "p",
          apiKey: "k",
          variables: ["a"],
        }),
      /Invalid Message ID/,
    );
  } finally {
    global.fetch = original;
  }
});

test("missing configuration is named specifically", async () => {
  const { sendWhatsAppTemplate } = require("../services/fast2smsProvider");
  await assert.rejects(
    () => sendWhatsAppTemplate({ phone: "9477623682", messageId: "1", apiKey: "k" }),
    /phone_number_id/,
    "the operator needs to know WHICH value is missing",
  );
});

// ---------------------------------------------------------------------------
// Channel selection and variable order
// ---------------------------------------------------------------------------

test("e-bills use WhatsApp when it is configured, and fall back cleanly", async () => {
  const { MESSAGES, channelFor } = require("../services/messagingService");

  await withEnv(
    {
      FAST2SMS_EBILL_WHATSAPP_MESSAGE_ID: "31172",
      FAST2SMS_WHATSAPP_PHONE_NUMBER_ID: "PNID",
    },
    () => assert.equal(channelFor(MESSAGES.eBill), "whatsapp"),
  );

  await withEnv(
    {
      FAST2SMS_EBILL_WHATSAPP_MESSAGE_ID: "31172",
      FAST2SMS_WHATSAPP_PHONE_NUMBER_ID: undefined, // half-configured
      FAST2SMS_EBILL_TEMPLATE_ID: "555",
      FAST2SMS_SENDER_ID: "KNOTKT",
    },
    () =>
      assert.equal(
        channelFor(MESSAGES.eBill),
        "dlt",
        "a WhatsApp id with no number id must not be attempted",
      ),
  );

  await withEnv(
    {
      FAST2SMS_EBILL_WHATSAPP_MESSAGE_ID: undefined,
      FAST2SMS_WHATSAPP_PHONE_NUMBER_ID: undefined,
      FAST2SMS_EBILL_TEMPLATE_ID: undefined,
      FAST2SMS_SENDER_ID: undefined,
    },
    () => assert.equal(channelFor(MESSAGES.eBill), "v3"),
  );
});

test("the e-bill variable order matches the registered WhatsApp template", () => {
  const { MESSAGES } = require("../services/messagingService");

  // knotkitchen_ebill, as approved:
  //   HEADER  Order E-Bill from {{1}}
  //   BODY    Order No: {{1}} / Total: Rs {{2}} / View Bill: {{3}}
  // flattened header-first.
  const values = MESSAGES.eBill.whatsapp.variables({
    restaurantName: "Spice Garden",
    orderNumber: "A-1042",
    total: "525.00",
    receiptUrl: "https://api.knotkitchen.online/r/o_x_y",
  });

  assert.deepEqual(values, [
    "Spice Garden",                              // header {{1}}
    "A-1042",                                    // body {{1}}
    "525.00",                                    // body {{2}}
    "https://api.knotkitchen.online/r/o_x_y",    // body {{3}}
  ]);
});

test("the total is a bare amount -- the template supplies the currency symbol", () => {
  // Lives in eBillService now, so the manual button and the automatic send
  // format it identically rather than each doing their own.
  assert.match(
    SRC("services/eBillService.js"),
    /Number\(receipt\.total \|\| 0\)\.toFixed\(2\)/,
    "'Total: Rs {{2}}' must not become 'Total: Rs Rs525'",
  );
});

// ---------------------------------------------------------------------------
// The public page
// ---------------------------------------------------------------------------

test("the public receipt escapes operator- and diner-supplied text", () => {
  const { render } = require("../controllers/publicReceiptController");
  const html = render({
    restaurant: { name: '<script>alert(1)</script>', address: "MG Road" },
    orderNumber: 'A"1042',
    dateTime: new Date().toISOString(),
    customerInformation: { name: "<img src=x onerror=alert(1)>" },
    items: [{ name: "<b>Paneer</b>", price: 250, quantity: 2, total: 500, modifiers: [] }],
    quantities: 2,
    subtotal: 500,
    taxes: 25,
    charges: 0,
    total: 525,
    paymentStatus: "PAID",
    paymentMethod: "Paid by Cash",
  });

  assert.ok(!html.includes("<script>alert(1)</script>"), "store name must not execute");
  assert.ok(!html.includes("<img src=x"), "customer name must not execute");
  assert.ok(!html.includes("<b>Paneer</b>"), "item name must not inject markup");
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /525\.00/, "the total still renders");
});

test("SOURCE: the dead FRONTEND_URL receipt link is gone", () => {
  // The link is built in the service both senders share; neither of them may
  // reintroduce the old one.
  for (const file of ["controllers/receiptController.js", "services/eBillService.js"]) {
    assert.ok(
      !/FRONTEND_URL.*\/receipt\//.test(CODE(file)),
      `${file}: that URL had no route, needed a staff login, and was keyed by a sequential number`,
    );
  }
  assert.match(
    CODE("services/eBillService.js"),
    /urlForSession|urlForOrder/,
    "the signed link builder is used instead",
  );
});

test("SOURCE: the public receipt route is mounted and unauthenticated", () => {
  assert.match(SRC("app.js"), /app\.use\("\/r", require\("\.\/routes\/publicReceiptRoute"\)\)/);
  const route = SRC("routes/publicReceiptRoute.js");
  assert.ok(
    !/isVerifiedUser|isAuthorized/.test(route),
    "a customer has no session; the signed token is the authorisation",
  );
});
