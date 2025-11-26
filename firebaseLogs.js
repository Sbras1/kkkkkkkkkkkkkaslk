// firebaseLogs.js
// مسئول عن التسجيل في Firebase فقط (Realtime Database)

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

let db = null;
let firebaseReady = false;

function _tryParseJsonString(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}

function initFirebase() {
  if (firebaseReady && db) return db;

  const dbURL = process.env.FIREBASE_DB_URL;
  const svcPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const svcJsonEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const svcBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;

  if (!dbURL) {
    console.warn("⚠️ Firebase غير مهيّأ: FIREBASE_DB_URL غير مذكور في المتغيّرات.");
    firebaseReady = false;
    return null;
  }

  let creds = null;

  // 1) إذا وُجِد مسار ملف
  if (svcPath) {
    try {
      const full = path.isAbsolute(svcPath) ? svcPath : path.join(process.cwd(), svcPath);
      const raw = fs.readFileSync(full, "utf8");
      creds = _tryParseJsonString(raw);
      if (!creds) {
        console.error("❌ فشل قراءة JSON من الملف المشار إليه في FIREBASE_SERVICE_ACCOUNT_PATH:", full);
      } else {
        console.log("ℹ️ استخدام ملف خدمة Firebase من:", full);
      }
    } catch (e) {
      console.error("❌ خطأ أثناء قراءة ملف الخدمة من FIREBASE_SERVICE_ACCOUNT_PATH:", e.message || e);
    }
  }

  // 2) إذا لم ينجح، جرّب المتغير JSON المباشر
  if (!creds && svcJsonEnv) {
    // بعض البيئات تحافظ على JSON مشفّر base64 — حاول فكّ الشيفرة إن لم يكن JSON صالحًا
    creds = _tryParseJsonString(svcJsonEnv);
    if (!creds) {
      try {
        const decoded = Buffer.from(svcJsonEnv, "base64").toString("utf8");
        creds = _tryParseJsonString(decoded);
        if (creds) console.log("ℹ️ فكّيت FIREBASE_SERVICE_ACCOUNT_JSON من base64 بنجاح.");
      } catch (e) {
        // ignore
      }
    } else {
      console.log("ℹ️ استخدام FIREBASE_SERVICE_ACCOUNT_JSON من المتغيرات.");
    }
  }

  // 3) دعم متغير base64 صريح
  if (!creds && svcBase64) {
    try {
      const decoded = Buffer.from(svcBase64, "base64").toString("utf8");
      creds = _tryParseJsonString(decoded);
      if (creds) console.log("ℹ️ استخدام FIREBASE_SERVICE_ACCOUNT_BASE64 بعد فك الشيفرة.");
    } catch (e) {
      console.error("❌ فشل فك FIREBASE_SERVICE_ACCOUNT_BASE64:", e.message || e);
    }
  }

  if (!creds) {
    console.warn(
      "⚠️ Firebase غير مهيّأ: لم أجد بيانات صلاحية خدمة صحيحة. ضع `FIREBASE_SERVICE_ACCOUNT_PATH` أو `FIREBASE_SERVICE_ACCOUNT_JSON` أو `FIREBASE_SERVICE_ACCOUNT_BASE64` في المتغيّرات."
    );
    firebaseReady = false;
    return null;
  }

  // تأكد أن المفتاح موجود وصيغة private_key نصية
  if (!creds.private_key || typeof creds.private_key !== "string") {
    console.error('❌ فشل تهيئة Firebase: Service account object must contain a string "private_key" property.');
    firebaseReady = false;
    return null;
  }

  // بعض الأنظمة تخزن \\n+  // بدل النيولاين؛ نُحوّلها إلى سطور حقيقية
  creds.private_key = creds.private_key.replace(/\\n/g, "\n");

  try {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(creds),
        databaseURL: dbURL
      });
    }
    db = admin.database();
    firebaseReady = true;
    console.log("✅ Firebase Logs جاهزة للعمل.");
    return db;
  } catch (err) {
    console.error("❌ فشل تهيئة Firebase:", err.message || err);
    firebaseReady = false;
    return null;
  }
}

// تسجيل عملية واحدة
async function logOperation(userId, data) {
  const database = initFirebase();
  if (!database) {
    console.warn("⚠️ logOperation: Firebase غير متوفر حالياً.");
    return;
  }
  try {
    const time = Date.now();
    await database.ref(`logs/${userId}`).push({ ...data, time });
    return true;
  } catch (err) {
    console.error("⚠️ logOperation: خطأ أثناء التسجيل في Firebase:", err.message || err);
    return false;
  }
}

// قراءة سجلات تاجر معيّن مع خيارات limit وtype وإحصائيات
async function getTraderLogs(userId, options = {}) {
  const database = initFirebase();
  if (!database) {
    console.warn("⚠️ getTraderLogs: Firebase غير متوفر حالياً.");
    return { items: [], total: 0, stats: { player: 0, check: 0, activate: 0 } };
  }

  const uid = String(userId);
  const limit = options.limit ? Number(options.limit) : null;
  const page = Number(options.page || 1);
  const pageSize = Number(options.pageSize || 20);

  try {
    const snapshot = await database.ref(`logs/${uid}`).orderByChild("time").once("value");
    const raw = snapshot.val() || {};
    // السجلات مرتبة من الأقدم إلى الأحدث
    const all = Object.values(raw).sort((a, b) => (a.time || 0) - (b.time || 0));

    // احصائيات لكل نوع سجل
    const stats = { player: 0, check: 0, activate: 0 };
    for (const log of all) {
      if (log.type && stats.hasOwnProperty(log.type)) {
        stats[log.type]++;
      }
    }

    // فلترة السجلات حسب نوع العملية إن لزم
    let filtered = all;
    if (options.type) {
      filtered = all.filter((log) => log.type === options.type);
    }

    // تحديد عدد العناصر المعادة
    let items;
    if (limit) {
      const start = Math.max(filtered.length - limit, 0);
      items = filtered.slice(start).reverse();
    } else {
      const total = filtered.length;
      const start = Math.max(total - page * pageSize, 0);
      const end = total - (page - 1) * pageSize;
      items = filtered.slice(start, end).reverse();
    }

    return { items, total: filtered.length, stats };
  } catch (err) {
    console.error("⚠️ getTraderLogs: خطأ أثناء القراءة من Firebase:", err.message);
    return { items: [], total: 0, stats: { player: 0, check: 0, activate: 0 } };
  }
}

module.exports = {
  logOperation,
  getTraderLogs
};