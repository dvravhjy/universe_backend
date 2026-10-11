require('dotenv').config();
const bcrypt = require('bcryptjs');
const {
  sequelize, User, Student, Subject, Section, Setting,
} = require('../src/models');
const { DEFAULT_SETTINGS } = require('../src/utils/helpers');

async function seed({ reset = true } = {}) {
  if (reset) await sequelize.sync({ force: true });
  else await sequelize.sync();

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) await Setting.upsert({ key, value });

  const pw = await bcrypt.hash('Password123', 10);
  const mk = (email, fullName, role, department = null) => User.create({ email, fullName, role, department, passwordHash: pw });

  const admin = await mk('admin@uniserve.edu', 'System Administrator', 'admin');
  await mk('registrar@uniserve.edu', 'Rita Registrar', 'registrar');
  await mk('cashier@uniserve.edu', 'Carlo Cashier', 'cashier');
  for (const d of ['Library', 'Laboratory', 'Guidance', 'Dean']) {
    await mk(`${d.toLowerCase()}@uniserve.edu`, `${d} Officer`, 'dept_staff', d);
  }
  const inst1 = await mk('instructor1@uniserve.edu', 'Prof. Ian Santos', 'instructor');
  const inst2 = await mk('instructor2@uniserve.edu', 'Prof. Maria Reyes', 'instructor');

  const studentUser = await mk('student@uniserve.edu', 'Sam Student', 'student');
  const student = await Student.create({ userId: studentUser.id, program: 'BS Computer Science', yearLevel: 2 });
  student.studentNo = `${new Date().getFullYear()}-${String(student.id).padStart(5, '0')}`;
  await student.save();

  const subjects = await Subject.bulkCreate([
    { code: 'CS201', title: 'Data Structures and Algorithms', units: 3 },
    { code: 'CS202', title: 'Software Engineering', units: 3 },
    { code: 'CS203', title: 'Database Management Systems', units: 3 },
    { code: 'MATH201', title: 'Discrete Mathematics', units: 3 },
    { code: 'GE101', title: 'Ethics', units: 3 },
    { code: 'PE201', title: 'Physical Education 3', units: 2 },
  ]);
  const term = { schoolYear: DEFAULT_SETTINGS.schoolYear, semester: DEFAULT_SETTINGS.semester };
  const sched = ['MWF 08:00-09:00', 'MWF 09:00-10:00', 'TTh 10:00-11:30', 'TTh 13:00-14:30', 'MWF 13:00-14:00', 'Sat 08:00-11:00'];
  await Section.bulkCreate(
    subjects.map((s, i) => ({
      subjectId: s.id, name: `${s.code}-A`, schedule: sched[i], room: `Room ${101 + i}`, capacity: 40,
      instructorId: i % 2 ? inst2.id : inst1.id, ...term,
    }))
  );
  return { admin };
}

if (require.main === module) {
  seed()
    .then(() => { console.log('Seed complete. All demo accounts use password: Password123'); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}

module.exports = seed;
