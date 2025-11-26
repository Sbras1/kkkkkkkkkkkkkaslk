// ==================================================
// 🤖 PUBG Trader Bot — Midasbuy + Firebase Logs + Traders + Subscription + Inline
// ==================================================

require("dotenv").config();
const fs = require("fs");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const { logOperation, getTraderLogs } = require("./firebaseLogs");

// ===================== الإعدادات من .env =====================

const BOT_TOKEN = (process.env.BOT_TOKEN || "").trim();
const API_KEY = (process.env.API_KEY || "").trim();
const OWNER_ID = process.env.OWNER_ID ? Number(process.env.OWNER_ID) : null;

const API_BASE_URL = (
  process.env.API_BASE_URL || "https://midasbuy-api.com/api/v1/pubg"
).replace(/\/+$/, "");

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN غير موجود في ملف .env");
  process.exit(1);
}
if (!API_KEY) {
  console.error("❌ API_KEY (مفتاح Midasbuy) غير موجود في ملف .env");
  process.exit(1);
}
if (!API_BASE_URL) {
  console.error("❌ API_BASE_URL غير صالح.");
  process.exit(1);
}

console.log(`🤖 جاري تشغيل البوت...`);
console.log(`🌐 API_BASE_URL = ${API_BASE_URL}`);

// ===================== إعداد التجّار =====================

const TRADERS_FILE = "traders.json";
let traders = {};

function loadTraders() {
  try {
    if (fs.existsSync(TRADERS_FILE)) {
      const raw = fs.readFileSync(TRADERS_FILE, "utf8").trim();
      if (!raw) {
        traders = {};
      } else {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          if (parsed.traders && typeof parsed.traders === "object") {
            traders = parsed.traders;
          } else {
            traders = parsed;
          }
        } else {
          traders = {};
        }
      }
    } else {
      traders = {};
      saveTraders();
    }
  } catch (err) {
    console.error("⚠️ خطأ أثناء تحميل traders.json:", err.message);
    traders = {};
  }
}

function saveTraders() {
  try {
    const data = { traders };
    fs.writeFileSync(TRADERS_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("⚠️ خطأ أثناء حفظ traders.json:", err.message);
  }
}

function isTraderActive(info) {
  if (!info) return false;
  if (info.active === false) return false;

  if (info.expiresAt) {
    return Date.now() < Number(info.expiresAt);
  }
  // لو ما في تاريخ انتهاء نعتبره غير نشط إلا لو فعّلت يدوي
  return false;
}

function isTrader(userId) {
  if (!userId) return false;
  if (OWNER_ID && Number(userId) === OWNER_ID) return true;
  const info = traders[String(userId)];
  return isTraderActive(info);
}

loadTraders();

// ===================== إنشاء البوت =====================

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
let botUsername = null;

bot
  .getMe()
  .then((me) => {
    botUsername = me.username;
    console.log(`✅ تم تشغيل البوت: @${botUsername}`);
  })
  .catch((err) => {
    console.error("⚠️ getMe error:", err.message);
  });

// ===================== إدارة الجلسات =====================

const sessions = new Map();

function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, {});
  }
  return sessions.get(chatId);
}

function resetSession(chatId) {
  sessions.set(chatId, {});
}

// ===================== دوال مساعدة =====================

function isDigits(text) {
  return /^[0-9]+$/.test((text || "").trim());
}

function formatDateTimeFromUnix(unixOrMs) {
  if (!unixOrMs && unixOrMs !== 0) return "-";

  let ms = Number(unixOrMs);
  if (ms < 1e12) {
    ms = ms * 1000;
  }

  const d = new Date(ms);
  return d.toLocaleString("ar-SA", {
    timeZone: "Asia/Riyadh",
    hour12: true,
  });
}

function formatNow() {
  const d = new Date();
  return d.toLocaleString("ar-SA", {
    timeZone: "Asia/Riyadh",
    hour12: true,
  });
}

// توحيد حالة الكود القادمة من API
function normalizeCodeStatus(rawStatus) {
  const s = (rawStatus || "").toString().toLowerCase().trim();

  // مفعّل
  if (["activated", "success", "used", "done"].includes(s)) {
    return "activated";
  }

  // غير مفعّل / متاح
  if (
    [
      "unactivated",
      "unused",
      "new",
      "not_activated",
      "available",
      "ok",
      "ready",
    ].includes(s)
  ) {
    return "unactivated";
  }

  // غير صالح
  if (["failed", "invalid", "error"].includes(s)) {
    return "failed";
  }

  // أي حالة غريبة نعتبره غير مفعّل (أأمن لك)
  return "unactivated";
}

async function apiPost(endpoint, body, label = "") {
  const url = `${API_BASE_URL}${endpoint}`;
  console.log(`🔗 ${label || "API"} URL:`, url);
  console.log(`📦 ${label || "API"} body:`, body);

  const res = await axios.post(url, body, {
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": API_KEY,
      Accept: "application/json",
    },
    timeout: 15000,
  });

  return res.data;
}

// ===================== استدعاءات Midasbuy =====================

async function getPlayerInfo(playerId) {
  return apiPost(
    "/getPlayer",
    { player_id: Number(playerId) },
    "getPlayer"
  );
}

async function checkUcCode(ucCode) {
  return apiPost(
    "/checkCode",
    { uc_code: ucCode, show_time: true },
    "checkCode"
  );
}

async function activateUcCode(playerId, ucCode) {
  return apiPost(
    "/activate",
    { player_id: Number(playerId), uc_code: ucCode },
    "activate"
  );
}

// ===================== لوحة التحكم الرئيسية =====================

function mainMenuKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        ["🎮 استعلام عن لاعب", "🧪 فحص كود"],
        ["⚡ تفعيل كود", "📒 سجلي"],
        ["👤 حسابي", "💳 الاشتراك"],
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
    },
  };
}

async function sendMainMenu(chatId) {
  await bot.sendMessage(
    chatId,
    "مرحبًا 👋\nاختر من القائمة أدناه:",
    mainMenuKeyboard()
  );
}

// ===================== إدارة التجّار (أوامر للمالك) =====================

bot.onText(/^\/اضف_تاجر(?:\s+(.+))?$/i, async (msg, match) => {
  const fromId = msg.from.id;
  const chatId = msg.chat.id;

  if (!OWNER_ID || fromId !== OWNER_ID) {
    return bot.sendMessage(chatId, "❌ هذا الأمر خاص بمالك البوت فقط.");
  }

  let targetId = null;
  let targetUsername = null;
  let targetName = null;

  if (msg.reply_to_message && msg.reply_to_message.from) {
    const u = msg.reply_to_message.from;
    targetId = u.id;
    targetUsername = u.username ? `@${u.username}` : null;
    targetName = [u.first_name, u.last_name].filter(Boolean).join(" ") || null;
  }

  if (!targetId && match && match[1]) {
    const arg = match[1].trim();
    if (isDigits(arg)) {
      targetId = Number(arg);
    }
  }

  if (!targetId) {
    return bot.sendMessage(
      chatId,
      "⚠️ استخدم الأمر هكذا:\n" +
        "• بالرد على رسالة التاجر: `/اضف_تاجر`\n" +
        "أو\n" +
        "• مع ID مباشر: `/اضف_تاجر 123456789`",
      { parse_mode: "Markdown" }
    );
  }

  const now = Date.now();
  const durationMs = 30 * 24 * 60 * 60 * 1000; // شهر

  const existing = traders[targetId];
  const registeredAt = existing?.registeredAt || now;
  const newExpiresAt = existing?.expiresAt
    ? Number(existing.expiresAt) + durationMs
    : now + durationMs;

  traders[targetId] = {
    username: targetUsername,
    name: targetName,
    registeredAt,
    expiresAt: newExpiresAt,
    active: true,
  };
  saveTraders();

  let txt = "✅ تم إضافة/تحديث التاجر.\n";
  txt += `• ID: ${targetId}\n`;
  if (targetUsername) txt += `• يوزر: ${targetUsername}\n`;
  if (targetName) txt += `• الاسم: ${targetName}\n`;
  txt += `• التسجيل: ${formatDateTimeFromUnix(registeredAt)}\n`;
  txt += `• ينتهي الاشتراك في: ${formatDateTimeFromUnix(newExpiresAt)}\n`;

  await bot.sendMessage(chatId, txt);
});

bot.onText(/^\/حذف_تاجر(?:\s+(.+))?$/i, async (msg, match) => {
  const fromId = msg.from.id;
  const chatId = msg.chat.id;

  if (!OWNER_ID || fromId !== OWNER_ID) {
    return bot.sendMessage(chatId, "❌ هذا الأمر خاص بمالك البوت فقط.");
  }

  let targetId = null;

  if (msg.reply_to_message && msg.reply_to_message.from) {
    targetId = msg.reply_to_message.from.id;
  }

  if (!targetId && match && match[1]) {
    const arg = match[1].trim();
    if (isDigits(arg)) {
      targetId = Number(arg);
    }
  }

  if (!targetId) {
    return bot.sendMessage(
      chatId,
      "⚠️ استخدم الأمر هكذا:\n" +
        "• بالرد على رسالة التاجر: `/حذف_تاجر`\n" +
        "أو\n" +
        "• مع ID مباشر: `/حذف_تاجر 123456789`",
      { parse_mode: "Markdown" }
    );
  }

  if (!traders[targetId]) {
    return bot.sendMessage(chatId, "ℹ️ هذا ID غير موجود في قائمة التجّار.");
  }

  delete traders[targetId];
  saveTraders();

  await bot.sendMessage(
    chatId,
    `✅ تم حذف التاجر من القائمة.\n• ID: ${targetId}`
  );
});

bot.onText(/^\/قائمة_التجار$/i, async (msg) => {
  const fromId = msg.from.id;
  const chatId = msg.chat.id;

  if (!OWNER_ID || fromId !== OWNER_ID) {
    return bot.sendMessage(chatId, "❌ هذا الأمر خاص بمالك البوت فقط.");
  }

  const entries = Object.entries(traders);
  if (!entries.length) {
    return bot.sendMessage(chatId, "لا يوجد تجّار مسجّلين حاليًا.");
  }

  let text = `📋 قائمة التجّار (${entries.length}):\n\n`;
  for (const [id, info] of entries) {
    const active = isTraderActive(info) ? "✅ نشط" : "⚠️ منتهي/موقوف";
    text += `• ID: ${id}`;
    if (info.username) text += ` — ${info.username}`;
    if (info.name) text += ` — ${info.name}`;
    text += ` — ${active}\n`;
  }

  await bot.sendMessage(chatId, text, { disable_web_page_preview: true });
});

// ===================== /start & حسابي & الاشتراك =====================

function formatTraderAccount(user, info) {
  const id = user.id;
  const name =
    [user.first_name, user.last_name].filter(Boolean).join(" ") || "غير معروف";
  const username = user.username ? `@${user.username}` : "غير متوفر";

  let registered = "غير متوفر";
  let expires = "غير محدد";
  let subStatus = "غير مشترك";

  if (info) {
    if (info.registeredAt) {
      registered = formatDateTimeFromUnix(info.registeredAt);
    }
    if (info.expiresAt) {
      expires = formatDateTimeFromUnix(info.expiresAt);
    }
    if (isTraderActive(info)) {
      subStatus = "مشترك";
    } else {
      subStatus = "منتهي / غير نشط";
    }
  }

  let txt = "👤 حسابي كتاجر:\n";
  txt += `• ID: ${id}\n`;
  txt += `• الاسم: ${name}\n`;
  txt += `• اليوزر: ${username}\n`;
  txt += `• تاريخ التسجيل: ${registered}\n`;
  txt += `• حالة الاشتراك: ${subStatus}\n`;
  txt += `• تاريخ الانتهاء: ${expires}`;

  return txt;
}

bot.onText(/^\/start/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  resetSession(chatId);

  const info = traders[String(userId)];

  if (!isTrader(userId)) {
    const txt =
      "⚠️ هذا البوت مخصص لتجّار شحن PUBG فقط.\n\n" +
      "يمكنك مشاهدة الأزرار، لكن استخدام المزايا يحتاج اشتراك كتاجر.\n\n" +
      "للاشتراك أو الاستفسار:\n" +
      "• راسل مالك البوت على تيليجرام: @YOUR_USERNAME";
    await bot.sendMessage(chatId, txt, mainMenuKeyboard());
    return;
  }

  let welcome = "أهلاً بك في بوت تاجر PUBG 💳\n\n";
  welcome += formatTraderAccount(msg.from, info);
  welcome += "\n\nيمكنك عبر هذا البوت:\n";
  welcome += "• استعلام عن اسم اللاعب عن طريق الـ ID.\n";
  welcome += "• فحص أكواد UC ومعرفة حالتها.\n";
  welcome += "• تفعيل أكواد UC على حساب اللاعب.\n\n";
  welcome += "اختر العملية من الأزرار بالأسفل.";

  await bot.sendMessage(chatId, welcome, mainMenuKeyboard());
});

bot.onText(/^\/حسابي$/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const info = traders[String(userId)];

  if (!info && userId !== OWNER_ID) {
    return bot.sendMessage(
      chatId,
      "⚠️ لست مسجلاً كتاجر بعد.\nتواصل مع مالك البوت للاشتراك."
    );
  }

  const text = formatTraderAccount(msg.from, info);
  await bot.sendMessage(chatId, text);
});

bot.onText(/^\/الاشتراك$/i, async (msg) => {
  const chatId = msg.chat.id;

  const txt =
    "💳 تفاصيل الاشتراك في بوت التاجر:\n\n" +
    "• 49 ريال / شهر — تاجر واحد\n" +
    "  يشمل:\n" +
    "  – استعلام اللاعبين بالـ ID\n" +
    "  – فحص أكواد UC\n" +
    "  – تفعيل الأكواد على حسابات العملاء\n" +
    "  – عرض سجل عملياتك من داخل البوت\n\n" +
    "للاشتراك أو الاستفسار:\n" +
    "• راسل مالك البوت على تيليجرام: @YOUR_USERNAME";

  await bot.sendMessage(chatId, txt, { disable_web_page_preview: true });
});

// ===================== دالة إرسال ملخص سجلي =====================

async function sendLogsSummary(chatId, userId) {
  const { items } = await getTraderLogs(userId, { limit: 500 });
  // حساب الإحصائيات محليًا
  const stats = { player: 0, check: 0, activate: 0 };
  for (const op of items) {
    if (op.type && stats.hasOwnProperty(op.type)) {
      stats[op.type]++;
    }
  }

  const text =
    "📒 ملخص عملياتك:\n\n" +
    `• عدد استعلامات اللاعبين: ${stats.player}\n` +
    `• عدد فحوص الأكواد: ${stats.check}\n` +
    `• عدد تفعيل الأكواد: ${stats.activate}\n\n` +
    "اختر ما تريد استعراضه:";

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "👤 استعراض الاستعلامات", callback_data: "logs:player" }],
        [{ text: "🧪 استعراض فحوص الأكواد", callback_data: "logs:check" }],
        [{ text: "⚡ استعراض التفعيل", callback_data: "logs:activate" }],
      ],
    },
  };

  await bot.sendMessage(chatId, text, keyboard);
}

bot.onText(/^\/سجلي$/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isTrader(userId)) {
    return bot.sendMessage(
      chatId,
      "⚠️ هذه الميزة متاحة للتجّار المشتركين فقط.\nتواصل مع مالك البوت للاشتراك."
    );
  }

  await sendLogsSummary(chatId, userId);
});

// ===================== التعامل مع الأزرار والرسائل =====================

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = (msg.text || "").trim();

  // أوامر نصية نعالجها في onText
  if (
    /^\/start/i.test(text) ||
    /^\/سجلي$/i.test(text) ||
    /^\/الاشتراك$/i.test(text) ||
    /^\/حسابي$/i.test(text) ||
    /^\/اضف_تاجر/i.test(text) ||
    /^\/حذف_تاجر/i.test(text) ||
    /^\/قائمة_التجار$/i.test(text)
  ) {
    return;
  }

  const session = getSession(chatId);

  // زر الاشتراك — يعمل للجميع
  if (text === "💳 الاشتراك") {
    const txt =
      "💳 تفاصيل الاشتراك في بوت التاجر:\n\n" +
      "• 49 ريال / شهر — تاجر واحد\n" +
      "  يشمل:\n" +
      "  – استعلام اللاعبين بالـ ID\n" +
      "  – فحص أكواد UC\n" +
      "  – تفعيل الأكواد على حسابات العملاء\n" +
      "  – عرض سجل عملياتك من داخل البوت\n\n" +
      "للاشتراك أو الاستفسار:\n" +
      "• راسل مالك البوت على تيليجرام: @YOUR_USERNAME";

    await bot.sendMessage(chatId, txt, { disable_web_page_preview: true });
    return;
  }

  // زر حسابي
  if (text === "👤 حسابي") {
    const info = traders[String(userId)];
    if (!info && userId !== OWNER_ID) {
      return bot.sendMessage(
        chatId,
        "⚠️ لست مسجلاً كتاجر بعد.\nتواصل مع مالك البوت للاشتراك."
      );
    }
    const t = formatTraderAccount(msg.from, info);
    await bot.sendMessage(chatId, t);
    return;
  }

  // غير تاجر؟ نرجع رسالة منع
  if (!isTrader(userId)) {
    const txt =
      "⚠️ هذا البوت مخصص لتجّار شحن PUBG فقط.\n\n" +
      "لا يمكنك استخدام هذه الميزة قبل الاشتراك كتاجر.\n\n" +
      "للاشتراك أو الاستفسار:\n" +
      "• راسل مالك البوت على تيليجرام: @YOUR_USERNAME";
    await bot.sendMessage(chatId, txt);
    return;
  }

  // زر سجلي
  if (text === "📒 سجلي") {
    await sendLogsSummary(chatId, userId);
    return;
  }

  // --------- القائمة الرئيسية ----------
  if (text === "🎮 استعلام عن لاعب") {
    session.mode = "WAIT_PLAYER_LOOKUP_ID";
    await bot.sendMessage(
      chatId,
      "أرسل الآن ID اللاعب (أرقام فقط) لعرض الاسم."
    );
    return;
  }

  if (text === "🧪 فحص كود") {
    session.mode = "WAIT_CHECK_CODE";
    await bot.sendMessage(
      chatId,
      "أرسل الآن كود UC المراد فحصه (انسخه كامل بدون مسافات زائدة)."
    );
    return;
  }

  if (text === "⚡ تفعيل كود") {
    session.mode = "WAIT_ACTIVATE_PLAYER_ID";
    session.temp = {};
    await bot.sendMessage(
      chatId,
      "أرسل الآن ID اللاعب الذي تريد تفعيل الكود له (أرقام فقط)."
    );
    return;
  }

  // --------- وضع: استعلام عن لاعب ----------
  if (session.mode === "WAIT_PLAYER_LOOKUP_ID") {
    if (!isDigits(text)) {
      return bot.sendMessage(
        chatId,
        "⚠️ ID غير صالح.\nأرسل أرقام فقط بدون مسافات."
      );
    }

    const playerId = text;
    try {
      await bot.sendMessage(chatId, "⏳ يتم الاستعلام عن اللاعب ...");

      const data = await getPlayerInfo(playerId);
      if (!data.success || !data.data || data.data.status !== "success") {
        await bot.sendMessage(
          chatId,
          "⚠️ لم يتم العثور على اللاعب.\nتأكد من الـ ID وحاول مرة أخرى."
        );

        await logOperation(userId, {
          type: "player",
          player_id: playerId,
          player_name: null,
          result: "not_found",
        });
      } else {
        const p = data.data;
        const reply =
          "👤 بيانات اللاعب:\n" +
          `• ID: ${p.player_id}\n` +
          `• الاسم: ${p.player_name}`;

        await bot.sendMessage(chatId, reply);

        await logOperation(userId, {
          type: "player",
          player_id: p.player_id,
          player_name: p.player_name,
          result: "success",
        });
      }
    } catch (err) {
      console.error("خطأ getPlayer:", err.message);
      await bot.sendMessage(
        chatId,
        "❌ حدث خطأ أثناء الاستعلام عن اللاعب. جرّب لاحقًا."
      );
    } finally {
      resetSession(chatId);
      await sendMainMenu(chatId);
    }
    return;
  }

  // --------- وضع: فحص كود ----------
  if (session.mode === "WAIT_CHECK_CODE") {
    const ucCode = text;

    try {
      await bot.sendMessage(chatId, "⏳ يتم فحص الكود ...");

      const data = await checkUcCode(ucCode);
      const nowStr = formatNow();

      if (!data.success || !data.data) {
        await bot.sendMessage(
          chatId,
          "❌ تعذر فحص الكود حاليًا. حاول مرة أخرى لاحقًا."
        );

        await logOperation(userId, {
          type: "check",
          code: ucCode,
          result: "error",
        });
      } else {
        const d = data.data;
        console.log("checkCode raw status =", d.status);

        const status = normalizeCodeStatus(d.status);
        const amount = d.amount || "-";
        const activatedTo = d.activated_to || "-";
        const activatedAtStr = d.activated_at
          ? formatDateTimeFromUnix(d.activated_at)
          : "-";

        if (status === "activated") {
          const reply =
            "✅ الكود مُفعّل\n" +
            `• الكود: ${d.uc_code}\n` +
            `• الكمية: ${amount} UC\n` +
            `• تم التفعيل على ID: ${activatedTo}\n` +
            `• وقت التفعيل: ${activatedAtStr}\n` +
            `• وقت الفحص: ${nowStr}`;

          await bot.sendMessage(chatId, reply);

          await logOperation(userId, {
            type: "check",
            code: d.uc_code,
            amount,
            activated_to: activatedTo,
            activated_at: d.activated_at || null,
            result: "activated",
          });
        } else if (status === "unactivated") {
          const reply =
            "ℹ️ الكود غير مفعّل\n" +
            `• الكود: ${d.uc_code}\n` +
            `• الكمية: ${amount} UC\n` +
            `• وقت الفحص: ${nowStr}`;

          await bot.sendMessage(chatId, reply);

          await logOperation(userId, {
            type: "check",
            code: d.uc_code,
            amount,
            result: "unactivated",
          });
        } else {
          const reply =
            "❌ حالة الكود: غير صالح\n" +
            `• الكود: ${d.uc_code || ucCode}\n` +
            `• وقت الفحص: ${nowStr}`;

          await bot.sendMessage(chatId, reply);

          await logOperation(userId, {
            type: "check",
            code: d.uc_code || ucCode,
            result: "failed",
          });
        }
      }
    } catch (err) {
      console.error("خطأ checkCode:", err.message);
      await bot.sendMessage(
        chatId,
        "❌ حدث خطأ أثناء فحص الكود. جرّب لاحقًا."
      );

      await logOperation(userId, {
        type: "check",
        code: ucCode,
        result: "error",
      });
    } finally {
      resetSession(chatId);
      await sendMainMenu(chatId);
    }

    return;
  }

  // --------- وضع: تفعيل كود (الخطوة الأولى: ID) ----------
  if (session.mode === "WAIT_ACTIVATE_PLAYER_ID") {
    if (!isDigits(text)) {
      return bot.sendMessage(
        chatId,
        "⚠️ ID غير صالح.\nأرسل أرقام فقط بدون مسافات."
      );
    }

    const playerId = text;
    session.temp = { playerId };
    session.mode = "WAIT_ACTIVATE_CODE";

    try {
      await bot.sendMessage(chatId, "⏳ يتم الاستعلام عن اللاعب ...");

      const data = await getPlayerInfo(playerId);
      if (data.success && data.data && data.data.status === "success") {
        const p = data.data;
        session.temp.playerName = p.player_name;

        const reply =
          "👤 بيانات اللاعب:\n" +
          `• ID: ${p.player_id}\n` +
          `• الاسم: ${p.player_name}\n\n` +
          "أرسل الآن كود UC الذي تريد تفعيله لهذا اللاعب.";
        await bot.sendMessage(chatId, reply);
      } else {
        await bot.sendMessage(
          chatId,
          "⚠️ لم يتم العثور على اللاعب، لكن يمكنك إرسال الكود وسنحاول التفعيل على هذا الـ ID."
        );
        await bot.sendMessage(
          chatId,
          "أرسل الآن كود UC الذي تريد تفعيله لهذا اللاعب."
        );
      }
    } catch (err) {
      console.error("خطأ getPlayer داخل التفعيل:", err.message);
      await bot.sendMessage(
        chatId,
        "⚠️ تعذر استعلام اسم اللاعب، لكن يمكنك الاستمرار.\nأرسل الآن كود UC للتفعيل."
      );
    }

    return;
  }

  // --------- وضع: تفعيل كود (الخطوة الثانية: الكود) ----------
  if (session.mode === "WAIT_ACTIVATE_CODE" && session.temp?.playerId) {
    const ucCode = text;
    const playerId = session.temp.playerId;
    const playerName = session.temp.playerName || "-";

    try {
      await bot.sendMessage(chatId, "⏳ يتم تفعيل الكود ...");

      // أولاً: فحص الكود قبل التفعيل
      const checkData = await checkUcCode(ucCode);

      if (!checkData.success || !checkData.data) {
        await bot.sendMessage(
          chatId,
          "❌ تعذر فحص الكود قبل التفعيل. جرّب لاحقًا."
        );

        await logOperation(userId, {
          type: "activate",
          player_id: playerId,
          player_name: playerName,
          code: ucCode,
          result: "check_error",
        });

        resetSession(chatId);
        await sendMainMenu(chatId);
        return;
      }

      const cd = checkData.data;
      console.log("pre-activate raw status =", cd.status);

      const cStatus = normalizeCodeStatus(cd.status);
      const activatedTo = cd.activated_to || "-";
      const activatedAtStr = cd.activated_at
        ? formatDateTimeFromUnix(cd.activated_at)
        : "-";

      if (cStatus === "activated") {
        // مفعل مسبقًا — لا نحاول التفعيل مرة أخرى
        const reply =
          "⚠️ الكود مفعل مسبقًا\n" +
          "👤 بيانات اللاعب:\n" +
          `• ID: ${playerId}\n` +
          `• الاسم: ${playerName}\n\n` +
          `• الكود: ${cd.uc_code || ucCode}\n` +
          `• تم التفعيل على ID: ${activatedTo}\n` +
          `• وقت التفعيل: ${activatedAtStr}`;

        await bot.sendMessage(chatId, reply);

        await logOperation(userId, {
          type: "activate",
          player_id: playerId,
          player_name: playerName,
          code: cd.uc_code || ucCode,
          result: "already_activated",
        });

        resetSession(chatId);
        await sendMainMenu(chatId);
        return;
      }

      if (cStatus === "failed") {
        // حالة غير صالحة — لا نحاول التفعيل
        const reply =
          "❌ لا يمكن تفعيل هذا الكود\n" +
          `• الكود: ${cd.uc_code || ucCode}`;

        await bot.sendMessage(chatId, reply);

        await logOperation(userId, {
          type: "activate",
          player_id: playerId,
          player_name: playerName,
          code: cd.uc_code || ucCode,
          result: "invalid_before_activate",
        });

        resetSession(chatId);
        await sendMainMenu(chatId);
        return;
      }

      // هنا الكود غير مفعّل — نحاول التفعيل فعليًا
      const actData = await activateUcCode(playerId, ucCode);

      if (actData && actData.success) {
        const reply =
          "✅ تم تفعيل الكود بنجاح\n" +
          "👤 بيانات اللاعب:\n" +
          `• ID: ${playerId}\n` +
          `• الاسم: ${playerName}\n\n` +
          `• الكود: ${ucCode}`;

        await bot.sendMessage(chatId, reply);

        await logOperation(userId, {
          type: "activate",
          player_id: playerId,
          player_name: playerName,
          code: ucCode,
          result: "success",
        });
      } else {
        const reply =
          "❌ فشل تفعيل الكود\n" +
          "👤 بيانات اللاعب:\n" +
          `• ID: ${playerId}\n` +
          `• الاسم: ${playerName}\n\n` +
          `• الكود: ${ucCode}`;

        await bot.sendMessage(chatId, reply);

        await logOperation(userId, {
          type: "activate",
          player_id: playerId,
          player_name: playerName,
          code: ucCode,
          result: "failed",
        });
      }
    } catch (err) {
      console.error("خطأ أثناء تفعيل الكود (check + activate):", err.message);
      await bot.sendMessage(
        chatId,
        "❌ حدث خطأ أثناء تفعيل الكود. جرّب لاحقًا."
      );

      await logOperation(userId, {
        type: "activate",
        player_id: playerId,
        player_name: playerName,
        code: ucCode,
        result: "error",
      });
    } finally {
      resetSession(chatId);
      await sendMainMenu(chatId);
    }

    return;
  }

  // لو ما في وضع معيّن، نرجّعه للقائمة
  if (!session.mode) {
    await sendMainMenu(chatId);
  }
});

// ===================== عرض السجلات من الأزرار (callback_query) =====================

bot.on("callback_query", async (query) => {
  const data = query.data || "";
  const chatId = query.message?.chat?.id;
  const userId = query.from?.id;

  if (!chatId || !userId) return;

  if (data.startsWith("logs:")) {
    const type = data.split(":")[1]; // player | check | activate

    const { items } = await getTraderLogs(userId, {
      type,
      limit: 20,
    });

    if (!items.length) {
      await bot.answerCallbackQuery(query.id, {
        text: "لا توجد سجلات لهذا النوع.",
        show_alert: true,
      });
      return;
    }

    let title = "";
    if (type === "player") title = "👤 استعلامات اللاعبين:";
    else if (type === "check") title = "🧪 فحوص الأكواد:";
    else if (type === "activate") title = "⚡ عمليات التفعيل:";

    let text = title + "\n\n";

    const slice = items.slice(0, 10); // آخر 10 فقط

    for (const op of slice) {
      const when = formatDateTimeFromUnix(op.time);
      if (type === "player") {
        text += `• ${op.player_name || "-"} (${op.player_id || "-"})\n  في: ${when}\n\n`;
      } else if (type === "check") {
        text += `• كود: ${op.code || "-"} — (${op.result || "-"})\n  في: ${when}\n\n`;
      } else if (type === "activate") {
        text += `• كود: ${op.code || "-"} — (${op.result || "-"})\n  لاعب: ${op.player_name || "-"} (${op.player_id || "-"})\n  في: ${when}\n\n`;
      }
    }

    await bot.sendMessage(chatId, text, { disable_web_page_preview: true });
    await bot.answerCallbackQuery(query.id);
  }
});

// ===================== Inline mode (استعلام + فحص داخل القروبات) =====================

bot.on("inline_query", async (iq) => {
  const q = (iq.query || "").trim();
  const fromId = iq.from.id;

  console.log(
    "🔍 inline_query from",
    fromId,
    ":",
    q.length ? q : "(empty)"
  );

  // لو ما كتب شيء، لا نرجع نتائج
  if (!q) {
    return bot.answerInlineQuery(iq.id, [], { cache_time: 0 });
  }

  const results = [];

  try {
    // أرقام فقط → استعلام لاعب
    if (isDigits(q)) {
      const playerId = q;
      const data = await getPlayerInfo(playerId);

      if (data.success && data.data && data.data.status === "success") {
        const p = data.data;

        const title = `${p.player_name} — ${p.player_id}`;
        const desc = "عرض بيانات اللاعب";

        const text =
          "👤 بيانات اللاعب:\n" +
          `• ID: ${p.player_id}\n` +
          `• الاسم: ${p.player_name}\n\n` +
          "للتفعيل لهذا اللاعب استخدم زر ⚡ تفعيل كود في الخاص مع البوت.";

        results.push({
          type: "article",
          id: "player-" + p.player_id,
          title,
          description: desc,
          input_message_content: {
            message_text: text,
          },
        });

        await logOperation(fromId, {
          type: "player",
          player_id: p.player_id,
          player_name: p.player_name,
          result: "success_inline",
        });
      }
    } else if (q.length >= 6) {
      // غير أرقام بالكامل → نفترض كود UC
      const ucCode = q;
      const data = await checkUcCode(ucCode);
      const nowStr = formatNow();

      if (data.success && data.data) {
        const d = data.data;
        console.log("inline checkCode raw status =", d.status);

        const status = normalizeCodeStatus(d.status);
        const amount = d.amount || "-";

        let title = "";
        let desc = "";
        let text = "";

        if (status === "activated") {
          title = "✅ الكود مُفعّل";
          desc = `كود: ${d.uc_code} — ${amount} UC`;
          text =
            "✅ الكود مُفعّل\n" +
            `• الكود: ${d.uc_code}\n` +
            `• الكمية: ${amount} UC\n` +
            `• وقت الفحص: ${nowStr}`;
        } else if (status === "unactivated") {
          title = "ℹ️ الكود غير مفعّل";
          desc = `كود: ${d.uc_code} — ${amount} UC`;
          text =
            "ℹ️ الكود غير مفعّل\n" +
            `• الكود: ${d.uc_code}\n` +
            `• الكمية: ${amount} UC\n` +
            `• وقت الفحص: ${nowStr}`;
        } else {
          title = "❌ الكود غير صالح";
          desc = `كود: ${d.uc_code || ucCode}`;
          text =
            "❌ حالة الكود: غير صالح\n" +
            `• الكود: ${d.uc_code || ucCode}\n` +
            `• وقت الفحص: ${nowStr}`;
        }

        results.push({
          type: "article",
          id: "code-" + ucCode,
          title,
          description: desc,
          input_message_content: {
            message_text: text,
          },
        });

        await logOperation(fromId, {
          type: "check",
          code: d.uc_code || ucCode,
          amount,
          result: status,
        });
      }
    }
  } catch (err) {
    console.error("inline_query error:", err.message);
  }

  await bot.answerInlineQuery(iq.id, results, { cache_time: 0 });
});

// ===================== التعامل مع أخطاء polling =====================

bot.on("polling_error", (err) => {
  console.error("Polling error:", err.code || err.message);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});