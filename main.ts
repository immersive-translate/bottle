import "https://deno.land/std@0.206.0/dotenv/load.ts";
import { ulid } from "https://deno.land/x/ulid@v0.3.0/mod.ts";
import { Context, Hono } from "https://deno.land/x/hono@v3.4.1/mod.ts";

interface Bottle {
  bottleId: string;
  letter: string;
  fromConversationId: string;
  fromEphemeralUserId: string;
  fromGptId: string;
  fromIsoCode?: string;
  createdAt: string;
  updatedAt: string;
  filterMeta: Record<string, string>;
  pickedConversationId?: string;
  pickedGptId?: string;
  pickedIsoCode?: string;
  pickedEphemeralUserId?: string;
  pickedAt?: string;
  replies: Message[];
}

interface Message {
  letterId: string;
  fromConversationId: string;
  fromEphemeralUserId: string;
  fromGptId: string;
  fromIsoCode?: string;
  toConversationId: string;
  toEphemeralUserId: string;
  toIsoCode?: string;
  toGptId: string;
  bottleId: string;
  letter: string;
  createdAt: string;
  updatedAt: string;
}

const ConversationIdField = "openai-conversation-id";
const EphemeralUserIdField = "openai-ephemeral-user-id";
const GptIdField = "openai-gpt-id";
const IsoCodeField = "openai-subdivision-1-iso-code";

// @ts-ignore: it's ok
const kv = await Deno.openKv();

// !!! Danger !!!
// !!! Clear all data in kv store !!!
// clearDb();

const app = new Hono();
app.onError((err, c) => {
  console.error(`${err}`);
  return c.json({
    message: err.message,
  }, 500);
});

// use auth for /admin/*
app.use("/admin/*", async (c, next) => {
  const headerToken = c.req.header("token");
  const queryToken = c.req.query("token");
  let token = "";
  if (queryToken) {
    token = queryToken;
  } else if (headerToken) {
    token = headerToken;
  }
  if (token === Deno.env.get("ADMIN_TOKEN")) {
    return await next();
  } else {
    return c.json({
      message: "unauthorized",
    }, 401);
  }
});

app.get("/", (c) => c.text("Welcome to GPT API!"));

app.get("/api/send-bottle-with-letter", async (c) => {
  const letter = c.req.query("letter");

  if (!letter) {
    throw new Error("letter is required");
  }

  const targetGender = c.req.query("targetGender");
  const targetMinAge = c.req.query("targetMinAge");
  const targetMaxAge = c.req.query("targetMaxAge");
  const targetLanguages = c.req.query("targetLanguages");
  const targetCountry = c.req.query("targetIsoCountryCode");
  const targetRegion = c.req.query("targetIsoRegionCode");

  const fromGender = c.req.query("fromGender");
  const fromAge = c.req.query("fromAge");
  const fromLanguages = c.req.query("fromLanguages");

  const authInfo = getAuthInfo(c);
  const { conversationId, ephemeralUserId, gptId, isoCode } = authInfo;

  const globalBottleId = ulid();
  const meta: Record<string, string> = {};
  if (isoCode) {
    meta["fromIsoCode"] = isoCode;
    meta["fromIsoCountryCode"] = isoCode.split("-")[0];
    meta["fromIsoRegionCode"] = isoCode.split("-")[1];
  }
  if (targetGender) {
    meta["targetGender"] = targetGender;
  }
  if (targetLanguages) {
    meta["targetLanguages"] = targetLanguages;
  }

  if (targetCountry) {
    meta["targetIsoCountryCode"] = targetCountry;
  }
  if (targetRegion) {
    meta["targetIsoRegionCode"] = targetRegion;
  }
  if (targetMinAge) {
    meta["targetMinAge"] = targetMinAge;
  }
  if (targetMaxAge) {
    meta["targetMaxAge"] = targetMaxAge;
  }

  if (fromGender) {
    meta["fromGender"] = fromGender;
  }
  if (fromAge) {
    meta["fromAge"] = fromAge;
  }

  if (fromLanguages) {
    meta["fromLanguages"] = fromLanguages;
  }
  console.log("send bottle filter meta", meta);

  const bottle: Bottle = {
    bottleId: globalBottleId,
    letter,
    fromConversationId: conversationId,
    fromEphemeralUserId: ephemeralUserId,
    fromIsoCode: isoCode || "",
    fromGptId: gptId,
    filterMeta: meta,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pickedConversationId: "",
    pickedEphemeralUserId: "",
    pickedGptId: "",
    pickedIsoCode: "",
    pickedAt: "",
    replies: [],
  };
  console.log("bottle", bottle);

  await kv.set([
    "bottles",
    globalBottleId,
  ], bottle);

  await kv.set([
    "active-bottles",
    globalBottleId,
  ], true);

  return c.json({
    message:
      "Send bottle successfully, remind user that they can check your unread letters later manually",
  });
});

app.get("/api/get-bottles", async (c) => {
  const fromConversationId = c.req.header(ConversationIdField);
  const authInfo = getAuthInfo(c);
  const { conversationId, ephemeralUserId, gptId, isoCode } = authInfo;
  const targetGender = c.req.query("filterGender");
  const targetMinAge = c.req.query("filterMinAge");
  const targetMaxAge = c.req.query("filterMaxAge");
  const targetLanguages = c.req.query("filterLanguages");
  const targetCountry = c.req.query("filterIsoCountryCode");
  const targetRegion = c.req.query("filterIsoRegionCode");

  const filterMeta: Record<string, string> = {};

  if (targetGender) {
    filterMeta["fromGender"] = targetGender;
  }
  if (targetLanguages) {
    filterMeta["fromLanguages"] = targetLanguages;
  }
  if (targetCountry) {
    filterMeta["fromIsoCountryCode"] = targetCountry;
  }
  if (targetRegion) {
    filterMeta["fromIsoRegionCode"] = targetRegion;
  }
  if (targetMinAge) {
    filterMeta["fromMinAge"] = targetMinAge;
  }
  if (targetMaxAge) {
    filterMeta["fromMaxAge"] = targetMaxAge;
  }
  console.log("filterMeta", filterMeta);
  // TODO filter by filterMeta
  // to get more matched bottles

  let allActiveBottleIds = [];
  const allRecentBottles: Bottle[] = [];
  const iter = kv.list({
    prefix: [
      "active-bottles",
    ],
  }, {
    limit: 100,
  });
  for await (const res of iter) {
    allActiveBottleIds.push(res.key[1]);
  }
  // get random 10 bottles

  if (allActiveBottleIds.length > 10) {
    allActiveBottleIds = allActiveBottleIds.sort(() => Math.random() - 0.5)
      .slice(0, 10);
  }

  const allBottles = await kv.getMany(allActiveBottleIds.map((id) => [
    "bottles",
    id,
  ]));

  // one bottle can only be picked by one user

  for (const bottle of allBottles) {
    const bottleValue = bottle.value;
    if (bottleValue.fromConversationId !== fromConversationId) {
      if (bottleValue.replies.length === 0) {
        allRecentBottles.push(bottle.value);
      }
    }
  }

  let message = "";

  if (allRecentBottles.length > 0) {
    message =
      `Congratulations! We have found some bottles for this user, please analyze the user's interests , show the user 1 bottle at a time (in natural language, without showing the bottle number), and ask the user to choose whether to throw it away or reply to it. If the user wants to throw it away, then you show the next bottle to the user; if the user wants to reply to it, then you call the plugin's reply API to`;
  } else {
    message =
      "Sorry, we don't have any bottles for this user, please try again later";
  }

  return c.json({
    message: message,
    bottles: allRecentBottles,
  });
});

app.get("/api/release-bottle", async (c: Context) => {
  // actually, we don't need this api now.
  const conversationId = c.req.header(ConversationIdField);
  const bottleId = c.req.query("bottleId");

  if (!conversationId) {
    throw new Error("conversationId is required");
  }
  if (!bottleId) {
    throw new Error("bottleId is required");
  }

  // TODO
  return c.json({
    message: "Release bottle successfully",
  });
});

app.get("/api/reply-bottle", async (c: Context) => {
  const letter = c.req.query("letter");
  const bottleId = c.req.query("bottleId");
  const authInfo = getAuthInfo(c);
  const { conversationId, ephemeralUserId, gptId, isoCode } = authInfo;
  // console.log("reploy bottle", bottleId, letter, "by:", conversationId);
  if (!letter) {
    throw new Error("letter is required");
  }
  if (!conversationId) {
    throw new Error("conversationId is required");
  }
  if (!bottleId) {
    throw new Error("bottleId is required");
  }

  const bottleResult = await kv.get([
    "bottles",
    bottleId,
  ]);
  if (!bottleResult.value) {
    throw new Error("bottle not found");
  }
  const bottle: Bottle = bottleResult.value;

  const bottleFromConversationId = bottle.fromConversationId;

  const allRecipients = [
    bottleFromConversationId,
  ];
  if (bottle.pickedConversationId) {
    allRecipients.push(bottle.pickedConversationId);
  }

  if (
    bottle.replies.length === 0 && bottleFromConversationId === conversationId
  ) {
    throw new Error(
      "Sorry, you can not reply to your own bottle, please try another one",
    );
  }

  if (!bottle.pickedConversationId) {
    bottle.pickedConversationId = conversationId;
    bottle.pickedEphemeralUserId = ephemeralUserId;
    bottle.pickedIsoCode = isoCode;
    bottle.pickedGptId = gptId;
    bottle.pickedAt = new Date().toISOString();
  }
  if (allRecipients.length > 1 && !allRecipients.includes(conversationId)) {
    throw new Error(
      "Sorry, this bottle just picked by other user, please try another one",
    );
  }

  let toConversationId = "";
  let toEphemeralUserId = "";
  let toIsoCode = "";
  let toGptId = "";

  if (conversationId === bottleFromConversationId) {
    toConversationId = bottle.pickedConversationId!;
    toEphemeralUserId = bottle.pickedEphemeralUserId!;
    toIsoCode = bottle.pickedIsoCode!;
    toGptId = bottle.pickedGptId!;
  } else {
    toConversationId = bottleFromConversationId;
    toEphemeralUserId = ephemeralUserId;
    toIsoCode = isoCode;
    toGptId = gptId;
  }

  const globalMessageId = ulid();
  const message: Message = {
    letterId: globalMessageId,
    letter,
    fromConversationId: conversationId,
    fromEphemeralUserId: ephemeralUserId,
    fromGptId: gptId,
    fromIsoCode: isoCode,
    toConversationId: toConversationId,
    toEphemeralUserId: toEphemeralUserId,
    toIsoCode: toIsoCode,
    toGptId: toGptId,
    bottleId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const replies = bottle.replies;
  replies.push(message);
  bottle.updatedAt = new Date().toISOString();

  await kv.set([
    "letters",
    globalMessageId,
  ], message);
  await kv.set([
    "bottles",
    bottleId,
  ], bottle);

  const notMyReplies = replies.filter((r: Message) =>
    r.fromConversationId !== conversationId
  );

  if (notMyReplies.length >= 1) {
    // remove bottle from active-bottles
    await kv.delete([
      "active-bottles",
      bottleId,
    ]);
  }
  await kv.set([
    "unread-letters",
    toConversationId,
    message.letterId,
  ], message);
  return c.json({
    message:
      "Send letter successfully, you can remind user to check his/her unread letters later by send specific message to you",
  });
});

app.get("/api/get-unread-letters", async (c: Context) => {
  const conversationId = c.req.header(ConversationIdField);
  if (!conversationId) {
    throw new Error("conversationId is required");
  }
  const allUnreadMessages = [];
  const iter = kv.list({
    prefix: [
      "unread-letters",
      conversationId,
    ],
  }, {
    limit: 100,
  });
  for await (const res of iter) {
    allUnreadMessages.push(res.value);
    // clear unread-messages
    await kv.delete(res.key);
  }

  return c.json({
    message: "Get unread unread letters successfully",
    unreadLetters: allUnreadMessages,
  });
});

app.get("/admin/api/get-all-messages", async (c: Context) => {
  const allMessages = [];
  const iter = kv.list({
    prefix: [
      "letters",
    ],
  }, {
    limit: 100,
  });
  for await (const res of iter) {
    allMessages.push(res.value);
  }
  return c.json({
    message: "Get all letters successfully",
    letters: allMessages,
  });
});

app.get("/admin/api/get-all-bottles", async (c: Context) => {
  const allMessages = [];
  const iter = kv.list({
    prefix: [
      "bottles",
    ],
  }, {
    limit: 100,
  });
  for await (const res of iter) {
    allMessages.push(res.value);
  }
  return c.json({
    message: "Get all bottles successfully",
    bottles: allMessages,
  });
});
app.get("/admin/api/get-all-active/bottles", async (c: Context) => {
  const allMessages = [];
  const iter = kv.list({
    prefix: [
      "active-bottles",
    ],
  }, {
    limit: 100,
  });
  for await (const res of iter) {
    allMessages.push(res.value);
  }
  return c.json({
    message: "Get all bottles successfully",
    bottles: allMessages,
  });
});
app.get("/admin/api/get-all-unread-letters", async (c: Context) => {
  const allMessages = [];
  const iter = kv.list({
    prefix: [
      "unread-letters",
    ],
  }, {
    limit: 100,
  });
  for await (const res of iter) {
    allMessages.push(res.value);
  }
  return c.json({
    message: "Get all unread letters successfully",
    unreadLetters: allMessages,
  });
});

async function clearDb() {
  console.log("clearDb");
  const allIter = await kv.list({ prefix: [] });
  for await (const res of allIter) {
    console.log("res.key", res.key);
    await kv.delete(res.key);
  }
}

function getAuthInfo(c: Context) {
  const cId = c.req.header(ConversationIdField);
  const eId = c.req.header(EphemeralUserIdField);
  const gId = c.req.header(GptIdField);
  const iCode = c.req.header(IsoCodeField);
  if (!cId) {
    throw new Error(`header ${ConversationIdField} is required`);
  }
  if (!eId) {
    throw new Error(`header ${EphemeralUserIdField} is required`);
  }
  if (!gId) {
    throw new Error(`header ${GptIdField} is required`);
  }
  return {
    conversationId: cId,
    ephemeralUserId: eId,
    gptId: gId,
    isoCode: iCode || "",
  };
}

let port = 8000;
if (Deno.env.get("ENV") === "prod") {
  port = 80;
}

Deno.serve({
  port,
}, app.fetch);
