const express = require('express');
const { body, param } = require('express-validator');
const { Student, User, Charge, Payment, DocumentRequest, sequelize } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { wrap, validate } = require('../middleware/common');
const { audit, notify, receiptNo } = require('../utils/helpers');

const router = express.Router();
router.use(authenticate, requireRole('cashier', 'admin'));

// Find student charges by student number
router.get('/students/:studentNo/charges', wrap(async (req, res) => {
  const student = await Student.findOne({ where: { studentNo: req.params.studentNo }, include: [{ model: User, attributes: ['fullName'] }] });
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const charges = await Charge.findAll({ where: { studentId: student.id }, include: Payment, order: [['createdAt', 'DESC']] });
  const total = charges.reduce((n, c) => n + Number(c.amount), 0);
  const paid = charges.reduce((n, c) => n + Number(c.paid), 0);
  res.json({ student, total, paid, balance: total - paid, charges });
}));

// Record a payment and issue a receipt
router.post(
  '/payments',
  requireRole('cashier'),
  [
    body('chargeId').isInt(),
    body('amount').isFloat({ gt: 0 }).withMessage('Amount must be greater than zero'),
    body('method').optional().isIn(['Cash', 'GCash', 'Bank Transfer', 'Card']),
  ],
  validate,
  wrap(async (req, res) => {
    const result = await sequelize.transaction(async (t) => {
      const charge = await Charge.findByPk(req.body.chargeId, { include: Student, transaction: t });
      if (!charge) { const e = new Error('Charge not found'); e.status = 404; throw e; }
      const outstanding = Number(charge.amount) - Number(charge.paid);
      const amount = Number(req.body.amount);
      if (amount > outstanding + 0.001) { const e = new Error(`Payment exceeds outstanding balance of ${outstanding.toFixed(2)}`); e.status = 400; throw e; }
      const payment = await Payment.create(
        { chargeId: charge.id, amount, method: req.body.method || 'Cash', receiptNo: receiptNo(), cashierId: req.user.id },
        { transaction: t }
      );
      const newPaid = Number(charge.paid) + amount;
      const fully = newPaid >= Number(charge.amount) - 0.001;
      await charge.update({ paid: newPaid, status: fully ? 'Paid' : 'Partial' }, { transaction: t });
      let docMarked = null;
      if (fully) {
        const doc = await DocumentRequest.findOne({ where: { chargeId: charge.id, status: 'Payment Pending' }, transaction: t });
        if (doc) { await doc.update({ status: 'Paid' }, { transaction: t }); docMarked = doc; }
      }
      return { payment, charge, docMarked };
    });
    await notify(result.charge.Student.userId, `Payment of PHP ${Number(req.body.amount).toFixed(2)} received. Receipt ${result.payment.receiptNo}.`);
    if (result.docMarked) await notify(result.charge.Student.userId, `Document request #${result.docMarked.id} is now Paid and will be processed.`);
    await audit(req, 'RECORD_PAYMENT', 'Payment', result.payment.id, { receipt: result.payment.receiptNo });
    res.status(201).json({ receiptNo: result.payment.receiptNo, payment: result.payment, charge: result.charge });
  })
);

// Payment history
router.get('/payments', wrap(async (req, res) => {
  const payments = await Payment.findAll({
    include: [{ model: Charge, include: [{ model: Student, include: [{ model: User, attributes: ['fullName'] }] }] }, { model: User, as: 'cashier', attributes: ['fullName'] }],
    order: [['createdAt', 'DESC']],
    limit: 200,
  });
  res.json(payments);
}));

router.get('/receipts/:receiptNo', [param('receiptNo').isString()], validate, wrap(async (req, res) => {
  const payment = await Payment.findOne({ where: { receiptNo: req.params.receiptNo }, include: [{ model: Charge, include: [{ model: Student, include: [{ model: User, attributes: ['fullName'] }] }] }] });
  if (!payment) return res.status(404).json({ error: 'Receipt not found' });
  res.json(payment);
}));

module.exports = router;
