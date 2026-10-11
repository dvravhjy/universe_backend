const express = require('express');
const { body } = require('express-validator');
const {
  Student, Section, Subject, User, Enrollment, EnrollmentItem, Grade, Charge, Payment, ClearanceItem, sequelize,
} = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { wrap, validate } = require('../middleware/common');
const { getSettings, audit, notify } = require('../utils/helpers');

const router = express.Router();
router.use(authenticate, requireRole('student'));

// Attach the student record for the logged-in user
router.use(wrap(async (req, res, next) => {
  req.student = await Student.findOne({ where: { userId: req.user.id } });
  if (!req.student) return res.status(404).json({ error: 'Student profile not found' });
  next();
}));

router.get('/profile', (req, res) => {
  res.json({ user: { fullName: req.user.fullName, email: req.user.email }, student: req.student });
});

router.put(
  '/profile',
  [
    body('phone').optional().trim().isLength({ max: 30 }).escape(),
    body('address').optional().trim().isLength({ max: 200 }).escape(),
  ],
  validate,
  wrap(async (req, res) => {
    const { phone, address } = req.body;
    await req.student.update({ phone, address });
    await audit(req, 'UPDATE_PROFILE', 'Student', req.student.id);
    res.json(req.student);
  })
);

// Sections open for the current term
router.get('/sections', wrap(async (req, res) => {
  const s = await getSettings();
  const sections = await Section.findAll({
    where: { schoolYear: s.schoolYear, semester: s.semester },
    include: [Subject, { model: User, as: 'instructor', attributes: ['fullName'] }],
  });
  const counts = await EnrollmentItem.findAll({
    attributes: ['sectionId', [sequelize.fn('COUNT', sequelize.col('id')), 'n']],
    group: ['sectionId'],
    raw: true,
  });
  const map = Object.fromEntries(counts.map((c) => [c.sectionId, Number(c.n)]));
  res.json(sections.map((sec) => ({ ...sec.toJSON(), enrolled: map[sec.id] || 0 })));
}));

// Submit enrollment (replaces physical queuing)
router.post(
  '/enrollment',
  [body('sectionIds').isArray({ min: 1, max: 12 }).withMessage('Choose 1-12 sections'), body('sectionIds.*').isInt()],
  validate,
  wrap(async (req, res) => {
    const s = await getSettings();
    if (s.enrollmentOpen !== 'true') return res.status(403).json({ error: 'Enrollment is currently closed' });

    const existing = await Enrollment.findOne({
      where: { studentId: req.student.id, schoolYear: s.schoolYear, semester: s.semester },
    });
    if (existing && existing.status !== 'Rejected') {
      return res.status(409).json({ error: 'You already have an enrollment for this term' });
    }

    const ids = [...new Set(req.body.sectionIds.map(Number))];
    const sections = await Section.findAll({
      where: { id: ids, schoolYear: s.schoolYear, semester: s.semester },
      include: Subject,
    });
    if (sections.length !== ids.length) return res.status(400).json({ error: 'One or more sections are invalid for this term' });

    const subjectIds = sections.map((x) => x.subjectId);
    if (new Set(subjectIds).size !== subjectIds.length) {
      return res.status(400).json({ error: 'You selected the same subject twice' });
    }

    const result = await sequelize.transaction(async (t) => {
      for (const sec of sections) {
        const taken = await EnrollmentItem.count({ where: { sectionId: sec.id }, transaction: t });
        if (taken >= sec.capacity) {
          const err = new Error(`Section ${sec.name} is full`);
          err.status = 409;
          throw err;
        }
      }
      const enrollment = existing
        ? await existing.update({ status: 'Submitted', remarks: null }, { transaction: t })
        : await Enrollment.create(
            { studentId: req.student.id, schoolYear: s.schoolYear, semester: s.semester },
            { transaction: t }
          );
      if (existing) await EnrollmentItem.destroy({ where: { enrollmentId: enrollment.id }, transaction: t });
      for (const sec of sections) {
        await EnrollmentItem.create({ enrollmentId: enrollment.id, sectionId: sec.id }, { transaction: t });
      }
      const units = sections.reduce((n, x) => n + x.Subject.units, 0);
      await Charge.create(
        { studentId: req.student.id, description: `Tuition ${s.schoolYear} ${s.semester} sem (${units} units)`, amount: units * Number(s.feePerUnit) },
        { transaction: t }
      );
      await Charge.create(
        { studentId: req.student.id, description: `Miscellaneous fees ${s.schoolYear} ${s.semester} sem`, amount: Number(s.miscFee) },
        { transaction: t }
      );
      return enrollment;
    });
    await audit(req, 'SUBMIT_ENROLLMENT', 'Enrollment', result.id);
    res.status(201).json(result);
  })
);

router.get('/enrollment', wrap(async (req, res) => {
  const list = await Enrollment.findAll({
    where: { studentId: req.student.id },
    include: [{ model: EnrollmentItem, as: 'items', include: [{ model: Section, include: Subject }] }],
    order: [['createdAt', 'DESC']],
  });
  res.json(list);
}));

// Schedule from validated enrollments only
router.get('/schedule', wrap(async (req, res) => {
  const s = await getSettings();
  const enr = await Enrollment.findOne({
    where: { studentId: req.student.id, schoolYear: s.schoolYear, semester: s.semester, status: 'Validated' },
    include: [{ model: EnrollmentItem, as: 'items', include: [{ model: Section, include: Subject }] }],
  });
  res.json(enr ? enr.items.map((i) => ({ code: i.Section.Subject.code, title: i.Section.Subject.title, units: i.Section.Subject.units, section: i.Section.name, schedule: i.Section.schedule, room: i.Section.room })) : []);
}));

// Only released grades are visible
router.get('/grades', wrap(async (req, res) => {
  const items = await EnrollmentItem.findAll({
    include: [
      { model: Enrollment, where: { studentId: req.student.id } },
      { model: Grade, where: { released: true }, required: true },
      { model: Section, include: Subject },
    ],
  });
  res.json(items.map((i) => ({
    schoolYear: i.Enrollment.schoolYear, semester: i.Enrollment.semester,
    code: i.Section.Subject.code, title: i.Section.Subject.title, units: i.Section.Subject.units,
    grade: i.Grade.value, remarks: i.Grade.remarks,
  })));
}));

// Clearance (auto-created per department for the current term)
router.get('/clearance', wrap(async (req, res) => {
  const s = await getSettings();
  for (const department of s.clearanceDepartments.split(',')) {
    await ClearanceItem.findOrCreate({
      where: { studentId: req.student.id, schoolYear: s.schoolYear, semester: s.semester, department },
    });
  }
  const items = await ClearanceItem.findAll({
    where: { studentId: req.student.id, schoolYear: s.schoolYear, semester: s.semester },
  });
  res.json({ items, fullyCleared: items.length > 0 && items.every((i) => i.status === 'Cleared') });
}));

router.get('/balance', wrap(async (req, res) => {
  const charges = await Charge.findAll({ where: { studentId: req.student.id }, include: Payment, order: [['createdAt', 'DESC']] });
  const total = charges.reduce((n, c) => n + Number(c.amount), 0);
  const paid = charges.reduce((n, c) => n + Number(c.paid), 0);
  res.json({ total, paid, balance: total - paid, charges });
}));

module.exports = router;
// notify is re-exported for other modules that import it from here in tests
module.exports.notify = notify;
