const fs = require('fs');

let content = fs.readFileSync('backend/scripts/rehearse_cutover.js', 'utf8');

// 1. Update INDEX_GROUPS count log and add guardemergencymodes
content = content.replace(
  `  console.log('\\n[5/10] Chuyển đổi và kiểm chứng va chạm (Collision) cho 21 nhóm Index...');`,
  `  console.log('\\n[5/10] Chuyển đổi và kiểm chứng va chạm (Collision) cho 22 nhóm Index...');`
);

const oldIndexGroupEnd = `    {
      col: 'evaluationperiods',
      oldIndex: 'code_1',
      field: 'code',
      newSpecs: [
        { name: 'tenantId_1_code_1_unique', keys: { tenantId: 1, code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
        { name: 'legacy_code_1_unique', keys: { code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
      ],
      sampleVal: 'EVAL_TEST_001'
    }
  ];`;

const newIndexGroupEnd = `    {
      col: 'evaluationperiods',
      oldIndex: 'code_1',
      field: 'code',
      newSpecs: [
        { name: 'tenantId_1_code_1_unique', keys: { tenantId: 1, code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
        { name: 'legacy_code_1_unique', keys: { code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
      ],
      sampleVal: 'EVAL_TEST_001'
    },
    {
      col: 'guardemergencymodes',
      oldIndex: 'activeKey_1',
      field: 'activeKey',
      newSpecs: [
        { name: 'tenantId_1_activeKey_1_unique', keys: { tenantId: 1, activeKey: 1 }, options: { unique: true, partialFilterExpression: { status: 'active', tenantId: { $type: 'objectId' } } } },
        { name: 'legacy_activeKey_1_unique', keys: { activeKey: 1 }, options: { unique: true, partialFilterExpression: { status: 'active', tenantId: null } } }
      ],
      sampleVal: 'GLOBAL'
    }
  ];`;

content = content.replace(oldIndexGroupEnd, newIndexGroupEnd);

// 2. Update makeDoc in Step 5 for guardemergencymodes
const oldMakeDocPart = `      } else if (group.col === 'studentcodecounters') {
        doc.seq = 1;
      }`;

const newMakeDocPart = `      } else if (group.col === 'studentcodecounters') {
        doc.seq = 1;
      } else if (group.col === 'guardemergencymodes') {
        doc.status = 'active';
        doc.level = 'security';
        doc.title = 'Test';
        doc.instructions = 'Test';
        doc.activatedBy = new mongoose.Types.ObjectId();
        doc.activatedByName = 'Bảo Vệ';
      }`;

content = content.replace(oldMakeDocPart, newMakeDocPart);

// 3. Update COMPOUND_INDEX_VERIFICATIONS in Step 10
const oldCompoundVerifsEnd = `    { col: 'evaluationperiods', expectedKey: { tenantId: 1, code: 1 } }
  ];`;

const newCompoundVerifsEnd = `    { col: 'evaluationperiods', expectedKey: { tenantId: 1, code: 1 } },
    { col: 'guardemergencymodes', expectedKey: { tenantId: 1, activeKey: 1 } }
  ];`;

content = content.replace(oldCompoundVerifsEnd, newCompoundVerifsEnd);

content = content.replace(
  `  console.log('\\n  -> Thực hiện kiểm kê xác nhận 21 bộ sưu tập nghiệp vụ có Compound Multi-Tenant Unique Index...');`,
  `  console.log('\\n  -> Thực hiện kiểm kê xác nhận 22 bộ sưu tập nghiệp vụ có Compound Multi-Tenant Unique Index...');`
);

content = content.replace(
  `recordAssertion('All 21 business collections have active compound tenant unique indexes', verifiedCompoundCount === 21);`,
  `recordAssertion('All 22 business collections have active compound tenant unique indexes', verifiedCompoundCount === 22);`
);

fs.writeFileSync('backend/scripts/rehearse_cutover.js', content, 'utf8');
console.log('Added guardemergencymodes to rehearse_cutover.js successfully!');
