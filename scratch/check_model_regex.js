'use strict';

const path = require('path');
process.env.NODE_PATH = path.join(__dirname, '../backend/node_modules');
require('module').Module._initPaths();

const models = [
  '../backend/src/models/zone2_hr/Employee',
  '../backend/src/models/zone2_hr/Department',
  '../backend/src/models/zone5_nutrition/Supplier',
  '../backend/src/models/zone5_nutrition/IngredientMaster',
  '../backend/src/models/zone5_nutrition/FoodSample',
  '../backend/src/models/zone6_procurement/PurchaseOrder'
];

models.forEach(mPath => {
  const M = require(mPath);
  M.schema.eachPath((pathname, schematype) => {
    if (schematype.options && schematype.options.match) {
      console.log(`${M.modelName}.${pathname}: match = ${schematype.options.match}`);
    }
  });
});
