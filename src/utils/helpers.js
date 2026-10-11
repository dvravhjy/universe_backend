const { Setting, AuditLog, Notification } = require('../models');

const DEFAULT_SETTINGS = {
  schoolYear: '2026-2027',
  semester: '1st',
  feePerUnit: '1200',
  miscFee: '2500',
  clearanceDepartments: 'Library,Laboratory,Guidance,Dean',
  enrollmentOpen: 'true',
};

async function getSettings() {
  const rows = await Setting.findAll();
  const out = { ...DEFAULT_SETTINGS };
  rows.forEach((r) => {
    out[r.key] = r.value;
  });
  return out;
}

async function audit(req, action, entity, entityId, details) {
  try {
    await AuditLog.create({
      userId: req.user ? req.user.id : null,
      action,
      entity,
      entityId: entityId != null ? String(entityId) : null,
      details: details ? JSON.stringify(details) : null,
      ip: req.ip,
    });
  } catch (e) {
    /* audit failures must never break the request */
  }
}

async function notify(userId, message) {
  if (!userId) return;
  await Notification.create({ userId, message });
}

function receiptNo() {
  return `OR-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0')}`;
}

module.exports = { getSettings, audit, notify, receiptNo, DEFAULT_SETTINGS };
