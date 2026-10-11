const express = require('express');
const { param } = require('express-validator');
const { Notification } = require('../models');
const { authenticate } = require('../middleware/auth');
const { wrap, validate } = require('../middleware/common');

const router = express.Router();
router.use(authenticate);

router.get('/', wrap(async (req, res) => {
  res.json(await Notification.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']], limit: 50 }));
}));

router.patch('/:id/read', [param('id').isInt()], validate, wrap(async (req, res) => {
  const n = await Notification.findOne({ where: { id: req.params.id, userId: req.user.id } });
  if (!n) return res.status(404).json({ error: 'Notification not found' });
  await n.update({ read: true });
  res.json(n);
}));

module.exports = router;
