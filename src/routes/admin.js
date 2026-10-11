const express = require('express');
const bcrypt = require('bcryptjs');
const { body, param } = require('express-validator');
const {
  User, Student, Enrollment, Payment, DocumentRequest, ClearanceItem, AuditLog, Setting, ROLES, sequelize,
} = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { wrap, validate } = require('../middleware/common');
const { audit, getSettings, DEFAULT_SETTINGS } = require('../utils/helpers');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

// ---------- Users & roles ----------
router.get('/users', wrap(async (req, res) => {
  const users = await User.findAll({ attributes: ['id', 'email', 'fullName', 'role', 'department', 'active', 'createdAt'], order: [['id', 'ASC']] });
  res.json(users);
}));

router.post(
  '/users',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).matches(/[A-Za-z]/).matches(/\d/).withMessage('Password needs 8+ chars with a letter and a number'),
    body('fullName').trim().isLength({ min: 2, max: 100 }).escape(),
    body('role').isIn(ROLES.filter((r) => r !== 'student')),
    body('department').optional({ nullable: true }).trim().isLength({ max: 50 }).escape(),
  ],
  validate,
  wrap(async (req, res) => {
    if (req.body.role === 'dept_staff' && !req.body.department) return res.status(400).json({ error: 'Department is required for department staff' });
    const user = await User.create({
      email: req.body.email, fullName: req.body.fullName, role: req.body.role,
      department: req.body.department || null, passwordHash: await bcrypt.hash(req.body.password, 10),
    });
    await audit(req, 'CREATE_USER', 'User', user.id, { role: user.role });
    res.status(201).json({ id: user.id, email: user.email, fullName: user.fullName, role: user.role, department: user.department });
  })
);

router.patch(
  '/users/:id',
  [
    param('id').isInt(),
    body('role').optional().isIn(ROLES),
    body('active').optional().isBoolean(),
    body('department').optional({ nullable: true }).trim().isLength({ max: 50 }).escape(),
  ],
  validate,
  wrap(async (req, res) => {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.id === req.user.id && (req.body.active === false || (req.body.role && req.body.role !== 'admin'))) {
      return res.status(400).json({ error: 'You cannot deactivate or demote your own account' });
    }
    const { role, active, department } = req.body;
    await user.update({ ...(role && { role }), ...(active !== undefined && { active }), ...(department !== undefined && { department }) });
    await audit(req, 'UPDATE_USER', 'User', user.id, { role, active, department });
    res.json({ id: user.id, role: user.role, active: user.active, department: user.department });
  })
);

// ---------- Settings ----------
router.get('/settings', wrap(async (req, res) => res.json(await getSettings())));

router.put(
  '/settings',
  [
    body('schoolYear').optional().matches(/^\d{4}-\d{4}$/).withMessage('Use format 2026-2027'),
    body('semester').optional().isIn(['1st', '2nd', 'Summer']),
    body('feePerUnit').optional().isFloat({ min: 0 }),
    body('miscFee').optional().isFloat({ min: 0 }),
    body('enrollmentOpen').optional().isBoolean(),
    body('clearanceDepartments').optional().trim().isLength({ min: 2, max: 200 }),
  ],
  validate,
  wrap(async (req, res) => {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (req.body[key] !== undefined) await Setting.upsert({ key, value: String(req.body[key]) });
    }
    await audit(req, 'UPDATE_SETTINGS', 'Setting', null, req.body);
    res.json(await getSettings());
  })
);

// ---------- Audit logs ----------
router.get('/audit-logs', wrap(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const logs = await AuditLog.findAll({ include: [{ model: User, attributes: ['fullName', 'role'] }], order: [['createdAt', 'DESC']], limit });
  res.json(logs);
}));

// ---------- Reports / analytics ----------
router.get('/reports/summary', wrap(async (req, res) => {
  const group = async (Model, field) => {
    const rows = await Model.findAll({ attributes: [field, [sequelize.fn('COUNT', sequelize.col('id')), 'n']], group: [field], raw: true });
    return Object.fromEntries(rows.map((r) => [r[field], Number(r.n)]));
  };
  const [students, enrollments, documents, clearance] = await Promise.all([
    Student.count(), group(Enrollment, 'status'), group(DocumentRequest, 'status'), group(ClearanceItem, 'status'),
  ]);
  const totalCollected = Number((await Payment.sum('amount')) || 0);
  res.json({ students, enrollments, documents, clearance, totalCollected });
}));

module.exports = router;
