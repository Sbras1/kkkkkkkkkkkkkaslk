// ==================================================
// 🤖 PUBG Trader Bot — ULTIMATE VERSION
// المميزات:
// 1. نظام التجار والاشتراكات
// 2. Midasbuy API (فردي + جماعي)
// 3. نظام الكلان (Bulk IDs)
// 4. نظام الستاك (Bulk Codes)
// 5. Inline Mode
// 6. سجلات Firebase مفصلة
// ==================================================

require("dotenv").config();
const fs = require("fs");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const { logOperation, getTraderLogs } = require("./firebaseLogs");

// تعطيل تحذير DeprecationWarning للملفات
process.env.NTBA_FIX_350 = 1;

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

console.log(`🤖 جاري تشغيل البوت (النسخة الكاملة)...`);
console.log(`🌐 API_BASE_URL = ${API_BASE_URL}`);

// ===================== متغيرات الأنظمة الجديدة =====================
const KEYS_FILE = "keys.json"; // ملف تخزين أكواد التفعيل
let activationKeys = []; // مصفوفة الأكواد في الذاكرة
const userCooldowns = {}; // لتخزين توقيت آخر عملية (الحماية)

// دالة تحميل المفاتيح (أضفها بجانب دالة loadTraders)
function loadKeys() {
  try {
    if (fs.existsSync(KEYS_FILE)) {
      activationKeys = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
    } else {
      fs.writeFileSync(KEYS_FILE, "[]", "utf8");
    }
  } catch (err) { 
    activationKeys = []; 
  }
}

function saveKeys() {
  fs.writeFileSync(KEYS_FILE, JSON.stringify(activationKeys, null, 2), "utf8");
}

loadKeys(); // تشغيل التحميل عند البدء

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
            // تحويل المصفوفة لكائن إذا كانت مصفوفة
            traders = Array.isArray(parsed.traders) ? {} : parsed.traders;
          } else {
            traders = Array.isArray(parsed) ? {} : parsed;
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

// ===================== دالة إرسال الخطأ للمالك (Error Reporter) 🐞 =====================

async function reportErrorToAdmin(errorMsg, context = "") {
  if (OWNER_ID) {
    const msg = `🐞 تنبيه خطأ برمجي:\n\n📝 الموقع: ${context}\n❌ الخطأ: ${errorMsg}`;
    try { 
      await bot.sendMessage(OWNER_ID, msg); 
    } catch (e) {
      console.error("فشل إرسال تقرير الخطأ للمالك:", e.message);
    }
  }
}

// ===================== دوال مساعدة =====================

function isDigits(text) {
  return /^[0-9]+$/.test((text || "").trim());
}

// ✅ دالة الانتظار (Delay) مهمة جداً لنظام الكلان
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

  if (["activated", "success", "used", "done"].includes(s)) {
    return "activated";
  }

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

  if (["failed", "invalid", "error"].includes(s)) {
    return "failed";
  }

  return "unactivated";
}

async function apiPost(endpoint, body, label = "") {
  const url = `${API_BASE_URL}${endpoint}`;
  // console.log(`🔗 ${label || "API"} URL:`, url); // تم الإخفاء لتخفيف الـ Logs

  const res = await axios.post(url, body, {
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": API_KEY,
      Accept: "application/json",
    },
    timeout: 25000, // زيادة الوقت قليلاً للعمليات الكبيرة
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

// ✅ دالة الشحن الجماعي الجديدة (Bulk API Endpoint)
async function activateBulkUcCodes(playerId, codesArray) {
  return apiPost(
    "/bulkActivate", 
    { 
        player_id: Number(playerId), 
        uc_codes: codesArray 
    },
    "bulkActivate"
  );
}

// ===================== لوحة التحكم الرئيسية =====================

function mainMenuKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        // الصف الأول
        [
            { text: "⚡ تفعيل كود" }, 
            { text: "🚀 تفعيل جماعي" }
        ],
        // الصف الثاني
        [
            { text: "🧪 فحص كود" }, 
            { text: "🎮 استعلام عن ID" }
        ],
        // الصف الثالث
        [
            { text: "👤 حسابي" }, 
            { text: "📒 سجلي" },
            { text: "💳 الاشتراك" }
        ],
        // الصف الرابع
        [
            { text: "🎫 فتح تذكرة" }
        ]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
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

  const existing = traders[String(targetId)];
  const registeredAt = existing?.registeredAt || now;
  const newExpiresAt = existing?.expiresAt
    ? Number(existing.expiresAt) + durationMs
    : now + durationMs;

  traders[String(targetId)] = {
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
  
  // 💾 نسخ احتياطي تلقائي (إضافة يدوية)
  if (OWNER_ID) {
    try {
      await bot.sendDocument(OWNER_ID, TRADERS_FILE, { 
        caption: "💾 نسخ احتياطي تلقائي (إضافة يدوية)"
      });
    } catch (err) {
      console.error("فشل إرسال النسخة الاحتياطية:", err.message);
    }
  }
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

  if (!traders[String(targetId)]) {
    return bot.sendMessage(chatId, "ℹ️ هذا ID غير موجود في قائمة التجّار.");
  }

  delete traders[String(targetId)];
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

  let txt = "👤 حسابي :\n";
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

  // 🔔 إشعار المالك بكل من يستخدم البوت (جديد أو قديم)
  if (OWNER_ID && userId !== OWNER_ID) {
    try {
      const userName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") || "غير معروف";
      const userUsername = msg.from.username ? `@${msg.from.username}` : "لا يوجد";
      const isRegistered = isTrader(userId);
      const status = isRegistered ? "✅ مشترك نشط" : "⚠️ غير مشترك";
      
      const notificationText = 
        `🔔 شخص ${isRegistered ? 'مشترك' : 'جديد'} استخدم البوت!\n\n` +
        `👤 الاسم: ${userName}\n` +
        `🆔 الآيدي: ${userId}\n` +
        `📱 اليوزر: ${userUsername}\n` +
        `📊 الحالة: ${status}\n` +
        `⏰ الوقت: ${formatNow()}`;

      const notificationKeyboard = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "➕ إضافة كتاجر (شهر)", callback_data: `add_trader:${userId}` },
            ],
            [
              { text: "❌ تجاهل", callback_data: "ignore_notification" }
            ]
          ]
        }
      };

      await bot.sendMessage(OWNER_ID, notificationText, notificationKeyboard);
    } catch (err) {
      console.error("خطأ في إرسال الإشعار للمالك:", err.message);
    }
  }

  if (!isTrader(userId)) {
    const txt =
      "⚠️ هذا البوت مخصص لتجّار PUBG فقط.\n\n" +
      "للاشتراك أو الاستفسار:\n" +
      "• راسل مالك البوت على تيليجرام: @Sbras_1";
    await bot.sendMessage(chatId, txt, mainMenuKeyboard());
    return;
  }

  let welcome = "أهلاً بك في بوت تاجر PUBG 💳\n\n";
  welcome += formatTraderAccount(msg.from, info);
  welcome += "\n\nيمكنك عبر هذا البوت:\n";
  welcome += "• تفعيل جماعي لـ (2-5) لاعبين.\n";
  welcome += "• تفعيل عدة أكواد للاعب واحد (Stack).\n";
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
    "• 45 ريال / 12$ — شهر \n" +
    "  يشمل:\n" +
    "  – استعلام اللاعبين بالـ ID\n" +
    "  – فحص تاريخ أكواد UC\n" +
    "  – تفعيل الأكواد على حسابات العملاء\n" +
    "  – عرض سجل عملياتك من داخل البوت\n\n" +
    "للاشتراك أو الاستفسار:\n" +
    "• راسل مالك البوت على تيليجرام: @Sbras_1";

  await bot.sendMessage(chatId, txt, { disable_web_page_preview: true });
});

// ===================== دالة إرسال ملخص سجلي =====================

async function sendLogsSummary(chatId, userId) {
  const { stats } = await getTraderLogs(userId, { limit: 500 });
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

// ===================== نظام أكواد التجديد التلقائي 🔑 =====================

// 🅰️ أمر للمالك: توليد مفتاح (مثال: /توليد 30)
bot.onText(/^\/توليد (\d+)/, async (msg, match) => {
  if (msg.from.id !== OWNER_ID) return;
  const days = parseInt(match[1]);
  
  // إنشاء كود عشوائي
  const key = 'KEY-' + Math.random().toString(36).substr(2, 9).toUpperCase();
  
  activationKeys.push({ key: key, days: days });
  saveKeys();
  
  await bot.sendMessage(msg.chat.id, `🔑 تم توليد مفتاح جديد:\n\`${key}\`\n⏳ المدة: ${days} يوم`, { parse_mode: "Markdown" });
});

// 🅱️ أمر للمستخدم: تفعيل المفتاح (مثال: /تفعيل KEY-XXXX)
bot.onText(/^\/تفعيل (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const inputKey = match[1].trim();

  // البحث عن المفتاح
  const keyIndex = activationKeys.findIndex(k => k.key === inputKey);
  
  if (keyIndex === -1) {
    return bot.sendMessage(chatId, "❌ هذا الكود غير صالح أو مستخدم من قبل.");
  }

  const keyData = activationKeys[keyIndex];
  const durationMs = keyData.days * 24 * 60 * 60 * 1000;
  const now = Date.now();

  // تحديث أو إنشاء التاجر
  if (!traders[String(userId)]) {
    const userName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") || null;
    const userUsername = msg.from.username ? `@${msg.from.username}` : null;
    
    traders[String(userId)] = { 
      username: userUsername,
      name: userName,
      active: true, 
      registeredAt: now, 
      expiresAt: now + durationMs
    };
  } else {
    // تمديد الاشتراك
    const currentExpire = traders[String(userId)].expiresAt || now;
    // إذا منتهي يبدأ من الآن، إذا لا يضاف على القديم
    const baseTime = (currentExpire < now) ? now : currentExpire;
    traders[String(userId)].expiresAt = baseTime + durationMs;
    traders[String(userId)].active = true;
  }

  saveTraders();

  // حذف المفتاح بعد الاستخدام
  activationKeys.splice(keyIndex, 1);
  saveKeys();

  await bot.sendMessage(chatId, `✅ تم تفعيل اشتراكك بنجاح!\n⏳ المدة المضافة: ${keyData.days} يوم.\n🗓 ينتهي في: ${formatDateTimeFromUnix(traders[String(userId)].expiresAt)}`, { parse_mode: "Markdown" });

  // 💾 نسخ احتياطي تلقائي
  if (OWNER_ID) {
    try {
      await bot.sendDocument(OWNER_ID, TRADERS_FILE, { 
        caption: `💾 نسخ احتياطي تلقائي (تفعيل جديد: ${userId})`
      });
    } catch (err) {
      console.error("فشل إرسال النسخة الاحتياطية:", err.message);
    }
  }
});

// ===================== التعامل مع الأزرار والرسائل =====================

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = (msg.text || "").trim();

  // أوامر نصية نعالجها في onText (لتجنب التكرار)
  if (
    /^\/start/i.test(text) ||
    /^\/سجلي$/i.test(text) ||
    /^\/الاشتراك$/i.test(text) ||
    /^\/حسابي$/i.test(text) ||
    /^\/اضف_تاجر/i.test(text) ||
    /^\/حذف_تاجر/i.test(text) ||
    /^\/قائمة_التجار$/i.test(text) ||
    /^\/توليد/i.test(text) ||
    /^\/تفعيل/i.test(text)
  ) {
    return;
  }

  const session = getSession(chatId);

  // 🛡️ نظام الحماية من السبام (Cooldown) - 10 ثواني
  // فقط للأزرار الرئيسية، وليس أثناء العمليات (modes)
  const now = Date.now();
  const isInOperation = session.mode && session.mode !== "";
  
  if (userId !== OWNER_ID && !isInOperation) {
    const lastTime = userCooldowns[userId] || 0;
    const diff = now - lastTime;
    // 10000 ميلي ثانية = 10 ثواني
    if (diff < 10000) { 
      const waitTime = Math.ceil((10000 - diff) / 1000);
      return bot.sendMessage(chatId, `⏳ يرجى الانتظار ${waitTime} ثوانٍ قبل المحاولة التالية.`);
    }
    userCooldowns[userId] = now; // تحديث الوقت
  }

  // ============================================================
  // 💎 منطقة الاشتراك والشرح التفاعلي (لغير المشتركين والمشتركين)
  // ============================================================

  // 1. الدخول لقائمة الاشتراك والشروحات
  if (text === "💳 الاشتراك") {
      const demoKeyboard = {
          reply_markup: {
              keyboard: [
                  // الصف الأول (كما طلبت)
                  [{ text: "🎮 استعلام عن ID" }, { text: "🧪 فحص كود" }, { text: "🔓 تنشيط حسابي" }],
                  // الصف الثاني
                  [{ text: "⚡ تفعيل كود" }, { text: "🚀 تفعيل جماعي" }],
                  // زر الرجوع
                  [{ text: "🔙 القائمة الرئيسية" }]
              ],
              resize_keyboard: true,
              one_time_keyboard: false
          }
      };

      await bot.sendMessage(chatId, 
          "💎 **باقات الاشتراك المدفوع**\n\n" +
          "تمتع بسرعة خيالية وخدمات حصرية.\n" +
          "💰 **السعر:** 45 ريال / 15$ - شهر\n\n" +
          "👇 **اضغط على الأزرار بالأسفل لتكتشف مميزات البوت قبل الاشتراك:**", 
          { parse_mode: "Markdown", ...demoKeyboard }
      );
      return;
  }

  // 2. شرح ميزة: تفعيل كود (النظام المزدوج)
  if (text === "⚡ تفعيل كود") {
      const caption = 
          "⚡ **شرح ميزة: تفعيل كود (نظامين في زر واحد)**\n\n" +
          "عند تفعيل هذا الخيار، سيطلب البوت الآيدي أولاً للتحقق من الاسم، ثم يخيرك بين:\n\n" +
          "1️⃣ **تفعيل كود واحد (Single Mode):**\n" +
          "• مخصص للسرعة.\n" +
          "• يحلل رد الموقع بدقة (يميز بين الكود المستخدم والكود الخطأ).\n\n" +
          "2️⃣ **تفعيل مجموعة أكواد (Stack Mode):**\n" +
          "• مخصص لشحن عروض (مثلاً 5 أكواد لنفس اللاعب).\n" +
          "• ترسل حتى 5 أكواد دفعة واحدة.\n" +
          "• تحصل على تقرير نهائي: (3 تم ✅ / 1 مستخدم ⚠️).\n\n" +
          "🛡️ **أمان:** ضمان عدم الخطأ في الآيدي.";
      
      await bot.sendMessage(chatId, caption, { parse_mode: "Markdown" });
      return;
  }

  // 3. شرح ميزة: تفعيل جماعي (الكلان)
  if (text === "🚀 تفعيل جماعي") {
      const caption = 
          "🚀 **شرح ميزة: شحن الكلانات (Bulk IDs)**\n\n" +
          "وداعاً للتعب اليدوي! اشحن لعدة لاعبين في وقت قياسي.\n\n" +
          "📝 **كيف يعمل؟**\n" +
          "1. ترسل قائمة الآيديات (من 2 إلى 5 لاعبين).\n" +
          "2. البوت يفحص الأسماء ويتأكد منها.\n" +
          "3. ترسل قائمة الأكواد.\n" +
          "4. يقوم البوت بالشحن واحداً تلو الآخر تلقائياً.\n\n" +
          "⏱️ **المميزات:** فاصل زمني ذكي للحماية من الحظر.";

      await bot.sendMessage(chatId, caption, { parse_mode: "Markdown" });
      return;
  }

  // 4. شرح ميزة: استعلام عن ID
  if (text === "🎮 استعلام عن ID") {
      await bot.sendMessage(chatId, 
          "🎮 **شرح ميزة: كشف اسم اللاعب**\n\n" +
          "لا داعي لفتح اللعبة! 🙅‍♂️\n" +
          "فقط أرسل الآيدي للبوت (مثال: `512345678`) وسيحضر لك:\n" +
          "• اسم اللاعب.\n" +
          "• الآيدي (منسوخ وجاهز).\n\n" +
          "💾 **جديد:** إمكانية حفظ اللاعب في جهات الاتصال للرجوع إليه لاحقاً.", 
          { parse_mode: "Markdown" }
      );
      return;
  }

  // 5. شرح ميزة: فحص كود
  if (text === "🧪 فحص كود") {
      await bot.sendMessage(chatId, 
          "🧪 **شرح ميزة: الفحص العميق**\n\n" +
          "تأكد من سلامة بضاعتك قبل بيعها.\n" +
          "أرسل الكود للبوت وسيخبرك:\n\n" +
          "🟢 **جديد (Valid):** الكود سليم وغير مستخدم.\n" +
          "🔴 **مستخدم (Used):** يظهر لك **وقت الاستخدام** بالضبط لكشف التلاعب.\n" +
          "❌ **تالف (Invalid):** الكود غير صحيح.", 
          { parse_mode: "Markdown" }
      );
      return;
  }

  // 6. شرح ميزة: تنشيط حسابي
  if (text === "🔓 تنشيط حسابي") {
      await bot.sendMessage(chatId, 
          "🔓 **كيفية تفعيل اشتراكك**\n\n" +
          "نظامنا يعمل آلياً 24/7. لا تحتاج لانتظار الرد!\n\n" +
          "1️⃣ اشترِ \"مفتاح تفعيل\" من المالك.\n" +
          "2️⃣ اكتب الأمر: `/تفعيل المفتاح`\n" +
          "3️⃣ سيعمل البوت معك فوراً.\n\n" +
          "🛒 **لشراء المفاتيح:** تواصل مع @Sbras_1", 
          { parse_mode: "Markdown" }
      );
      return;
  }

  // 7. زر الرجوع (للعودة للقائمة الأصلية)
  if (text === "🔙 القائمة الرئيسية") {
      // نعيد القائمة الاصلية حسب حالة المستخدم (مشترك او لا)
      await sendMainMenu(chatId); 
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
    
    const opts = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "👥 جهات الاتصال (لاعبيني)", callback_data: "my_players" }]
        ]
      }
    };
    
    await bot.sendMessage(chatId, formatTraderAccount(msg.from, info), opts);
    return;
  }

  // غير تاجر؟ نرجع رسالة منع (إلا إذا ضغط زر التذكرة - له رسالة خاصة)
  if (!isTrader(userId) && text !== "🎫 فتح تذكرة") {
    const txt =
      "⚠️ هذا البوت مخصص لتجّار PUBG فقط.\n\n" +
      "لا يمكنك استخدام هذه الميزة قبل الاشتراك كتاجر.\n\n" +
      "للاشتراك أو الاستفسار:\n" +
      "• راسل مالك البوت على تيليجرام: @Sbras_1";
    await bot.sendMessage(chatId, txt);
    return;
  }

  // زر سجلي
  if (text === "📒 سجلي") {
    await sendLogsSummary(chatId, userId);
    return;
  }

  // --------- القائمة الرئيسية ----------
  if (text === "🔍 استعلام") {
    session.mode = "WAIT_PLAYER_LOOKUP_ID";
    await bot.sendMessage(
      chatId,
      "أرسل الآن ID اللاعب (أرقام فقط) لعرض الاسم."
    );
    return;
  }

  if (text === "🧾 فحص") {
    session.mode = "WAIT_CHECK_CODE";
    await bot.sendMessage(
      chatId,
      "أرسل الآن كود UC المراد فحصه (انسخه كامل بدون مسافات زائدة)."
    );
    return;
  }

  if (text === "⚡ تفعيل") {
    session.mode = "WAIT_ACTIVATE_PLAYER_ID";
    session.temp = {};
    await bot.sendMessage(
      chatId,
      "أرسل الآن ID اللاعب الذي تريد تفعيل الكود له (أرقام فقط)."
    );
    return;
  }

  // ==========================================
  // 🚀 بداية منطق التفعيل الجماعي (كلان) - عدة لاعبين
  // ==========================================
  if (text === "🚀 تفعيل جماعي") {
    session.mode = "WAIT_BULK_IDS";
    session.bulkData = []; // تهيئة المصفوفة
    await bot.sendMessage(chatId, 
      "🚀 **نظام تفعيل الكلان (عدة لاعبين)**\n\n" +
      "1️⃣ أرسل قائمة الآيديات الآن (كل آيدي في سطر).\n" +
      "⚠️ الحد المسموح: من **2** إلى **5** آيديات.\n\n" +
      "مثال:\n512345678\n598765432", 
      { parse_mode: "Markdown" }
    );
    return;
  }

  // معالجة الآيديات في الوضع الجماعي (كلان)
  if (session.mode === "WAIT_BULK_IDS") {
    // تقسيم النص لأسطر واستخراج الأرقام فقط
    const ids = text.split('\n').map(l => l.trim()).filter(l => isDigits(l));

    if (ids.length < 2 || ids.length > 5) {
      return bot.sendMessage(chatId, "❌ العدد غير صحيح!\nيجب إرسال من 2 إلى 5 آيديات في الرسالة الواحدة.\nحاول مرة أخرى.");
    }

    await bot.sendMessage(chatId, `⏳ جاري فحص ${ids.length} آيديات... يرجى الانتظار.`);

    let validPlayers = [];
    
    // فحص الآيديات واحداً تلو الآخر
    for (const id of ids) {
        try {
            const res = await getPlayerInfo(id);
            if (res.success && res.data && res.data.player_name) {
                validPlayers.push({ id: id, name: res.data.player_name });
            } else {
                return bot.sendMessage(chatId, `❌ توقف! الآيدي (${id}) غير صحيح أو غير موجود.\nأعد إرسال القائمة الصحيحة بالكامل.`);
            }
        } catch (e) {
            return bot.sendMessage(chatId, "❌ حدث خطأ في الاتصال أثناء فحص الآيديات.");
        }
        // انتظار بسيط جداً لعدم إرهاق السيرفر في الفحص
        await delay(300);
    }

    // حفظ اللاعبين الصحيحين في الجلسة
    session.bulkData = validPlayers;
    session.mode = "WAIT_BULK_CODES";

    let msgIds = "✅ تم التحقق من اللاعبين:\n";
    validPlayers.forEach((p, i) => {
        msgIds += `${i+1}. ${p.name} (${p.id})\n`;
    });
    msgIds += `\n👇 **الآن أرسل ${validPlayers.length} أكواد** (كل كود في سطر) بنفس الترتيب!`;

    await bot.sendMessage(chatId, msgIds, { parse_mode: "Markdown" });
    return;
  }

  // معالجة الأكواد في الوضع الجماعي (كلان)
  if (session.mode === "WAIT_BULK_CODES") {
    // تنظيف الأكواد
    const codes = text.split('\n')
      .map(l => l.replace(/Code:/gi, "").replace(/\s/g, "").trim())
      .filter(l => l.length > 5);

    const players = session.bulkData;

    if (codes.length !== players.length) {
        return bot.sendMessage(chatId, `⚠️ عدد الأكواد (${codes.length}) لا يطابق عدد اللاعبين (${players.length})!\nأعد إرسال الأكواد بالعدد الصحيح.`);
    }

    // دمج الأكواد مع اللاعبين في الجلسة للمراجعة
    players.forEach((p, i) => {
        p.code = codes[i];
    });

    session.mode = "WAIT_BULK_CONFIRM"; // وضع الانتظار للتأكيد

    // بناء رسالة المراجعة
    let reviewMsg = "📝 **مراجعة الطلب (كلان) قبل التنفيذ:**\n\n";
    players.forEach((p, i) => {
        reviewMsg += `${i+1}. 👤 ${p.name}\n   🆔 \`${p.id}\`\n   💎 كود: \`${p.code}\`\n\n`;
    });
    reviewMsg += "⚠️ سيتم التفعيل بفاصل 3 ثوانٍ بين كل عملية.";

    const confirmKeyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "✅ تأكيد وبدء التفعيل", callback_data: "bulk_confirm" }],
                [{ text: "❌ إلغاء العملية", callback_data: "bulk_cancel" }]
            ]
        }
    };

    await bot.sendMessage(chatId, reviewMsg, { parse_mode: "Markdown", ...confirmKeyboard });
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

        // زر الحفظ للاعب
        const saveKeyboard = {
          reply_markup: {
            inline_keyboard: [
              [{ text: "💾 حفظ هذا اللاعب", callback_data: `save_player:${p.player_id}:${p.player_name}` }]
            ]
          }
        };

        await bot.sendMessage(chatId, reply, saveKeyboard);

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

  // --------- المنطقة 1: استلام الآيدي (للشحن الفردي أو الستاك) ----------
  if (session.mode === "WAIT_ACTIVATE_PLAYER_ID") {
    if (!isDigits(text)) {
      return bot.sendMessage(chatId, "⚠️ ID غير صالح، أرسل أرقام فقط.");
    }

    const playerId = text;
    await bot.sendMessage(chatId, "⏳ جاري التحقق من اللاعب...");

    try {
      const data = await getPlayerInfo(playerId);
      if (data.success && data.data && data.data.status === "success") {
        const p = data.data;
        
        // حفظ بيانات اللاعب في الجلسة لاستخدامها لاحقاً
        session.temp = {
          playerId: p.player_id,
          playerName: p.player_name
        };

        // تجهيز الرسالة مع الأزرار
        const reply = 
          `👤 **بيانات اللاعب:**\n` +
          `• الاسم: ${p.player_name}\n` +
          `• الآيدي: \`${p.player_id}\`\n\n` +
          `👇 **كيف تريد شحن هذا اللاعب؟**`;

        const optionsKeyboard = {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "1️⃣ كود واحد", callback_data: "mode_single" },
                { text: "🔢 مجموعة أكواد (Max 5)", callback_data: "mode_bulk_stack" }
              ],
              [{ text: "❌ إلغاء", callback_data: "cancel_act" }]
            ]
          }
        };

        // ننتظر الآن ضغط الزر، لذا نغير الوضع إلى "انتظار الاختيار"
        session.mode = "WAIT_SELECTION_MODE"; 
        await bot.sendMessage(chatId, reply, { parse_mode: "Markdown", ...optionsKeyboard });

      } else {
        await bot.sendMessage(chatId, "❌ لم يتم العثور على اللاعب. تأكد من الآيدي.");
      }
    } catch (err) {
      console.error(err);
      await bot.sendMessage(chatId, "❌ خطأ في الاتصال، حاول لاحقاً.");
      resetSession(chatId); await sendMainMenu(chatId);
    }
    return;
  }

  // --------- وضع: تفعيل كود واحد (الخطوة الثانية: الكود) ----------
  if (session.mode === "WAIT_ACTIVATE_CODE_SINGLE" && session.temp?.playerId) {
    const ucCode = text.trim();
    const playerId = session.temp.playerId;
    const playerName = session.temp.playerName || "-";

    try {
      await bot.sendMessage(chatId, "⏳ يتم تفعيل الكود ...");
      const res = await activateUcCode(playerId, ucCode);
      
      // قراءة الرسالة من المكان الصحيح: data.message
      const innerMsg = (res.data?.message || "").toLowerCase();
      
      // الشرط الدقيق: نجاح فقط إذا status=success والرسالة ليست "already"
      const isAlreadyUsed = innerMsg.includes("already");
      const isSuccess = res.data?.status === "success" && !isAlreadyUsed;
      
      if (isSuccess) {
        const reply = `✅ تم تفعيل الكود بنجاح\n👤 ${playerName} (${playerId})\n💎 الكود: ${ucCode}`;
        await bot.sendMessage(chatId, reply);
        await logOperation(userId, { type: "activate", player_id: playerId, player_name: playerName, code: ucCode, result: "success" });
      } else {
        // تحديد السبب بدقة
        let errorReason = "غير صالح";
        if (isAlreadyUsed || innerMsg.includes("already") || res.data?.status === "failed") {
          errorReason = "مفعل سابقاً";
        }
        
        const reply = `❌ فشل التفعيل (${errorReason})\n👤 ${playerName} (${playerId})\n💎 الكود: ${ucCode}`;
        await bot.sendMessage(chatId, reply);
        await logOperation(userId, { type: "activate", player_id: playerId, player_name: playerName, code: ucCode, result: "failed" });
      }
    } catch (err) {
      console.error("Activate Error:", err.message);
      await bot.sendMessage(chatId, "❌ حدث خطأ أثناء تفعيل الكود.");
      await logOperation(userId, { type: "activate", player_id: playerId, code: ucCode, result: "error" });
    } finally {
      resetSession(chatId);
      await sendMainMenu(chatId);
    }
    return;
  }

  // ✅ المنطقة 3: تنفيذ التفعيل الجماعي لنفس اللاعب (Stack) - باستخدام New Bulk API
  if (session.mode === "WAIT_ACTIVATE_CODE_BULK_STACK") {
      // 1. تنظيف الأكواد
      const codes = text.split('\n')
        .map(l => l.replace(/Code:/gi, "").replace(/\s/g, "").trim())
        .filter(l => l.length > 5);

      if (codes.length > 5) return bot.sendMessage(chatId, "⚠️ الحد الأقصى 5 أكواد.");
      if (codes.length < 2) return bot.sendMessage(chatId, "⚠️ للشحن الجماعي، أرسل كودين على الأقل.");

      const player = session.temp;
      await bot.sendMessage(chatId, `🚀 يتم إرسال ${codes.length} أكواد للاعب ${player.playerName} دفعة واحدة...`);

      try {
          // 2. استدعاء API الشحن الجماعي الجديد
          const res = await activateBulkUcCodes(player.playerId, codes);

          let report = `📊 **تقرير الشحن لـ ${player.playerName}:**\n\n`;
          let successCount = 0;
          let failedCount = 0;

          // 3. تحليل الرد
          if (res.success && res.data && res.data.results) {
              const results = res.data.results;

              for (let i = 0; i < results.length; i++) {
                  const item = results[i];
                  const code = item.code_activated || codes[i];
                  const status = item.status; // success / failed
                  const message = (item.message || "").toLowerCase();

                  let statusText = "";
                  let logResult = "";

                  if (status === "success" || status === "activated") {
                      statusText = "✅ تم الشحن";
                      logResult = "success";
                      successCount++;
                  } else {
                      // التصحيح: فحص دقيق لرسالة "مستخدم سابقاً"
                      if (message.includes("used") || message.includes("redeemed") || message.includes("already")) {
                          statusText = "⚠️ مفعل مسبقاً";
                          logResult = "already_used";
                      } else if (message.includes("region")) {
                          statusText = "🌍 خطأ دولة (Region)";
                          logResult = "region_error";
                      } else {
                          statusText = "❌ غير صالح";
                          logResult = "invalid";
                      }
                      failedCount++;
                  }

                  report += `${i+1}. \`${code}\` : ${statusText}\n`;
                  
                  // تسجيل في Firebase
                  logOperation(userId, { 
                      type: "activate", 
                      player_id: player.playerId, 
                      code: code, 
                      result: logResult 
                  });
              }
              report += `\n📈 **النتائج:** ${successCount} ناجح / ${failedCount} فشل`;

          } else {
              report += `❌ حدث خطأ في الطلب: ${res.message || "خطأ غير معروف"}`;
          }

          await bot.sendMessage(chatId, report, { parse_mode: "Markdown" });

      } catch (err) {
          console.error(err);
          await bot.sendMessage(chatId, "❌ خطأ في الاتصال بالسيرفر.");
      }
      
      resetSession(chatId); 
      await sendMainMenu(chatId);
      return;
  }

  // 🎫 زر فتح تذكرة (للمشتركين فقط)
  if (text === "🎫 فتح تذكرة") {
    // 🔒 التحقق: هل هو مشترك نشط؟
    if (!isTrader(userId)) {
      return bot.sendMessage(chatId, "🛑 **عذراً، خدمة الدعم الفني متاحة للمشتركين النشطين فقط.**\nيرجى تجديد اشتراكك أولاً.", { parse_mode: "Markdown" });
    }

    session.mode = "WAIT_TICKET_MESSAGE";
    
    await bot.sendMessage(chatId, 
      "✅ **أهلاً بك في الدعم الفني الخاص بالمشتركين**\n\n" +
      "📝 يرجى كتابة رسالتك أو مشكلتك الآن (في رسالة واحدة).\n" +
      "📸 يمكنك إرسال صور أيضاً.", 
      { parse_mode: "Markdown" }
    );
    return;
  }

  // 📨 استقبال رسالة التذكرة من التاجر
  if (session.mode === "WAIT_TICKET_MESSAGE") {
    const ADMIN_GROUP_ID = -1001767287162;
    
    try {
      // تجهيز معلومات التاجر للإدارة
      const traderInfo = traders[String(userId)];
      const subDate = traderInfo ? formatDateTimeFromUnix(traderInfo.expiresAt) : "غير محدد";
      
      const caption = `🎫 **تذكرة جديدة!**\n` +
                      `👤 الاسم: ${msg.from.first_name}\n` +
                      `🆔 الآيدي: \`${userId}\`\n` +
                      `📅 انتهاء الاشتراك: ${subDate}\n` +
                      `🔻 الرسالة بالأسفل (قم بالرد عليها):`;

      // إرسال بطاقة التعريف للقروب
      await bot.sendMessage(ADMIN_GROUP_ID, caption, { parse_mode: "Markdown" });

      // تحويل رسالة التاجر (نص أو صورة) للقروب
      await bot.forwardMessage(ADMIN_GROUP_ID, chatId, msg.message_id);
      
      // إشعار التاجر بالنجاح
      await bot.sendMessage(chatId, "✅ تم إرسال رسالتك للإدارة، سيتم الرد عليك قريباً.");
      
    } catch (err) {
      console.error("خطأ في إرسال التذكرة للقروب:", err.message);
      
      // إشعار التاجر بالفشل
      await bot.sendMessage(chatId, 
        "⚠️ حدث خطأ في إرسال رسالتك.\n" +
        "\n" +
        "يرجى التواصل مباشرة مع المالك: @Sbras_1"
      );
    }

    // الخروج من وضع التذكرة
    resetSession(chatId);
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
  const session = getSession(chatId);

  if (!chatId || !userId) return;

  // 📒 معالجة نظام حفظ جهات الاتصال
  if (data.startsWith("save_player:")) {
    const [_, pid, ...pnameArr] = data.split(":");
    const pname = pnameArr.join(":"); // في حال كان الاسم يحتوي على :
    
    if (!traders[String(userId)]) {
      return bot.answerCallbackQuery(query.id, { text: "❌ يجب أن تكون مشتركاً لاستخدام هذه الميزة", show_alert: true });
    }
    
    if (!traders[String(userId)].savedPlayers) {
      traders[String(userId)].savedPlayers = [];
    }
    
    // التأكد من عدم التكرار
    const exists = traders[String(userId)].savedPlayers.find(p => p.id == pid);
    if (exists) {
      return bot.answerCallbackQuery(query.id, { text: "اللاعب محفوظ مسبقاً!", show_alert: true });
    }

    traders[String(userId)].savedPlayers.push({ id: pid, name: pname });
    saveTraders();
    
    await bot.answerCallbackQuery(query.id, { text: "✅ تم حفظ اللاعب في قائمتك." });
    return;
  }

  // 📒 معالجة عرض قائمة اللاعبين المحفوظين
  if (data === "my_players") {
    if (!traders[String(userId)] || !traders[String(userId)].savedPlayers) {
      return bot.answerCallbackQuery(query.id, { text: "قائمتك فارغة.", show_alert: true });
    }
    
    const list = traders[String(userId)].savedPlayers || [];
    if (list.length === 0) {
      return bot.answerCallbackQuery(query.id, { text: "قائمتك فارغة.", show_alert: true });
    }

    let msgList = "👥 قائمة اللاعبين المحفوظين:\n\n";
    // عرض الأسماء مع الآيديات لنسخها بسهولة
    list.forEach((p, i) => {
      msgList += `${i+1}. ${p.name}\n   \`${p.id}\`\n`; 
    });
    
    await bot.sendMessage(chatId, msgList, { parse_mode: "Markdown" });
    await bot.answerCallbackQuery(query.id);
    return;
  }

  // 🔔 معالجة أزرار إشعارات المالك
  if (data.startsWith("add_trader:")) {
    if (userId !== OWNER_ID) {
      return bot.answerCallbackQuery(query.id, { text: "❌ هذا الزر للمالك فقط", show_alert: true });
    }

    const targetId = data.split(":")[1];
    
    try {
      // 🔍 جلب معلومات الشخص من Telegram مباشرة
      let userName = null;
      let userUsername = null;
      
      try {
        const chatMember = await bot.getChatMember(targetId, targetId);
        const user = chatMember.user;
        userName = [user.first_name, user.last_name].filter(Boolean).join(" ") || null;
        userUsername = user.username ? `@${user.username}` : null;
      } catch (err) {
        console.log("تعذر جلب معلومات المستخدم من Telegram، سيتم الحفظ بدونها");
      }

      const now = Date.now();
      const durationMs = 30 * 24 * 60 * 60 * 1000; // شهر
      
      const existing = traders[String(targetId)];
      const registeredAt = existing?.registeredAt || now;
      const newExpiresAt = existing?.expiresAt
        ? Number(existing.expiresAt) + durationMs
        : now + durationMs;

      traders[String(targetId)] = {
        username: userUsername || existing?.username || null,
        name: userName || existing?.name || null,
        registeredAt,
        expiresAt: newExpiresAt,
        active: true,
      };
      saveTraders();

      await bot.editMessageText(
        query.message.text + "\n\n✅ تمت الإضافة بنجاح!",
        {
          chat_id: chatId,
          message_id: query.message.message_id
        }
      );

      await bot.answerCallbackQuery(query.id, { text: "✅ تمت إضافة التاجر بنجاح!" });
    } catch (err) {
      console.error("خطأ في إضافة التاجر:", err.message);
      await bot.answerCallbackQuery(query.id, { text: "❌ حدث خطأ في الإضافة", show_alert: true });
    }
    return;
  }

  if (data === "ignore_notification") {
    if (userId !== OWNER_ID) {
      return bot.answerCallbackQuery(query.id, { text: "❌ هذا الزر للمالك فقط", show_alert: true });
    }
    
    try {
      await bot.deleteMessage(chatId, query.message.message_id);
      await bot.answerCallbackQuery(query.id, { text: "✅ تم التجاهل" });
    } catch (err) {
      await bot.answerCallbackQuery(query.id);
    }
    return;
  }

  // ✅ التعامل مع أزرار التفعيل (فردي/جماعي)
  if (data === "mode_single") {
    if (!session.temp || !session.temp.playerName) return bot.answerCallbackQuery(query.id, { text: "انتهت الجلسة" });
    session.mode = "WAIT_ACTIVATE_CODE_SINGLE";
    await bot.deleteMessage(chatId, query.message.message_id);
    await bot.sendMessage(chatId, `✅ اخترت تفعيل كود واحد لـ ${session.temp.playerName}.\n👇 أرسل الكود الآن:`);
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "mode_bulk_stack") {
    if (!session.temp || !session.temp.playerName) return bot.answerCallbackQuery(query.id, { text: "انتهت الجلسة" });
    session.mode = "WAIT_ACTIVATE_CODE_BULK_STACK";
    await bot.deleteMessage(chatId, query.message.message_id);
    await bot.sendMessage(chatId, 
        `✅ اخترت تفعيل مجموعة أكواد لـ ${session.temp.playerName}.\n` +
        `👇 أرسل الأكواد الآن (كل كود في سطر) - من 2 إلى 5 أكواد.`
    );
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "cancel_act") {
    await bot.deleteMessage(chatId, query.message.message_id);
    await bot.sendMessage(chatId, "تم الإلغاء.");
    resetSession(chatId); await sendMainMenu(chatId);
    await bot.answerCallbackQuery(query.id);
    return;
  }

  // ===================== معالجة تأكيد التفعيل الجماعي (كلان) =====================
  if (data === "bulk_confirm") {
    if (session.mode !== "WAIT_BULK_CONFIRM" || !session.bulkData) {
      return bot.answerCallbackQuery(query.id, {
        text: "⚠️ انتهت صلاحية الجلسة",
        show_alert: true,
      });
    }

    // حذف رسالة التأكيد
    await bot.deleteMessage(chatId, query.message.message_id);
    await bot.sendMessage(chatId, "🚀 بدأ التنفيذ (نظام الكلان)... يرجى الانتظار.");

    let finalReport = "📊 **تقرير الكلان النهائي:**\n\n";
    let successCount = 0;

    // الحلقة الرئيسية للتنفيذ (تتابعي مع تأخير)
    for (let i = 0; i < session.bulkData.length; i++) {
      const item = session.bulkData[i];

      try {
        const res = await activateUcCode(item.id, item.code);
        
        // قراءة الرسالة من data.message (المكان الصحيح)
        const innerMsg = (res.data?.message || "").toLowerCase();
        const isAlreadyUsed = innerMsg.includes("already");
        const isSuccess = res.data?.status === "success" && !isAlreadyUsed;

        if (isSuccess) {
          finalReport += `✅ **${item.name}**: تم بنجاح\n`;
          successCount++;
          logOperation(userId, {
            type: "activate",
            player_id: item.id,
            player_name: item.name,
            code: item.code,
            result: "bulk_success",
          });
        } else {
          // تحديد السبب بدقة
          let reason = "غير صالح";
          if (isAlreadyUsed || res.data?.status === "failed") {
            reason = "مفعل مسبقاً";
          }
          
          finalReport += `❌ **${item.name}**: ${reason}\n`;
          logOperation(userId, {
            type: "activate",
            player_id: item.id,
            player_name: item.name,
            code: item.code,
            result: "bulk_failed",
          });
        }
      } catch (err) {
        finalReport += `⚠️ **${item.name}**: خطأ في الاتصال\n`;
      }

      // فاصل زمني 3 ثواني (ما عدا آخر عملية)
      if (i < session.bulkData.length - 1) {
        await bot.sendChatAction(chatId, "typing");
        await delay(3000);
      }
    }

    finalReport += `\n📈 **النتائج:** ${successCount} ناجح / ${
      session.bulkData.length - successCount
    } فشل`;

    await bot.sendMessage(chatId, finalReport, { parse_mode: "Markdown" });

    resetSession(chatId);
    await sendMainMenu(chatId);
    try {
      await bot.answerCallbackQuery(query.id);
    } catch (err) {}
    return;
  }

  if (data === "bulk_cancel") {
    await bot.deleteMessage(chatId, query.message.message_id);
    await bot.sendMessage(chatId, "❌ تم إلغاء العملية.");
    resetSession(chatId);
    await sendMainMenu(chatId);
    try {
      await bot.answerCallbackQuery(query.id);
    } catch (err) {}
    return;
  }

  // التعامل مع سجلات Logs
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

    const resultLabels = {
      activated: "مُفعّل",
      unactivated: "غير مفعّل",
      failed: "غير صالح",
      success: "ناجح",
      error: "خطأ",
      already_activated: "مُفعّل مسبقًا",
      already_used: "مُستخدم",
      invalid: "غير صالح",
      invalid_before_activate: "غير صالح",
      check_error: "خطأ في الفحص",
      bulk_success: "جماعي ناجح",
      bulk_failed: "جماعي فاشل"
    };

    let text = "";
    if (type === "check") text += "🧪 فحوص الأكواد:\n\n";
    else if (type === "activate") text += "⚡ عمليات التفعيل:\n\n";
    else if (type === "player") text += "👤 استعلامات اللاعبين:\n\n";

    const slice = items.slice(0, 10); // آخر 10 فقط

    for (const op of slice) {
      const when = formatDateTimeFromUnix(op.time);
      if (type === "player") {
        text += `• ${op.player_name || "-"} (${op.player_id || "-"})\n  في: ${when}\n\n`;
      } else if (type === "check") {
        const resultText = resultLabels[op.result] || op.result;
        text += `• كود: ${op.code || "-"} — (${resultText})\n  في: ${when}\n\n`;
      } else if (type === "activate") {
        const resultText = resultLabels[op.result] || op.result;
        text += `• كود: ${op.code || "-"} — (${resultText})\n  لاعب: ${op.player_name || "-"} (${op.player_id || "-"})\n  في: ${when}\n\n`;
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

// ==================================================
// 🎫 الرد من الإدارة إلى التاجر (نظام التذاكر)
// ==================================================

const ADMIN_GROUP_ID = -1001767287162;

// الرد من الإدارة (من داخل القروب) إلى التاجر
bot.on("message", async (msg) => {
    // التأكد أن الرسالة قادمة من قروب الإدارة وأنها "رد" (Reply)
    if (msg.chat.id === ADMIN_GROUP_ID && msg.reply_to_message) {
        
        // إذا كانت الرسالة الأصلية (التي نرد عليها) محولة من شخص Forwarded
        if (msg.reply_to_message.forward_from) {
            const customerId = msg.reply_to_message.forward_from.id;
            
            try {
                // إرسال رد الإدارة للتاجر
                await bot.sendMessage(customerId, `👨‍💻 **رد من الدعم الفني:**\n\n${msg.text}`, { parse_mode: "Markdown" });
                
                // تأكيد للإدارة
                await bot.sendMessage(ADMIN_GROUP_ID, "✅ تم إيصال الرد للتاجر.");
            } catch (err) {
                await bot.sendMessage(ADMIN_GROUP_ID, "❌ فشل الإرسال (ربما قام التاجر بحظر البوت).");
            }
        }
    }
});

// ===================== التعامل مع الأخطاء 🐞 =====================

bot.on("polling_error", (err) => {
  // تجاهل أخطاء ETELEGRAM البسيطة (timeout/network issues)
  if (err.code === 'ETELEGRAM') {
    // لا نطبع شيء للتقليل من الإزعاج
    return;
  }
  // طباعة الأخطاء المهمة فقط
  console.error('⚠️ Polling Error:', err.code, err.message);
});

// التعامل مع الأخطاء غير المتوقعة (Crash)
process.on('uncaughtException', (err) => {
  console.error('CRASH:', err);
  reportErrorToAdmin(err.message, "Uncaught Exception");
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Rejection:', reason);
  // reportErrorToAdmin(reason.toString(), "Unhandled Rejection"); // اختياري
});