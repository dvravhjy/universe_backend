const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const ROLES = ['student', 'registrar', 'cashier', 'dept_staff', 'instructor', 'admin'];
const DOC_STATUSES = ['Submitted', 'Payment Pending', 'Paid', 'Processing', 'Ready', 'Released'];
const DOC_TYPES = [
  'Transcript of Records (TOR)',
  'Certificate of Enrollment',
  'Good Moral Certificate',
  'Diploma Copy',
  'Certificate of Grades',
];

const User = sequelize.define('User', {
  email: { type: DataTypes.STRING, allowNull: false, unique: true, validate: { isEmail: true } },
  passwordHash: { type: DataTypes.STRING, allowNull: false },
  fullName: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.ENUM(...ROLES), allowNull: false, defaultValue: 'student' },
  department: { type: DataTypes.STRING }, // for dept_staff (Library, Laboratory, Guidance, Dean)
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
  failedAttempts: { type: DataTypes.INTEGER, defaultValue: 0 },
  lockedUntil: { type: DataTypes.DATE },
});

const Student = sequelize.define('Student', {
  studentNo: { type: DataTypes.STRING, unique: true },
  program: { type: DataTypes.STRING, allowNull: false },
  yearLevel: { type: DataTypes.INTEGER, defaultValue: 1 },
  status: { type: DataTypes.STRING, defaultValue: 'Active' },
  phone: { type: DataTypes.STRING },
  address: { type: DataTypes.STRING },
});

const Subject = sequelize.define('Subject', {
  code: { type: DataTypes.STRING, allowNull: false, unique: true },
  title: { type: DataTypes.STRING, allowNull: false },
  units: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3 },
});

const Section = sequelize.define('Section', {
  name: { type: DataTypes.STRING, allowNull: false },
  schedule: { type: DataTypes.STRING, allowNull: false }, // e.g. "MWF 08:00-09:00"
  room: { type: DataTypes.STRING },
  capacity: { type: DataTypes.INTEGER, defaultValue: 40 },
  schoolYear: { type: DataTypes.STRING, allowNull: false },
  semester: { type: DataTypes.STRING, allowNull: false },
});

const Enrollment = sequelize.define('Enrollment', {
  schoolYear: { type: DataTypes.STRING, allowNull: false },
  semester: { type: DataTypes.STRING, allowNull: false },
  status: { type: DataTypes.ENUM('Submitted', 'Validated', 'Rejected'), defaultValue: 'Submitted' },
  remarks: { type: DataTypes.STRING },
});

const EnrollmentItem = sequelize.define('EnrollmentItem', {});

const Grade = sequelize.define('Grade', {
  value: { type: DataTypes.FLOAT, validate: { min: 1, max: 5 } },
  remarks: { type: DataTypes.STRING },
  released: { type: DataTypes.BOOLEAN, defaultValue: false },
});

const Charge = sequelize.define('Charge', {
  description: { type: DataTypes.STRING, allowNull: false },
  amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  paid: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  status: { type: DataTypes.ENUM('Unpaid', 'Partial', 'Paid'), defaultValue: 'Unpaid' },
});

const Payment = sequelize.define('Payment', {
  amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  method: { type: DataTypes.STRING, defaultValue: 'Cash' },
  receiptNo: { type: DataTypes.STRING, unique: true },
});

const ClearanceItem = sequelize.define('ClearanceItem', {
  schoolYear: { type: DataTypes.STRING, allowNull: false },
  semester: { type: DataTypes.STRING, allowNull: false },
  department: { type: DataTypes.STRING, allowNull: false },
  status: { type: DataTypes.ENUM('Pending', 'Cleared', 'Hold'), defaultValue: 'Pending' },
  remarks: { type: DataTypes.STRING },
});

const DocumentRequest = sequelize.define('DocumentRequest', {
  type: { type: DataTypes.STRING, allowNull: false },
  purpose: { type: DataTypes.STRING },
  copies: { type: DataTypes.INTEGER, defaultValue: 1 },
  status: { type: DataTypes.ENUM(...DOC_STATUSES), defaultValue: 'Submitted' },
  fee: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  remarks: { type: DataTypes.STRING },
});

const Setting = sequelize.define('Setting', {
  key: { type: DataTypes.STRING, primaryKey: true },
  value: { type: DataTypes.STRING, allowNull: false },
});

const AuditLog = sequelize.define('AuditLog', {
  action: { type: DataTypes.STRING, allowNull: false },
  entity: { type: DataTypes.STRING },
  entityId: { type: DataTypes.STRING },
  details: { type: DataTypes.TEXT },
  ip: { type: DataTypes.STRING },
});

const Notification = sequelize.define('Notification', {
  message: { type: DataTypes.STRING, allowNull: false },
  read: { type: DataTypes.BOOLEAN, defaultValue: false },
});

// Associations
User.hasOne(Student, { foreignKey: 'userId' });
Student.belongsTo(User, { foreignKey: 'userId' });

Subject.hasMany(Section, { foreignKey: 'subjectId' });
Section.belongsTo(Subject, { foreignKey: 'subjectId' });
User.hasMany(Section, { foreignKey: 'instructorId', as: 'teaching' });
Section.belongsTo(User, { foreignKey: 'instructorId', as: 'instructor' });

Student.hasMany(Enrollment, { foreignKey: 'studentId' });
Enrollment.belongsTo(Student, { foreignKey: 'studentId' });
Enrollment.hasMany(EnrollmentItem, { foreignKey: 'enrollmentId', as: 'items' });
EnrollmentItem.belongsTo(Enrollment, { foreignKey: 'enrollmentId' });
Section.hasMany(EnrollmentItem, { foreignKey: 'sectionId' });
EnrollmentItem.belongsTo(Section, { foreignKey: 'sectionId' });
EnrollmentItem.hasOne(Grade, { foreignKey: 'enrollmentItemId' });
Grade.belongsTo(EnrollmentItem, { foreignKey: 'enrollmentItemId' });

Student.hasMany(Charge, { foreignKey: 'studentId' });
Charge.belongsTo(Student, { foreignKey: 'studentId' });
Charge.hasMany(Payment, { foreignKey: 'chargeId' });
Payment.belongsTo(Charge, { foreignKey: 'chargeId' });
User.hasMany(Payment, { foreignKey: 'cashierId' });
Payment.belongsTo(User, { foreignKey: 'cashierId', as: 'cashier' });

Student.hasMany(ClearanceItem, { foreignKey: 'studentId' });
ClearanceItem.belongsTo(Student, { foreignKey: 'studentId' });

Student.hasMany(DocumentRequest, { foreignKey: 'studentId' });
DocumentRequest.belongsTo(Student, { foreignKey: 'studentId' });
Charge.hasOne(DocumentRequest, { foreignKey: 'chargeId' });
DocumentRequest.belongsTo(Charge, { foreignKey: 'chargeId' });

User.hasMany(AuditLog, { foreignKey: 'userId' });
AuditLog.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(Notification, { foreignKey: 'userId' });
Notification.belongsTo(User, { foreignKey: 'userId' });

module.exports = {
  sequelize,
  ROLES,
  DOC_STATUSES,
  DOC_TYPES,
  User,
  Student,
  Subject,
  Section,
  Enrollment,
  EnrollmentItem,
  Grade,
  Charge,
  Payment,
  ClearanceItem,
  DocumentRequest,
  Setting,
  AuditLog,
  Notification,
};
