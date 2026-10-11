const express = require('express');
const { body, param } = require('express-validator');
const { DocumentRequest, Student, User, Charge, DOC_TYPES } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { wrap, validate } = require('../middleware/common');
const { audit, notify } = require('../utils/helpers');

const router = express.Router();
router.use(authenticate);

const FEES = {
  'Transcript of Records (TOR)': 150,
  'Certificate of Enrollment': 50,
  'Good Moral Certificate': 80,
  'Diploma Copy': 200,
  'Certificate of Grades': 60,
};

// Allowed transitions. Payment Pending -> Paid is done by the cashier recording a payment.
const NEXT = {
  Submitted: ['Payment Pending'],
  'Payment Pending': [],
  Paid: ['Processing'],
  Processing: ['Ready'],
  Ready: ['Released'],
  Released: [],
};

router.get('/types', (req, res) => res.json(DOC_TYPES.map((t) => ({ type: t, fee: FEES[t] }))));

// Student: create request
router.post(
  '/',
  requireRole('student'),
  [
    body('type').isIn(DOC_TYPES).withMessage('Unknown document type'),
    body('purpose').trim().isLength({ min: 3, max: 200 }).escape().withMessage('Purpose required'),
    body('copies').optional().isInt({ min: 1, max: 5 }),
  ],
  validate,
  wrap(async (req, res) => {
    const student = await Student.findOne({ where: { userId: req.user.id } });
    const copies = Number(req.body.copies || 1);
    const doc = await DocumentRequest.create({
      studentId: student.id,
      type: req.body.type,
      purpose: req.body.purpose,
      copies,
      fee: FEES[req.body.type] * copies,
    });
    await audit(req, 'CREATE_DOC_REQUEST', 'DocumentRequest', doc.id);
    res.status(201).json(doc);
  })
);

// Student: own history. Staff: all (optionally filtered by status)
router.get('/', wrap(async (req, res) => {
  const where = {};
  const include = [{ model: Student, include: [{ model: User, attributes: ['fullName', 'email'] }] }];
  if (req.user.role === 'student') {
    const student = await Student.findOne({ where: { userId: req.user.id } });
    where.studentId = student.id;
  } else if (!['registrar', 'cashier', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'You do not have permission to do this' });
  }
  if (req.query.status) where.status = req.query.status;
  const docs = await DocumentRequest.findAll({ where, include, order: [['createdAt', 'DESC']] });
  res.json(docs);
}));

// Registrar: assess fee -> Payment Pending (creates a charge the cashier will collect)
router.post(
  '/:id/assess',
  requireRole('registrar'),
  [param('id').isInt()],
  validate,
  wrap(async (req, res) => {
    const doc = await DocumentRequest.findByPk(req.params.id, { include: Student });
    if (!doc) return res.status(404).json({ error: 'Request not found' });
    if (doc.status !== 'Submitted') return res.status(409).json({ error: `Cannot assess a request that is ${doc.status}` });
    const charge = await Charge.create({ studentId: doc.studentId, description: `${doc.type} x${doc.copies} (request #${doc.id})`, amount: doc.fee });
    await doc.update({ status: 'Payment Pending', chargeId: charge.id });
    await notify(doc.Student.userId, `Your request #${doc.id} (${doc.type}) needs payment of PHP ${Number(doc.fee).toFixed(2)} at the cashier.`);
    await audit(req, 'ASSESS_DOC_REQUEST', 'DocumentRequest', doc.id);
    res.json(doc);
  })
);

// Registrar: Paid -> Processing -> Ready -> Released
router.patch(
  '/:id/status',
  requireRole('registrar'),
  [param('id').isInt(), body('status').isIn(['Processing', 'Ready', 'Released']), body('remarks').optional().trim().isLength({ max: 200 }).escape()],
  validate,
  wrap(async (req, res) => {
    const doc = await DocumentRequest.findByPk(req.params.id, { include: Student });
    if (!doc) return res.status(404).json({ error: 'Request not found' });
    if (!NEXT[doc.status].includes(req.body.status)) {
      return res.status(409).json({ error: `Cannot move a request from ${doc.status} to ${req.body.status}` });
    }
    await doc.update({ status: req.body.status, remarks: req.body.remarks || doc.remarks });
    await notify(doc.Student.userId, `Your request #${doc.id} (${doc.type}) is now: ${doc.status}.`);
    await audit(req, 'UPDATE_DOC_STATUS', 'DocumentRequest', doc.id, { status: doc.status });
    res.json(doc);
  })
);

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Student (owner) or registrar: printable copy of a document that is Ready/Released.
// Returns HTML the browser can print or save as PDF.
router.get(
  '/:id/download',
  [param('id').isInt()],
  validate,
  wrap(async (req, res) => {
    const doc = await DocumentRequest.findByPk(req.params.id, { include: [{ model: Student, include: [{ model: User, attributes: ['fullName', 'email'] }] }] });
    if (!doc) return res.status(404).json({ error: 'Request not found' });
    const isOwner = req.user.role === 'student' && doc.Student.userId === req.user.id;
    if (!isOwner && !['registrar', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission to do this' });
    if (!['Ready', 'Released'].includes(doc.status)) return res.status(409).json({ error: 'Document is not ready yet' });
    const university = process.env.UNIVERSITY_NAME || 'UniServe University';
    const issued = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.type)} #${doc.id}</title>
<style>body{font-family:Georgia,serif;max-width:700px;margin:40px auto;padding:0 24px;color:#111}h1{text-align:center;margin-bottom:0}
.sub{text-align:center;color:#555;margin-top:4px}hr{margin:24px 0}td{padding:6px 12px 6px 0;vertical-align:top}.sig{margin-top:80px;text-align:right}</style></head><body>
<h1>${esc(university)}</h1><p class="sub">Office of the Registrar</p><hr>
<h2 style="text-align:center">${esc(doc.type.toUpperCase())}</h2>
<table><tr><td><b>Student</b></td><td>${esc(doc.Student.User.fullName)}</td></tr>
<tr><td><b>Student No.</b></td><td>${esc(doc.Student.studentNumber)}</td></tr>
<tr><td><b>Request No.</b></td><td>${doc.id}</td></tr>
<tr><td><b>Copies</b></td><td>${doc.copies}</td></tr>
<tr><td><b>Purpose</b></td><td>${esc(doc.purpose)}</td></tr>
<tr><td><b>Date issued</b></td><td>${esc(issued)}</td></tr></table>
<p>This certifies that the above request was processed and approved by the Office of the Registrar.</p>
<div class="sig">______________________<br>University Registrar</div>
<script>window.onload=function(){window.print()}</script></body></html>`);
  })
);

module.exports = router;
