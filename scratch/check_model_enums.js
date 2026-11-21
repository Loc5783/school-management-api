'use strict';

const path = require('path');
process.env.NODE_PATH = path.join(__dirname, '../backend/node_modules');
require('module').Module._initPaths();

const models = [
  '../backend/src/models/zone2_hr/Employee',
  '../backend/src/models/zone2_hr/StaffShift',
  '../backend/src/models/zone2_hr/InternalAnnouncement',
  '../backend/src/models/zone3_school/SecurityIncident',
  '../backend/src/models/zone3_school/GuardEmergencyMode',
  '../backend/src/models/zone4_finance/OperatingExpense',
  '../backend/src/models/zone4_finance/PurchaseExpense',
  '../backend/src/models/zone5_nutrition/Dish',
  '../backend/src/models/zone5_nutrition/IngredientMaster',
  '../backend/src/models/zone6_procurement/ItemMaster',
  '../backend/src/models/zone6_procurement/ProcurementRequest',
  '../backend/src/models/zone6_procurement/Asset'
];

models.forEach(mPath => {
  const M = require(mPath);
  M.schema.eachPath((pathname, schematype) => {
    if (schematype.enumValues && schematype.enumValues.length > 0) {
      console.log(`${M.modelName}.${pathname}: enums = [${schematype.enumValues.join(', ')}]`);
    }
  });
});
