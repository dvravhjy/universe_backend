const express = require('express');
const { body, param } = require('express-validator');
const { ClearanceItem, Student, User } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { wrap, validate } = require('../middleware/common');
const { audit, notify, getSettings } = require('../utils/helpers');

const router = express.Router();
router.use(authenticate, requireRole('dept_staff', 'admin'));

// Queue for the staff member's department (admins may pass ?department=)
router.get('/clearance', wrap(async (req, res) => {
  const s = await getSettings();
  const department = req.user.role === 'dept_staff' ? req.user.department : req.query.department;
  const where = { schoolYear: s.schoolYear, semester: s.semester };
  if (department) where.department = department;
  if (req.query.status) where.status = req.query.status;
  const items = await ClearanceItem.findAll({
    where,
    include: [{ model: Student, include: [{ model: User, attributes: ['fullName'] }] }],
    order: [['createdAt', 'ASC']],
  });
  res.json(items);
}));

router.patch(
  '/clearance/:id',
  requireRole('dept_staff'),
  [
    param('id').isInt(),
    body('status').isIn(['Cleared', 'Hold', 'Pending']),
    body('remarks').trim().if(body('status').equals('Hold')).notEmpty().withMessage('Remarks are required when placing a hold').bail().isLength({ max: 200 }).escape(),
  ],
  validate,
  wrap(async (req, res) => {
    const item = await ClearanceItem.findByPk(req.params.id, { include: Student });
    if (!item) return res.status(404).json({ error: 'Clearance item not found' });
    // Staff may only act on their own department
    if (item.department !== req.user.department) {
      return res.status(403).json({ error: 'You can only update clearance for your own department' });
    }
    await item.update({ status: req.body.status, remarks: req.body.remarks || null });
    await notify(item.Student.userId, `${item.department} clearance: ${item.status}${item.remarks ? ' - ' + item.remarks : ''}`);
    await audit(req, 'UPDATE_CLEARANCE', 'ClearanceItem', item.id, { status: item.status });
    res.json(item);
  })
);

module.exports = router;
