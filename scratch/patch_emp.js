const fs = require('fs');
let s = fs.readFileSync('frontend/src/pages/EmployeeManagement.jsx', 'utf8');
const target = '          </div>\r\n        )}';
const addition = `\r\n\r\n        {tab === 'devices' && (\r\n          <section className="content-card">\r\n            <TimekeepingDeviceManagement />\r\n          </section>\r\n        )}`;
if (s.includes(target)) {
  s = s.replace(target, target + addition);
  fs.writeFileSync('frontend/src/pages/EmployeeManagement.jsx', s, 'utf8');
  console.log('PATCH_OK');
} else {
  console.log('TARGET_NOT_FOUND');
}
