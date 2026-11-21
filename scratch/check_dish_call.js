const path = require('path');
process.env.TIMEKEEPING_SCHEDULER_ENABLED = 'false';
process.env.JWT_SECRET = 'school_management_super_secret_jwt_key_rehearsal_32_chars_min';
const mongoose = require(path.join(__dirname, '../backend/node_modules/mongoose'));
mongoose.set('autoIndex', false);
const createProductionSaasApp = require(path.join(__dirname, '../backend/src/saas/createProductionSaasApp'));
const request = require(path.join(__dirname, '../backend/node_modules/supertest'));

async function test() {
  await mongoose.connect('mongodb://127.0.0.1:27018/school_rehearsal_20261111?directConnection=true');
  const app = createProductionSaasApp({
    connection: mongoose.connection,
    allowedDbNames: ['school_rehearsal_20261111']
  });
  const loginChefA = await request(app).post('/api/auth/login').send({ schoolCode: 'HOANANG-A', username: 'chef', password: '123456' });
  const tokenChefA = loginChefA.body?.token;

  // Let's test PUT /dishes/:id on non-existent or other tenant dish
  const fakeId = new mongoose.Types.ObjectId();
  const putRes = await request(app).put('/api/nutrition/dishes/' + fakeId).set('Authorization', 'Bearer ' + tokenChefA).send({ name: 'Hack' });
  console.log('PUT DISH STATUS:', putRes.status, putRes.body);

  const getRes = await request(app).get('/api/nutrition/dishes/' + fakeId).set('Authorization', 'Bearer ' + tokenChefA);
  console.log('GET DISH STATUS:', getRes.status, getRes.body);

  await mongoose.disconnect();
  process.exit(0);
}
test().catch(err => {
  console.error('ERROR:', err);
  process.exit(1);
});
