require('dotenv').config();
const mongoose = require('mongoose');
const Classroom = require('../models/zone3_school/Classroom');
const Student = require('../models/zone3_school/Student');
const { generateStudentCode } = require('../services/studentCoreService');

const schoolYear = '2026-2027';
const demoClasses = [
  { name: 'MGL 3-4 A', fullName: 'Mẫu giáo bé 3–4 tuổi, lớp A', ageGroup: '3-4', maxSize: 25 },
  { name: 'MGL 4-5 A', fullName: 'Mẫu giáo nhỡ 4–5 tuổi, lớp A', ageGroup: '4-5', maxSize: 25 },
  { name: 'MGL 5-6 B', fullName: 'Mẫu giáo lớn 5–6 tuổi, lớp B', ageGroup: '5-6', maxSize: 28 }
];
const demoStudents = [
  ['MGL 3-4 A', 'Bé Trần Gia Hân', '2022-03-15', 'female'], ['MGL 3-4 A', 'Bé Lê Minh Khang', '2022-07-21', 'male'], ['MGL 3-4 A', 'Bé Phạm Bảo Ngọc', '2022-11-06', 'female'],
  ['MGL 4-5 A', 'Bé Nguyễn Đức Anh', '2021-02-19', 'male'], ['MGL 4-5 A', 'Bé Võ Khánh Linh', '2021-06-12', 'female'], ['MGL 4-5 A', 'Bé Đặng Hoàng Nam', '2021-09-27', 'male'],
  ['MGL 5-6 B', 'Bé Bùi Thanh Mai', '2020-01-30', 'female'], ['MGL 5-6 B', 'Bé Hồ Quốc Bảo', '2020-05-18', 'male'], ['MGL 5-6 B', 'Bé Dương Nhật Minh', '2020-10-09', 'male']
];

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const session = await mongoose.startSession(); let createdClasses = 0; let createdStudents = 0;
  try {
    await session.withTransaction(async () => {
      const classes = new Map();
      for (const item of demoClasses) {
        let classroom = await Classroom.findOne({ name: item.name, schoolYear }).session(session);
        if (!classroom) { classroom = (await Classroom.create([{ ...item, schoolYear, status: 'active', statistics: { currentStudents: 0, male: 0, female: 0 } }], { session }))[0]; createdClasses += 1; }
        classes.set(item.name, classroom);
      }
      for (const [className, fullName, birthDate, gender] of demoStudents) {
        const classroom = classes.get(className);
        if (await Student.exists({ classroomId: classroom._id, fullName }).session(session)) continue;
        const admissionDate = new Date('2026-08-20T00:00:00.000Z');
        await Student.create([{ studentCode: await generateStudentCode(admissionDate, session), fullName, birthDate: new Date(birthDate), gender, classroomId: classroom._id, className: classroom.name, schoolYear, admissionDate, enrollmentDate: admissionDate, status: 'enrolled' }], { session });
        await Classroom.updateOne({ _id: classroom._id }, { $inc: { 'statistics.currentStudents': 1, [`statistics.${gender === 'male' ? 'male' : 'female'}`]: 1 } }, { session });
        createdStudents += 1;
      }
    });
    console.log(`Đã thêm ${createdClasses} lớp và ${createdStudents} học sinh mẫu.`);
  } finally { await session.endSession(); await mongoose.disconnect(); }
};
run().catch(async (err) => { console.error(err); await mongoose.disconnect(); process.exit(1); });
