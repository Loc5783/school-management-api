require('dotenv').config();
const mongoose = require('mongoose');

const apply = process.argv.includes('--apply');

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const collection = mongoose.connection.collection('tuitionfees');
  const duplicates = await collection.aggregate([
    { $match: { status: { $in: ['unpaid', 'partial', 'paid'] } } },
    { $group: { _id: { studentId: '$studentId', period: '$period' }, count: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();
  if (duplicates.length) {
    console.error(JSON.stringify({ ok: false, duplicates }, null, 2));
    process.exitCode = 1;
    return;
  }
  const indexes = await collection.indexes();
  const current = indexes.find((index) => JSON.stringify(index.key) === JSON.stringify({ studentId: 1, period: 1 }));
  const result = { ok: true, apply, existingIndex: current?.name || null, unique: current?.unique === true };
  if (apply && current?.unique !== true) {
    if (current) await collection.dropIndex(current.name);
    await collection.createIndex(
      { studentId: 1, period: 1 },
      { unique: true, partialFilterExpression: { status: { $in: ['unpaid', 'partial', 'paid'] } }, name: 'studentId_1_period_1' }
    );
    result.unique = true;
  }
  console.log(JSON.stringify(result, null, 2));
};

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => mongoose.disconnect());
